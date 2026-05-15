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

/** Primary model — best quality but occasionally 503 under load. */
const GEMINI_MODEL_PRIMARY = "gemini-2.5-pro";
/** Fallback model — much higher capacity, slightly weaker reasoning,
 *  still good enough for thematic discovery. Used when Pro returns
 *  503/429 (capacity errors), NOT when it returns a real error. */
const GEMINI_MODEL_FALLBACK = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 120_000; // Deep research with grounding takes 30-90s
const DEFAULT_DIAMETER_CAP_M = 3_500;

/** Max retry attempts on capacity errors (503, 429). 1 attempt + 2 retries = 3 total. */
const MAX_CAPACITY_RETRIES = 2;
/** Initial backoff before first retry; doubles on each retry (8s → 16s). */
const INITIAL_BACKOFF_MS = 8_000;

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
    raw = await callGeminiWithResilience(prompt, apiKey);
  } catch (err) {
    console.warn(
      `[ai-discovery] Gemini call failed after retries+fallback (${err instanceof Error ? err.message : err}) — caller will fall back`,
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
  4. Spread the locations across the city rather than clustering them all in one street.

MIX OF NARRATIVE ANCHORS + MICRO-MEMORIALS (CRITICAL FOR HISTORICAL THEMES)
  When the theme is historical (resistance, war, persecution, revolution,
  political movement, a specific person, a literary figure...), the list
  MUST include BOTH categories — never one without the other:

  CATEGORY A — NARRATIVE ANCHORS (40-60% of stops)
    Big-name buildings and public spaces that carry the broad story:
    - The seat of power (Palazzo Comunale, Hôtel de Ville, parliament)
    - Study centres / museums dedicated to the theme
    - Family residences of key figures (writers, leaders, witnesses)
    - Major squares where the iconic events took place
    - Cathedrals or churches with documented thematic role
    - Original buildings of the institutions involved

  CATEGORY B — MICRO-MEMORIALS (40-60% of stops)
    Small, specific, emotionally precise markers that ground abstract
    history in named victims and dated events:
    - Commemorative plaques (lapidi / plaques) with a specific name + date
    - Stelae and cippi (memorial pillars) at the spot of a specific death
    - "Stolperstein" or equivalent stumbling stones
    - Inscribed paving stones
    - Small monuments named after a single individual

  These specialized databases are GOLD when the theme matches — use
  Google Search to query them:
    - Italy / Resistance: pietredellamemoria.it (lapidi, stele, cippi
      across every Italian municipality with the Resistance theme)
    - Germany / Nazi persecution: stolpersteine.eu
    - France / WW2: memoiredeshommes.sga.defense.gouv.fr,
      ajpn.org (anonymes justes et persécutés)
    - Spain / Civil War: stolpersteine.eu (used for victims of Francoism)
    - Generic: localized "Wikipedia: Mémoriaux de [ville]" lists

  The mix matters: a tour with only narrative anchors feels monumental
  and dry ("here was the seat of power, here is the museum"). A tour
  with only micro-memorials feels like a cemetery walk ("here died X,
  here died Y"). The combination is what makes the player FEEL the
  history — abstract politics anchored on individual sacrifice.

OUTPUT — JSON array, no markdown fences, no commentary before or after. Each item:
{
  "name": "<canonical local name as Google Maps would have it>",
  "address": "<full street address: street, number, postal code, city>",
  "lat": <number, 6 decimals — your best estimate>,
  "lon": <number, 6 decimals — your best estimate>,
  "historical_role": "<one sentence: why this place matters for the theme — for micro-memorials include the named person + date if known>",
  "citation": "<URL or short source: 'Pietre della Memoria', 'Wikipedia: Republic_of_Alba', 'Centro Studi Fenoglio', 'Istoreto Piemonte', etc.>",
  "access": "always_open" | "limited_access" | "unknown"
}

If you cannot find ${count} locations that meet ALL constraints, return as many as you legitimately can — do not invent. A short list of authentic places beats a padded list of generic ones.

Output ONLY the JSON array.`;
}

/**
 * Resilient orchestration: try Pro with retries, fall back to Flash on
 * sustained capacity errors. Distinguishes 5xx/429 (capacity — retry,
 * then fallback) from other 4xx (semantic — don't retry).
 *
 * Why the capacity/semantic split:
 *   - 503 "high demand" can clear in seconds; worth retrying with
 *     backoff before giving up on the prompt.
 *   - 400 "invalid request" won't fix itself by retrying — surface
 *     immediately so the caller's fallback path runs.
 */
async function callGeminiWithResilience(
  prompt: string,
  apiKey: string,
): Promise<string> {
  // Attempt 1+: Pro with backoff retries on capacity errors
  for (let attempt = 0; attempt <= MAX_CAPACITY_RETRIES; attempt++) {
    try {
      return await callGeminiWithGrounding(
        prompt,
        apiKey,
        GEMINI_MODEL_PRIMARY,
        GEMINI_TIMEOUT_MS,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCapacity = /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded)\b/i.test(
        msg,
      );
      if (!isCapacity) {
        // Semantic / network error — don't retry, don't fall back, fail fast
        throw err;
      }
      if (attempt < MAX_CAPACITY_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[ai-discovery] ${GEMINI_MODEL_PRIMARY} capacity error (attempt ${attempt + 1}/${MAX_CAPACITY_RETRIES + 1}): ${msg.slice(0, 120)} — retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        console.warn(
          `[ai-discovery] ${GEMINI_MODEL_PRIMARY} exhausted retries — falling back to ${GEMINI_MODEL_FALLBACK}`,
        );
      }
    }
  }

  // Final attempt: Flash (much higher capacity, single shot — if Flash
  // is also 503, the whole AI ecosystem is melting and we'd rather the
  // caller fall back to Google Places legacy than retry forever).
  return callGeminiWithGrounding(
    prompt,
    apiKey,
    GEMINI_MODEL_FALLBACK,
    GEMINI_TIMEOUT_MS,
  );
}

/**
 * Call Gemini via REST with Google Search grounding enabled.
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
  model: string,
  timeoutMs: number,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
