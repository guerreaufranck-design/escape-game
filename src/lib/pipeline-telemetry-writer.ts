/**
 * Pipeline telemetry writer (Sprint 2.3, 2026-05-21).
 *
 * Centralizes writes to `pipeline_telemetry` so callers don't have to
 * deal with the Supabase admin client or column mapping. Each write is
 * fire-and-forget : failures are LOGGED but never re-thrown — telemetry
 * writes must NEVER cause a pipeline failure.
 *
 * Sprint 2.3 adds quality_score columns (migration 035) — the
 * `recordPhaseQuality` helper persists the score + breakdown from
 * lib/pipeline-quality-scorer.
 */
import { createAdminClient } from "./supabase/admin";
import type { QualityPhase, QualityScore } from "./pipeline-quality-scorer";

/**
 * Map the in-app phase enum to the `pipeline_telemetry.phase` enum
 * already used by other writers (migration 028).
 *
 * - phase1a → "discovery" (Perplexity DR is the discovery's research arm)
 * - phase1b → "discovery" (the Google + scoring arm)
 * - phase2a → "narration"
 * - phase2b → "final_riddle" (groups intro + epilogue + final riddle)
 * - phase2c → "other"     (DB insert)
 *
 * The fine-grained phase identifier is preserved in `metadata.phase_id`
 * so SQL aggregations can filter by exact sub-step when needed.
 */
const PHASE_TO_TELEMETRY_BUCKET: Record<QualityPhase, string> = {
  phase1a: "discovery",
  phase1b: "discovery",
  phase2a: "narration",
  phase2b: "final_riddle",
  phase2c: "other",
};

/**
 * Persist a phase's quality score in `pipeline_telemetry`. Idempotent
 * in the trivial sense (each call creates a new row — we don't update).
 *
 * Fire-and-forget : never throws. Caller can `void recordPhaseQuality(...)`
 * to skip awaiting.
 */
export async function recordPhaseQuality(args: {
  /** Set to null if game_id isn't known yet (e.g. phase1a/1b fired
   *  before Phase 2c inserted the row). The cron in Sprint 4 can
   *  retroactively join by run_id once we add that. */
  gameId: string | null;
  phase: QualityPhase;
  /** The score computed by lib/pipeline-quality-scorer. */
  quality: QualityScore;
  /** Optional duration of the phase in ms (for cross-correlation with
   *  cost/latency). */
  durationMs?: number;
  /** Optional provider — defaults to "other". Stays consistent with
   *  migration 028 enum. */
  provider?: string;
  /** Free-form metadata (transport_mode, radius_km, etc.) so we can
   *  bucket by request shape in Sprint 4 dashboards. */
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    const phaseEnum = PHASE_TO_TELEMETRY_BUCKET[args.phase] ?? "other";
    const { error } = await supabase.from("pipeline_telemetry").insert({
      game_id: args.gameId,
      phase: phaseEnum,
      provider: args.provider ?? "other",
      api_calls: 1,
      duration_ms: args.durationMs ?? null,
      quality_score: args.quality.score,
      quality_breakdown: args.quality.breakdown,
      quality_floor: args.quality.floor,
      quality_passes: args.quality.passes,
      metadata: {
        phase_id: args.phase,
        weights: args.quality.weights,
        ...(args.metadata ?? {}),
      },
    });
    if (error) {
      console.warn(
        `[telemetry] Failed to persist quality for phase=${args.phase}: ${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[telemetry] Quality write threw (non-fatal): ${err instanceof Error ? err.message : err}`,
    );
  }
}
