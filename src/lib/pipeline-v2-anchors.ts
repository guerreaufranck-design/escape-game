/**
 * Pipeline V2 — Anchor discovery (2026-05-23).
 *
 * ═══════════════════════════════════════════════════════════════════
 * The HEART of pipeline V2. Replaces the entire enrichment chain
 * (Sprint A Perplexity iconicSites + Sprint I Claude proposer).
 * ═══════════════════════════════════════════════════════════════════
 *
 * Design principle :
 *
 *   "Don't dig through 60 noisy Google candidates hoping to find
 *    thematic landmarks. Start with the THEMATIC LANDMARKS that
 *    must be present, then verify they exist in Google Places."
 *
 * Old approach (broken) :
 *   1. Google nearbysearch returns 60 generic POIs
 *   2. Multiple enrichment layers try to inject thematic anchors
 *   3. Claude curates, judges complain, auto-repair shuffles
 *   4. Pool still polluted, stops still bad
 *
 * V2 approach :
 *   1. Claude HISTORIAN proposes ~6-8 canonical sites for the theme
 *   2. Google findPlaceFromText verifies each (real place_id, GPS)
 *   3. Filter : must be near startPoint, must have acceptable types
 *   4. Output : N anchors with full data, ready to use directly
 *
 * Trust contract :
 *   - Claude proposes NAMES only (no GPS, no place_id)
 *   - Google decides if a name resolves to a real place
 *   - We never insert anything Google didn't validate
 *   - Hallucinated names → silent geocode fail → silent skip
 *
 * Cost : ~$0.005 Claude + ~$0.005 Google = $0.01 per game
 * Time : ~3-5s parallel geocode
 *
 * vs old (Sprint A + I) :
 *   Cost : $0.40 Perplexity + $0.005 Claude proposer + $0.005 Google
 *        = $0.41 (40× more)
 *   Time : 2-5 min Perplexity + 5s anchors = 2-5 min (60× slower)
 *   Reliability : Perplexity unstable, 0.01 quality observed
 */
import Anthropic from "@anthropic-ai/sdk";
import type { NearbyCandidate } from "./geocode";
import { haversineMeters } from "./geocode";

export interface AnchorProposal {
  name: string;
  rationale: string;
  tier: 1 | 2 | 3;
}

export interface ProposeAnchorsInput {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  narrative?: string;
  city: string;
  country: string;
  /** Walking radius around startPoint (anchors farther than this × 1.5
   *  are dropped — Claude doesn't know the exact radius, we accept
   *  some tolerance and prune after geocoding). */
  walkingRadiusM: number;
  /** Max number of anchors to propose (default 8). */
  maxProposals?: number;
}

const SYSTEM_PROMPT = `You are a heritage historian. For a given theme + city, you list the PHYSICAL LANDMARKS a knowledgeable visitor MUST see to experience this theme on a walking tour.

═══════════════════════════════════════════════════════════
OUTPUT — strict JSON, no markdown
═══════════════════════════════════════════════════════════

{
  "landmarks": [
    {
      "name": "<full geocodable name, with city if needed>",
      "rationale": "<one sentence : why this site for this theme>",
      "tier": 1 | 2 | 3
    },
    ... up to 8 entries
  ]
}

═══════════════════════════════════════════════════════════
TIER PRIORITY
═══════════════════════════════════════════════════════════

  TIER 1 — DIRECT thematic anchor (canonical, named in any history
           book about this theme in this city). Examples :
           - For "1209 Cathar massacre Béziers" : Cathédrale Saint-
             Nazaire, Église de la Madeleine, Pont Vieux, Remparts
           - For "Caravaggio Malta" : Co-Cathédrale Saint-Jean,
             Auberge de Provence, Palais des Grands Maîtres
           - For "1572 Huguenots Aigues-Mortes" : Tour de Constance,
             Place Saint-Louis, Remparts

  TIER 2 — STRONG era / regional context (era-compatible heritage in
           the same neighborhood, atmospheric even if no direct
           documentation). Examples :
           - For "1209 Béziers" : Basilique Saint-Aphrodise (medieval,
             same century), Place de la Madeleine
           - For "Caravaggio Malta" : any 16th-c hospitaller building

  TIER 3 — Acceptable last-resort (era-compatible elsewhere in town).
           Use only when Tier 1+2 give fewer than 5 landmarks.

═══════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════

  ✅ PROPOSE :
     - NAMED, PHYSICAL, STILL-STANDING landmarks
     - Full geocodable name : "Cathédrale Saint-Nazaire de Béziers"
       (NOT "the cathedral", NOT "Notre-Dame")
     - Use proper diacritics + accents
     - Include ", [city]" when the name is generic
       ("Place de la Madeleine" → "Place de la Madeleine, Béziers")
     - Prefer OUTDOOR landmarks (façade-visible heritage) — outdoor
       escape-game UX
     - Mix Tier 1 (most desired) with Tier 2/3 (fallback fill) to
       reach 6-8 landmarks total

  ❌ DON'T PROPOSE :
     - Generic categories ("a medieval church")
     - Modern museums about the theme (unless the museum IS the
       theme, e.g. Caravaggio museum for a Caravaggio theme)
     - Reconstructions / replicas
     - Landmarks in OTHER cities
     - Aquariums, theme parks, supermarkets, hotels, gas stations
     - Bus stations, parking, sports stadiums
     - Lodging facilities (even "Château" / "Domaine de X" if it's
       actually a wine estate with rooms)
     - Hallucinated/imaginary sites

  ⚠️ IF you genuinely don't know this city well enough to propose
     grounded landmarks for this theme, return EMPTY landmarks array
     rather than fabricate. Empty is OK — downstream handles it.

═══════════════════════════════════════════════════════════
TIER QUOTA (target distribution)
═══════════════════════════════════════════════════════════

  For 8 proposals : aim for 4-5 Tier 1 + 2-3 Tier 2 + 0-1 Tier 3
  For 5 proposals : aim for 3-4 Tier 1 + 1-2 Tier 2

  If only 2-3 Tier 1 sites exist for this theme + city (extreme niche),
  that's fine — propose them all + supplement with Tier 2 era-compat.`;

function buildUserPrompt(input: ProposeAnchorsInput): string {
  const productBlock =
    input.productDescription && input.productDescription.length > 50
      ? `\nPRODUCT-PAGE DESCRIPTION (the customer's promise) :\n"""${input.productDescription.trim().slice(0, 1800)}"""\n`
      : "";
  const narrativeBlock = input.narrative
    ? `\nNARRATIVE : ${input.narrative.slice(0, 500)}\n`
    : "";
  return `THEME : ${input.theme}
THEME DESCRIPTION : ${input.themeDescription}
CITY : ${input.city}, ${input.country}
WALKING RADIUS : ${input.walkingRadiusM}m around start point
${productBlock}${narrativeBlock}
Propose up to ${input.maxProposals ?? 8} canonical PHYSICAL landmarks for this theme in this city. Return JSON only.`;
}

async function proposeAnchorsViaClaud(
  input: ProposeAnchorsInput,
): Promise<AnchorProposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = new Anthropic({ apiKey });
  let text = "";
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        temperature: 0.15, // mild variance so Claude doesn't get stuck on the same 3 famous sites
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
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
      `[v2-anchors] Claude call failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: { landmarks?: unknown } = {};
  try {
    parsed = JSON.parse(jsonText) as { landmarks?: unknown };
  } catch (err) {
    console.warn(
      `[v2-anchors] Claude returned non-JSON: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
  if (!Array.isArray(parsed.landmarks)) return [];
  const out: AnchorProposal[] = [];
  for (const item of parsed.landmarks) {
    const r = (item ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (name.length < 3) continue;
    const rationale =
      typeof r.rationale === "string" ? r.rationale.trim() : "";
    const tierRaw = typeof r.tier === "number" ? r.tier : 2;
    const tier: 1 | 2 | 3 =
      tierRaw === 1 ? 1 : tierRaw === 3 ? 3 : 2;
    if (out.find((p) => p.name.toLowerCase() === name.toLowerCase()))
      continue;
    out.push({ name, rationale, tier });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════
// Google Places findPlaceFromText with strict acceptable-type filter
// ═════════════════════════════════════════════════════════════════════

const REJECT_TYPES = new Set([
  "route",
  "political",
  "premise",
  "subpremise",
  "establishment", // too generic, rely on more specific types
  "street_address",
  "intersection",
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

function isAcceptableType(types: string[]): boolean {
  if (!types || types.length === 0) return false;
  // Reject if ANY hard-bad type present
  for (const t of types) {
    if (REJECT_TYPES.has(t)) return false;
  }
  return true;
}

export interface AnchorCandidate extends NearbyCandidate {
  /** Tier from Claude proposer (1=Tier 1 canonical, 2/3=fallback). */
  tier: 1 | 2 | 3;
  /** Rationale from Claude (why this site for this theme). */
  rationale: string;
  /** Original Claude-proposed name (before Google may have renamed it). */
  proposedName: string;
}

async function geocodeAnchor(
  proposal: AnchorProposal,
  startPoint: { lat: number; lon: number },
  maxDistanceM: number,
  city: string,
  country: string,
  apiKey: string,
): Promise<AnchorCandidate | null> {
  const query = `${proposal.name}, ${city}, ${country}`;
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
    if (!res.ok) return null;
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
    if (data.status !== "OK" || !data.candidates?.length) return null;

    // Parcours all candidates — keep the first acceptable one
    for (const c of data.candidates) {
      if (!c.geometry?.location || !c.place_id) continue;
      const types = c.types ?? [];
      if (!isAcceptableType(types)) {
        console.log(
          `[v2-anchors] REJECT geocode "${proposal.name}" — types=[${types.join(",")}] (returned "${c.name}", not heritage)`,
        );
        continue;
      }
      const distanceM = haversineMeters(
        { lat: c.geometry.location.lat, lon: c.geometry.location.lng },
        startPoint,
      );
      if (distanceM > maxDistanceM) {
        console.log(
          `[v2-anchors] REJECT geocode "${proposal.name}" — ${Math.round(distanceM)}m > ${Math.round(maxDistanceM)}m max`,
        );
        continue;
      }
      return {
        name: c.name,
        lat: c.geometry.location.lat,
        lon: c.geometry.location.lng,
        placeId: c.place_id,
        types,
        address: c.formatted_address,
        rating: c.rating,
        userRatingsTotal: c.user_ratings_total,
        distanceM,
        tier: proposal.tier,
        rationale: proposal.rationale,
        proposedName: proposal.name,
      };
    }
    return null;
  } catch (err) {
    console.warn(
      `[v2-anchors] geocode failed for "${proposal.name}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ═════════════════════════════════════════════════════════════════════
// Public entry point
// ═════════════════════════════════════════════════════════════════════

export interface DiscoverAnchorsResult {
  anchors: AnchorCandidate[];
  /** Names Claude proposed but Google didn't validate (audit). */
  rejected: Array<{ name: string; reason: string }>;
  /** Total Claude proposed (for telemetry). */
  proposedCount: number;
}

/**
 * Main entry : ask Claude for canonical landmarks, geocode them in
 * parallel via Google Places, filter to acceptable types + distance.
 *
 * Returns all geocoded anchors (may be 0 if Claude knows nothing or
 * Google can't find anything). Caller decides whether to proceed,
 * fill with heritage candidates, or abort.
 */
export async function discoverAnchors(
  input: ProposeAnchorsInput & { startPoint: { lat: number; lon: number } },
): Promise<DiscoverAnchorsResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[v2-anchors] GOOGLE_MAPS_API_KEY missing");
    return { anchors: [], rejected: [], proposedCount: 0 };
  }

  const proposals = await proposeAnchorsViaClaud(input);
  console.log(
    `[v2-anchors] Claude proposed ${proposals.length} landmarks for "${input.theme}" in ${input.city}: ${proposals.map((p) => `${p.name}(T${p.tier})`).join(", ")}`,
  );
  if (proposals.length === 0) {
    return { anchors: [], rejected: [], proposedCount: 0 };
  }

  // Geocode in parallel — same tolerance as Sprint A pattern (1.5× radius
  // since these are CANONICAL sites worth a bit of extra walk if needed)
  const geocodeTolerance = input.walkingRadiusM * 1.5;

  const results = await Promise.allSettled(
    proposals.map((p) =>
      geocodeAnchor(p, input.startPoint, geocodeTolerance, input.city, input.country, apiKey),
    ),
  );

  const anchors: AnchorCandidate[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const seenPlaceIds = new Set<string>();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const proposal = proposals[i];
    if (r.status === "fulfilled" && r.value !== null) {
      if (seenPlaceIds.has(r.value.placeId)) {
        rejected.push({
          name: proposal.name,
          reason: "duplicate place_id (already added under another name)",
        });
        continue;
      }
      seenPlaceIds.add(r.value.placeId);
      anchors.push(r.value);
    } else {
      rejected.push({
        name: proposal.name,
        reason:
          r.status === "rejected"
            ? `geocode error: ${r.reason instanceof Error ? r.reason.message : r.reason}`
            : "no acceptable Google Places match within radius",
      });
    }
  }

  // Sort : Tier 1 first, then Tier 2, then Tier 3; within tier by rating
  anchors.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  console.log(
    `[v2-anchors] ${anchors.length}/${proposals.length} anchors geocoded successfully (${anchors.filter((a) => a.tier === 1).length} Tier 1, ${anchors.filter((a) => a.tier === 2).length} Tier 2, ${anchors.filter((a) => a.tier === 3).length} Tier 3). Rejected: ${rejected.length}`,
  );

  return { anchors, rejected, proposedCount: proposals.length };
}
