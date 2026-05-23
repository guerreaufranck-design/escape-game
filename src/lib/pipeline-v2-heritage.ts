/**
 * Pipeline V2 — Heritage fill (2026-05-23).
 *
 * ═══════════════════════════════════════════════════════════════════
 * When `discoverAnchors` (V2.2) returns fewer than ~6 anchors, we
 * fill the parcours with ERA-COMPATIBLE PATRIMOINE so the player
 * has enough stops to feel like a real escape-game.
 *
 * Design principle :
 *
 *   Heritage fills DO NOT need to be theme-specific. They need to be
 *   ERA-COMPATIBLE so the NARRATION can weave them in without breaking
 *   the period feel. A 12th-century church in Béziers fits a 1209
 *   Cathar theme even if it has no documented Cathar role — the
 *   narrator says "by the time of the 1209 events, this church already
 *   stood here..." and the player buys it.
 *
 * Approach :
 *
 *   1. Google nearbysearch with STRICT heritage types
 *      (cathedral, church, historical_landmark, monument, castle,
 *       basilica, abbey, bridge, city_gate, place_of_worship)
 *      → 40-60 raw candidates within walking radius
 *
 *   2. Hard filter : reject if ANY bad type is present
 *      (gas_station, supermarket, lodging, parking, etc. — same
 *       REJECT_TYPES as anchors module)
 *
 *   3. Sort by tourism score (existing computeTouristicScore)
 *      Score = rating × log(reviews) + type_bonus + proximity
 *
 *   4. Optional era check (Claude Haiku judge, batch) :
 *      For each top-10 candidate, ask "is this era-compatible with
 *      [theme era] ?". Reject incompatible (e.g., 19th-c canal locks
 *      on a 13th-century theme).
 *      Cost : 1 Haiku call for the batch ~$0.003
 *
 *   5. Return top N best heritage candidates that PASSED everything.
 *
 * Output : array of NearbyCandidate ready to merge with anchors.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  discoverNearbyLandmarks,
  haversineMeters,
  type NearbyCandidate,
} from "./geocode";
import { computeTouristicScore } from "./parcours-selection";

// ═════════════════════════════════════════════════════════════════════
// Google Places type filter — STRICT (no false friends)
// ═════════════════════════════════════════════════════════════════════

/**
 * Heritage types we EXPLICITLY search for in nearbysearch.
 * We do multiple narrow queries to avoid the "tourist_attraction"
 * grab-bag (which includes amusement parks, aquariums, etc.).
 */
const HERITAGE_SEARCH_TYPES = [
  "cathedral",
  "church",
  "historical_landmark",
  "monument",
  "castle",
  "basilica",
  "abbey",
  "bridge",
  "city_gate",
  "place_of_worship",
  "tourist_attraction", // include but with strict post-filter
];

/**
 * Types we REJECT in post-filter. Same as anchors module
 * for consistency.
 */
const REJECT_TYPES = new Set([
  "route",
  "political",
  "premise",
  "subpremise",
  "lodging",
  "gas_station",
  "convenience_store",
  "supermarket",
  "shopping_mall",
  "parking",
  "atm",
  "bank",
  "real_estate_agency",
  "lawyer",
  "doctor",
  "hospital",
  "pharmacy",
  "post_office",
  "car_dealer",
  "car_rental",
  "car_repair",
  "transit_station",
  "bus_station",
  "subway_station",
  "taxi_stand",
  "gym",
  "spa",
  "hair_care",
  "beauty_salon",
  "laundry",
  "meal_delivery",
  "meal_takeaway",
  "storage",
  "campground",
  "amusement_park",
  "aquarium",
  "zoo",
  "rv_park",
  "stadium",
]);

function isAcceptableHeritageType(types: string[]): boolean {
  if (!types || types.length === 0) return false;
  for (const t of types) {
    if (REJECT_TYPES.has(t)) return false;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════
// Era-compatibility judge (Claude Haiku batch)
// ═════════════════════════════════════════════════════════════════════

interface EraVerdict {
  name: string;
  era_compatible: boolean;
  reason: string;
}

const ERA_JUDGE_SYSTEM = `You are a quick era-compatibility checker for outdoor escape-game stops.

Given a theme era + a list of candidate stops with names & types, decide for each : would including this stop BREAK the period feel of a tour about this theme ?

Examples :
  Theme "1209 Cathar massacre Béziers" (13th century) :
    - "Cathédrale Saint-Nazaire" (medieval cathedral) → era_compatible : true
    - "Pont-canal de l'Orb" (18th-c canal aqueduct) → era_compatible : false (anachronistic infrastructure)
    - "Plateau des Poètes" (19th-c park) → era_compatible : false (modern recreation)
    - "Église Saint-Aphrodise" (medieval) → era_compatible : true

Calibrate strictness :
  - Era ± 200 years OK
  - Same building period OK even if no theme tie
  - Industrial / modern / 19th-c amenities → REJECT
  - 20th-c constructions → REJECT for any pre-1800 theme

OUTPUT — strict JSON :
{
  "stops": [
    {
      "name": "<as input>",
      "era_compatible": true | false,
      "reason": "<short justification>"
    },
    ... one entry per input stop
  ]
}`;

async function eraCompatibilityCheck(
  themeEra: string,
  candidates: NearbyCandidate[],
): Promise<EraVerdict[]> {
  if (candidates.length === 0) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fail-open : return all as compatible
    return candidates.map((c) => ({
      name: c.name,
      era_compatible: true,
      reason: "no API key, skipping check",
    }));
  }
  const client = new Anthropic({ apiKey });
  const userPrompt = `THEME ERA : ${themeEra}

CANDIDATE STOPS :
${candidates
  .map(
    (c, i) =>
      `${i + 1}. ${c.name} | types=[${(c.types ?? []).slice(0, 4).join(",")}] | rating=${c.rating ?? "?"}`,
  )
  .join("\n")}

For each, decide era_compatible (true/false). Return JSON only.`;
  let text = "";
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        temperature: 0,
        system: ERA_JUDGE_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: 30_000 },
    );
    text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.warn(
      `[v2-heritage] era judge failed: ${err instanceof Error ? err.message : err} — fail-open (keep all)`,
    );
    return candidates.map((c) => ({
      name: c.name,
      era_compatible: true,
      reason: "era judge unavailable, fail-open",
    }));
  }
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonText) as { stops?: unknown };
    if (!Array.isArray(parsed.stops)) return [];
    return (parsed.stops as unknown[])
      .map((s) => {
        const r = (s ?? {}) as Record<string, unknown>;
        return {
          name: typeof r.name === "string" ? r.name : "",
          era_compatible: r.era_compatible === true,
          reason: typeof r.reason === "string" ? r.reason : "",
        };
      })
      .filter((v) => v.name.length > 0);
  } catch (err) {
    console.warn(
      `[v2-heritage] era judge returned non-JSON: ${err instanceof Error ? err.message : err}`,
    );
    return candidates.map((c) => ({
      name: c.name,
      era_compatible: true,
      reason: "parse error, fail-open",
    }));
  }
}

// ═════════════════════════════════════════════════════════════════════
// Public entry point
// ═════════════════════════════════════════════════════════════════════

export interface DiscoverHeritageInput {
  startPoint: { lat: number; lon: number };
  walkingRadiusM: number;
  /** Place IDs of already-discovered anchors — these will be excluded
   *  from heritage fill (no double-counting). */
  excludePlaceIds: Set<string>;
  /** How many heritage fill candidates to RETURN (we'll over-fetch
   *  internally to allow filtering). */
  needed: number;
  /** Era string for compatibility check. Empty = skip era judge.
   *  Examples : "13th century", "1209", "16th-17th c Renaissance". */
  themeEra?: string;
  /** Skip era judge (faster, useful for mainstream themes where
   *  era-strict is overkill). Default false. */
  skipEraJudge?: boolean;
}

export interface DiscoverHeritageResult {
  heritage: NearbyCandidate[];
  /** Audit : Google found N raw, after type filter X, after era filter Y. */
  stats: {
    rawCount: number;
    afterTypeFilter: number;
    afterEraFilter: number;
    rejected: Array<{ name: string; reason: string }>;
  };
}

/**
 * Discover era-compatible heritage POIs to fill the parcours when
 * anchors alone aren't enough.
 *
 * Process :
 *   1. Google nearbysearch with HERITAGE_SEARCH_TYPES
 *   2. Hard type filter (REJECT_TYPES)
 *   3. Sort by computeTouristicScore (existing scenic rating)
 *   4. Take top 2× needed for era check
 *   5. Optional Claude era-compat batch judge
 *   6. Return top `needed` survivors
 */
export async function discoverHeritage(
  input: DiscoverHeritageInput,
): Promise<DiscoverHeritageResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      heritage: [],
      stats: { rawCount: 0, afterTypeFilter: 0, afterEraFilter: 0, rejected: [] },
    };
  }

  // 1. Google nearbysearch
  let raw: NearbyCandidate[];
  try {
    raw = await discoverNearbyLandmarks(input.startPoint, {
      radiusM: input.walkingRadiusM,
      limit: 60,
      types: HERITAGE_SEARCH_TYPES,
    });
  } catch (err) {
    console.warn(
      `[v2-heritage] Google nearbysearch failed: ${err instanceof Error ? err.message : err}`,
    );
    return {
      heritage: [],
      stats: { rawCount: 0, afterTypeFilter: 0, afterEraFilter: 0, rejected: [] },
    };
  }
  const rawCount = raw.length;
  const rejected: Array<{ name: string; reason: string }> = [];

  // 2. Hard type filter + exclude already-discovered anchors
  let filtered = raw.filter((c) => {
    if (input.excludePlaceIds.has(c.placeId)) return false;
    if (!isAcceptableHeritageType(c.types)) {
      rejected.push({
        name: c.name,
        reason: `bad type: [${c.types.join(",")}]`,
      });
      return false;
    }
    return true;
  });
  const afterTypeFilter = filtered.length;

  // 3. Sort by touristic score
  filtered.sort(
    (a, b) => computeTouristicScore(b) - computeTouristicScore(a),
  );

  // 4. Take top 2× needed for era check (to allow era-rejection room)
  const candidates = filtered.slice(0, input.needed * 2);

  // 5. Optional era-compat judge
  let afterEraFilter = candidates.length;
  let surviving = candidates;
  if (input.themeEra && !input.skipEraJudge && candidates.length > 0) {
    const verdicts = await eraCompatibilityCheck(input.themeEra, candidates);
    const compatNames = new Set(
      verdicts.filter((v) => v.era_compatible).map((v) => v.name),
    );
    const beforeEra = surviving.length;
    surviving = candidates.filter((c) => {
      if (!compatNames.has(c.name)) {
        const verdict = verdicts.find((v) => v.name === c.name);
        rejected.push({
          name: c.name,
          reason: `era-incompatible (${verdict?.reason ?? "unspecified"})`,
        });
        return false;
      }
      return true;
    });
    afterEraFilter = surviving.length;
    console.log(
      `[v2-heritage] era judge for "${input.themeEra}" : ${beforeEra} candidates → ${afterEraFilter} compatible`,
    );
  }

  // 6. Return top N
  const heritage = surviving.slice(0, input.needed);
  console.log(
    `[v2-heritage] discovered ${heritage.length}/${input.needed} heritage candidates (raw ${rawCount}, type-OK ${afterTypeFilter}, era-OK ${afterEraFilter})`,
  );

  return {
    heritage,
    stats: { rawCount, afterTypeFilter, afterEraFilter, rejected },
  };
}
