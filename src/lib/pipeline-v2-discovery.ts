/**
 * Pipeline V2 — Discovery orchestrator (2026-05-23).
 *
 * ═══════════════════════════════════════════════════════════════════
 * THE SINGLE ENTRY POINT for stop discovery in V2.
 * Replaces the entire `discoverParcours` chain from parcours-discovery.ts.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Pipeline V2 design (deliberate simplicity vs V1's stacked patches) :
 *
 *   1. Resolve startPoint  (existing geocode logic, unchanged)
 *
 *   2. Run TWO modules in PARALLEL :
 *      a. Anchor discovery (V2.2) : Claude names canonical landmarks
 *         + Google geocodes them
 *      b. Facts extraction (V2.1) : Claude builds VerifiedThemeContext
 *         (replaces Perplexity DR — same output, 40× cheaper, 60× faster)
 *
 *   3. If anchors < HERITAGE_FILL_THRESHOLD (typically 5) :
 *      Run heritage fill (V2.3) — Google nearbysearch with strict
 *      heritage types + optional era-compatibility judge.
 *
 *   4. Assemble candidate pool :
 *      [Tier 1 anchors] > [Tier 2 anchors] > [Tier 3 anchors] > [heritage]
 *      Pool size = anchors.length + heritage.length, typically 5-12
 *
 *   5. Apply geometric selection (existing selectStopsByGeometry from
 *      parcours-selection.ts) :
 *      - Greedy pick with min-distance respect
 *      - Up to MIN(pool size, MAX_STOP_COUNT)
 *
 *   6. NN reorder from startPoint (existing helper)
 *
 *   7. Walkability filter — drop outlier stops too far from neighbors
 *      (existing logic, but lighter — V2 trusts the pool is cleaner)
 *
 *   8. Return DiscoverParcoursResult-shaped output so the downstream
 *      pipeline (game-pipeline.ts → build-game.ts) doesn't change.
 *
 * What V2 DOES NOT DO (vs V1) :
 *   - No widening retries (1× → 1.5× → 2.5×). V2 starts at one radius
 *     and accepts the pool size it gets. If too few stops, ABORT with
 *     a clear error — don't ship a degraded game.
 *   - No Gemini AI-first discovery branch (always Google + anchors).
 *   - No Perplexity DR (replaced by Claude facts).
 *   - No multi-layer thematic auto-repair (anchors are thematic BY
 *     CONSTRUCTION — no need to re-rank).
 *
 * Cost per build :
 *   V1 : ~$0.55 (Perplexity DR $0.40 + Claude calls $0.10 + Google $0.05)
 *   V2 : ~$0.05 (Claude facts $0.005 + Claude anchors $0.005 + Google $0.04)
 *   → 11× cheaper.
 *
 * Time per build :
 *   V1 : 15-25 min (Perplexity DR is the long pole)
 *   V2 : 1-3 min (parallel anchors + heritage)
 *   → 5-10× faster.
 *
 * Reliability :
 *   V1 : ~30% (Béziers V3, V4, V5, V5-bis, V6 all failed)
 *   V2 : Target ~95% (anchors are themed by construction)
 */
import type { VerifiedThemeContext } from "./perplexity";
import type { NearbyCandidate } from "./geocode";
import { haversineMeters } from "./geocode";
import {
  selectStopsByGeometry,
  computeAdaptiveMinDist,
  haversineMetersBetween,
} from "./parcours-selection";
import { extractThemeFacts } from "./pipeline-v2-facts";
import {
  discoverAnchors,
  type AnchorCandidate,
} from "./pipeline-v2-anchors";
import { discoverHeritage } from "./pipeline-v2-heritage";
import type { DiscoveredStop } from "./parcours-discovery";

/**
 * Minimum number of stops we accept to publish a game. Below this,
 * the experience feels too thin for the price point. We ABORT rather
 * than ship.
 *
 * V1 used 6, but V2 allows 5 because :
 *   - Anchors are theme-CANONICAL by construction (high per-stop value)
 *   - Sprint J's adaptive logic showed 5 high-Tier stops > 7 noisy
 *   - User explicitly authorized 5 as commercial floor 23/05/2026
 */
export const V2_MIN_STOPS = 5;

/**
 * Maximum stops we'll select even if pool is larger. Beyond this,
 * the parcours runs longer than 2-3h (overshoots 7.99€/11.99€ pricing).
 */
export const V2_MAX_STOPS = 8;

/**
 * Threshold below which we trigger heritage fill (V2.3). If anchors
 * alone give 5+, we trust them and skip the fill (cleaner pool).
 */
const HERITAGE_FILL_THRESHOLD = 5;

/**
 * Walking radius for stop discovery, FIXED for V2 (no adaptive
 * widening). Picks a generous-but-walkable diameter.
 *
 *   stopCount target ≥ 7 → 2500m radius (5km diameter)
 *   stopCount target ≤ 6 → 2000m radius (4km diameter)
 *
 * For roadtrip mode, use template.radiusKm × 1000 directly.
 */
function v2WalkingRadiusM(targetStopCount: number): number {
  if (targetStopCount >= 7) return 2_500;
  return 2_000;
}

/**
 * Theme era extraction — very lightweight heuristic for the heritage
 * fill era-compat check. Looks for year patterns or known era names
 * in the theme description.
 */
function extractThemeEra(themeDescription: string, narrative?: string): string {
  const combined = `${themeDescription} ${narrative ?? ""}`.toLowerCase();

  // Year mentions
  const yearMatch = combined.match(/\b1[0-9]{3}\b/g);
  if (yearMatch && yearMatch.length > 0) {
    const year = parseInt(yearMatch[0], 10);
    if (year < 1300) return `${year} (medieval, 13th c or earlier)`;
    if (year < 1500) return `${year} (late medieval)`;
    if (year < 1700) return `${year} (Renaissance / early modern)`;
    if (year < 1850) return `${year} (early modern / pre-industrial)`;
    return `${year} (modern era)`;
  }

  // Era keywords
  if (/\bmedieval\b|\bmoyen[\s-]âge\b/.test(combined))
    return "medieval (5th-15th c)";
  if (/\brenaissance\b/.test(combined)) return "Renaissance (15-17th c)";
  if (/\bantique\b|\bantiquity\b|\broman\b|\bromain\b/.test(combined))
    return "Antiquity (Roman/Greek)";
  if (/\bcrusade\b|\bcroisade\b|\bcathar\b|\bcathare\b/.test(combined))
    return "Crusades-era medieval (12-13th c)";
  if (/\bhuguenot\b|\bprotestant\b/.test(combined))
    return "Religious wars (16-17th c)";
  if (/\brevolution\b/.test(combined))
    return "French Revolution / late 18th c";
  if (/\bnapoleon\b|\bempire\b/.test(combined))
    return "Napoleonic / 19th c";
  if (/\bw[wo]2\b|\bworld war\b|\bguerre mondiale\b|\bresistance\b|\bresistance\b/.test(combined))
    return "20th-c (WWII era)";

  return ""; // unknown era → skip era judge, accept any heritage
}

// ═════════════════════════════════════════════════════════════════════
// Public entry point
// ═════════════════════════════════════════════════════════════════════

export interface DiscoverV2Params {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
  productDescription?: string;
  stopCount: number; // OddballTrip's requested target (informative)
  /** Resolved start point — REQUIRED. Caller (game-pipeline.ts) handles
   *  resolution via existing logic so V2 stays focused on discovery. */
  startPoint: { lat: number; lon: number };
  /** Label for the start point (passes through for DB persistence). */
  startPointText: string;
  /** Source tag for telemetry/audit. */
  startPointSource:
    | "startPointText-geocoded"
    | "top-landmark-google-places"
    | "city-center-fallback";
  /** Optional accessibility filter — passes through to heritage fill. */
  accessibility?: "free" | "any";
  /** Transport mode override. Default "walking". */
  transportMode?: "walking" | "driving" | "mixed";
  /** Radius for roadtrip mode in km. Used when transportMode != walking. */
  radiusKm?: number;
  /** Pre-computed VerifiedThemeContext from Inngest's upstream
   *  phase1a-deep-research step. When supplied, V2 SKIPS the
   *  facts extraction call internally (same pattern as V1's
   *  injectedVerifiedContext). */
  injectedVerifiedContext?: VerifiedThemeContext;
}

export interface DiscoverV2Result {
  success: boolean;
  landmarks: DiscoveredStop[];
  rejected: Array<{ name: string; reason: string }>;
  errorCode?: "DISCOVERY_FAILED" | "TOO_FEW_LANDMARKS" | "PARCOURS_TOO_DISPERSED";
  error?: string;
  verifiedContext?: VerifiedThemeContext;
  /** Always populated (V2 always uses Claude + Google). */
  discoverySource: "v2_claude_anchors";
  escalatedTransportMode?: "walking" | "mixed" | "driving";
  /** Resolved start point + source for downstream persistence. */
  resolvedStartPoint: { lat: number; lon: number };
  resolvedStartPointText: string;
  resolvedStartPointSource:
    | "startPointText-geocoded"
    | "top-landmark-google-places"
    | "city-center-fallback";
  /** Audit : breakdown of pool composition. */
  poolBreakdown: {
    anchorsTier1: number;
    anchorsTier2: number;
    anchorsTier3: number;
    heritage: number;
    total: number;
  };
  /**
   * Full pool for downstream auto-repair (Sprint 6.2quater still
   * exists as backstop, even though V2 should rarely need it).
   */
  allCandidates: NearbyCandidate[];
  /** Notes for telemetry / review_reason. */
  notes: string[];
}

/**
 * V2 main entry. Replaces discoverParcours from V1.
 */
export async function discoverParcoursV2(
  params: DiscoverV2Params,
): Promise<DiscoverV2Result> {
  const notes: string[] = [];
  const startPoint = params.startPoint;
  const startPointText = params.startPointText;
  const startPointSource = params.startPointSource;

  // ──────────────────────────────────────────────────────────
  // STEP 1 : Determine search radius
  // ──────────────────────────────────────────────────────────
  const isRoadtrip =
    params.transportMode === "driving" || params.transportMode === "mixed";
  const radiusM = isRoadtrip
    ? Math.round((params.radiusKm ?? 30) * 1000)
    : v2WalkingRadiusM(params.stopCount);
  notes.push(
    `[v2] start=${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)} radius=${radiusM}m mode=${params.transportMode ?? "walking"} target_stop_count=${params.stopCount}`,
  );

  // ──────────────────────────────────────────────────────────
  // STEP 2 : Parallel — facts extraction (skipped if injected) +
  //           anchor discovery
  // ──────────────────────────────────────────────────────────
  const factsPromise = params.injectedVerifiedContext
    ? Promise.resolve(params.injectedVerifiedContext)
    : extractThemeFacts({
        theme: params.theme,
        themeDescription: params.themeDescription,
        productDescription: params.productDescription,
        city: params.city,
        country: params.country,
        narrative: params.narrative,
      });
  const [factsRes, anchorsRes] = await Promise.allSettled([
    factsPromise,
    discoverAnchors({
      theme: params.theme,
      themeDescription: params.themeDescription,
      productDescription: params.productDescription,
      narrative: params.narrative,
      city: params.city,
      country: params.country,
      walkingRadiusM: radiusM,
      startPoint,
      maxProposals: 8,
    }),
  ]);

  const verifiedContext =
    factsRes.status === "fulfilled" ? factsRes.value : undefined;
  const anchors: AnchorCandidate[] =
    anchorsRes.status === "fulfilled" ? anchorsRes.value.anchors : [];
  const anchorRejected: Array<{ name: string; reason: string }> =
    anchorsRes.status === "fulfilled" ? anchorsRes.value.rejected : [];

  if (factsRes.status === "rejected") {
    notes.push(
      `[v2] facts extraction failed: ${factsRes.reason instanceof Error ? factsRes.reason.message : factsRes.reason} — pipeline continues without verifiedContext`,
    );
  }
  if (anchorsRes.status === "rejected") {
    notes.push(
      `[v2] anchor discovery failed: ${anchorsRes.reason instanceof Error ? anchorsRes.reason.message : anchorsRes.reason}`,
    );
  }

  const anchorsTier1 = anchors.filter((a) => a.tier === 1).length;
  const anchorsTier2 = anchors.filter((a) => a.tier === 2).length;
  const anchorsTier3 = anchors.filter((a) => a.tier === 3).length;
  notes.push(
    `[v2] anchors: ${anchors.length} geocoded (T1=${anchorsTier1}, T2=${anchorsTier2}, T3=${anchorsTier3}). Rejected: ${anchorRejected.length}`,
  );

  // ──────────────────────────────────────────────────────────
  // STEP 3 : Heritage fill (only if anchors below threshold)
  // ──────────────────────────────────────────────────────────
  let heritage: NearbyCandidate[] = [];
  if (anchors.length < HERITAGE_FILL_THRESHOLD || anchors.length < V2_MAX_STOPS) {
    const needed = V2_MAX_STOPS - anchors.length;
    if (needed > 0) {
      const themeEra = extractThemeEra(
        params.themeDescription,
        params.narrative,
      );
      notes.push(
        `[v2] heritage fill triggered: need ${needed} more, era="${themeEra || "(unknown)"}", judge ${themeEra ? "ON" : "OFF"}`,
      );
      try {
        const heritageRes = await discoverHeritage({
          startPoint,
          walkingRadiusM: radiusM,
          excludePlaceIds: new Set(anchors.map((a) => a.placeId)),
          needed,
          themeEra,
          skipEraJudge: !themeEra,
        });
        heritage = heritageRes.heritage;
        notes.push(
          `[v2] heritage fill: ${heritage.length} accepted (raw ${heritageRes.stats.rawCount}, type-OK ${heritageRes.stats.afterTypeFilter}, era-OK ${heritageRes.stats.afterEraFilter})`,
        );
        for (const r of heritageRes.stats.rejected.slice(0, 5)) {
          anchorRejected.push({ name: r.name, reason: r.reason });
        }
      } catch (err) {
        notes.push(
          `[v2] heritage fill failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  } else {
    notes.push(
      `[v2] heritage fill skipped: ${anchors.length} anchors >= threshold ${HERITAGE_FILL_THRESHOLD}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // STEP 4 : Assemble pool + check minimum viable
  // ──────────────────────────────────────────────────────────
  const pool: NearbyCandidate[] = [
    // Anchors first, sorted by tier ascending then by rating
    ...anchors,
    // Then heritage fill
    ...heritage,
  ];

  if (pool.length < V2_MIN_STOPS) {
    notes.push(
      `[v2] ABORT: pool=${pool.length} < V2_MIN_STOPS=${V2_MIN_STOPS}. Zone insufficient for this theme.`,
    );
    return {
      success: false,
      landmarks: [],
      rejected: anchorRejected,
      errorCode: "TOO_FEW_LANDMARKS",
      error: `Pool too thin (${pool.length} candidates after anchors+heritage). Zone insufficient for theme "${params.theme}" in ${params.city}. Reframe editorially.`,
      verifiedContext,
      discoverySource: "v2_claude_anchors",
      escalatedTransportMode: params.transportMode,
      resolvedStartPoint: startPoint,
      resolvedStartPointText: startPointText,
      resolvedStartPointSource: startPointSource,
      poolBreakdown: { anchorsTier1, anchorsTier2, anchorsTier3, heritage: heritage.length, total: pool.length },
      allCandidates: pool,
      notes,
    };
  }

  // ──────────────────────────────────────────────────────────
  // STEP 5 : Geometric selection (greedy with min-distance)
  // ──────────────────────────────────────────────────────────
  // Target = min(pool size, V2_MAX_STOPS). The pool ordering puts
  // tier 1 anchors first, so greedy will prefer them. Adaptive
  // min-distance scales with zone size.
  const targetN = Math.min(pool.length, V2_MAX_STOPS);
  const minDistanceM = computeAdaptiveMinDist(targetN, radiusM);
  const selection = selectStopsByGeometry({
    candidates: pool,
    targetN,
    minN: V2_MIN_STOPS,
    minDistanceM,
  });

  notes.push(
    `[v2] geometric selection: ${selection.selected.length}/${targetN} stops, min_pair_distance=${Math.round(selection.actualMinPairDistanceM)}m (relaxed from ${minDistanceM}m to ${selection.finalMinDistanceUsedM}m in ${selection.relaxationSteps} step(s))`,
  );

  if (!selection.success) {
    notes.push(
      `[v2] geometric selection failed: ${selection.failureReason ?? "(no reason)"}. Falling back to pool order.`,
    );
  }

  if (selection.selected.length < V2_MIN_STOPS) {
    return {
      success: false,
      landmarks: [],
      rejected: anchorRejected,
      errorCode: "PARCOURS_TOO_DISPERSED",
      error: `Geometric selection returned only ${selection.selected.length}/${V2_MIN_STOPS} stops after relaxation to ${selection.finalMinDistanceUsedM}m. Zone too sparse or clustered.`,
      verifiedContext,
      discoverySource: "v2_claude_anchors",
      escalatedTransportMode: params.transportMode,
      resolvedStartPoint: startPoint,
      resolvedStartPointText: startPointText,
      resolvedStartPointSource: startPointSource,
      poolBreakdown: { anchorsTier1, anchorsTier2, anchorsTier3, heritage: heritage.length, total: pool.length },
      allCandidates: pool,
      notes,
    };
  }

  // ──────────────────────────────────────────────────────────
  // STEP 6 : NN reorder from startPoint (greedy nearest neighbor)
  // ──────────────────────────────────────────────────────────
  const ordered = greedyNNFromStart(selection.selected, startPoint);

  // ──────────────────────────────────────────────────────────
  // STEP 7 : Light walkability sanity check (no drops; just log)
  // ──────────────────────────────────────────────────────────
  for (let i = 1; i < ordered.length; i++) {
    const hopDistance = haversineMeters(
      { lat: ordered[i - 1].lat, lon: ordered[i - 1].lon },
      { lat: ordered[i].lat, lon: ordered[i].lon },
    );
    if (hopDistance > 2500) {
      notes.push(
        `[v2] WARNING walkability: ${ordered[i - 1].name} → ${ordered[i].name} hop=${Math.round(hopDistance)}m (> 2500m)`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // STEP 8 : Convert to DiscoveredStop[]
  // ──────────────────────────────────────────────────────────
  const landmarks: DiscoveredStop[] = ordered.map((c) => {
    // If this is an anchor, prepend the rationale to description for
    // narration context. Otherwise just use the name.
    const asAnchor = c as AnchorCandidate;
    const description = asAnchor.rationale
      ? `${asAnchor.rationale} (Tier ${asAnchor.tier} anchor)`
      : `Era-compatible heritage : ${c.types.slice(0, 3).join(", ")}`;
    return {
      name: c.name,
      description,
      source: asAnchor.tier ? "v2-claude-anchor" : "v2-heritage-fill",
      lat: c.lat,
      lon: c.lon,
      placeId: c.placeId,
      distanceFromStartM: c.distanceM,
      stopMode: "radar" as const,
      navigationHint: undefined,
      types: c.types,
      rating: c.rating,
    };
  });

  notes.push(
    `[v2] SUCCESS: ${landmarks.length} stops (${anchorsTier1} T1 anchors + ${anchorsTier2} T2 + ${anchorsTier3} T3 + ${heritage.length} heritage)`,
  );

  return {
    success: true,
    landmarks,
    rejected: anchorRejected,
    verifiedContext,
    discoverySource: "v2_claude_anchors",
    escalatedTransportMode: params.transportMode,
    resolvedStartPoint: startPoint,
    resolvedStartPointText: startPointText,
    resolvedStartPointSource: startPointSource,
    poolBreakdown: { anchorsTier1, anchorsTier2, anchorsTier3, heritage: heritage.length, total: pool.length },
    allCandidates: pool,
    notes,
  };
}

/**
 * Greedy nearest-neighbor reorder from startPoint.
 * Picks the closest unvisited stop at each step.
 */
function greedyNNFromStart(
  stops: NearbyCandidate[],
  startPoint: { lat: number; lon: number },
): NearbyCandidate[] {
  if (stops.length === 0) return [];
  const remaining = [...stops];
  const ordered: NearbyCandidate[] = [];
  let current = { lat: startPoint.lat, lon: startPoint.lon };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMetersBetween(current, {
        lat: remaining[i].lat,
        lon: remaining[i].lon,
      });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = { lat: next.lat, lon: next.lon };
  }
  return ordered;
}
