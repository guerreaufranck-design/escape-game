/**
 * Canonicalize POIs returned by Gemini through Google Maps.
 *
 * Gemini gives us names + addresses + hint coordinates. We trust the
 * names and addresses, but the coordinates are routinely wrong by
 * 50-500 m. So we re-geocode each POI by its full address, and use
 * Gemini's lat/lon only as a hint to detect catastrophic hallucination
 * (Google returning a POI of the same name in another city).
 *
 * The output is a `NearbyCandidate[]` so it slots into the existing
 * `selectStopsByGeometry` pipeline without touching the rest of the
 * code path.
 *
 * Pairwise diameter enforcement runs at the end: any POI whose presence
 * makes the set diameter exceed the cap is iteratively dropped until
 * the set fits.
 */

import { geocodeLocation, haversineMeters, type NearbyCandidate } from "./geocode";
import type { RawThematicPoi } from "./ai-discovery";

/** Max acceptable distance between Gemini's hint coords and Google's
 *  canonical coords. Above this, we suspect Gemini hallucinated a
 *  different place with a similar name (e.g. another "Liceo Govone"
 *  in another city). We keep the Google version but log a warning;
 *  if the displayName also looks off, the geocoder's own name-match
 *  guard already drops the result. */
const HINT_DRIFT_WARN_M = 500;

/** Max acceptable drift before we hard-reject the POI as a likely
 *  hallucination. 5 km is well beyond any reasonable geocoder
 *  imprecision and signals "we asked for X in Alba, Italy and got
 *  X in Madrid". */
const HINT_DRIFT_REJECT_M = 5_000;

export interface ValidatePoisParams {
  city: string;
  country: string;
  startPoint: { lat: number; lon: number };
  /** Max pairwise diameter allowed in the final set (start point included). */
  diameterCapM: number;
}

export interface ValidationResult {
  candidates: NearbyCandidate[];
  rejected: Array<{
    name: string;
    reason: string;
    address?: string;
  }>;
  /** Validated POIs paired with their original Gemini metadata. Used
   *  downstream by the narrative generator to anchor anecdotes on
   *  real historical_role + citation. */
  themedContext: Array<{
    placeId: string;
    historicalRole: string;
    citation: string;
  }>;
}

/**
 * Run each raw POI through Google Maps Geocoding and Places. Returns
 * one NearbyCandidate per surviving POI, plus a rejection log and
 * a per-POI thematic context for downstream narrative generation.
 */
export async function validateThematicPois(
  rawPois: RawThematicPoi[],
  params: ValidatePoisParams,
): Promise<ValidationResult> {
  const rejected: ValidationResult["rejected"] = [];
  const themedContext: ValidationResult["themedContext"] = [];

  // Parallel geocoding — geocodeLocation has its own per-call dedup
  // cache so concurrency is safe and cheap.
  const tasks = rawPois.map(async (raw) => {
    // Try address first (most specific), then fall back to name.
    // geocodeLocation handles Google Places → Google Geocoding → Nominatim
    // cascade with name-match + distance validation built in.
    const geo =
      (await geocodeLocation(raw.address, params.city, params.country, {
        referencePoint: params.startPoint,
        maxDistanceM: params.diameterCapM,
      })) ||
      (await geocodeLocation(raw.name, params.city, params.country, {
        referencePoint: params.startPoint,
        maxDistanceM: params.diameterCapM,
      }));

    if (!geo) {
      return {
        ok: false as const,
        raw,
        reason: "no geocode match within diameter cap",
      };
    }

    if (geo.confidence === "low") {
      return {
        ok: false as const,
        raw,
        reason: `geocode confidence "low" — neighbourhood-level only, would put player 100+ m off`,
      };
    }

    // Cross-check Gemini's hint vs Google's canonical coords. Big drift =
    // probable hallucination of a different place with similar name.
    const drift = haversineMeters(
      { lat: raw.latHint, lon: raw.lonHint },
      { lat: geo.lat, lon: geo.lon },
    );

    if (drift > HINT_DRIFT_REJECT_M) {
      return {
        ok: false as const,
        raw,
        reason: `hint vs canonical drift = ${Math.round(drift)}m (> ${HINT_DRIFT_REJECT_M}m) — likely Gemini hallucinated wrong "${raw.name}"`,
      };
    }

    if (drift > HINT_DRIFT_WARN_M) {
      console.warn(
        `[poi-validation] hint drift ${Math.round(drift)}m for "${raw.name}" → kept (Google canonical wins), but Gemini coords were off`,
      );
    }

    const distanceFromStart = haversineMeters(params.startPoint, {
      lat: geo.lat,
      lon: geo.lon,
    });

    const placeId = geo.externalId ?? `geocoded:${raw.name}`;
    const candidate: NearbyCandidate = {
      name: raw.name,
      lat: geo.lat,
      lon: geo.lon,
      placeId,
      types: ["thematic"], // tagged for downstream debug
      address: geo.displayName,
      distanceM: distanceFromStart,
    };

    return {
      ok: true as const,
      raw,
      candidate,
      themedEntry: {
        placeId,
        historicalRole: raw.historicalRole,
        citation: raw.citation,
      },
    };
  });

  const results = await Promise.allSettled(tasks);

  // Collect successes + rejects, dedup by place_id (Gemini sometimes
  // returns the same site under two slightly different names — e.g.
  // "Piazza Risorgimento" + "Piazza Duomo, Alba" → same place_id).
  const seenPlaceIds = new Set<string>();
  const candidates: NearbyCandidate[] = [];

  for (const r of results) {
    if (r.status === "rejected") {
      rejected.push({
        name: "<unknown>",
        reason: `geocode task threw: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      });
      continue;
    }
    if (!r.value.ok) {
      rejected.push({
        name: r.value.raw.name,
        address: r.value.raw.address,
        reason: r.value.reason,
      });
      continue;
    }
    if (seenPlaceIds.has(r.value.candidate.placeId)) {
      rejected.push({
        name: r.value.raw.name,
        address: r.value.raw.address,
        reason: `duplicate place_id with already-validated POI`,
      });
      continue;
    }
    seenPlaceIds.add(r.value.candidate.placeId);
    candidates.push(r.value.candidate);
    themedContext.push(r.value.themedEntry);
  }

  // Enforce pairwise diameter cap (start point included). Iteratively
  // remove the POI involved in the most violations until no pair exceeds
  // the cap. O(n²) per pass, n ≤ ~20, so trivially cheap.
  const enforced = enforceDiameterCap(
    candidates,
    themedContext,
    params.startPoint,
    params.diameterCapM,
  );

  return {
    candidates: enforced.candidates,
    rejected: [...rejected, ...enforced.rejected],
    themedContext: enforced.themedContext,
  };
}

interface EnforceResult {
  candidates: NearbyCandidate[];
  themedContext: ValidationResult["themedContext"];
  rejected: ValidationResult["rejected"];
}

function enforceDiameterCap(
  candidates: NearbyCandidate[],
  themedContext: ValidationResult["themedContext"],
  startPoint: { lat: number; lon: number },
  diameterCapM: number,
): EnforceResult {
  const rejected: ValidationResult["rejected"] = [];
  // Working copy
  let remaining = candidates.map((c, i) => ({ candidate: c, ctx: themedContext[i] }));

  while (true) {
    // Build the set with start point as index -1
    const points = [
      { lat: startPoint.lat, lon: startPoint.lon, isStart: true, idx: -1 },
      ...remaining.map((r, i) => ({
        lat: r.candidate.lat,
        lon: r.candidate.lon,
        isStart: false,
        idx: i,
      })),
    ];

    // Count violations per POI (start point can't be removed)
    const violations = new Map<number, number>();
    let maxPairDist = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = haversineMeters(
          { lat: points[i].lat, lon: points[i].lon },
          { lat: points[j].lat, lon: points[j].lon },
        );
        if (d > maxPairDist) maxPairDist = d;
        if (d > diameterCapM) {
          if (!points[i].isStart) {
            violations.set(points[i].idx, (violations.get(points[i].idx) ?? 0) + 1);
          }
          if (!points[j].isStart) {
            violations.set(points[j].idx, (violations.get(points[j].idx) ?? 0) + 1);
          }
        }
      }
    }

    if (violations.size === 0) {
      // Diameter satisfied
      console.log(
        `[poi-validation] diameter check OK — max pair = ${Math.round(maxPairDist)}m (cap ${diameterCapM}m), ${remaining.length} POIs`,
      );
      return {
        candidates: remaining.map((r) => r.candidate),
        themedContext: remaining.map((r) => r.ctx),
        rejected,
      };
    }

    // Drop the POI with the most violations. Ties broken by distance to
    // start point (drop the further one — it's likely the geographic
    // outlier).
    let worstIdx = -1;
    let worstScore = -Infinity;
    for (const [idx, count] of violations) {
      const c = remaining[idx].candidate;
      const distFromStart = haversineMeters(startPoint, { lat: c.lat, lon: c.lon });
      const score = count * 100_000 + distFromStart;
      if (score > worstScore) {
        worstScore = score;
        worstIdx = idx;
      }
    }

    const dropped = remaining[worstIdx];
    rejected.push({
      name: dropped.candidate.name,
      reason: `diameter violation — would push the set beyond ${diameterCapM}m cap`,
    });
    remaining = remaining.filter((_, i) => i !== worstIdx);

    if (remaining.length === 0) {
      console.warn(
        `[poi-validation] all POIs dropped during diameter enforcement — set was geographically inconsistent`,
      );
      return { candidates: [], themedContext: [], rejected };
    }
  }
}
