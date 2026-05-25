/**
 * GEOCODE — Google Places Text Search, anti-bias.
 *
 * Règle d'or : on NE PASSE PAS de coordonnées à Google Places. Juste le
 * nom du landmark + la ville. Google trouve seul. Si nos coords GPS
 * étaient hallucinées par Perplexity, ne pas les injecter ici éviterait
 * de biaiser la recherche.
 *
 * Pour chaque landmark, on calcule aussi la distance au point de départ
 * (utile pour ordonner / valider).
 *
 * Si un landmark n'est pas trouvable → on log un FAILED et on continue
 * sans lui. La phase Quality Gate décidera si c'est bloquant (< 5 stops
 * géocodés → needs_review).
 */

import type {
  DiscoveredLandmark,
  GeocodeResult,
  GeocodedLandmark,
  PipelineInput,
} from "./types";

const PLACES_TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const PLACES_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sa = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(sa));
}

/** Résout le point de départ si pas explicite : géocode startPointText OU centre ville. */
async function resolveStartPoint(input: PipelineInput): Promise<GeocodeResult["startPoint"]> {
  if (input.startPoint) {
    return { ...input.startPoint, source: "input" };
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY missing");

  const query = input.startPointText
    ? `${input.startPointText}, ${input.city}`
    : input.city;
  const url = `${PLACES_GEOCODE}?address=${encodeURIComponent(query)}&key=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json();
  const loc = json?.results?.[0]?.geometry?.location;
  if (!loc) throw new Error(`Cannot geocode start point "${query}" — status: ${json?.status}`);
  return { lat: loc.lat, lon: loc.lng, source: "geocoded" };
}

/** Cherche un landmark via Places Text Search, sans bias GPS. */
export async function geocodeLandmark(
  name: string,
  city: string,
): Promise<Omit<GeocodedLandmark, keyof DiscoveredLandmark | "distanceFromStartM"> | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY missing");

  const query = `${name}, ${city}`;
  const url = `${PLACES_TEXT_SEARCH}?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,geometry,formatted_address,types&key=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json();
  const c = json?.candidates?.[0];
  if (!c?.geometry?.location) return null;
  return {
    lat: c.geometry.location.lat,
    lon: c.geometry.location.lng,
    placeId: c.place_id,
    formattedAddress: c.formatted_address ?? "",
    placeTypes: c.types ?? [],
    googleName: c.name ?? name,
  };
}

/**
 * Orchestrateur de la phase Geocode.
 *
 * Pour chaque landmark découvert :
 *   1. Google Places Text Search "{name}, {city}"
 *   2. Si trouvé → enregistré avec ses VRAIS GPS + place_id
 *   3. Si non trouvé → ajouté à `failed` (Quality Gate décidera)
 *
 * Détermine aussi le point de départ final.
 */
export async function runGeocode(
  input: PipelineInput,
  landmarks: DiscoveredLandmark[],
): Promise<GeocodeResult> {
  const startPoint = await resolveStartPoint(input);

  const geocoded: GeocodedLandmark[] = [];
  const failed: GeocodeResult["failed"] = [];

  for (const lm of landmarks) {
    const result = await geocodeLandmark(lm.name, input.city);
    if (!result) {
      failed.push({ landmark: lm, reason: "Google Places returned no candidate" });
      continue;
    }
    const distance = haversineMeters(startPoint, { lat: result.lat, lon: result.lon });
    geocoded.push({
      ...lm,
      ...result,
      distanceFromStartM: Math.round(distance),
    });
  }

  // Si startPoint a été inféré et qu'on a au moins 1 landmark, on peut
  // optionnellement re-définir le startPoint = first_landmark si plus
  // proche du cluster. Pas critique pour l'instant.
  return { geocoded, failed, startPoint };
}
