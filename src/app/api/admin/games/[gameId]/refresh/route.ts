/**
 * POST /api/admin/games/[gameId]/refresh
 *
 * Bring a game to the current "healthy" state:
 *   1. Bump max_hints_per_step to 3 if needed.
 *   2. For each step with < 3 hints, ask Claude to fill the gaps
 *      (#2 = OPEN THE AR CAMERA + where, #3 = answer shape).
 *   3. Wipe cached hint translations for the affected steps so the
 *      packaging step that follows re-translates them.
 *   4. Re-run prepareGamePackage for every (game x language) pair
 *      already packaged — refills translation cache and any missing
 *      audio.
 *
 * Returns a summary the admin UI displays in a toast.
 *
 * Synchronous — Vercel maxDuration is set to 600s to allow the
 * combined Claude + Gemini + ElevenLabs round-trips to complete.
 * For large games (>10 packaged languages) consider splitting in two
 * calls (hints first, packaging second) — out of scope for V1.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { auditGameHealth } from "@/lib/game-health";
import {
  regenerateStepHints,
  type StepForHints,
} from "@/lib/hint-regeneration";
import { prepareGamePackage } from "@/lib/game-package";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 minutes — Vercel paid plan ceiling

interface LangResult {
  language: string;
  ok: boolean;
  audioGenerated: number;
  audioSkipped: number;
  durationMs: number;
  errors: string[];
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const t0 = Date.now();
  const { gameId } = await params;
  if (!gameId) {
    return NextResponse.json({ error: "missing gameId" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Initial audit so we know what to do (and can include "before"
  // state in the response).
  const before = await auditGameHealth(gameId);

  // 2. Bump max_hints_per_step if needed
  let bumpedHintsCap = false;
  if (before.issues.maxHintsCapTooLow) {
    const { error } = await supabase
      .from("games")
      .update({ max_hints_per_step: 3 })
      .eq("id", gameId);
    if (error) {
      return NextResponse.json(
        { error: `Échec du bump max_hints_per_step: ${error.message}` },
        { status: 500 },
      );
    }
    bumpedHintsCap = true;
  }

  // 3. Regenerate missing hints. We re-fetch the steps each time so
  // we work on the latest DB state (avoids stale caches across calls).
  const stepsResult = await supabase
    .from("game_steps")
    .select("id, step_order, title, riddle_text, answer_text, ar_facade_text, hints")
    .eq("game_id", gameId)
    .order("step_order");

  const stepRows = (stepsResult.data ?? []) as StepForHints[];
  const stepsRegenerated: number[] = [];
  const hintErrors: string[] = [];

  for (const step of stepRows) {
    const existing = Array.isArray(step.hints) ? step.hints : [];
    if (existing.length >= 3) continue;
    try {
      const merged = await regenerateStepHints(step);
      const { error } = await supabase
        .from("game_steps")
        .update({ hints: merged })
        .eq("id", step.id);
      if (error) throw new Error(error.message);
      stepsRegenerated.push(step.step_order);
      // Wipe cached hint translations for this step's slots so the
      // packaging step that follows refills them with the new content.
      for (const idx of [0, 1, 2]) {
        const key = `hint-${gameId}-${step.step_order}-${idx}`;
        await supabase
          .from("translations_cache")
          .delete()
          .eq("source_id", key);
      }
    } catch (err) {
      hintErrors.push(
        `step ${step.step_order}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Pace Claude — 800ms keeps us comfortably under any soft rate cap.
    await new Promise((r) => setTimeout(r, 800));
  }

  // 4. Re-package every language already in audio_cache. This refills
  // missing translations + any audio slots that prepareGamePackage
  // discovers as still empty. Sequential to stay polite with Gemini
  // and ElevenLabs.
  const langResults: LangResult[] = [];
  for (const lang of before.packagedLanguages) {
    try {
      const res = await prepareGamePackage(gameId, lang);
      langResults.push({
        language: lang,
        ok: res.success,
        audioGenerated: res.audioGenerated,
        audioSkipped: res.audioSkipped,
        durationMs: res.durationMs,
        errors: res.errors,
      });
    } catch (err) {
      langResults.push({
        language: lang,
        ok: false,
        audioGenerated: 0,
        audioSkipped: 0,
        durationMs: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  // 5. Re-audit so the client can render the new badge without a
  // round-trip. Cheap — just queries.
  const after = await auditGameHealth(gameId);

  return NextResponse.json({
    ok: hintErrors.length === 0 && langResults.every((r) => r.ok),
    durationMs: Date.now() - t0,
    bumpedHintsCap,
    stepsRegenerated,
    hintErrors,
    languagesProcessed: langResults,
    before: { level: before.level, summary: before.summary },
    after: { level: after.level, summary: after.summary },
  });
}
