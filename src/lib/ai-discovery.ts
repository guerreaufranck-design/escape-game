/**
 * AI-FIRST thematic discovery.
 *
 * Reverses the historical pipeline order. Instead of asking Google Places
 * for whatever tourism POI sits within 2 km of the startPoint and then
 * brodering a story on top, we ask Gemini 2.5 Pro (with Google Search
 * grounding) to enumerate locations that MATTER for the theme — using its
 * deep-research capability the same way a human would Google "lieux
 * historiques résistance Alba 1944".
 *
 * Why this exists — incident Julien 2026-05-15:
 *   Pipeline returned 4 modern hotels for "La Résistance d'Alba" because
 *   they had high Google ratings. The 4 actual Resistance memorials in
 *   Alba (Monumento alla Liberazione, Centro Studi Fenoglio, Sala della
 *   Resistenza, Palazzo Comunale with Chessa frescoes) were never even
 *   in the candidate pool — they don't rank as "tourist_attraction" in
 *   Google Places.
 *
 * Architecture:
 *   1. Gemini 2.5 Pro + google_search tool → 10-12 thematic POIs with
 *      addresses + hint coordinates + historical role + source citation
 *   2. Constraint baked into the prompt: max pairwise distance (incl.
 *      startPoint) ≤ DIAMETER_CAP_M (3500m by default)
 *   3. Caller (parcours-discovery) then runs each POI through Google
 *      Maps Geocoding to canonicalize GPS, and through Places Text
 *      Search to enrich place_id / photos / rating
 *
 * Returns [] on hard failure so the caller can fall back to the legacy
 * Google-Places-first flow without crashing.
 */

const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_TIMEOUT_MS = 120_000; // Deep research with grounding takes 30-90s
const DEFAULT_DIAMETER_CAP_M = 3_500;

export interface DiscoverThematicPoisParams {
  city: string;
  country: string;
  /** Game title — passed verbatim, conveys the strongest signal of theme intent. */
  title: string;
  /** Theme tag — broader category for the game. */
  theme: string;
  /** Free-text description of the theme written by OddballTrip / admin. */
  themeDescription: string;
  /** GPS centre — typically the geocoded startPoint from OddballTrip. */
  startPoint: { lat: number; lon: number };
  /** Target number of stops the game will publish. We ask Gemini for
   *  more than this (+50%) so geometric selection has room to filter. */
  stopCount: number;
  /** Max pairwise diameter of the final set (startPoint included). Default
   *  3.5 km — walkable city centre. Caller may relax for roadtrips. */
  diameterCapM?: number;
}

/**
 * Raw POI as returned by Gemini before any GPS validation. The lat/lon
 * here are HINTS only — Gemini's coordinate memory is approximate and
 * occasionally wrong by 100-500m. Caller must geocode by address.
 */
export interface RawThematicPoi {
  /** Canonical local name, suitable for Geocoding ("Centro Studi Beppe Fenoglio"). */
  name: string;
  /** Full street address suitable for Google Geocoding. */
  address: string;
  /** Hint coordinates from Gemini — use only to detect hallucination after geocoding. */
  latHint: number;
  lonHint: number;
  /** One-sentence explanation of why this place matters for the theme. */
  historicalRole: string;
  /** Source citation (URL or "Wikipedia" / "Centro Studi" / etc.). */
  citation: string;
  /** Optional: known opening status — "always_open" for public squares,
   *  "limited_access" for museums, etc. Used as soft signal downstream. */
  accessHint?: "always_open" | "limited_access" | "unknown";
}

/**
 * Main entry point. Returns empty array on any hard failure (no key,
 * timeout, malformed JSON, zero parseable items). Soft errors (Gemini
 * returns 4 items when we asked for 12) just propagate — caller decides
 * what to do with a partial result.
 */
export async function discoverThematicPois(
  params: DiscoverThematicPoisParams,
): Promise<RawThematicPoi[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[ai-discovery] GEMINI_API_KEY missing — skipping");
    return [];
  }

  const diameterM = params.diameterCapM ?? DEFAULT_DIAMETER_CAP_M;
  const overshoot = Math.ceil(params.stopCount * 1.5); // ask for 50% more

  const prompt = buildPrompt(params, diameterM, overshoot);

  const startTs = Date.now();
  let raw: string;
  try {
    raw = await callGeminiWithGrounding(prompt, apiKey, GEMINI_TIMEOUT_MS);
  } catch (err) {
    console.warn(
      `[ai-discovery] Gemini call failed (${err instanceof Error ? err.message : err}) — caller will fall back`,
    );
    return [];
  }

  const parsed = extractJsonArray(raw);
  if (!parsed) {
    console.warn(
      `[ai-discovery] could not extract JSON array from Gemini output (${raw.slice(0, 200)}…)`,
    );
    return [];
  }

  const pois = parsed
    .map(coerceToRawPoi)
    .filter((p): p is RawThematicPoi => p !== null);

  console.log(
    `[ai-discovery] Gemini returned ${pois.length}/${overshoot} thematic POIs in ${Math.round((Date.now() - startTs) / 1000)}s for "${params.title}" @ ${params.city}`,
  );

  return pois;
}

function buildPrompt(
  params: DiscoverThematicPoisParams,
  diameterM: number,
  count: number,
): string {
  return `You are a heritage-and-place researcher building an outdoor walking game.

GAME
  Title: "${params.title}"
  Theme tag: "${params.theme}"
  Theme description: "${params.themeDescription}"
  City: ${params.city}, ${params.country}
  Start point GPS: ${params.startPoint.lat.toFixed(6)}, ${params.startPoint.lon.toFixed(6)}

TASK
  Find ${count} locations in ${params.city} that are HISTORICALLY DOCUMENTED as directly linked to the theme. Use Google Search to verify each one. Cite the source.

HARD CONSTRAINTS
  1. Each location must be a REAL physical place with a street address that Google Maps can geocode.
  2. The maximum pairwise distance between any two locations (start point included) must be ≤ ${(diameterM / 1000).toFixed(1)} km. Think of it as the diameter of the smallest circle that contains start point + all stops.
  3. Prefer locations of clear historical / cultural relevance to the theme. Avoid generic modern hotels, restaurants, art galleries, or parks UNLESS they are themselves of documented historical importance to the theme.
  4. If the theme is historical (resistance, war, religion, art movement, literary figure...), prefer memorials, plaques, study centres, family residences, original buildings, public squares with documented events. Avoid invented connections to modern establishments.
  5. Spread the locations across the city rather than clustering them all in one street.

OUTPUT — JSON array, no markdown fences, no commentary before or after. Each item:
{
  "name": "<canonical local name as Google Maps would have it>",
  "address": "<full street address: street, number, postal code, city>",
  "lat": <number, 6 decimals — your best estimate>,
  "lon": <number, 6 decimals — your best estimate>,
  "historical_role": "<one sentence: why this place matters for the theme>",
  "citation": "<URL or short source: 'Wikipedia: Republic_of_Alba', 'Centro Studi Fenoglio', 'Istoreto Piemonte', etc.>",
  "access": "always_open" | "limited_access" | "unknown"
}

If you cannot find ${count} locations that meet ALL constraints, return as many as you legitimately can — do not invent. A short list of authentic places beats a padded list of generic ones.

Output ONLY the JSON array.`;
}

/**
 * Call Gemini 2.5 Pro via REST with Google Search grounding enabled.
 *
 * We go through REST rather than the @google/generative-ai SDK because:
 *   - The SDK at version 0.24.x mis-handles google_search tool config
 *     under some account configurations (returns API_KEY_INVALID).
 *   - REST gives us full control over the request shape.
 *
 * Note: response_mime_type=application/json is INCOMPATIBLE with the
 * google_search tool in Gemini 2.x. We rely on prompt discipline + a
 * JSON-array regex extractor on the response instead.
 */
async function callGeminiWithGrounding(
  prompt: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 16384,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error(`Gemini returned empty parts: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return parts
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull a JSON array out of Gemini's response. Gemini with grounding
 * sometimes wraps the JSON in markdown fences, sometimes prepends a
 * one-line preamble, sometimes appends citations. We tolerate all three.
 */
function extractJsonArray(raw: string): unknown[] | null {
  // Strip markdown fences if present
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  // Find the first '[' and the matching last ']'
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = stripped.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate + normalize one Gemini item into a RawThematicPoi. Returns
 * null if any required field is missing or malformed — the caller drops
 * silently rather than failing the whole batch.
 */
function coerceToRawPoi(item: unknown): RawThematicPoi | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim() : "";
  const address = typeof o.address === "string" ? o.address.trim() : "";
  const lat = typeof o.lat === "number" ? o.lat : NaN;
  const lon = typeof o.lon === "number" ? o.lon : NaN;
  const role = typeof o.historical_role === "string" ? o.historical_role.trim() : "";
  const citation = typeof o.citation === "string" ? o.citation.trim() : "";
  const accessRaw = typeof o.access === "string" ? o.access.trim() : "unknown";

  if (!name || !address) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const access =
    accessRaw === "always_open" || accessRaw === "limited_access"
      ? accessRaw
      : "unknown";

  return {
    name,
    address,
    latHint: lat,
    lonHint: lon,
    historicalRole: role,
    citation,
    accessHint: access,
  };
}
