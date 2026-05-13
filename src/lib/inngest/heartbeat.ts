/**
 * Inngest function — Heartbeat / stuck-game recovery.
 *
 * Cron qui tourne toutes les 5 minutes et scan la table games pour
 * détecter les jeux "stuck" : `is_published=false` AND `created_at >
 * 30 min ago` AND `needs_review=false`. Ce sont des jeux qui ont été
 * insérés par Lambda 1 mais dont la finalisation n'a jamais terminé.
 *
 * Causes possibles d'un stuck game (filet de sécurité de filet de sécurité) :
 *
 *   - L'event `game/generate.requested` n'a pas été émis par Lambda 1
 *     (bug côté entry route, OOM, hard kill).
 *   - L'event a été émis mais Inngest Cloud était indisponible à ce
 *     moment précis (rarissime, ~0.01% uptime).
 *   - La fonction `generateGame` a planté avec une exception non-catchée
 *     hors des step.run (rarissime, mais possible).
 *
 * Action : pour chaque stuck game, ré-émet l'event `game/generate.requested`
 * avec les params re-chargés depuis la DB. La fonction `generateGame` est
 * idempotente (steps mémoïsés par Inngest, code métier idempotent), donc
 * ce re-fire est sans risque même si le jeu était en cours de finalize.
 *
 * Note : on ne touche PAS aux jeux `needs_review=true` (déjà dans la dead
 * letter queue, attendent l'opérateur). On ne touche pas non plus aux jeux
 * créés il y a moins de 30 min (laisser le temps à la finalize de finir
 * normalement).
 */

import { inngest } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";

/** Âge minimum pour qu'un jeu unpublished soit considéré "stuck".
 *  30 min couvre largement le cas normal (5-15 min de finalize) +
 *  buffer pour les retries Inngest. */
const STUCK_THRESHOLD_MIN = 30;

/** Hard cap sur le nombre de stuck games rejoués à chaque tick.
 *  Évite qu'un bug remontant des centaines de stuck d'un coup ne
 *  fasse exploser le quota Gemini. */
const MAX_REPLAYS_PER_TICK = 5;

export const recoverStuckGames = inngest.createFunction(
  {
    id: "recover-stuck-games",
    name: "Heartbeat — Recover stuck game generations",
    triggers: [{ cron: "*/5 * * * *" }], // Toutes les 5 minutes
    retries: 1,
  },
  async ({ step, logger }) => {
    // ─────────────────────────────────────────────────────────────────
    // Step 1 — Query stuck games
    // ─────────────────────────────────────────────────────────────────
    const stuckGames = await step.run("find-stuck-games", async () => {
      const supabase = createAdminClient();
      const cutoff = new Date(
        Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000,
      ).toISOString();
      const { data, error } = await supabase
        .from("games")
        .select("id, slug, city, theme, narrative, language, genre, created_at")
        .eq("is_published", false)
        .eq("needs_review", false)
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(MAX_REPLAYS_PER_TICK);
      if (error) {
        throw new Error(`Query stuck games failed: ${error.message}`);
      }
      return data ?? [];
    });

    if (stuckGames.length === 0) {
      logger.info(`[heartbeat] No stuck games`);
      return { stuckCount: 0, replayed: 0 };
    }

    logger.warn(
      `[heartbeat] Found ${stuckGames.length} stuck game(s) (${STUCK_THRESHOLD_MIN}+ min old, unpublished, not flagged for review) — re-firing events`,
    );

    // ─────────────────────────────────────────────────────────────────
    // Step 2 — Re-fire events
    // ─────────────────────────────────────────────────────────────────
    // On émet UN event par stuck game. Pas de Promise.all → on les fait
    // séquentiellement pour ne pas burst Inngest. step.sendEvent attend
    // l'ack avant de continuer.
    for (const game of stuckGames) {
      await step.sendEvent(`replay-${game.id}`, {
        name: "game/generate.requested",
        data: {
          gameId: game.id,
          slug: game.slug,
          language: game.language ?? undefined,
          city: game.city,
          theme: game.theme,
          narrative: game.narrative,
          genre: game.genre ?? undefined,
          // Pas de callbackUrl ici — c'est un replay interne, on ne notifie
          // pas OddballTrip à nouveau (ils ont déjà reçu le callback de
          // l'appel initial, ou ils polleront find-game eux-mêmes).
        },
      });
      logger.warn(
        `[heartbeat] Re-fired generate event for stuck game ${game.id} (${game.slug}), created ${game.created_at}`,
      );
    }

    return {
      stuckCount: stuckGames.length,
      replayed: stuckGames.length,
      replayedIds: stuckGames.map((g) => g.id),
    };
  },
);
