/**
 * Pipeline finalize — Lambda 2 of the chained architecture.
 *
 * Extracted from generateGameFromTemplate to give the heavy
 * prepareGamePackage + validator + auto-repair loop its OWN 10-min
 * Vercel lambda budget, separate from the discovery + generation
 * lambda. Total effective pipeline budget: 20 min (vs 10 min before).
 *
 * Lambda 1 (game-pipeline.generateGameFromTemplate):
 *   Discovery → curation → step generation → DB insert (with
 *   is_published=false). Typically 5-10 min.
 *
 * Lambda 2 (this file, called from /api/internal/finalize-game):
 *   Translation + audio (with up to 4 Gemini retries per field) →
 *   final validator → auto-repair loop (max 3 iter) → flip
 *   is_published=true if all checks pass. Typically 5-15 min.
 *
 * If both lambdas complete within budget, the game is auto-published
 * and the activation code can be sent to the client. If lambda 2 itself
 * times out, is_published stays false and the operator gets an email
 * (rare worst-case scenario).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { prepareGamePackage } from "@/lib/game-package";
import { validateFinalGame } from "@/lib/pipeline-validators";
import { attemptAutoRepair } from "@/lib/pipeline-auto-repair";
import type { GameGenre } from "@/lib/game-genres";

export interface FinalizeResult {
  success: boolean;
  isPublished: boolean;
  needsReview: boolean;
  reviewReason?: string;
  audioGenerated?: number;
  audioSkipped?: number;
  audioFailed?: number;
  validatorIterations: number;
  durationMs: number;
}

/**
 * Finalize a game: pre-translate, generate audio, validate, auto-repair,
 * publish. Idempotent — safe to retry if interrupted.
 */
export async function finalizeGame(params: {
  gameId: string;
  language?: string;
  city: string;
  theme: string;
  narrative: string;
  genre?: GameGenre;
}): Promise<FinalizeResult> {
  const t0 = Date.now();
  const { gameId, language, city, theme, narrative, genre } = params;
  const supabase = createAdminClient();

  // 1. prepareGamePackage : translations + audio (with built-in Gemini
  //    retries up to 4 per field, cf. translate-service.ts)
  let audioGenerated = 0;
  let audioSkipped = 0;
  let audioFailed = 0;
  if (language && /^[a-z]{2}$/.test(language)) {
    try {
      const pkg = await prepareGamePackage(gameId, language);
      audioGenerated = pkg.audioGenerated;
      audioSkipped = pkg.audioSkipped;
      audioFailed = pkg.audioFailed;
      if (pkg.success) {
        console.log(
          `[finalize] Pre-generated audio for "${language}" in ${Math.round((Date.now() - t0) / 1000)}s — generated=${pkg.audioGenerated}, skipped=${pkg.audioSkipped}, failed=${pkg.audioFailed}`,
        );
      } else {
        console.warn(
          `[finalize] Audio package returned errors: ${pkg.errors?.join("; ")}`,
        );
      }
    } catch (err) {
      console.warn(
        `[finalize] prepareGamePackage threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.warn(
      `[finalize] No language provided — skipping audio pre-gen, player will use browser TTS fallback`,
    );
  }

  // 2. Validator + auto-repair loop (max 3 iterations)
  let finalValidation = await validateFinalGame(gameId, language);
  const MAX_REPAIR_ITERATIONS = 3;
  let repairIteration = 0;
  while (!finalValidation.ok && repairIteration < MAX_REPAIR_ITERATIONS) {
    repairIteration++;
    console.log(
      `[finalize] Auto-repair iter ${repairIteration}/${MAX_REPAIR_ITERATIONS} — ${finalValidation.issues.length} issue(s)`,
    );
    const repair = await attemptAutoRepair(gameId, finalValidation, {
      language,
      city,
      theme,
      narrative,
      genre,
    });
    console.log(
      `[finalize] iter ${repairIteration} → attempted=[${repair.attemptedIssues.join(",")}], unrepairable=[${repair.unrepairableIssues.join(",")}]`,
    );
    if (!repair.anyAttempted) {
      console.log(
        `[finalize] no more repairable issues — breaking out of loop`,
      );
      break;
    }
    finalValidation = await validateFinalGame(gameId, language);
  }

  // 3. Decide: publish or flag
  if (finalValidation.ok) {
    console.log(
      `[finalize] ✅ Final validator passed (after ${repairIteration} repair iter${repairIteration === 1 ? "" : "s"})`,
    );
    // Flip is_published=true ET reset needs_review/review_reason
    // (peuvent traîner d'une itération précédente où le validator avait
    // failed — observé Lugdunum V5 11/05 : needs_review=true resté
    // sticky après que les iterations suivantes du validator passent).
    // OddballTrip vérifie needs_review pour décider d'envoyer le code,
    // donc on doit reset à false explicitement quand validator OK.
    const { error: pubErr } = await supabase
      .from("games")
      .update({
        is_published: true,
        needs_review: false,
        review_reason: null,
      })
      .eq("id", gameId);
    if (pubErr) {
      console.warn(
        `[finalize] ⚠ Failed to flip is_published=true: ${pubErr.message}`,
      );
    } else {
      console.log(
        `[finalize] is_published=true — game now visible to find-game endpoint`,
      );
    }
    return {
      success: true,
      isPublished: true,
      needsReview: false,
      audioGenerated,
      audioSkipped,
      audioFailed,
      validatorIterations: repairIteration,
      durationMs: Date.now() - t0,
    };
  }

  // Validator KO after max iterations → stays unpublished, flag for human
  console.warn(
    `[finalize] ⚠ Validator still has ${finalValidation.issues.length} issue(s) after ${repairIteration} repair iter(s) — flagging needs_review`,
  );
  for (const issue of finalValidation.issues) {
    console.warn(`[finalize]   - [${issue.code}] ${issue.message}`);
  }
  const { data: currentGame } = await supabase
    .from("games")
    .select("review_reason")
    .eq("id", gameId)
    .single();
  const existingReason = currentGame?.review_reason ?? "";
  const combinedReason = existingReason
    ? `${existingReason} | ${finalValidation.reviewReason}`
    : finalValidation.reviewReason;
  await supabase
    .from("games")
    .update({
      needs_review: true,
      review_reason: combinedReason,
    })
    .eq("id", gameId);
  return {
    success: false,
    isPublished: false,
    needsReview: true,
    reviewReason: combinedReason,
    audioGenerated,
    audioSkipped,
    audioFailed,
    validatorIterations: repairIteration,
    durationMs: Date.now() - t0,
  };
}
