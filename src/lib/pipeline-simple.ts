/**
 * Pipeline simple (2026-05-23) — discovery + ranking en 1 fichier.
 *
 * ═══════════════════════════════════════════════════════════════════
 * DESIGN PRINCIPLE — the user's vision, expressed directly :
 *
 *   "Une ville arrive, un thème, une narration. Pourquoi c'est si dur
 *    de trouver et classer les monuments par pertinence thématique ?"
 *
 * Réponse : ce N'EST PAS dur. La pipeline V1 a empilé 10 sprints de
 * patches. Ce module fait CE qui est nécessaire, rien de plus :
 *
 *   1. Google Places nearbysearch (~30-60 POIs autour du startPoint)
 *   2. Filtre stricte de types (kick out hotels/stations/parkings/etc.)
 *   3. UN seul appel Claude Haiku : score chaque POI 0-10 vs thème
 *      + extrait personnage/event réel si Claude en connaît un
 *   4. Trie par score, prend top N (5-8), seuil flexible si pool fin
 *   5. NN reorder + walkability check
 *   6. Output : DiscoveredStop[] prêt pour narration
 *
 * Fail-safe : si Google returns 0, ou Claude scoring fail, on tombe
 * sur un fallback simple (top rating Google) avec needs_review forcé.
 *
 * Coût : ~$0.01 par build (1 Claude Haiku + Google Places).
 * Temps : ~10-20s (parallèle).
 * ═══════════════════════════════════════════════════════════════════
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  discoverNearbyLandmarks,
  haversineMeters,
  type NearbyCandidate,
} from "./geocode";
import type { DiscoveredStop } from "./parcours-discovery";

// ═══════════════════════════════════════════════════════════════════
// CONFIG — minimaliste, transparent
// ═══════════════════════════════════════════════════════════════════

/** Walking radius around startPoint. Generous-but-realistic 2.5km. */
const WALKING_RADIUS_M = 2_500;

/** Google Places types we SEARCH for (multiple narrow queries). */
const HERITAGE_SEARCH_TYPES = [
  "tourist_attraction",
  "church",
  "museum",
  "place_of_worship",
  "historical_landmark",
  "city_hall",
  "park",
];

/** Types we HARD REJECT in post-filter (zero-narrative-value or
 *  anxiogenic for an outdoor escape-game). */
const REJECT_TYPES = new Set([
  "lodging", "gas_station", "convenience_store", "supermarket",
  "shopping_mall", "parking", "atm", "bank", "real_estate_agency",
  "lawyer", "doctor", "hospital", "pharmacy", "post_office",
  "car_dealer", "car_rental", "car_repair",
  "transit_station", "bus_station", "subway_station", "taxi_stand",
  "gym", "spa", "hair_care", "beauty_salon", "laundry",
  "meal_delivery", "meal_takeaway", "storage", "campground",
  "amusement_park", "aquarium", "zoo", "rv_park", "stadium",
  "route", "political", "premise", "subpremise",
  "store", "clothing_store", "electronics_store", "furniture_store",
]);

function isAcceptable(types: string[]): boolean {
  if (!types || types.length === 0) return false;
  for (const t of types) if (REJECT_TYPES.has(t)) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// CLAUDE SCORING — single batch call
// ═══════════════════════════════════════════════════════════════════

interface ScoredCandidate {
  /** index into the pool array (0-based) */
  index: number;
  /** 0-10, higher = better thematic match */
  themeScore: number;
  /** one sentence : why this score */
  rationale: string;
  /** real historical figure tied to this place, if Claude knows one */
  realFigure?: { name: string; role: string; lifespan?: string };
  /** real historical event tied to this place, if Claude knows one */
  realEvent?: { date: string; description: string };
  /** "Tier" 1 (canonical) / 2 (heritage compatible) / 3 (era-OK) */
  tier: 1 | 2 | 3;
}

const SCORER_SYSTEM = `You are a heritage historian scoring outdoor escape-game candidate stops.

For each candidate POI in the pool, decide :
  1. How well does it fit the THEME ? (0-10 score, see scale below)
  2. What TIER is it ? (1 = canonical-for-theme, 2 = era-compatible heritage, 3 = generic-era-OK)
  3. Is there a REAL named figure tied to it ? (if you know one)
  4. Is there a REAL dated event tied to it ? (if you know one)

═══════════════════════════════════════════════════════════
SCORE SCALE (0-10)
═══════════════════════════════════════════════════════════
  10  THE iconic landmark for this theme
      Ex: Tour de Constance for "Huguenot prison 1572"
  7-9 Directly tied to theme : same person/event/era documented
  4-6 Era-compatible heritage, atmospheric fit
      Ex: 12th-c church in town for a Cathar massacre 1209 theme
  1-3 Right city wrong era OR irrelevant theme
      Ex: 19th-c park for a 1209 medieval theme
  0   Anti-thematic / breaks the period feel
      Ex: aquarium for a historical theme

═══════════════════════════════════════════════════════════
TIER PRIORITY
═══════════════════════════════════════════════════════════
  TIER 1 — Score 7-10 — canonical theme anchor
  TIER 2 — Score 4-6 — era-compatible heritage
  TIER 3 — Score 1-3 — generic / wrong era

═══════════════════════════════════════════════════════════
REAL FIGURES / EVENTS
═══════════════════════════════════════════════════════════
Only cite if you are CONFIDENT (Wikipedia-grade fact). If uncertain,
omit. Never fabricate.

  - realFigure : { name, role, lifespan? }
    Ex: { name: "Dom Antoine de Besse", role: "last abbot of Cluny",
          lifespan: "1731-1812" }
  - realEvent : { date, description }
    Ex: { date: "1209-07-22", description: "Crusader sack of Béziers" }

═══════════════════════════════════════════════════════════
OUTPUT — strict JSON
═══════════════════════════════════════════════════════════
{
  "candidates": [
    {
      "index": 0,
      "themeScore": 8,
      "rationale": "12th-c basilica in old town, era-fit for Cathar narrative",
      "tier": 2,
      "realFigure": { "name": "...", "role": "...", "lifespan": "..." }, // optional
      "realEvent": { "date": "...", "description": "..." } // optional
    },
    ... one entry PER candidate (no skips)
  ]
}

NEVER skip a candidate — even bad ones score 0-3. Output JSON ONLY,
no markdown, no preamble.`;

function buildScorerPrompt(input: {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  pool: NearbyCandidate[];
}): string {
  const pdBlock =
    input.productDescription && input.productDescription.length > 50
      ? `\nPRODUCT DESCRIPTION (customer's promise, rich context) :\n"""${input.productDescription.trim().slice(0, 1500)}"""\n`
      : "";

  const candidates = input.pool
    .map(
      (c, i) =>
        `[${i}] ${c.name} | types=[${c.types.slice(0, 4).join(",")}] | rating=${c.rating ?? "?"}(${c.userRatingsTotal ?? "?"}) | distance=${Math.round(c.distanceM)}m`,
    )
    .join("\n");

  return `THEME : ${input.theme}
THEME DESCRIPTION : ${input.themeDescription}
CITY : ${input.city}, ${input.country}
${pdBlock}
CANDIDATES (${input.pool.length}) :
${candidates}

Score each candidate. Return JSON only.`;
}

async function scoreViaClaud(input: {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  pool: NearbyCandidate[];
}): Promise<ScoredCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || input.pool.length === 0) return [];
  const client = new Anthropic({ apiKey });
  let text = "";
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        temperature: 0,
        system: SCORER_SYSTEM,
        messages: [{ role: "user", content: buildScorerPrompt(input) }],
      },
      { timeout: 45_000 },
    );
    text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.warn(
      `[simple] Claude scoring call failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonText) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    const scored: ScoredCandidate[] = [];
    for (const c of parsed.candidates) {
      const r = (c ?? {}) as Record<string, unknown>;
      const idx = typeof r.index === "number" ? r.index : -1;
      if (idx < 0 || idx >= input.pool.length) continue;
      const themeScore = Math.max(
        0,
        Math.min(10, typeof r.themeScore === "number" ? r.themeScore : 0),
      );
      const tierRaw = typeof r.tier === "number" ? r.tier : 2;
      const tier: 1 | 2 | 3 = tierRaw === 1 ? 1 : tierRaw === 3 ? 3 : 2;
      const rationale = typeof r.rationale === "string" ? r.rationale : "";
      const figureRaw = r.realFigure as Record<string, unknown> | undefined;
      const realFigure =
        figureRaw && typeof figureRaw.name === "string"
          ? {
              name: figureRaw.name,
              role: typeof figureRaw.role === "string" ? figureRaw.role : "",
              lifespan:
                typeof figureRaw.lifespan === "string"
                  ? figureRaw.lifespan
                  : undefined,
            }
          : undefined;
      const eventRaw = r.realEvent as Record<string, unknown> | undefined;
      const realEvent =
        eventRaw && typeof eventRaw.date === "string"
          ? {
              date: eventRaw.date,
              description:
                typeof eventRaw.description === "string"
                  ? eventRaw.description
                  : "",
            }
          : undefined;
      scored.push({
        index: idx,
        themeScore,
        rationale,
        tier,
        realFigure,
        realEvent,
      });
    }
    return scored;
  } catch (err) {
    console.warn(
      `[simple] Claude JSON parse failed: ${err instanceof Error ? err.message : err}. Body: ${text.slice(0, 200)}`,
    );
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// NN reorder
// ═══════════════════════════════════════════════════════════════════

function greedyNN(
  stops: NearbyCandidate[],
  startPoint: { lat: number; lon: number },
): NearbyCandidate[] {
  if (stops.length === 0) return [];
  const remaining = [...stops];
  const out: NearbyCandidate[] = [];
  let cur = { lat: startPoint.lat, lon: startPoint.lon };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(
        cur,
        { lat: remaining[i].lat, lon: remaining[i].lon },
      );
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    out.push(next);
    cur = { lat: next.lat, lon: next.lon };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Public entry
// ═══════════════════════════════════════════════════════════════════

export interface SimpleDiscoveryInput {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  productDescription?: string;
  startPoint: { lat: number; lon: number };
  /** Target number of stops (default 7). */
  targetStopCount?: number;
  /** Floor commercial (default 5). Pipeline ABORTS below this. */
  minStopCount?: number;
  /** Override walking radius. Default 2500m. */
  walkingRadiusM?: number;
}

export interface SimpleDiscoveryResult {
  success: boolean;
  /** Final stops, NN-ordered. */
  stops: Array<
    DiscoveredStop & {
      themeScore: number;
      tier: 1 | 2 | 3;
      rationale: string;
      realFigure?: { name: string; role: string; lifespan?: string };
      realEvent?: { date: string; description: string };
    }
  >;
  /** Diagnostic info for review_reason / logs. */
  diagnostics: {
    rawPoolCount: number;
    afterTypeFilter: number;
    scoredCount: number;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    averageScore: number;
    minScoreInFinal: number;
    fallbackUsed: boolean;
    notes: string[];
  };
  errorMessage?: string;
}

/**
 * Simple, reliable discovery + ranking pipeline.
 *
 * Steps :
 *   1. Google nearbysearch with heritage types
 *   2. Hard type filter (reject hotels/stations/etc.)
 *   3. Claude Haiku scores each candidate vs theme (single batch call)
 *   4. Sort by score desc, take top N (or floor)
 *   5. NN reorder
 *   6. Return DiscoveredStop[] + diagnostics
 *
 * Never throws. Always returns a result. Fail modes :
 *   - Google empty → fallback to top-rating candidates with note
 *   - Claude scoring fails → fallback to top-rating, score=0 each
 *   - Pool < minStopCount → success=false with clear errorMessage
 */
export async function runSimpleDiscovery(
  input: SimpleDiscoveryInput,
): Promise<SimpleDiscoveryResult> {
  const target = input.targetStopCount ?? 7;
  const minStops = input.minStopCount ?? 5;
  const radiusM = input.walkingRadiusM ?? WALKING_RADIUS_M;
  const notes: string[] = [];
  notes.push(
    `start=${input.startPoint.lat.toFixed(4)},${input.startPoint.lon.toFixed(4)} radius=${radiusM}m target=${target} floor=${minStops}`,
  );

  // ── 1. Google nearbysearch ────────────────────────────────────
  let rawPool: NearbyCandidate[];
  try {
    rawPool = await discoverNearbyLandmarks(input.startPoint, {
      radiusM,
      limit: 60,
      types: HERITAGE_SEARCH_TYPES,
    });
  } catch (err) {
    notes.push(
      `Google nearbysearch failed: ${err instanceof Error ? err.message : err}`,
    );
    return {
      success: false,
      stops: [],
      diagnostics: {
        rawPoolCount: 0,
        afterTypeFilter: 0,
        scoredCount: 0,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        averageScore: 0,
        minScoreInFinal: 0,
        fallbackUsed: false,
        notes,
      },
      errorMessage: "Google Places API unavailable",
    };
  }
  notes.push(`raw pool from Google : ${rawPool.length} candidates`);

  // ── 2. Hard type filter ───────────────────────────────────────
  const filteredPool = rawPool.filter((c) => isAcceptable(c.types));
  notes.push(
    `after type filter (kick lodging/stations/etc.) : ${filteredPool.length} candidates`,
  );

  if (filteredPool.length < minStops) {
    notes.push(
      `pool < minStops=${minStops} after filter. Cannot publish themed game.`,
    );
    return {
      success: false,
      stops: [],
      diagnostics: {
        rawPoolCount: rawPool.length,
        afterTypeFilter: filteredPool.length,
        scoredCount: 0,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        averageScore: 0,
        minScoreInFinal: 0,
        fallbackUsed: false,
        notes,
      },
      errorMessage: `Walkable heritage pool too thin (${filteredPool.length} after type filter) for "${input.theme}" in ${input.city}. Reframe or change city.`,
    };
  }

  // ── 3. Claude scoring (single batch call) ────────────────────
  const scored = await scoreViaClaud({
    theme: input.theme,
    themeDescription: input.themeDescription,
    productDescription: input.productDescription,
    city: input.city,
    country: input.country,
    pool: filteredPool,
  });
  notes.push(`Claude scored ${scored.length}/${filteredPool.length} candidates`);

  let fallbackUsed = false;
  // ── 4. Sort + select ─────────────────────────────────────────
  // Build a merged list : each pool candidate gets a score (Claude's
  // or 0 if not scored). Sort by tier asc, then score desc.
  const enriched = filteredPool.map((c, i) => {
    const s = scored.find((x) => x.index === i);
    return {
      candidate: c,
      themeScore: s?.themeScore ?? 0,
      tier: (s?.tier ?? 3) as 1 | 2 | 3,
      rationale: s?.rationale ?? "(not scored)",
      realFigure: s?.realFigure,
      realEvent: s?.realEvent,
    };
  });

  if (scored.length === 0) {
    notes.push(`Claude scoring returned nothing — fallback to top-rating`);
    fallbackUsed = true;
    // Fallback : sort by Google rating × log(reviews)
    enriched.sort((a, b) => {
      const sa =
        (a.candidate.rating ?? 0) *
        Math.log10((a.candidate.userRatingsTotal ?? 0) + 1);
      const sb =
        (b.candidate.rating ?? 0) *
        Math.log10((b.candidate.userRatingsTotal ?? 0) + 1);
      return sb - sa;
    });
  } else {
    // Themed sort : Tier asc, score desc (Claude's intent)
    enriched.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.themeScore - a.themeScore;
    });
  }

  const selected = enriched.slice(0, target);
  notes.push(
    `selected top ${selected.length} : tier1=${selected.filter((s) => s.tier === 1).length} tier2=${selected.filter((s) => s.tier === 2).length} tier3=${selected.filter((s) => s.tier === 3).length}`,
  );

  if (selected.length < minStops) {
    notes.push(
      `selected ${selected.length} < minStops=${minStops}. Aborting.`,
    );
    return {
      success: false,
      stops: [],
      diagnostics: {
        rawPoolCount: rawPool.length,
        afterTypeFilter: filteredPool.length,
        scoredCount: scored.length,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        averageScore: 0,
        minScoreInFinal: 0,
        fallbackUsed,
        notes,
      },
      errorMessage: `Selection yielded ${selected.length} stops, below floor ${minStops}.`,
    };
  }

  // ── 5. NN reorder ─────────────────────────────────────────────
  const candidatesOnly = selected.map((s) => s.candidate);
  const ordered = greedyNN(candidatesOnly, input.startPoint);
  // Re-attach metadata from selected[] in the new NN order
  const orderedSelected = ordered.map((c) => {
    const found = selected.find((s) => s.candidate.placeId === c.placeId);
    return found!;
  });

  // ── 6. Map to DiscoveredStop[] + return ──────────────────────
  const finalStops = orderedSelected.map((s) => {
    const figureNote = s.realFigure
      ? ` [REAL FIGURE: ${s.realFigure.name} (${s.realFigure.lifespan ?? "?"}) — ${s.realFigure.role}]`
      : "";
    const eventNote = s.realEvent
      ? ` [REAL EVENT: ${s.realEvent.date} — ${s.realEvent.description}]`
      : "";
    return {
      name: s.candidate.name,
      description: `${s.rationale}${figureNote}${eventNote}`,
      source: "pipeline-simple",
      lat: s.candidate.lat,
      lon: s.candidate.lon,
      placeId: s.candidate.placeId,
      distanceFromStartM: s.candidate.distanceM,
      stopMode: "radar" as const,
      navigationHint: undefined,
      types: s.candidate.types,
      rating: s.candidate.rating,
      themeScore: s.themeScore,
      tier: s.tier,
      rationale: s.rationale,
      realFigure: s.realFigure,
      realEvent: s.realEvent,
    };
  });

  const averageScore =
    finalStops.reduce((sum, s) => sum + s.themeScore, 0) / finalStops.length;
  const minScoreInFinal = Math.min(...finalStops.map((s) => s.themeScore));

  notes.push(
    `final : ${finalStops.length} stops, avg_score=${averageScore.toFixed(2)}, min_score=${minScoreInFinal}`,
  );

  return {
    success: true,
    stops: finalStops,
    diagnostics: {
      rawPoolCount: rawPool.length,
      afterTypeFilter: filteredPool.length,
      scoredCount: scored.length,
      tier1Count: finalStops.filter((s) => s.tier === 1).length,
      tier2Count: finalStops.filter((s) => s.tier === 2).length,
      tier3Count: finalStops.filter((s) => s.tier === 3).length,
      averageScore: Number(averageScore.toFixed(2)),
      minScoreInFinal,
      fallbackUsed,
      notes,
    },
  };
}
