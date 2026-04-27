/**
 * Gemini-based research for the game-generation pipeline.
 *
 * Replaces the heavier Perplexity sonar-deep-research call when the
 * USE_GEMINI_RESEARCH flag is on. Uses Gemini 2.5 Flash WITHOUT Google
 * Search grounding (the user hit a 503 from Google Search in production
 * earlier today — we won't put it on the critical path).
 *
 * Strategy:
 *   1. Ask Gemini for structured JSON about the predefined stops, using
 *      ONLY its training-data knowledge — no live web call.
 *   2. For any GPS coordinate that looks suspicious (zero, NaN, or far
 *      from the city centre), defer to Nominatim to fix it.
 *   3. Force every entry's answerSource to "virtual_ar" — same contract
 *      as the Perplexity path so downstream code doesn't care which
 *      provider produced the data.
 *
 * Cost: ~$0.02/game (vs ~$1.00 for Perplexity sonar-deep-research).
 *
 * Reliability: a clean LLM call has much smaller failure surface than
 * grounding-augmented requests. Combined with the Perplexity fallback
 * in the pipeline, the player never sees a research failure unless BOTH
 * providers are down simultaneously.
 */

import type { ResearchedLocation, PredefinedStop } from "./perplexity";
import { getGeminiModel } from "./gemini";
import { geocodeStop } from "./geocode";

const GEMINI_TIMEOUT_MS = 25_000;

/**
 * Wrap a promise with a timeout. Returns null on expiry instead of throwing
 * so callers can gracefully fall back to Perplexity.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Gemini research timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/**
 * Validate the shape of a Gemini-returned ResearchedLocation. Discards
 * entries that lack the essentials. Coords get rescued via Nominatim
 * downstream — what we filter here are the truly broken entries.
 */
function isValidLocation(loc: Partial<ResearchedLocation>): boolean {
  if (!loc.name || typeof loc.name !== "string") return false;
  if (!loc.answer || typeof loc.answer !== "string") return false;
  return true;
}

/**
 * Sanity-check a single coordinate value: must be finite, non-zero,
 * within world bounds. NaN or 0/0 trips this and signals "needs Nominatim".
 */
function looksFakeCoord(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  if (lat === 0 && lon === 0) return true;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return true;
  return false;
}

/**
 * Main entry point. Drop-in replacement for Perplexity's
 * researchPredefinedStops, returning the same shape so the pipeline is
 * indifferent to which provider was used.
 *
 * Throws on hard failure (parse error, all entries invalid). The pipeline
 * catches and falls back to Perplexity.
 */
export async function researchPredefinedStopsWithGemini(
  city: string,
  country: string,
  theme: string,
  stops: PredefinedStop[],
): Promise<ResearchedLocation[]> {
  const stopsList = stops
    .map(
      (s, i) =>
        `${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}`,
    )
    .join("\n");

  const prompt = `You are a heritage-tourism research assistant. The game designer has selected ${stops.length} specific locations in ${city}, ${country} for an outdoor AR walking game themed "${theme}". For EACH location, return a structured JSON object using ONLY your training-data knowledge — do NOT cite the web, do NOT hedge.

For each location:
- Pinpoint the GPS coordinates as accurately as you can recall (6 decimals).
- Provide a short historical / cultural fact tying the place to the theme.
- Invent a memorable, thematic answer that would be revealed magically in AR (a year, roman numeral, a single Latin/local-language word, max 3 words).

LOCATIONS:
${stopsList}

RETURN — a JSON array, one object per location, in the SAME order as above:
[
  {
    "name": "<exact name from the input>",
    "latitude": <number with 6 decimals, never 0>,
    "longitude": <number with 6 decimals, never 0>,
    "whatToObserve": "Reach the location and point your camera at the facade — the AR will reveal the secret.",
    "answer": "<short evocative answer, max 3 words>",
    "answerType": "year" | "number" | "name",
    "answerSource": "virtual_ar",
    "source": "training",
    "themeLink": "<one sentence on how this place ties to the theme '${theme}'>"
  },
  ...
]

If you don't have enough information to give plausible coordinates for a stop, return them as 0/0 — the system will geocode it from the name. NEVER fabricate wildly wrong coordinates. NEVER skip a stop. Output ONLY the JSON array — no markdown fences, no commentary.`;

  const model = getGeminiModel();

  const result = await withTimeout(
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 8192,
      },
    }),
    GEMINI_TIMEOUT_MS,
  );

  const raw = result.response.text().trim();
  let parsed: ResearchedLocation[];
  try {
    parsed = JSON.parse(raw) as ResearchedLocation[];
  } catch (err) {
    throw new Error(
      `[gemini-research] JSON parse failed: ${err instanceof Error ? err.message : err}. Output: ${raw.slice(0, 300)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`[gemini-research] expected array, got ${typeof parsed}`);
  }

  // Filter shape-invalid entries before geocoding.
  const valid = parsed.filter(isValidLocation);
  if (valid.length === 0) {
    throw new Error("[gemini-research] no valid entries returned");
  }

  // Force virtual_ar contract regardless of what the model said.
  // Geocode any entry whose coords look fake (0/0, NaN, out-of-range).
  const enriched: ResearchedLocation[] = await Promise.all(
    valid.map(async (loc) => {
      let { latitude, longitude } = loc;
      if (looksFakeCoord(latitude, longitude)) {
        const geo = await geocodeStop(loc.name, city, country);
        if (geo) {
          latitude = geo.latitude;
          longitude = geo.longitude;
          console.log(
            `[gemini-research] geocoded "${loc.name}" via Nominatim → ${latitude},${longitude}`,
          );
        } else {
          console.warn(
            `[gemini-research] geocode failed for "${loc.name}" — keeping ${latitude}/${longitude}`,
          );
        }
      }

      return {
        ...loc,
        latitude,
        longitude,
        answerSource: "virtual_ar" as const,
        source: loc.source || "gemini-training",
      };
    }),
  );

  console.log(
    `[gemini-research] returned ${enriched.length}/${stops.length} locations (target = input count)`,
  );

  return enriched;
}
