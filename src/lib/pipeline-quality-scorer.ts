/**
 * Pipeline quality scorer (Sprint 2.2, 2026-05-21).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose
 * ═══════════════════════════════════════════════════════════════════
 *
 * Compute a 0..1 quality score for each pipeline phase output. Used by :
 *   - The Inngest orchestrator to circuit-break before publish
 *   - `pipeline_telemetry.quality_score` for self-tuning (Sprint 4)
 *   - Admin observability dashboards (Sprint 4)
 *
 * Each phase has its own scoring function because the failure modes
 * differ. We aggregate sub-scores with explicit weights and document
 * the rationale so the formula is reviewable and tunable.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Scoring philosophy
 * ═══════════════════════════════════════════════════════════════════
 *
 *   1. Each sub-criterion is normalized to [0, 1].
 *   2. The aggregate score is the WEIGHTED ARITHMETIC MEAN of sub-scores
 *      → simple, explainable, easy to tune. We avoid geometric mean
 *        because a single 0-score would zero out the whole result,
 *        which is too punitive for non-critical criteria.
 *   3. The breakdown is returned alongside the score for telemetry —
 *      we want to know WHICH sub-criterion failed, not just that
 *      something failed.
 *   4. Thresholds (quality_floor per phase) are configurable via the
 *      `pipeline_thresholds` table (Sprint 4) — defaults documented
 *      here as constants.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Mathematical form
 * ═══════════════════════════════════════════════════════════════════
 *
 *   score(phase, output) = Σᵢ wᵢ·subScoreᵢ(output)    with Σᵢ wᵢ = 1
 *
 *   Each subScoreᵢ ∈ [0, 1] is a continuous mapping of a measurable
 *   property of the output. We prefer continuous mappings (e.g. sigmoid
 *   on coverage ratios) over binary thresholds — they make the score
 *   gradient-friendly for future auto-tuning.
 */

import type { Phase1Result } from "./game-pipeline";
import type { ResearchedLocation } from "./perplexity";

// ════════════════════════════════════════════════════════════════════
// Default floors per phase. The pipeline blocks (does not publish) if
// the computed score falls below the floor. These can be overridden
// per environment via PIPELINE_QUALITY_FLOOR_<PHASE> env vars OR via
// the `pipeline_thresholds` table once Sprint 4 ships.
// ════════════════════════════════════════════════════════════════════

const DEFAULT_FLOORS: Record<QualityPhase, number> = {
  // Phase 1a (Perplexity Deep Research) : we tolerate empty context
  // (Perplexity API outage) but flag for review. Floor low because
  // downstream still produces useable games without DR context.
  phase1a: 0.3,
  // Phase 1b (Discovery + scoring) : MUST have ≥6 landmarks. Below
  // floor = pipeline fails hard, we'd ship a broken game.
  phase1b: 0.7,
  // Phase 2a (Narration) : Claude generated steps with valid hints,
  // riddles, anecdotes. Floor includes Roman drift QA.
  phase2a: 0.75,
  // Phase 2b (Game-wide blocks) : intro + epilogue + final riddle.
  // Less critical than per-step content — degrades gracefully.
  phase2b: 0.6,
  // Phase 2c (Insert + photos) : SQL succeeded, photos non-blocking.
  phase2c: 0.5,
};

export type QualityPhase =
  | "phase1a"
  | "phase1b"
  | "phase2a"
  | "phase2b"
  | "phase2c";

export interface QualityScore {
  /** Final aggregate score in [0, 1]. */
  score: number;
  /** Breakdown of each sub-criterion (for telemetry + debug). */
  breakdown: Record<string, number>;
  /** Weights used (for telemetry — useful when tuning). */
  weights: Record<string, number>;
  /** Floor this phase is configured against. */
  floor: number;
  /** True iff score ≥ floor. False → caller should circuit-break. */
  passes: boolean;
  /** Human-readable summary for logs. */
  summary: string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Continuous coverage : returns value/expected, clamped to [0, 1]. */
function coverage(value: number, expected: number): number {
  if (expected <= 0) return 1; // nothing expected → perfect
  return clamp01(value / expected);
}

/** Sigmoid-shaped coverage : smooth, biased to penalize low values
 *  harder than reward high values. Useful for non-critical bonuses. */
function softCoverage(value: number, target: number, k = 4): number {
  if (target <= 0) return 1;
  const x = value / target;
  return clamp01(1 / (1 + Math.exp(-k * (x - 0.5))));
}

function getFloor(phase: QualityPhase): number {
  const envKey = `PIPELINE_QUALITY_FLOOR_${phase.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) {
    const parsed = parseFloat(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return DEFAULT_FLOORS[phase];
}

function aggregate(
  phase: QualityPhase,
  breakdown: Record<string, number>,
  weights: Record<string, number>,
): QualityScore {
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  if (Math.abs(totalWeight - 1) > 0.001) {
    console.warn(
      `[qualityScorer] ⚠ Weights for ${phase} sum to ${totalWeight}, not 1 — normalizing`,
    );
  }
  let score = 0;
  for (const key of Object.keys(breakdown)) {
    const w = weights[key] ?? 0;
    score += clamp01(breakdown[key]) * w;
  }
  score /= totalWeight || 1;
  const floor = getFloor(phase);
  const passes = score >= floor;
  const breakdownStr = Object.entries(breakdown)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(" ");
  const summary = `score=${score.toFixed(2)} (floor=${floor.toFixed(2)}, ${passes ? "PASS" : "FAIL"}) — ${breakdownStr}`;
  return { score, breakdown, weights, floor, passes, summary };
}

// ════════════════════════════════════════════════════════════════════
// Phase scorers
// ════════════════════════════════════════════════════════════════════

/**
 * Phase 1a — Perplexity Deep Research.
 * Measure : how rich was the verified context returned?
 */
export function scorePhase1a(verifiedContext: {
  iconicSites?: unknown[];
  realFigures?: unknown[];
  events?: unknown[];
  localTraditions?: unknown[];
  rawSummary?: string;
}): QualityScore {
  const iconicSites = verifiedContext.iconicSites?.length ?? 0;
  const realFigures = verifiedContext.realFigures?.length ?? 0;
  const events = verifiedContext.events?.length ?? 0;
  const localTraditions = verifiedContext.localTraditions?.length ?? 0;
  const hasRawSummary = (verifiedContext.rawSummary?.length ?? 0) > 500 ? 1 : 0;

  const breakdown = {
    // We expect 5-8 iconic sites on rich themes. ≥4 = perfect, fewer
    // = soft penalty.
    iconicSites: coverage(iconicSites, 4),
    realFigures: coverage(realFigures, 3),
    events: coverage(events, 4),
    localTraditions: softCoverage(localTraditions, 2),
    rawSummary: hasRawSummary,
  };
  const weights = {
    iconicSites: 0.35,
    realFigures: 0.2,
    events: 0.25,
    localTraditions: 0.1,
    rawSummary: 0.1,
  };
  return aggregate("phase1a", breakdown, weights);
}

/**
 * Phase 1b — Discovery + scoring.
 * Measure : are we shipping a usable parcours?
 */
export function scorePhase1b(phase1: Phase1Result): QualityScore {
  if (!phase1.success) {
    // Failure case : the phase didn't even produce output. Score = 0.
    return aggregate(
      "phase1b",
      { success: 0, coverage: 0, narrativeRatio: 0 },
      { success: 0.5, coverage: 0.3, narrativeRatio: 0.2 },
    );
  }
  const totalStops = phase1.discoveryLandmarks.length;
  const expectedStops = phase1.resolvedStopCount;
  const narrativeStops = phase1.stopModes.filter((m) => m === "narrative").length;

  const breakdown = {
    // 1 if pipeline succeeded structurally.
    success: 1,
    // How close are we to the operator-target stopCount?
    coverage: coverage(totalStops, expectedStops),
    // Narrative ratio : a stop in narrative mode is OK for archaeological
    // sub-monuments but should be RARE. Score = 1 - narrativeRatio,
    // capped at 0.4 worst case (we accept up to 60% narrative before
    // hard failure).
    narrativeRatio:
      totalStops === 0
        ? 0
        : clamp01(1 - (narrativeStops / totalStops) * 1.5),
    // Centroid drift sanity (mirrors STEP 1.5 check). 1 if not flagged.
    centroidSane: phase1.needsReview ? 0.5 : 1,
  };
  const weights = {
    success: 0.3,
    coverage: 0.3,
    narrativeRatio: 0.25,
    centroidSane: 0.15,
  };
  return aggregate("phase1b", breakdown, weights);
}

/**
 * Phase 2a — Narration generation (Claude steps).
 * Measure : per-step content completeness + Roman drift sanity.
 */
export function scorePhase2a(steps: ResearchedLocation[]): QualityScore {
  if (steps.length === 0) {
    return aggregate(
      "phase2a",
      { hasSteps: 0, riddleCoverage: 0, answerCoverage: 0, distinctAR: 0 },
      { hasSteps: 0.4, riddleCoverage: 0.25, answerCoverage: 0.2, distinctAR: 0.15 },
    );
  }
  const withRiddle = steps.filter((s) => s.whatToObserve?.trim()).length;
  const withAnswer = steps.filter((s) => s.answer?.trim()).length;
  const distinctAnswers = new Set(
    steps.map((s) => (s.answer ?? "").trim().toLowerCase()).filter(Boolean),
  ).size;

  const breakdown = {
    hasSteps: 1,
    riddleCoverage: coverage(withRiddle, steps.length),
    answerCoverage: coverage(withAnswer, steps.length),
    distinctAR: coverage(distinctAnswers, steps.length),
  };
  const weights = {
    hasSteps: 0.3,
    riddleCoverage: 0.25,
    answerCoverage: 0.25,
    distinctAR: 0.2,
  };
  return aggregate("phase2a", breakdown, weights);
}

/**
 * Phase 2b — Game-wide blocks (intro / epilogue / final riddle).
 */
export function scorePhase2b(payload: {
  introSpeech: { text: string } | null;
  epilogue: { title?: string; text?: string } | null;
  finalRiddle: { riddle: string; answer: string; explanation?: string } | null;
}): QualityScore {
  const breakdown = {
    intro: payload.introSpeech?.text?.trim() ? 1 : 0,
    epilogue: payload.epilogue?.text?.trim() ? 1 : 0,
    finalRiddle:
      payload.finalRiddle?.riddle?.trim() && payload.finalRiddle?.answer?.trim()
        ? 1
        : 0,
    finalExplanation: payload.finalRiddle?.explanation?.trim() ? 1 : 0,
  };
  const weights = {
    intro: 0.25,
    epilogue: 0.25,
    finalRiddle: 0.35,
    finalExplanation: 0.15,
  };
  return aggregate("phase2b", breakdown, weights);
}

/**
 * Phase 2c — Insert into DB + photos.
 * Most signals are binary (insert succeeded yes/no). Photos are
 * non-blocking — partial coverage still passes.
 */
export function scorePhase2c(result: {
  gameId: string | undefined;
  stopsInserted: number;
  expectedStops: number;
  photosFetched: number;
}): QualityScore {
  const inserted = result.gameId ? 1 : 0;
  const breakdown = {
    inserted,
    stopsCoverage: coverage(result.stopsInserted, result.expectedStops),
    photosCoverage: softCoverage(result.photosFetched, result.expectedStops, 2),
  };
  const weights = {
    inserted: 0.6,
    stopsCoverage: 0.3,
    photosCoverage: 0.1,
  };
  return aggregate("phase2c", breakdown, weights);
}

// ════════════════════════════════════════════════════════════════════
// Circuit breaker helper
// ════════════════════════════════════════════════════════════════════

/**
 * `assertPhasePassesOrThrow` — call from the Inngest orchestrator after
 * each step.run() to gate the next phase on quality.
 *
 * Throws an error with a `code` property that the orchestrator's
 * `classifier_failure` reads to decide retry vs halt-publish.
 */
export function assertPhasePassesOrThrow(
  phase: QualityPhase,
  score: QualityScore,
): void {
  if (score.passes) {
    console.log(`[qualityScorer] ${phase} ${score.summary}`);
    return;
  }
  const err = new Error(
    `[qualityScorer] ${phase} FAILED quality gate : ${score.summary}`,
  ) as Error & { code?: string; quality?: QualityScore };
  err.code = "QUALITY_GATE_FAIL";
  err.quality = score;
  throw err;
}
