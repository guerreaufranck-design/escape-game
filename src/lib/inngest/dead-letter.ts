/**
 * Inngest function — Dead letter handler pour la pipeline de génération.
 *
 * Consume l'event `game/generate.failed` émis par la fonction `generateGame`
 * quand un step a épuisé tous ses retries. Action :
 *
 *   1. Lit la row games pour récupérer le contexte (slug, city, theme).
 *   2. UPDATE games SET needs_review=true, review_reason='dead_letter: ...'.
 *      L'opérateur peut ensuite voir le jeu dans le back-office et décider
 *      manuellement (regen, refund, support client).
 *   3. Envoie un email d'alerte à l'opérateur avec game_id + step + erreur
 *      via sendPipelineFailureAlert.
 *
 * Pourquoi un handler dédié plutôt qu'un onFailure inline dans generateGame :
 *   - Séparation des concerns : la pipeline ne se préoccupe pas de
 *     "comment alerter", elle émet juste un signal.
 *   - Réutilisable : si on ajoute une autre fonction Inngest (ex.
 *     processRefund), elle peut aussi émettre `game/generate.failed`.
 *   - Testable indépendamment depuis le dashboard Inngest (Send Event).
 *   - Si le dead-letter lui-même échoue, Inngest a son propre retry +
 *     son propre dashboard d'erreurs.
 */

import { inngest, gameGenerateFailed } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPipelineFailureAlert } from "@/lib/email";

export const handleGenerateGameFailure = inngest.createFunction(
  {
    id: "handle-generate-game-failure",
    name: "Dead letter — game generation failed",
    triggers: [{ event: gameGenerateFailed }],
    /** Retry 3× : si même l'alerte échoue, on a un vrai problème
     *  infra (Supabase + Resend down simultanément). Inngest dashboard
     *  remontera ces "dead-letter-of-dead-letter" comme erreurs visibles. */
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const { gameId, step: failedStep, error, attempts } = event.data;

    logger.error(
      `[dead-letter] Game generation FAILED — gameId=${gameId} step=${failedStep} attempts=${attempts} error=${error}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // Step 1 — Charger le contexte du jeu
    // ─────────────────────────────────────────────────────────────────
    const gameContext = await step.run("load-game-context", async () => {
      const supabase = createAdminClient();
      const { data, error: dbErr } = await supabase
        .from("games")
        .select("id, slug, city, country, theme, is_published, needs_review")
        .eq("id", gameId)
        .single();
      if (dbErr || !data) {
        // Jeu introuvable — probablement gameId 'unknown' venant de l'event
        // (cas où l'event original lui-même était corrompu). On loggue
        // mais on continue pour quand même envoyer l'alerte email.
        logger.warn(
          `[dead-letter] Could not load game ${gameId}: ${dbErr?.message ?? "not found"} — sending generic alert`,
        );
        return null;
      }
      return data;
    });

    // ─────────────────────────────────────────────────────────────────
    // Step 2 — Flag needs_review en DB (si on a un jeu valide)
    // ─────────────────────────────────────────────────────────────────
    if (gameContext) {
      await step.run("flag-needs-review", async () => {
        const supabase = createAdminClient();
        const reviewReason = `dead_letter from step=${failedStep}: ${error}`;
        const { error: updateErr } = await supabase
          .from("games")
          .update({
            needs_review: true,
            review_reason: reviewReason,
          })
          .eq("id", gameId);
        if (updateErr) {
          throw new Error(
            `Failed to flag needs_review for ${gameId}: ${updateErr.message}`,
          );
        }
        logger.warn(
          `[dead-letter] Flagged game ${gameId} (${gameContext.slug}) needs_review=true`,
        );
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 3 — Email alerte opérateur (toujours, même si gameContext null)
    // ─────────────────────────────────────────────────────────────────
    await step.run("send-failure-email", async () => {
      try {
        await sendPipelineFailureAlert({
          city: gameContext?.city ?? "Unknown",
          country: gameContext?.country ?? "Unknown",
          theme: gameContext?.theme ?? "Unknown",
          slug: gameContext?.slug ?? gameId,
          error: `[Inngest dead letter] step=${failedStep} attempts=${attempts}: ${error}`,
          errorCode: "INTERNAL_ERROR",
        });
        logger.info(`[dead-letter] Failure email sent for ${gameId}`);
      } catch (emailErr) {
        // Si l'email lui-même fail, throw pour qu'Inngest retry ce step
        throw new Error(
          `Failed to send dead-letter email: ${emailErr instanceof Error ? emailErr.message : emailErr}`,
        );
      }
    });

    return {
      gameId,
      flagged: !!gameContext,
      slug: gameContext?.slug,
    };
  },
);
