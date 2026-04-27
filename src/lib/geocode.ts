/**
 * Geocoding helper backed by OpenStreetMap Nominatim.
 *
 * Used by the Gemini research path to fix GPS coordinates when Gemini's
 * training data is fuzzy. Free, no API key, same OSM ecosystem we already
 * lean on for walking-route safety (see route-safety.ts).
 *
 * Nominatim's free public endpoint at nominatim.openstreetmap.org has a
 * "1 request/sec, fair use" policy — for our scale (a handful of geocode
 * lookups per game generation, batched per-game in parallel-ish bursts)
 * we stay well under the threshold. If we ever push past it, we can:
 *   - host our own Nominatim mirror,
 *   - or pay for a managed mirror (LocationIQ, MapQuest, etc.).
 *
 * Always honour their User-Agent requirement so our requests are
 * attributable. Returns null on any failure (timeout, 4xx, 5xx, parse
 * error) — callers must keep working without coordinates.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const REQUEST_TIMEOUT_MS = 5000;
const USER_AGENT = "OddballTrip-EscapeGame/1.0 (oddballtrip.com)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

/**
 * Look up a place by free-text name + city + country. Returns the most
 * confident match's coordinates, or null on failure / no result.
 *
 * The search query is "name, city, country" — Nominatim handles fuzzy
 * matching well, but we don't go crazy with synonyms here. If the LLM
 * returns a name Nominatim can't find, we let the caller decide what
 * to do (typically: keep the LLM's coords as-is).
 */
export async function geocodeStop(
  name: string,
  city: string,
  country: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const query = `${name}, ${city}, ${country}`;
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[geocode] Nominatim ${res.status} for "${query}"`);
      return null;
    }
    const data = (await res.json()) as NominatimResult[];
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[geocode] no Nominatim result for "${query}"`);
      return null;
    }
    const lat = Number.parseFloat(data[0].lat);
    const lon = Number.parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { latitude: lat, longitude: lon };
  } catch (err) {
    console.warn(
      `[geocode] Nominatim threw for "${query}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
