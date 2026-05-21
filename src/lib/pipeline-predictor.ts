/**
 * Pipeline duration predictor (Sprint 3, 2026-05-21).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose
 * ═══════════════════════════════════════════════════════════════════
 *
 * BEFORE invoking the long pole of the pipeline (`phase1a-deep-research`
 * which can take 2-5 min on roadtrips), estimate the probability that
 * the step will exceed the Inngest HTTP timeout (~2m43s) and, if too
 * risky, automatically downgrade to a faster (less detailed) model.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Math model
 * ═══════════════════════════════════════════════════════════════════
 *
 * Latency of `deepResearchTheme` follows a log-normal distribution
 * (verified empirically across ~30 production runs : long tail, right-
 * skewed). We fit log(duration_ms) ~ N(μ(features), σ²) via Bayesian
 * linear regression with hierarchical priors per `transport_mode`.
 *
 * Features (continuous + binary) :
 *   x₁ = radius_km                    (continuous, 0..60)
 *   x₂ = is_roadtrip                  (binary, transport_mode ≠ walking)
 *   x₃ = theme_length / 100           (continuous, proxy for theme complexity)
 *   x₄ = has_multi_landmark_signal    (binary, 1 if theme contains "tour",
 *                                       "trail", "châteaux", "ruta", etc.)
 *
 * Model :
 *   μ = β₀ + β₁·x₁ + β₂·x₂ + β₃·x₃ + β₄·x₄
 *   duration ~ LogNormal(μ, σ²)
 *
 *   P(duration > threshold) = 1 - Φ((log(threshold) - μ) / σ)
 *
 * Where Φ is the standard normal CDF.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Calibration
 * ═══════════════════════════════════════════════════════════════════
 *
 * Coefficients β are computed by SQL aggregation over
 * `pipeline_telemetry` rows where phase='discovery' and provider='perplexity'.
 * The aggregation is performed by Sprint 4's weekly cron and persisted
 * in `pipeline_thresholds` (migration coming in Sprint 4).
 *
 * Cold start (no telemetry yet) : we use a-priori coefficients seeded
 * from manual eyeballing of the 30 runs we have. Documented inline.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Decision rule
 * ═══════════════════════════════════════════════════════════════════
 *
 *   P(duration > inngest_timeout) > 0.20 → switch to sonar-pro
 *                                            + flag needs_review
 *                                            + log to telemetry
 *   else                                  → proceed with sonar-deep-research
 *
 * The 20% threshold balances quality (DR's depth is valuable) vs risk
 * (a single timeout means a failed game and an angry customer). Tunable
 * via env PIPELINE_PREDICTOR_TIMEOUT_PROB_THRESHOLD.
 */

// ════════════════════════════════════════════════════════════════════
// Seed coefficients (cold start, before any telemetry-driven calibration)
// ════════════════════════════════════════════════════════════════════
// These were eyeballed from 30 production runs 2026-05-15 → 2026-05-21.
// Format : log(duration_ms) prediction (so μ on log scale).
//
// Empirical baseline (walking, low complexity) : 180s = log(180_000) = 12.10
// Roadtrip adder (mixed/driving) : +1-3 min = +0.5 to +1.0 on log scale
// radius_km contribution : approx linear, +5-10s per km on the upper end
// theme complexity : 30-60s extra for multi-landmark trails

const SEED_BETA = {
  intercept: 12.0,            // log(160s) — walking, simple theme baseline
  radius_km: 0.012,           // +12ms per km in log space ≈ +30s at radius=60
  is_roadtrip: 0.5,           // +50% over baseline when mode != walking
  theme_length_100: 0.05,     // longer themes → slightly slower DR
  has_multi_landmark: 0.4,    // "trail" / "châteaux" / "ruta" / etc. → +40% on log scale
};

const SEED_SIGMA = 0.45; // log-scale std dev = sqrt(variance) of observed runs

// ════════════════════════════════════════════════════════════════════
// Public predictor
// ════════════════════════════════════════════════════════════════════

export interface PredictionFeatures {
  radius_km: number;
  is_roadtrip: boolean;
  theme: string;
}

export interface PredictionResult {
  /** Expected duration in ms (median of log-normal). */
  expected_ms: number;
  /** 90th percentile (lognormal upper bound at p90). */
  p90_ms: number;
  /** 99th percentile (lognormal upper bound at p99). */
  p99_ms: number;
  /** Probability the duration exceeds `timeout_ms`. */
  prob_timeout: number;
  /** Human-readable rationale for logging. */
  rationale: string;
  /** Whether the predictor recommends downgrading to a faster model. */
  recommend_downgrade: boolean;
}

// Standard normal CDF using the error function approximation
// (Abramowitz & Stegun 7.1.26). Accuracy ~1e-7 — plenty for our use.
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function stdNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

const MULTI_LANDMARK_KEYWORDS = [
  "trail",
  "tour",
  "circuit",
  "route",
  "ruta",
  "chemin",
  "châteaux",
  "chateau",
  "castles",
  "thread",
  "journey",
  "voyage",
  "way",
  "pilgrim",
  "vineyard",
  "wineries",
  "battle",
  "war",
  "memorial",
];

function hasMultiLandmark(theme: string): boolean {
  const lower = theme.toLowerCase();
  return MULTI_LANDMARK_KEYWORDS.some((k) => lower.includes(k));
}

function loadBeta(): typeof SEED_BETA {
  // In Sprint 4 this will read from `pipeline_thresholds` table.
  // For now, return the seed coefficients.
  return SEED_BETA;
}

function loadSigma(): number {
  return SEED_SIGMA;
}

/**
 * Predict the duration distribution of `phase1a-deep-research` and
 * compute the probability of exceeding the Inngest HTTP timeout.
 */
export function predictPhase1aDuration(
  features: PredictionFeatures,
): PredictionResult {
  const beta = loadBeta();
  const sigma = loadSigma();
  const multiLandmark = hasMultiLandmark(features.theme);
  const themeLength100 = features.theme.length / 100;

  const mu =
    beta.intercept +
    beta.radius_km * features.radius_km +
    beta.is_roadtrip * (features.is_roadtrip ? 1 : 0) +
    beta.theme_length_100 * themeLength100 +
    beta.has_multi_landmark * (multiLandmark ? 1 : 0);

  // Median of log-normal = exp(μ)
  const expected_ms = Math.exp(mu);
  // Quantiles : z₉₀ ≈ 1.282, z₉₉ ≈ 2.326
  const p90_ms = Math.exp(mu + 1.282 * sigma);
  const p99_ms = Math.exp(mu + 2.326 * sigma);

  // P(X > T) = 1 - Φ((log T - μ) / σ)  for log-normal X
  const timeout_ms = parseInt(
    process.env.PIPELINE_PREDICTOR_TIMEOUT_MS ?? "163000", // 2m43s default
    10,
  );
  const z = (Math.log(timeout_ms) - mu) / sigma;
  const prob_timeout = 1 - stdNormalCdf(z);

  const threshold = parseFloat(
    process.env.PIPELINE_PREDICTOR_TIMEOUT_PROB_THRESHOLD ?? "0.20",
  );
  const recommend_downgrade = prob_timeout > threshold;

  const rationale =
    `radius_km=${features.radius_km} is_roadtrip=${features.is_roadtrip} ` +
    `theme_len=${features.theme.length} multi_landmark=${multiLandmark} ` +
    `→ μ=${mu.toFixed(2)} (median=${Math.round(expected_ms / 1000)}s, ` +
    `p99=${Math.round(p99_ms / 1000)}s) ` +
    `P(>${Math.round(timeout_ms / 1000)}s)=${(prob_timeout * 100).toFixed(1)}% ` +
    `${recommend_downgrade ? "→ DOWNGRADE recommended" : "→ proceed nominal"}`;

  return {
    expected_ms: Math.round(expected_ms),
    p90_ms: Math.round(p90_ms),
    p99_ms: Math.round(p99_ms),
    prob_timeout,
    rationale,
    recommend_downgrade,
  };
}

/**
 * Helper for the Inngest orchestrator. Given a GameTemplate-like
 * object, returns a prediction + decides whether to downgrade.
 *
 * The caller (build-game.ts) uses this to optionally switch the
 * Perplexity model to sonar-pro before invoking phase1a. The downgrade
 * is logged + flagged in needs_review so operators review the result
 * before activation code release.
 */
export interface BuildDecision {
  /** Either "nominal" (sonar-deep-research) or "downgraded" (sonar-pro). */
  perplexity_model: "sonar-deep-research" | "sonar-pro";
  /** True iff the predictor recommends flagging needs_review (because
   *  we downgraded). */
  flag_needs_review: boolean;
  /** Reason string to put in `games.review_reason` if flagged. */
  needs_review_reason?: string;
  /** Underlying prediction (for telemetry). */
  prediction: PredictionResult;
}

export function decideBuildStrategy(features: PredictionFeatures): BuildDecision {
  const prediction = predictPhase1aDuration(features);

  if (prediction.recommend_downgrade) {
    return {
      perplexity_model: "sonar-pro",
      flag_needs_review: true,
      needs_review_reason:
        `Predictor downgraded Perplexity to sonar-pro because P(phase1a>timeout)=${(prediction.prob_timeout * 100).toFixed(1)}% on this configuration (${prediction.rationale}). Inspect the depth of Deep Research context — sonar-pro returns less detail. Verify final_riddle + epilogue are still rich enough.`,
      prediction,
    };
  }

  return {
    perplexity_model: "sonar-deep-research",
    flag_needs_review: false,
    prediction,
  };
}
