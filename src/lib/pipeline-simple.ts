/**
 * Pipeline simple V2 (2026-05-23, theme-first) — discovery + ranking
 * en 1 fichier, theme-first approach.
 *
 * ═══════════════════════════════════════════════════════════════════
 * USER PRINCIPLE (mandate 2026-05-23) :
 *
 *   "Au lieu de demander à Google tout autour et filtrer par thème,
 *    on demande à Claude QUELS sont les monuments thématiques, puis
 *    on les géocode via Google. Comme ça pas de Spectacle Son &
 *    Lumière, pas de twin stops, pas de fillers hors-sujet."
 *
 * Architecture :
 *
 *   1. Claude Haiku — pour [theme + city] propose 10-12 monuments
 *      named (avec tier/themeScore/rationale/realFigure/realEvent)
 *   2. Google findPlaceFromText pour chaque → vrais GPS + place_id
 *   3. Filtre : reject events/dates, reject hotels/stations, in radius
 *   4. Si ≥ 5 monuments → SUCCESS, on continue
 *   5. Si < 5 → FALLBACK : Google nearbysearch top-rating heritage
 *   6. selectStopsByGeometry avec min-distance 150m → top N
 *   7. NN reorder
 *
 * Output : DiscoveredStop[] avec metadata thématique (tier, rationale,
 * realFigure, realEvent) prête pour la narration phase 2a.
 *
 * Cible 8 stops, floor commercial 5, walking radius 1.75km (3.5km
 * diameter). Tous configurables via input params.
 * ═══════════════════════════════════════════════════════════════════
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  discoverNearbyLandmarks,
  haversineMeters,
  type NearbyCandidate,
} from "./geocode";
import type { DiscoveredStop } from "./parcours-discovery";
import { selectStopsByGeometry } from "./parcours-selection";

// ═══════════════════════════════════════════════════════════════════
// CONFIG (mandate user 2026-05-23)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_WALKING_RADIUS_M = 1_750; // 3.5km diameter
const DEFAULT_TARGET_STOPS = 8;
const DEFAULT_MIN_STOPS = 6; // V10 bumped from 5 to match V1 sanity-check floor (was below_floor flag)
const MIN_INTER_STOP_M = 150; // Anti twin stops (= 2 min de marche)
/** Rendez-vous gap : start point ≠ stop 1. Le joueur arrive au RDV
 *  (entrée d'un café, panneau, etc.) puis MARCHE vers le 1er stop —
 *  c'est ce qui donne l'impression que "le jeu commence". Sans gap,
 *  stop 1 est sur le RDV et le joueur valide en 13 secondes. */
const RENDEZVOUS_GAP_M = 150;

// ═══════════════════════════════════════════════════════════════════
// FILTERS — types et noms à reject
// ═══════════════════════════════════════════════════════════════════

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

function isAcceptableType(types: string[]): boolean {
  if (!types || types.length === 0) return false;
  for (const t of types) if (REJECT_TYPES.has(t)) return false;
  return true;
}

/**
 * Reject candidate names matching event/temporary-show patterns.
 *
 * Pattern catches :
 *   - "Spectacle", "Festival", "Concert", "Exposition"
 *   - "Son & Lumière" / "Son et Lumière"
 *   - "Visite Guidée"
 *   - Year markers : "2024", "2025"
 *   - Date ranges : "du X au Y"
 */
const EVENT_NAME_REGEX =
  /\b(spectacle|festival|concert|exposition|son\s*&?\s*et?\s*lumi[èe]re|show|visite\s+guid[ée]e?|événement|evenement)\b|\b20\d{2}\b|\bdu\s+\d{1,2}\s+\w+\s+au\s+\d{1,2}/i;

function isEventName(name: string): boolean {
  return EVENT_NAME_REGEX.test(name);
}

// ═══════════════════════════════════════════════════════════════════
// CLAUDE — propose + score en 1 appel
// ═══════════════════════════════════════════════════════════════════

interface ProposedLandmark {
  name: string;
  tier: 1 | 2 | 3;
  themeScore: number;
  rationale: string;
  realFigure?: { name: string; role: string; lifespan?: string };
  realEvent?: { date: string; description: string };
}

const PROPOSER_SYSTEM = `You are a TOURIST GUIDE designing the perfect 8-stop city walking tour.

═══════════════════════════════════════════════════════════
🎯 CORE PRINCIPLE (read twice — overrides any other heuristic)
═══════════════════════════════════════════════════════════

  The customer buys a CITY VISIT FIRST, theme second.

  Players want to discover the city's BEST monuments. The "theme"
  is just a NARRATIVE THREAD a guide will weave on top of the
  visit. Even if a site has NO documented theme connection (e.g.,
  Roman ruins on a medieval Cathar theme), it stays if it's a
  top-tourist landmark of the city. The narration will explain :
  "history left no Cathar trace here, but these ruins stood when
  the crusaders arrived..."

  THEREFORE :

  ✅ PRIMARY : pick the BEST tourist/heritage landmarks of the city
     (high rating, famous, era-compatible OR architecturally iconic)
  ✅ SECONDARY : if equal quality, prefer the theme-tied one
  ❌ NEVER drop a top monument because it doesn't fit the theme
     strictly — the narrator will weave it in

For a given THEME + CITY, propose 10-12 PHYSICAL, NAMED, STILL-STANDING
landmarks that form the BEST CITY-VISIT WALK in this city. The theme
will be applied as a narrative layer downstream.

═══════════════════════════════════════════════════════════
HARD RULES — PROPOSE
═══════════════════════════════════════════════════════════

  ✅ FULL geocodable name on Google Maps :
       "Cathédrale Saint-Nazaire de Béziers" (NOT "the cathedral")
       "Église de la Madeleine, Béziers"
       "Casa Zavala" (good, if unique name)
       "San Pablo Bridge, Cuenca"
  ✅ Use proper diacritics + accents
  ✅ Prefer OUTDOOR/façade-visible heritage (escape-game UX)
  ✅ Mix Tier 1 (canonical) + Tier 2 (era-fit) for variety
  ✅ Walking-distance scope (assume 1.75km radius around city center)

  ⚠️ MENTAL TEST before adding a landmark :
     "Would Google Maps find this if I typed the name in the search bar
      and added the city name ?"
     If you're not 90% sure → DROP IT. Better 8 confirmed-existing
     landmarks than 12 with 4 that don't exist on Google.

═══════════════════════════════════════════════════════════
DON'T PROPOSE — GOOGLE PLACES BLIND SPOTS
═══════════════════════════════════════════════════════════

  ❌ GEOGRAPHIC FEATURES (rarely have discrete Google entries) :
       - "Ramparts of X", "City Walls", "Remparts"
       - "Old Town Quarter", "Medieval Quarter", "Historic Center"
       - "Gorge", "Cliff", "Mountain pass"
       - "Promenade", "Esplanade" (unless named like "Allées Paul Riquet")
       - Generic streets ("Rue de X" — only Google-finds famous ones)

  ❌ RUINS / NON-STANDING (often not on Google) :
       - "Château de X (Ruins)" — strip ruins if you must propose
       - "Old foundations of...", "Remains of..."
       - Archaeological digs (these don't have public Google entries)

  ❌ EVENTS / TEMPORARY :
       - "Spectacle Son & Lumière", "Festival X 2024"

  ❌ COMMERCIAL :
       - Hotels, restaurants, shops, transport stations

  ❌ DUPLICATES (Google has BOTH names but they're 50m apart, same site) :
       Pick ONE official name only.

  ❌ Modern reconstructions / replicas
  ❌ Hallucinated/imaginary sites — only what you KNOW exists

  ✅ DO PROPOSE : cathedrals, churches, named monasteries, named convents,
     specific named towers/gates (e.g., "Tour de Constance", "Porte
     Narbonnaise"), named bridges, named museums (only if historic
     building), named palaces, named houses (only if landmark like
     "Casa de los Picos"), named squares with own Google entry.

═══════════════════════════════════════════════════════════
SCORING FORMULA — patrimoine base + theme bonus
═══════════════════════════════════════════════════════════

  themeScore = base_patrimoine + theme_bonus  (capped 0-10)

  BASE PATRIMOINE (the LANDMARK QUALITY itself, theme-agnostic) :
    9  THE iconic landmark of the city (Notre-Dame Paris, Casas
       Colgadas Cuenca, Cathédrale Saint-Nazaire Béziers)
    7-8 TOP monuments of the city (must-see for any visitor :
        major churches, named towers, Roman ruins, famous bridges,
        historic squares with own Google entry)
    5-6 NOTABLE heritage (smaller churches, secondary museums,
        named historic streets)
    3-4 Decent stop (named buildings, parks with character)
    0-2 Generic/forgettable (modern offices, anonymous parks,
        shops). REJECT these.

  THEME BONUS (added on top of base) :
    +2  Documented event / figure / era explicit tie
        (Cathédrale Saint-Nazaire = 1209 massacre refuge → +2)
    +1  Era-compatible OR existed during the theme period
        (Arènes Romaines built 1st c. → still standing during
         1209 Cathar crusade → +1, NOT -5 ! Cathares walked past
         them daily. Same for Romanesque churches in any
         post-medieval theme.)
     0  Anachronistic but acceptable narrator-weave
        (a 19th-c park in a medieval theme — narrator says
         "where this park stands now, the medieval refugees
         once fled the burning city")

═══════════════════════════════════════════════════════════
🚨 CRITICAL HISTORICAL REASONING
═══════════════════════════════════════════════════════════

  Don't be dogmatic about "wrong era" :
    - Roman ruins EXISTED during medieval times (and Renaissance,
      and modern times). The Cathares of 1209 saw the Arènes
      Romaines every day — they were already 1100 years old.
      → Score them HIGH (great patrimoine + existed then = 7-8)
    - Medieval churches survive into the present. A 12th-c church
      seen on a 19th-c theme = still relevant patrimoine.
      → Score them based on tourism value, not strict era-match.
    - Only score 0-3 if the building is GENUINELY post-theme :
      a 1990s mall on a 1209 theme = 1/10, justified.

  Mental model :
    "What would a knowledgeable tourist guide of this city say is
     worth visiting ? Now, for each : how strongly does the theme
     connect ? The visit list comes FIRST, theme bonus AFTER."

═══════════════════════════════════════════════════════════
TIER ASSIGNMENT (derived from themeScore)
═══════════════════════════════════════════════════════════

  TIER 1 = themeScore 8-10
  TIER 2 = themeScore 5-7
  TIER 3 = themeScore 3-4 (acceptable filler)
  Below 3 = REJECT (not in proposal list)

  ⚠️ NEVER reject a great tourist landmark because it's "wrong era".
     Apply the formula above, accept the score, move on.

═══════════════════════════════════════════════════════════
REAL FIGURES + EVENTS (when known)
═══════════════════════════════════════════════════════════

  Add "realFigure" field if you KNOW a documented historical figure
  tied to this landmark (with lifespan if confident). Skip if uncertain.

  Add "realEvent" field if you KNOW a documented dated event tied
  to it. Skip if uncertain. Don't fabricate dates.

═══════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown, no preamble
═══════════════════════════════════════════════════════════

{
  "landmarks": [
    {
      "name": "<full geocodable name>",
      "tier": 1 | 2 | 3,
      "themeScore": <0..10>,
      "rationale": "<one sentence : why this site for this theme>",
      "realFigure": { "name": "...", "role": "...", "lifespan": "..." },
      "realEvent": { "date": "YYYY-MM-DD or YYYY", "description": "..." }
    },
    ... 10-12 entries TOTAL, sorted by tier asc then themeScore desc
  ]
}

If you genuinely don't know the city well, return an empty landmarks
array — downstream has a fallback. Don't fabricate.`;

function buildProposerPrompt(input: {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
}): string {
  const pdBlock =
    input.productDescription && input.productDescription.length > 50
      ? `\nPRODUCT DESCRIPTION (rich context — what the customer wants to experience) :\n"""${input.productDescription.trim().slice(0, 1500)}"""\n`
      : "";
  return `THEME : ${input.theme}
THEME DESCRIPTION : ${input.themeDescription}
CITY : ${input.city}, ${input.country}
${pdBlock}
Propose 10-12 canonical landmarks for this theme in this city. JSON only.`;
}

export async function proposeLandmarksViaClaude(input: {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
}): Promise<ProposedLandmark[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = new Anthropic({ apiKey });
  let text = "";
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        temperature: 0.1,
        system: PROPOSER_SYSTEM,
        messages: [{ role: "user", content: buildProposerPrompt(input) }],
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
      `[simple] Claude proposer failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonText) as { landmarks?: unknown };
    if (!Array.isArray(parsed.landmarks)) return [];
    const out: ProposedLandmark[] = [];
    const seen = new Set<string>();
    for (const item of parsed.landmarks) {
      const r = (item ?? {}) as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (name.length < 5) continue;
      if (isEventName(name)) {
        console.log(`[simple] Claude proposed an event name, rejecting : "${name}"`);
        continue;
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      const tierRaw = typeof r.tier === "number" ? r.tier : 2;
      const tier: 1 | 2 | 3 = tierRaw === 1 ? 1 : tierRaw === 3 ? 3 : 2;
      const themeScore = Math.max(
        0,
        Math.min(10, typeof r.themeScore === "number" ? r.themeScore : 0),
      );
      const rationale =
        typeof r.rationale === "string" ? r.rationale : "";
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
      out.push({ name, tier, themeScore, rationale, realFigure, realEvent });
    }
    return out;
  } catch (err) {
    console.warn(
      `[simple] Claude proposer JSON parse failed: ${err instanceof Error ? err.message : err}. Body: ${text.slice(0, 200)}`,
    );
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// GOOGLE — findPlaceFromText for each proposed landmark
// ═══════════════════════════════════════════════════════════════════

interface GeocodedLandmark extends NearbyCandidate {
  tier: 1 | 2 | 3;
  themeScore: number;
  rationale: string;
  realFigure?: { name: string; role: string; lifespan?: string };
  realEvent?: { date: string; description: string };
  proposedName: string; // original Claude name (before Google rename)
}

/**
 * Generate name variants for retry when geocode fails. Google rates names
 * slightly differently across users (Basilique de la X vs Église de la X,
 * "(Ruins)" suffixes drop, etc.). We try the original name, then up to 3
 * synonyms.
 */
function nameVariants(name: string): string[] {
  const variants: string[] = [name];
  // Strip parens
  const noParens = name.replace(/\s*\([^)]*\)/g, "").trim();
  if (noParens !== name) variants.push(noParens);
  // Basilique ↔ Église
  if (/\bBasilique\b/i.test(name)) {
    variants.push(name.replace(/\bBasilique\b/i, "Église"));
  }
  if (/\bÉglise\b/i.test(name)) {
    variants.push(name.replace(/\bÉglise\b/i, "Basilique"));
  }
  // Catedral / Cathédrale (FR/ES)
  if (/\bCatedral\b/i.test(name)) {
    variants.push(name.replace(/\bCatedral\b/i, "Cathédrale"));
  }
  if (/\bCathédrale\b/i.test(name)) {
    variants.push(name.replace(/\bCathédrale\b/i, "Catedral"));
  }
  // Strip city-name suffix if present (it gets re-added in the query)
  const noCity = name.replace(/,\s*[A-Z][\wÀ-ÿ -]+\s*$/, "").trim();
  if (noCity !== name && noCity.length > 4) variants.push(noCity);
  // Dedup
  return Array.from(new Set(variants));
}

async function geocodeOnce(
  query: string,
  startPoint: { lat: number; lon: number },
  maxDistanceM: number,
  apiKey: string,
): Promise<{ raw: { name: string; place_id: string; geometry: { location: { lat: number; lng: number } }; types?: string[]; rating?: number; user_ratings_total?: number; formatted_address?: string } | null } | { raw: null }> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
  );
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set(
    "fields",
    "name,geometry,place_id,formatted_address,types,rating,user_ratings_total",
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "locationbias",
    `circle:${Math.round(maxDistanceM)}@${startPoint.lat},${startPoint.lon}`,
  );

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch(url.toString(), { signal: ac.signal });
    if (!res.ok) return { raw: null };
    const data = (await res.json()) as {
      status: string;
      candidates?: Array<{
        name: string;
        formatted_address?: string;
        place_id: string;
        geometry?: { location: { lat: number; lng: number } };
        types?: string[];
        rating?: number;
        user_ratings_total?: number;
      }>;
    };
    if (data.status !== "OK" || !data.candidates?.length) return { raw: null };
    // Find first acceptable candidate
    for (const c of data.candidates) {
      if (!c.geometry?.location || !c.place_id) continue;
      const types = c.types ?? [];
      if (!isAcceptableType(types)) continue;
      if (isEventName(c.name)) continue;
      const distanceM = haversineMeters(
        { lat: c.geometry.location.lat, lon: c.geometry.location.lng },
        startPoint,
      );
      if (distanceM > maxDistanceM) continue;
      return {
        raw: {
          name: c.name,
          place_id: c.place_id,
          geometry: { location: c.geometry.location },
          types,
          rating: c.rating,
          user_ratings_total: c.user_ratings_total,
          formatted_address: c.formatted_address,
        },
      };
    }
    return { raw: null };
  } catch (err) {
    console.warn(
      `[simple] geocode "${query}" failed: ${err instanceof Error ? err.message : err}`,
    );
    return { raw: null };
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeOne(
  proposed: ProposedLandmark,
  city: string,
  country: string,
  startPoint: { lat: number; lon: number },
  maxDistanceM: number,
  apiKey: string,
): Promise<GeocodedLandmark | null> {
  // FIX 2 (2026-05-23) — retry with variants if first geocode fails.
  // Google's findPlaceFromText is finicky on naming (Basilique vs Église,
  // "(Ruins)" parens, with/without city suffix).
  const variants = nameVariants(proposed.name);
  let raw: Awaited<ReturnType<typeof geocodeOnce>>["raw"] = null;
  for (const v of variants) {
    const query = `${v}, ${city}, ${country}`;
    const res = await geocodeOnce(query, startPoint, maxDistanceM, apiKey);
    if (res.raw) {
      if (variants.indexOf(v) > 0) {
        console.log(`[simple] geocode VARIANT WIN for "${proposed.name}" → "${v}" → "${res.raw.name}"`);
      }
      raw = res.raw;
      break;
    }
  }
  if (!raw) {
    return null;
  }
  const distanceM = haversineMeters(
    { lat: raw.geometry.location.lat, lon: raw.geometry.location.lng },
    startPoint,
  );
  return {
    name: raw.name,
    lat: raw.geometry.location.lat,
    lon: raw.geometry.location.lng,
    placeId: raw.place_id,
    types: raw.types ?? [],
    address: raw.formatted_address,
    rating: raw.rating,
    userRatingsTotal: raw.user_ratings_total,
    distanceM,
    tier: proposed.tier,
    themeScore: proposed.themeScore,
    rationale: proposed.rationale,
    realFigure: proposed.realFigure,
    realEvent: proposed.realEvent,
    proposedName: proposed.name,
  };
}

async function geocodeAll(
  proposals: ProposedLandmark[],
  city: string,
  country: string,
  startPoint: { lat: number; lon: number },
  maxDistanceM: number,
): Promise<GeocodedLandmark[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || proposals.length === 0) return [];
  const results = await Promise.allSettled(
    proposals.map((p) =>
      geocodeOne(p, city, country, startPoint, maxDistanceM, apiKey),
    ),
  );
  const out: GeocodedLandmark[] = [];
  const seenPlaceIds = new Set<string>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      if (!seenPlaceIds.has(r.value.placeId)) {
        seenPlaceIds.add(r.value.placeId);
        out.push(r.value);
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// FALLBACK — Google nearbysearch top-rating (if Claude knows nothing)
// ═══════════════════════════════════════════════════════════════════

/**
 * Fallback nearbysearch — but NOW with Claude scoring (V10 fix 3).
 * When Claude's proposer doesn't give us enough geocoded landmarks,
 * we hit Google nearbysearch for top heritage POIs, then ASK Claude
 * to score each by theme. Picks Claude's top picks, not Google's.
 *
 * This way fillers are at least theme-compatible (no more "Spectacle
 * Son & Lumière 2024" fillers in 1209 Cathar games).
 */
async function fallbackNearbysearch(
  startPoint: { lat: number; lon: number },
  radiusM: number,
  theme: string,
  themeDescription: string,
  city: string,
): Promise<GeocodedLandmark[]> {
  let raw: NearbyCandidate[];
  try {
    raw = await discoverNearbyLandmarks(startPoint, {
      radiusM,
      limit: 60,
      types: [
        "tourist_attraction",
        "church",
        "museum",
        "place_of_worship",
        "historical_landmark",
        "city_hall",
        "park",
      ],
    });
  } catch (err) {
    console.warn(`[simple] fallback nearbysearch failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
  const filtered = raw
    .filter((c) => isAcceptableType(c.types))
    .filter((c) => !isEventName(c.name));
  if (filtered.length === 0) return [];

  // V10 FIX 3 : score these via Claude (single batch) BEFORE using.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No Claude available — degrade to rating-only top
    console.warn("[simple] fallback Claude scoring unavailable, defaulting to top-rating");
    return filtered
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 20)
      .map((c) => ({
        ...c,
        tier: 3 as const,
        themeScore: 0,
        rationale: "Fallback (Google top-rating, no Claude)",
        proposedName: c.name,
      }));
  }
  const client = new Anthropic({ apiKey });
  const top = filtered
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 30);
  const prompt = `Score these ${top.length} POIs for thematic fit with the game "${theme}" in ${city}.
THEME DESCRIPTION : ${themeDescription}

POIs :
${top.map((c, i) => `[${i}] ${c.name} | types=[${c.types.slice(0, 3).join(",")}] | rating=${c.rating ?? "?"}(${c.userRatingsTotal ?? "?"})`).join("\n")}

For each, score 0-10 (10=canonical, 4-6=era-compatible, 1-3=tangential, 0=anti-thematic).
Return strict JSON :
{
  "scores": [
    {"index": 0, "themeScore": 7, "tier": 2, "rationale": "brief"},
    ...
  ]
}`;
  let scores: Array<{ index: number; themeScore: number; tier: 1 | 2 | 3; rationale: string }> = [];
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 3000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: 45_000 },
    );
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(text) as { scores?: unknown };
    if (Array.isArray(parsed.scores)) {
      for (const s of parsed.scores) {
        const r = (s ?? {}) as Record<string, unknown>;
        const idx = typeof r.index === "number" ? r.index : -1;
        if (idx < 0 || idx >= top.length) continue;
        const ts = Math.max(0, Math.min(10, typeof r.themeScore === "number" ? r.themeScore : 0));
        const tierRaw = typeof r.tier === "number" ? r.tier : 3;
        scores.push({
          index: idx,
          themeScore: ts,
          tier: tierRaw === 1 ? 1 : tierRaw === 2 ? 2 : 3,
          rationale: typeof r.rationale === "string" ? r.rationale : "",
        });
      }
    }
  } catch (err) {
    console.warn(
      `[simple] fallback Claude scoring failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Sort scored by themeScore desc, take top 20
  scores.sort((a, b) => b.themeScore - a.themeScore);
  const out: GeocodedLandmark[] = [];
  for (const s of scores.slice(0, 20)) {
    const c = top[s.index];
    if (!c) continue;
    out.push({
      ...c,
      tier: s.tier,
      themeScore: s.themeScore,
      rationale: s.rationale || "Fallback (nearbysearch + Claude scored)",
      proposedName: c.name,
    });
  }
  return out;
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
      const d = haversineMeters(cur, {
        lat: remaining[i].lat,
        lon: remaining[i].lon,
      });
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
  targetStopCount?: number;
  minStopCount?: number;
  walkingRadiusM?: number;
}

export interface SimpleDiscoveryResult {
  success: boolean;
  stops: Array<
    DiscoveredStop & {
      themeScore: number;
      tier: 1 | 2 | 3;
      rationale: string;
      realFigure?: { name: string; role: string; lifespan?: string };
      realEvent?: { date: string; description: string };
    }
  >;
  diagnostics: {
    proposedCount: number;
    geocodedCount: number;
    fallbackUsed: boolean;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    averageScore: number;
    minScoreInFinal: number;
    notes: string[];
  };
  errorMessage?: string;
}

/**
 * Run the theme-first discovery pipeline.
 *
 * Phases :
 *   1. Claude proposes 10-12 landmarks for [theme + city]
 *   2. Google geocodes each in parallel
 *   3. Filter (event names, REJECT_TYPES, distance)
 *   4. If < minStopCount survive → fallback to Google nearbysearch
 *   5. Select top N with min-distance enforcement
 *   6. NN reorder + return DiscoveredStop[]
 *
 * Never throws. Returns success=false with errorMessage on failure.
 */
export async function runSimpleDiscovery(
  input: SimpleDiscoveryInput,
): Promise<SimpleDiscoveryResult> {
  const target = input.targetStopCount ?? DEFAULT_TARGET_STOPS;
  const minStops = input.minStopCount ?? DEFAULT_MIN_STOPS;
  const radiusM = input.walkingRadiusM ?? DEFAULT_WALKING_RADIUS_M;
  const notes: string[] = [];
  notes.push(
    `start=${input.startPoint.lat.toFixed(4)},${input.startPoint.lon.toFixed(4)} radius=${radiusM}m target=${target} floor=${minStops}`,
  );

  // ── PHASE 1 : Claude proposer ──────────────────────────────────
  const proposals = await proposeLandmarksViaClaude({
    theme: input.theme,
    themeDescription: input.themeDescription,
    productDescription: input.productDescription,
    city: input.city,
    country: input.country,
  });
  notes.push(`Claude proposed ${proposals.length} landmarks`);

  // ── PHASE 2 : Google geocode parallèle ────────────────────────
  const geocodedRaw = await geocodeAll(
    proposals,
    input.city,
    input.country,
    input.startPoint,
    radiusM,
  );
  notes.push(
    `Geocoded ${geocodedRaw.length}/${proposals.length} (filtered events, REJECT_TYPES, within ${radiusM}m)`,
  );

  // ── PHASE 2.5 : Rendez-vous gap (start point ≠ stop 1) ───────
  // Drop landmarks too close to startPoint — the player arrives at
  // the RDV, then walks to stop 1. Without this, stop 1 sits ON the
  // startPoint and the player validates in 13s.
  const geocoded = geocodedRaw.filter((c) => {
    if (c.distanceM < RENDEZVOUS_GAP_M) {
      notes.push(`  rejected "${c.name}" (${Math.round(c.distanceM)}m < ${RENDEZVOUS_GAP_M}m rendez-vous gap)`);
      return false;
    }
    return true;
  });
  if (geocoded.length < geocodedRaw.length) {
    notes.push(`After rendez-vous gap ${RENDEZVOUS_GAP_M}m : ${geocoded.length}/${geocodedRaw.length} survived`);
  }

  // ── PHASE 3 : Fallback si trop peu ──────────────────────────
  let pool = geocoded;
  let fallbackUsed = false;
  // V10 FIX : Aggressive fill — trigger fallback if we have less than TARGET
  // (not just less than MIN). Target 8 stops, even if Claude found 5+,
  // we hit nearbysearch to fill up to 8 with Claude-scored heritage.
  if (pool.length < target) {
    notes.push(`Pool ${pool.length} < target=${target} — triggering Google nearbysearch fallback (Claude-scored)`);
    const fallback = await fallbackNearbysearch(
      input.startPoint,
      radiusM,
      input.theme,
      input.themeDescription,
      input.city,
    );
    notes.push(`Fallback returned ${fallback.length} Claude-scored candidates`);
    // Merge : keep themed first, fillers second
    const existingIds = new Set(pool.map((c) => c.placeId));
    const newOnes = fallback.filter((c) => !existingIds.has(c.placeId));
    pool = [...pool, ...newOnes];
    if (pool.length < target) {
      fallbackUsed = true; // We needed fallback to even reach target
    }
  }

  if (pool.length < minStops) {
    notes.push(`Pool still ${pool.length} < minStops=${minStops} after fallback. ABORT.`);
    return {
      success: false,
      stops: [],
      diagnostics: {
        proposedCount: proposals.length,
        geocodedCount: geocoded.length,
        fallbackUsed,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        averageScore: 0,
        minScoreInFinal: 0,
        notes,
      },
      errorMessage: `Pool too thin (${pool.length}) for "${input.theme}" in ${input.city}. Reframe editorially.`,
    };
  }

  // ── PHASE 4 : Sort + min-distance selection ───────────────────
  pool.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.themeScore - a.themeScore;
  });

  const sel = selectStopsByGeometry({
    candidates: pool,
    targetN: Math.min(target, pool.length),
    minN: Math.min(minStops, pool.length),
    minDistanceM: MIN_INTER_STOP_M,
  });
  notes.push(
    `min-distance selection : ${sel.selected.length}/${target} (min_pair=${Math.round(sel.actualMinPairDistanceM)}m, relaxed to ${sel.finalMinDistanceUsedM}m)`,
  );

  // Re-attach metadata from pool
  const selectedWithMeta = sel.selected.map((c) => pool.find((p) => p.placeId === c.placeId)!);

  // ── PHASE 5 : NN reorder ─────────────────────────────────────
  const ordered = greedyNN(selectedWithMeta, input.startPoint);

  // ── PHASE 6 : Map to DiscoveredStop[] ────────────────────────
  const finalStops = ordered.map((c) => {
    const enriched = c as GeocodedLandmark;
    const figureNote = enriched.realFigure
      ? ` [FIGURE: ${enriched.realFigure.name}${enriched.realFigure.lifespan ? ` (${enriched.realFigure.lifespan})` : ""} — ${enriched.realFigure.role}]`
      : "";
    const eventNote = enriched.realEvent
      ? ` [EVENT: ${enriched.realEvent.date} — ${enriched.realEvent.description}]`
      : "";
    return {
      name: enriched.name,
      description: `${enriched.rationale}${figureNote}${eventNote}`,
      source: "pipeline-simple-theme-first",
      lat: enriched.lat,
      lon: enriched.lon,
      placeId: enriched.placeId,
      distanceFromStartM: enriched.distanceM,
      stopMode: "radar" as const,
      navigationHint: undefined,
      types: enriched.types,
      rating: enriched.rating,
      themeScore: enriched.themeScore,
      tier: enriched.tier,
      rationale: enriched.rationale,
      realFigure: enriched.realFigure,
      realEvent: enriched.realEvent,
    };
  });

  const averageScore =
    finalStops.reduce((s, c) => s + c.themeScore, 0) / finalStops.length;
  const minScoreInFinal = Math.min(...finalStops.map((c) => c.themeScore));

  notes.push(
    `FINAL : ${finalStops.length} stops, avg=${averageScore.toFixed(2)}/10, min=${minScoreInFinal}, T1=${finalStops.filter((s) => s.tier === 1).length} T2=${finalStops.filter((s) => s.tier === 2).length} T3=${finalStops.filter((s) => s.tier === 3).length}`,
  );

  return {
    success: true,
    stops: finalStops,
    diagnostics: {
      proposedCount: proposals.length,
      geocodedCount: geocoded.length,
      fallbackUsed,
      tier1Count: finalStops.filter((s) => s.tier === 1).length,
      tier2Count: finalStops.filter((s) => s.tier === 2).length,
      tier3Count: finalStops.filter((s) => s.tier === 3).length,
      averageScore: Number(averageScore.toFixed(2)),
      minScoreInFinal,
      notes,
    },
  };
}
