/**
 * Pipeline coherence checks (Sprint 6.2bis, 2026-05-22).
 *
 * Three lightweight defensive checks that target failure modes the
 * existing safety nets missed on the Aigues-Mortes 22/05 incident :
 *
 *   B. radius_km vs estimated_duration_min coherence check
 *   D. Iconic-landmark whitelist becomes THEME-AWARE
 *   E. Phase 1a Perplexity empty → hard force_needs_review
 *
 * Each function is pure / synchronous (except E which uses the score
 * already computed). They are called from build-game.ts orchestrator
 * BEFORE the final release decision.
 */
import type { ErrorCategory } from "./error-report-classifier";

// ════════════════════════════════════════════════════════════════════
// B. radius / duration coherence
// ════════════════════════════════════════════════════════════════════

/**
 * Check that the announced radius_km is physically achievable within
 * the announced estimated_duration_min, given the transport_mode.
 *
 * Failure cases seen in production :
 *   - radius_km=60 with transport_mode=walking → impossible (no walker
 *     covers 120km round-trip)
 *   - radius_km=60 with duration=165min and walking → impossible
 *   - radius_km=0 with duration=240min → suspicious (no movement
 *     planned ?)
 *
 * The check tolerates 1.5× the physical max because operators may
 * deliberately design loose parcours, but flags anything beyond.
 */
export interface RadiusDurationCheckInput {
  transport_mode: "walking" | "driving" | "mixed" | null;
  radius_km: number | null;
  estimated_duration_min: number | null;
}

export interface CoherenceFlag {
  code: string;
  severity: "fail" | "warn";
  message: string;
  details: Record<string, unknown>;
}

const SPEED_KMH: Record<string, number> = {
  walking: 4, // 4 km/h average walking pace
  driving: 60, // 60 km/h average road
  mixed: 30, // mixed = some driving, some walking
};

export function checkRadiusDurationCoherence(
  input: RadiusDurationCheckInput,
): CoherenceFlag | null {
  const { transport_mode, radius_km, estimated_duration_min } = input;
  if (!transport_mode || !radius_km || !estimated_duration_min) return null;
  if (radius_km <= 0 || estimated_duration_min <= 0) return null;

  const speed = SPEED_KMH[transport_mode] ?? SPEED_KMH.walking;
  // Max realistic radius = (speed × duration_h) / 2 (one-way, allowing return)
  //   speed × hours = total distance possible
  //   /2 because radius is one-way from startPoint
  const durationH = estimated_duration_min / 60;
  const maxRealisticRadiusKm = (speed * durationH) / 2;
  // Tolerance : 1.5× because operators may design unrealistic but
  // intentional parcours (e.g. lots of stops in tight zone with long
  // contemplative durations).
  const toleratedMaxKm = maxRealisticRadiusKm * 1.5;

  if (radius_km > toleratedMaxKm) {
    return {
      code: "radius_duration_mismatch",
      severity: "fail",
      message:
        `radius_km=${radius_km} is incompatible with transport_mode=${transport_mode} ` +
        `and estimated_duration_min=${estimated_duration_min}. ` +
        `Max realistic radius at ${speed} km/h over ${durationH.toFixed(1)}h = ${maxRealisticRadiusKm.toFixed(1)} km ` +
        `(×1.5 tolerance = ${toleratedMaxKm.toFixed(1)} km). ` +
        `Either OddballTrip sent wrong parameters, or the product description is inconsistent. ` +
        `Operator must verify before code release.`,
      details: {
        radius_km,
        transport_mode,
        estimated_duration_min,
        max_realistic_radius_km: Number(maxRealisticRadiusKm.toFixed(2)),
        tolerated_max_radius_km: Number(toleratedMaxKm.toFixed(2)),
        excess_factor: Number((radius_km / toleratedMaxKm).toFixed(2)),
      },
    };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════
// D. Theme-aware iconic landmark detection
// ════════════════════════════════════════════════════════════════════

/**
 * Sprint 5.2 introduced a regex whitelist that escapes "Musée X" etc.
 * from the `sources_thin` sanity-check. That whitelist was too
 * permissive : on the Aigues-Mortes 22/05 incident, "Musée Fabre" /
 * "Musée Art Brut" / "Planet Ocean" all matched as iconic and slipped
 * past the check — but they were COMPLETELY UNRELATED to the theme.
 *
 * The fix : a landmark is iconic FOR A THEME only if BOTH
 *   (1) its name matches the iconic-pattern regex set, AND
 *   (2) its name shares a meaningful keyword with the theme.
 *
 * Example :
 *   Theme = "Huguenot Aigues-Mortes 1572"
 *   Landmark = "Musée Fabre"
 *     - (1) match (musée pattern) ✅
 *     - (2) no shared keyword with theme ❌
 *     → NOT iconic for this theme → falls back to needing citation
 *
 *   Theme = "Renaissance French art"
 *   Landmark = "Musée du Louvre"
 *     - (1) match (musée du pattern) ✅
 *     - (2) shared keyword "art" or "musée" ✅
 *     → iconic for this theme → can escape sources_thin
 *
 * The keyword extraction is intentionally simple (significant nouns,
 * length ≥ 4, lowercased). A learned classifier would be more robust
 * but adds complexity for marginal gain on the current scale.
 */

const STOPWORDS_FR_EN = new Set([
  // FR
  "dans", "avec", "pour", "sans", "sous", "vers", "depuis", "entre",
  "cette", "celui", "celle", "ceux", "leur", "leurs", "notre", "votre",
  "mais", "donc", "alors", "ainsi", "aussi", "comme", "plus", "moins",
  "très", "tres", "bien", "tout", "tous", "toute", "toutes",
  "etre", "être", "avoir", "faire", "aller", "venir", "voir",
  "place", "rue", "ville", "siecle", "siècle", "ans", "annee", "année",
  // EN
  "with", "from", "into", "onto", "over", "under", "between", "across",
  "their", "where", "which", "while", "those", "these", "this", "that",
  "have", "been", "were", "will", "would", "could", "should", "must",
  "more", "less", "very", "some", "many", "much", "such", "than",
  "city", "town", "street", "century", "year", "years", "place",
  // Generic toponym components
  "saint", "sainte", "san", "santo", "santa", "north", "south", "east", "west",
  "grand", "petit", "vieille", "vieux", "new", "old", "main",
  // Common landmark words (too generic to score thematic fit)
  "tour", "tower", "porte", "gate", "muraille", "wall", "rempart",
  "cathedral", "cathedrale", "eglise", "chapelle", "abbey", "monastery",
  "place", "plaza", "square", "park", "parc", "jardin", "garden",
  "musee", "museum", "monument",
]);

function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();
  // Normalize : lowercase, strip diacritics, split on non-alpha
  const norm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
  const tokens = norm.split(/[\s-]+/).filter((t) => t.length >= 4);
  return new Set(tokens.filter((t) => !STOPWORDS_FR_EN.has(t)));
}

/**
 * Returns true iff a landmark is iconic-for-theme (both pattern match
 * AND keyword overlap with theme).
 *
 * `iconicMatchFn` is injected so we can keep the regex set in one place
 * (lib/pipeline-validators.ts already has it as ICONIC_LANDMARK_PATTERNS).
 */
export function isIconicForTheme(
  landmarkName: string,
  themeText: string,
  iconicMatchFn: (name: string) => boolean,
): boolean {
  if (!iconicMatchFn(landmarkName)) return false;
  if (!themeText || themeText.trim().length === 0) return true; // no theme = old behavior

  const themeKeywords = extractKeywords(themeText);
  if (themeKeywords.size === 0) return true; // theme too generic to filter

  const landmarkKeywords = extractKeywords(landmarkName);
  if (landmarkKeywords.size === 0) return false;

  // At least one significant keyword overlap required
  for (const lk of landmarkKeywords) {
    if (themeKeywords.has(lk)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// E. Hard flag if Phase 1a Perplexity returned empty context
// ════════════════════════════════════════════════════════════════════

/**
 * Sprint 4 introduced Phase 1a (Perplexity Deep Research) as a sub-
 * step. Its quality_score is non-blocking by design — if Perplexity
 * fails, we continue with degraded grounded research.
 *
 * BUT the Aigues-Mortes 22/05 incident showed that an empty Perplexity
 * context is precisely the condition under which Phase 1b is most
 * likely to hallucinate (no factual anchors → Claude picks tourist-
 * popular POIs regardless of theme).
 *
 * NEW POLICY : when phase1a quality_score < 0.3, force needs_review.
 * The game can still publish (Cynthia paid, we deliver), but operator
 * MUST inspect before the activation code is released.
 *
 * This is a defensive escalation : when the foundation is weak, we
 * promote the operator from passive observer to mandatory reviewer.
 */
export const PHASE1A_HARD_FLAG_THRESHOLD = 0.3;

export interface Phase1aEscalation {
  trigger: boolean;
  reason: string;
}

export function escalateOnPhase1aEmpty(
  phase1aQualityScore: number,
): Phase1aEscalation {
  if (phase1aQualityScore >= PHASE1A_HARD_FLAG_THRESHOLD) {
    return { trigger: false, reason: "" };
  }
  return {
    trigger: true,
    reason:
      `[PERPLEXITY_DR_EMPTY] Phase 1a quality_score=${phase1aQualityScore.toFixed(2)} below floor ${PHASE1A_HARD_FLAG_THRESHOLD}. ` +
      `Perplexity Deep Research returned no usable iconic_sites / real_figures / events / traditions. ` +
      `Without factual anchoring, Phase 1b discovery likely picked stops on popularity rather than theme fit. ` +
      `Operator MUST inspect stops vs theme before code release.`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Aggregation — single entry point for build-game.ts
// ════════════════════════════════════════════════════════════════════

export interface AggregatedFlag {
  needs_review: boolean;
  /** Concatenated review reasons (one per flagged check). Empty if needs_review=false. */
  review_reason: string;
  flags: CoherenceFlag[];
}

export function aggregateCoherenceFlags(
  flags: Array<CoherenceFlag | null>,
): AggregatedFlag {
  const real = flags.filter((f): f is CoherenceFlag => f !== null);
  if (real.length === 0) {
    return { needs_review: false, review_reason: "", flags: [] };
  }
  const needs_review = real.some((f) => f.severity === "fail");
  const review_reason = real.map((f) => `[${f.code}] ${f.message}`).join(" | ");
  return { needs_review, review_reason, flags: real };
}

// Re-export ErrorCategory so callers of this module don't need a separate
// import (centralizes the Sprint 6 type surface).
export type { ErrorCategory };
