/**
 * Forward-geocoding for game-step locations.
 *
 * Why this exists: the Perplexity → Claude extraction pipeline produces
 * coordinates as a side-effect of paraphrasing a research report. Claude
 * routinely rounds or invents coords that are dozens to hundreds of
 * metres off the actual landmark (Los Cristianos step 1 was ~280 m off
 * the church). Game validation radius is 25-50 m, so any drift past
 * that means the player physically arrives at the right place but the
 * app says "you're not there yet". The fix: never trust LLM-emitted
 * coords for the final stored value — re-geocode the named landmark
 * with a real geocoder and use ITS answer as ground truth.
 *
 * Two providers, in this order of preference:
 *   - GOOGLE Places + Geocoding API. Sub-10 m on named landmarks.
 *     Used when GOOGLE_MAPS_API_KEY is set (paid, ~$5/1000 req →
 *     roughly $0.04 per generated game).
 *   - NOMINATIM (OpenStreetMap). Free, polite-use rate-limited to
 *     ~1 req/sec, sub-50 m on most named buildings, sometimes worse
 *     on vague POIs. Always the fallback.
 */

export type GeocodeSource = "google_places" | "google_geocoding" | "nominatim";

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Canonical name as returned by the provider. */
  displayName: string;
  /** Which provider answered. */
  source: GeocodeSource;
  /** "high" = exact address/POI, "medium" = neighbourhood, "low" = city-level. */
  confidence: "high" | "medium" | "low";
  /** Provider-specific id, if any (place_id from Google, osm_type:osm_id from Nominatim). */
  externalId?: string;
}

// Process-lifetime cache. Helps when the pipeline retries and during
// audit / backfill scripts that re-geocode every step.
const cache = new Map<string, GeocodeResult | null>();

const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "OddballTrip-EscapeGame/1.0 (oddballtrip.com)";

const REQUEST_TIMEOUT_MS = 8000;

let lastNominatimCall = 0;
async function paceNominatim(): Promise<void> {
  // Nominatim policy: max ~1 req/sec. We sleep to 1100 ms between calls
  // to stay safely under and avoid rate-limit bans.
  const elapsed = Date.now() - lastNominatimCall;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastNominatimCall = Date.now();
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a named landmark. Caller passes the landmark name as Claude /
 * Perplexity wrote it (e.g. "Iglesia de Nuestra Señora del Carmen") plus
 * city + country to disambiguate. Returns null when no provider returns
 * anything — the caller is expected to surface that to the operator
 * (reject the step, fail the pipeline) rather than fall back to a guess.
 */
export async function geocodeLocation(
  landmarkName: string,
  city: string,
  country: string,
): Promise<GeocodeResult | null> {
  if (!landmarkName?.trim()) return null;
  const cacheKey = `${landmarkName}|${city}|${country}`.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  let result: GeocodeResult | null = null;

  // Primary: Google when a key is present. Places "findplacefromtext"
  // targets named landmarks and is consistently sub-10 m on famous
  // locations; Geocoding is the fallback when Places returns nothing
  // (street addresses, plazas without their own POI).
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      result = await viaGooglePlaces(landmarkName, city, country);
    } catch (err) {
      console.warn(
        `[geocode] Google Places threw for "${landmarkName}":`,
        err instanceof Error ? err.message : err,
      );
    }
    if (!result) {
      try {
        result = await viaGoogleGeocoding(landmarkName, city, country);
      } catch (err) {
        console.warn(
          `[geocode] Google Geocoding threw for "${landmarkName}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Fallback: Nominatim. Free, no key, polite rate-limit applies.
  if (!result) {
    try {
      result = await viaNominatim(landmarkName, city, country);
    } catch (err) {
      console.warn(
        `[geocode] Nominatim threw for "${landmarkName}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  cache.set(cacheKey, result);
  return result;
}

/**
 * Backwards-compat shim for callers that still expect the older
 * `geocodeStop` API. New code should use `geocodeLocation` directly to
 * get the richer GeocodeResult (with provider, confidence, etc.).
 */
export async function geocodeStop(
  name: string,
  city: string,
  country: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const r = await geocodeLocation(name, city, country);
  return r ? { latitude: r.lat, longitude: r.lon } : null;
}

async function viaGooglePlaces(
  landmark: string,
  city: string,
  country: string,
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  const query = `${landmark}, ${city}, ${country}`;
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
  );
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "name,geometry,place_id,formatted_address");
  url.searchParams.set("key", apiKey);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
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
      }>;
    };
    if (data.status !== "OK" || !data.candidates?.length) return null;
    const c = data.candidates[0];
    if (!c.geometry?.location) return null;
    return {
      lat: c.geometry.location.lat,
      lon: c.geometry.location.lng,
      displayName: c.formatted_address || c.name,
      source: "google_places",
      confidence: "high",
      externalId: c.place_id,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function viaGoogleGeocoding(
  landmark: string,
  city: string,
  country: string,
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${landmark}, ${city}, ${country}`);
  url.searchParams.set("key", apiKey);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ac.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        place_id: string;
        geometry: {
          location: { lat: number; lng: number };
          location_type: string;
        };
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    const r = data.results[0];
    // Google's location_type indicates how precise the match is.
    // ROOFTOP / RANGE_INTERPOLATED = high; GEOMETRIC_CENTER = medium;
    // APPROXIMATE = low.
    const lt = r.geometry.location_type;
    const confidence: GeocodeResult["confidence"] =
      lt === "ROOFTOP" || lt === "RANGE_INTERPOLATED"
        ? "high"
        : lt === "GEOMETRIC_CENTER"
          ? "medium"
          : "low";
    return {
      lat: r.geometry.location.lat,
      lon: r.geometry.location.lng,
      displayName: r.formatted_address,
      source: "google_geocoding",
      confidence,
      externalId: r.place_id,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function viaNominatim(
  landmark: string,
  city: string,
  country: string,
): Promise<GeocodeResult | null> {
  await paceNominatim();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${landmark}, ${city}, ${country}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      osm_id: number | string;
      osm_type: string;
      importance?: number;
      class?: string;
      type?: string;
    }>;
    if (!arr.length) return null;

    // Prefer concrete buildings / amenities over admin areas. Falls
    // back to the highest-importance hit when nothing concrete shows up.
    const ranked = [...arr].sort((a, b) => {
      const pref = (e: typeof a) =>
        (e.class === "amenity" ? 3 : 0) +
        (e.class === "building" ? 3 : 0) +
        (e.class === "tourism" ? 2 : 0) +
        (e.class === "historic" ? 2 : 0);
      return (pref(b) - pref(a)) || ((b.importance ?? 0) - (a.importance ?? 0));
    });
    const best = ranked[0];
    const lat = parseFloat(best.lat);
    const lon = parseFloat(best.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      lat,
      lon,
      displayName: best.display_name,
      source: "nominatim",
      // Nominatim doesn't expose a precision flag. For class=amenity /
      // building we usually get <30 m; otherwise mark as medium.
      confidence:
        best.class === "amenity" || best.class === "building"
          ? "high"
          : "medium",
      externalId: `${best.osm_type}:${best.osm_id}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Distance in metres between two coords using the haversine formula.
 * Used by the pipeline to log how far the LLM coord drifted from the
 * geocoded ground truth (so we can spot the next failure mode early)
 * and decide whether to override.
 */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
