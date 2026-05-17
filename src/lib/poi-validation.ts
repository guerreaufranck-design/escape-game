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

/**
 * Pure address geocoder for Gemini-supplied POIs. Bypasses the name-
 * match heuristic used by `geocodeLocation`, which is meant for
 * landmark-name lookups and is overly strict here: Gemini gives us a
 * postal address ("Piazza Risorgimento, 1, 12051 Alba CN, Italy") plus
 * a separate name ("Palazzo Comunale"). Google's geocoder canonicalizes
 * the address to "Comune di Alba, Piazza Risorgimento 1" — that's the
 * SAME building, but the token-overlap match against "Palazzo Comunale"
 * fails and the result gets dropped.
 *
 * For Gemini-fed POIs we trust the ADDRESS as primary identifier, not
 * the name. The address is what Gemini got from Google Search grounding,
 * so it's already been seen on a Google-indexed page. Returns null
 * only when Google Geocoding finds nothing matching at all, or when
 * the result lies outside the requested zone.
 */
async function geocodeAddress(
  address: string,
  referencePoint: { lat: number; lon: number },
  maxDistanceM: number,
): Promise<{ lat: number; lon: number; displayName: string; placeId: string } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  // bias around the start point — same syntax as geocode.ts uses for
  // viaGoogleGeocoding (location bias is "lat,lon,radiusMeters").
  url.searchParams.set("bounds", boundingBoxAround(referencePoint, maxDistanceM));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        geometry?: { location?: { lat: number; lng: number }; location_type?: string };
        place_id?: string;
        formatted_address?: string;
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const top = data.results[0];
    const loc = top.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;

    // Reject neighbourhood-level approximations (would put player 100+m off)
    if (top.geometry?.location_type === "APPROXIMATE") return null;

    const lat = loc.lat;
    const lon = loc.lng;
    const distance = haversineMeters({ lat, lon }, referencePoint);
    if (distance > maxDistanceM) return null;

    return {
      lat,
      lon,
      displayName: top.formatted_address ?? address,
      placeId: top.place_id ? `google:${top.place_id}` : `geocoded:${address}`,
    };
  } catch {
    return null;
  }
}

/** Rough bounding box around a point — used to bias geocoding rather
 *  than filter. We still validate distance after the call. */
function boundingBoxAround(
  refPoint: { lat: number; lon: number },
  radiusM: number,
): string {
  // 1° latitude ≈ 111 km. Convert radius to degrees.
  const latDelta = radiusM / 111_000;
  const lonDelta =
    radiusM /
    (111_000 * Math.max(0.01, Math.cos((refPoint.lat * Math.PI) / 180)));
  const sw = `${(refPoint.lat - latDelta).toFixed(6)},${(refPoint.lon - lonDelta).toFixed(6)}`;
  const ne = `${(refPoint.lat + latDelta).toFixed(6)},${(refPoint.lon + lonDelta).toFixed(6)}`;
  return `${sw}|${ne}`;
}

/** Max acceptable distance between Gemini's hint coords and Google's
 *  canonical coords. Above this, we suspect Gemini hallucinated a
 *  different place with a similar name. Tightened 2026-05-17 after
 *  Zadar incident (3/7 stops off by 340-1100 m, all within the old
 *  500 m WARN range so no signal fired). 200 m = a player can still
 *  visually spot the landmark from the marker. */
const HINT_DRIFT_WARN_M = 200;

/** Max acceptable drift before we hard-reject the POI as a likely
 *  hallucination. Tightened 2026-05-17 (was 5 km — let Zadar Stop 5
 *  through at 1.1 km drift). 1.5 km = ~ same block, beyond is clearly
 *  another place (same street name in different district, homonym
 *  POI in adjacent neighbourhood, etc.). */
const HINT_DRIFT_REJECT_M = 1_500;

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
   *  downstream by the narrative generator to anchor each stop's
   *  landmark_history (patrimonial) and anecdote (thematic) on real
   *  documented facts. */
  themedContext: Array<{
    placeId: string;
    /** Full patrimonial story (1 paragraph) — fuels landmark_history. */
    patrimonialRole: string;
    /** Theme connection (1 sentence) — fuels anecdote framing. May be empty. */
    thematicRole: string;
    /** Source URL or short reference. */
    citation: string;
    /** Category from Gemini: patrimonial_landmark / thematic_anchor / micro_memorial. */
    category: "patrimonial_landmark" | "thematic_anchor" | "micro_memorial";
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

  // Parallel geocoding. NAME-FIRST strategy (revised 2026-05-17 post-Zadar).
  //
  // Why name-first: Google Places `findplacefromtext` is purpose-built
  // for named POIs and uses Google's authoritative POI database. Address-
  // first was the legacy approach but it trusted Gemini's hallucinated
  // address blindly — if Gemini invented an address consistent with its
  // hallucinated coords, Google geocoded the wrong address to wrong
  // coords and the pipeline accepted them (3/7 Zadar stops failed this
  // way: Cathedral 370 m off, Sv. Marije 1.1 km off, Sv. Krševana 340 m).
  //
  // The user's manual technique that always works: type `"name, city"`
  // in Google Maps. That's exactly what `geocodeLocation(name, city)`
  // does via Places API. So we now match that flow:
  //   1. geocodeLocation(name, city) — Places findplacefromtext, the
  //      gold standard for named landmarks (sub-10 m).
  //   2. geocodeAddress(address) — fallback when name lookup fails
  //      (rare: small chapels, plazas without dedicated POI entries).
  //   3. geocodeLocation(address) — last resort when API key missing
  //      or Google rejects (falls back to Nominatim).
  const tasks = rawPois.map(async (raw) => {
    let lat: number;
    let lon: number;
    let displayName: string;
    let placeId: string;

    // Step 1: NAME-first via Google Places findplacefromtext.
    const nameGeo = await geocodeLocation(
      raw.name,
      params.city,
      params.country,
      {
        referencePoint: params.startPoint,
        maxDistanceM: params.diameterCapM,
      },
    );

    if (nameGeo && nameGeo.confidence !== "low") {
      lat = nameGeo.lat;
      lon = nameGeo.lon;
      displayName = nameGeo.displayName;
      placeId = nameGeo.externalId ?? `geocoded:${raw.name}`;
    } else {
      // Step 2: address-based fallback via Google Geocoding API.
      const addressGeo = await geocodeAddress(
        raw.address,
        params.startPoint,
        params.diameterCapM,
      );

      if (addressGeo) {
        ({ lat, lon, displayName, placeId } = addressGeo);
      } else {
        // Step 3: last resort — geocodeLocation(address) handles
        // missing API key by falling down to Nominatim.
        const addressFallback = await geocodeLocation(
          raw.address,
          params.city,
          params.country,
          {
            referencePoint: params.startPoint,
            maxDistanceM: params.diameterCapM,
          },
        );

        if (!addressFallback) {
          return {
            ok: false as const,
            raw,
            reason: "no geocode match (name + address + address-as-name all failed)",
          };
        }
        if (addressFallback.confidence === "low") {
          return {
            ok: false as const,
            raw,
            reason: `geocode confidence "low" — neighbourhood-level only`,
          };
        }
        lat = addressFallback.lat;
        lon = addressFallback.lon;
        displayName = addressFallback.displayName;
        placeId = addressFallback.externalId ?? `geocoded:${raw.address}`;
      }
    }

    const geo = {
      lat,
      lon,
      displayName,
      externalId: placeId,
      confidence: "high" as const,
    };

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

    const candidatePlaceId = geo.externalId ?? `geocoded:${raw.name}`;
    const candidate: NearbyCandidate = {
      name: raw.name,
      lat: geo.lat,
      lon: geo.lon,
      placeId: candidatePlaceId,
      types: ["thematic"], // tagged for downstream debug
      address: geo.displayName,
      distanceM: distanceFromStart,
    };

    return {
      ok: true as const,
      raw,
      candidate,
      themedEntry: {
        placeId: candidatePlaceId,
        patrimonialRole: raw.patrimonialRole,
        thematicRole: raw.thematicRole,
        citation: raw.citation,
        category: raw.category ?? "patrimonial_landmark",
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
