/**
 * Inngest function — Durable game finalization pipeline.
 *
 * Remplace l'ancien Lambda 2 (`/api/internal/finalize-game`) par un workflow
 * Inngest durable. Lambda 1 (`generateGameFromTemplate` dans
 * `/api/games/generate`) reste inchangé pour l'instant — il insère la row
 * games avec `is_published=false` et envoie ensuite l'event Inngest qui
 * déclenche cette fonction.
 *
 * Architecture en steps (chacun mémoïsé, retry indépendant) :
 *
 *   1. `prepare-package` (5-10 min) — Traductions Gemini + audio ElevenLabs.
 *      Step le plus long et le plus flaky (Gemini rate limits, ElevenLabs
 *      latence). 3 retries via Inngest natif.
 *
 *   2. `validate-initial`         (10s) — `validateFinalGame()`.
 *      Détecte les 5 issues : twin_stops, below_floor, roman_date_drift,
 *      translation_incomplete, audio_coverage_mismatch.
 *
 *   3. `auto-repair-iter-N`       (1-3 min) — Tente de réparer les issues.
 *      Boucle jusqu'à 3 itérations. Chaque iter = step Inngest dédié →
 *      observable + durable + retryable indépendamment.
 *
 *   4. `validate-after-iter-N`    (10s) — Re-validation post-repair.
 *
 *   5. `publish-or-flag`           (1s) — UPDATE games SET is_published=true
 *      (OU needs_review=true si validator KO après 3 iter).
 *
 *   6. `notify-callback`           (5s) — Callback HTTP OddballTrip.
 *      Non-bloquant : si callback fail, log warn mais on ne re-throw pas.
 *
 *   7. `email-needs-review`        (2s) — Email opérateur si flagged.
 *
 *   8. `emit-succeeded`            (1s) — Event final `game/generate.succeeded`.
 *
 * Échec : si un step épuise ses retries (config function-level), Inngest
 * fire l'event `game/generate.failed` consommé par
 * `handleGenerateGameFailure` (dead letter handler, fichier séparé).
 *
 * Idempotence : chaque step DOIT être idempotent. `prepareGamePackage`,
 * `validateFinalGame`, `attemptAutoRepair` le sont déjà (skip-if-exists,
 * pure reads, op-by-op DB writes). Le step `publish-or-flag` est un
 * simple UPDATE → idempotent par nature.
 */

import { inngest, gameGenerateRequested } from "@/lib/inngest-client";
import { prepareGamePackage } from "@/lib/game-package";
import { validateFinalGame } from "@/lib/pipeline-validators";
import { attemptAutoRepair } from "@/lib/pipeline-auto-repair";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNeedsReviewAlert } from "@/lib/email";
import type { GameGenre } from "@/lib/game-genres";

/** Nombre maximum d'itérations de la boucle auto-repair. Au-delà, le
 *  jeu est flaggé `needs_review=true` pour inspection humaine. Aligné
 *  sur la valeur historique de pipeline-finalize.ts. */
const MAX_REPAIR_ITERATIONS = 3;

export const generateGame = inngest.createFunction(
  {
    id: "generate-game",
    name: "Generate game (durable finalize)",
    triggers: [{ event: gameGenerateRequested }],
    /**
     * Concurrency cap global — max 5 jeux finalisés en parallèle.
     *
     * Pourquoi 5 : limite hard du plan Inngest free tier. Très suffisant
     * pour 3500 jeux/mois (~5 jeux/heure de moyenne, peak ~15/h sur les
     * weekends). Si Inngest reçoit 20 events en burst, il queue les 15
     * surplus et les exécute au fil de l'eau au lieu de tous faire
     * timeout — exactement le comportement qu'on veut.
     *
     * Si on dépasse durablement (>100 jeux/heure régulier), upgrade
     * Inngest Pro à $20/mois qui donne 50 en parallèle.
     */
    concurrency: { limit: 5 },
    /**
     * Retry budget au niveau function. Si un step throw après ces N
     * tentatives, l'event `game/generate.failed` est émis automatiquement
     * par Inngest (via le bloc onFailure ci-dessous).
     *
     * 3 = bon compromis pour gérer les transients Gemini/ElevenLabs sans
     * boucler trop longtemps sur des issues déterministes (ex. discovery
     * trop pauvre).
     */
    retries: 3,
    /**
     * Dead letter — fires après que tous les retries ci-dessus sont épuisés.
     * On émet un event `game/generate.failed` qui est consommé par
     * `handleGenerateGameFailure` (fichier séparé : dead-letter.ts) pour
     * flagger `needs_review=true` + envoyer une alerte email opérateur.
     */
    onFailure: async ({ event, error }) => {
      // `event` ici est l'event de l'exception (`inngest/function.failed`),
      // PAS l'event original. L'original est dans `event.data.event`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalEvent = (event as any).data?.event;
      const gameId = originalEvent?.data?.gameId ?? "unknown";
      await inngest.send({
        name: "game/generate.failed",
        data: {
          gameId,
          step: "pipeline",
          error: error?.message ?? String(error),
          attempts: 0,
        },
      });
    },
  },
  async ({ event, step, logger }) => {
    const {
      gameId,
      slug,
      language,
      city,
      theme,
      narrative,
      genre,
      buyerEmail,
      orderId,
      callbackUrl,
      callbackSecret,
    } = event.data;

    logger.info(
      `[generate-game] Starting finalize gameId=${gameId} slug=${slug} lang=${language ?? "(none)"}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // Step 1 — prepareGamePackage (translations + audio)
    // ─────────────────────────────────────────────────────────────────
    const packageResult = await step.run("prepare-package", async () => {
      if (!language || !/^[a-z]{2}$/.test(language)) {
        logger.warn(
          `[generate-game] No valid language (got "${language}") — skipping audio pre-gen, player will fall back to browser TTS`,
        );
        return {
          audioGenerated: 0,
          audioSkipped: 0,
          audioFailed: 0,
          skipped: true as const,
        };
      }
      const pkg = await prepareGamePackage(gameId, language);
      if (!pkg.success) {
        // Throw → Inngest will retry this step (function-level retries: 3)
        throw new Error(
          `prepareGamePackage failed for ${gameId} (${language}): ${pkg.errors.join("; ")}`,
        );
      }
      logger.info(
        `[generate-game] Package ready — audio generated=${pkg.audioGenerated}, skipped=${pkg.audioSkipped}, failed=${pkg.audioFailed}`,
      );
      return {
        audioGenerated: pkg.audioGenerated,
        audioSkipped: pkg.audioSkipped,
        audioFailed: pkg.audioFailed,
        skipped: false as const,
      };
    });

    // ─────────────────────────────────────────────────────────────────
    // Step 2 — Validator initial
    // ─────────────────────────────────────────────────────────────────
    let finalValidation = await step.run("validate-initial", () =>
      validateFinalGame(gameId, language),
    );
    logger.info(
      `[generate-game] Initial validator: ok=${finalValidation.ok}, issues=${finalValidation.issues.length}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // Step 3 — Auto-repair loop (max 3 iterations, each = its own step)
    // ─────────────────────────────────────────────────────────────────
    let repairIteration = 0;
    const allAttemptedIssues: string[] = [];
    const allUnrepairableIssues: string[] = [];

    while (
      !finalValidation.ok &&
      repairIteration < MAX_REPAIR_ITERATIONS
    ) {
      repairIteration++;
      const iterIdx = repairIteration; // capture for step closure

      const repair = await step.run(
        { id: `auto-repair-iter-${iterIdx}`, name: `Auto-repair iter ${iterIdx}` },
        () =>
          attemptAutoRepair(gameId, finalValidation, {
            language,
            city,
            theme,
            narrative,
            genre: genre as GameGenre | undefined,
          }),
      );
      allAttemptedIssues.push(...repair.attemptedIssues);
      allUnrepairableIssues.push(...repair.unrepairableIssues);

      logger.info(
        `[generate-game] Repair iter ${iterIdx} → attempted=[${repair.attemptedIssues.join(",")}], unrepairable=[${repair.unrepairableIssues.join(",")}]`,
      );

      if (!repair.anyAttempted) {
        logger.info(
          `[generate-game] No more repairable issues at iter ${iterIdx} — exiting loop`,
        );
        break;
      }

      finalValidation = await step.run(
        { id: `validate-after-iter-${iterIdx}`, name: `Validate after repair ${iterIdx}` },
        () => validateFinalGame(gameId, language),
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 4 — Publish OR flag needs_review
    // ─────────────────────────────────────────────────────────────────
    const publishResult = await step.run("publish-or-flag", async () => {
      const supabase = createAdminClient();

      if (finalValidation.ok) {
        // Validator passed → publish + reset any sticky needs_review flag
        // (peut traîner d'une iteration précédente où validator avait failed,
        // observé Lugdunum V5 11/05).
        const { error } = await supabase
          .from("games")
          .update({
            is_published: true,
            needs_review: false,
            review_reason: null,
          })
          .eq("id", gameId);
        if (error) {
          throw new Error(`Failed to flip is_published: ${error.message}`);
        }
        logger.info(
          `[generate-game] ✅ is_published=true after ${repairIteration} repair iter(s)`,
        );
        return {
          isPublished: true,
          needsReview: false,
          reviewReason: null as string | null,
        };
      }

      // Validator KO after max iter → flag for human review
      const { data: currentGame } = await supabase
        .from("games")
        .select("review_reason")
        .eq("id", gameId)
        .single();
      const existingReason = currentGame?.review_reason ?? "";
      const combinedReason = existingReason
        ? `${existingReason} | ${finalValidation.reviewReason ?? "validator failed"}`
        : (finalValidation.reviewReason ??
          `validator failed after ${MAX_REPAIR_ITERATIONS} repair iter(s)`);

      const { error: flagErr } = await supabase
        .from("games")
        .update({
          needs_review: true,
          review_reason: combinedReason,
        })
        .eq("id", gameId);
      if (flagErr) {
        throw new Error(`Failed to flag needs_review: ${flagErr.message}`);
      }
      logger.warn(
        `[generate-game] ⚠ Validator KO after ${repairIteration} iter(s) — flagged needs_review: ${combinedReason}`,
      );
      return {
        isPublished: false,
        needsReview: true,
        reviewReason: combinedReason,
      };
    });

    // ─────────────────────────────────────────────────────────────────
    // Step 5 — Callback HTTP OddballTrip (non-bloquant si échec)
    // ─────────────────────────────────────────────────────────────────
    if (callbackUrl) {
      await step.run("notify-callback", async () => {
        try {
          const res = await fetch(callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(callbackSecret && {
                Authorization: `Bearer ${callbackSecret}`,
              }),
            },
            body: JSON.stringify({
              success: publishResult.isPublished,
              gameId,
              slug,
              ...(publishResult.needsReview
                ? {
                    needsReview: true,
                    reviewReason: publishResult.reviewReason,
                  }
                : {}),
            }),
          });
          logger.info(
            `[generate-game] Callback to ${callbackUrl} → ${res.status} ${res.statusText}`,
          );
        } catch (err) {
          // Callback fail = NOT FATAL. Le jeu est publié, OddballTrip
          // peut le récupérer via /api/external/find-game. On log et on
          // continue. Re-throw causerait un retry de toute la fonction
          // ce qui re-jouerait validate/repair/publish — overkill.
          logger.warn(
            `[generate-game] Callback failed (non-fatal): ${err instanceof Error ? err.message : err}`,
          );
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 6 — Email alert si needs_review
    // ─────────────────────────────────────────────────────────────────
    if (publishResult.needsReview && publishResult.reviewReason) {
      await step.run("email-needs-review", async () => {
        try {
          await sendNeedsReviewAlert({
            gameId,
            slug,
            city,
            theme,
            reviewReason: publishResult.reviewReason!,
            buyerEmail,
            orderId,
          });
          logger.info(`[generate-game] needs_review email sent`);
        } catch (err) {
          // Email fail non-fatal, log seul
          logger.warn(
            `[generate-game] needs_review email failed (non-fatal): ${err instanceof Error ? err.message : err}`,
          );
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 7 — Emit succeeded event (pour observabilité / future analytics)
    // ─────────────────────────────────────────────────────────────────
    await step.sendEvent("emit-succeeded", {
      name: "game/generate.succeeded",
      data: {
        gameId,
        // durationMs n'est pas trivial à calculer ici (steps mémoïsés),
        // on laisse 0 et on regardera la durée totale dans le dashboard Inngest.
        durationMs: 0,
      },
    });

    return {
      gameId,
      slug,
      isPublished: publishResult.isPublished,
      needsReview: publishResult.needsReview,
      reviewReason: publishResult.reviewReason,
      audioGenerated: packageResult.audioGenerated,
      audioFailed: packageResult.audioFailed,
      repairIterations: repairIteration,
      attemptedIssues: allAttemptedIssues,
      unrepairableIssues: allUnrepairableIssues,
    };
  },
);
