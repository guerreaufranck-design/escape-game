/**
 * GEOCODE v4 — Google Places pure géolocalisation, AUCUN filtre.
 *
 * Mandat user 2026-05-25 :
 *   "google geocode n'a pas d'intelligence il est fait pour géolocaliser,
 *    donc il géolocalise tout les landmarks, tous"
 *   "je ne veux pas de filtres"
 *
 * Comportement :
 *   - Pour chaque landmark Perplexity, on cherche dans Google Places
 *   - Si Google trouve : on garde les coords + nom Google
 *   - Si Google ne trouve PAS : pas de coord donc on n'a rien à passer
 *     à la suite — log mais on continue
 *   - PAS de filtre similarity, PAS de filtre radius, PAS de dedup
 *
 * C'est Perplexity (passe 2) qui sélectionnera les meilleurs landmarks
 * géocodés en fonction du scénario.
 */

import type {
  DiscoveredLandmark,
  GeocodeResult,
  GeocodedLandmark,
  PipelineInput,
} from "./types";

const PLACES_TEXT_SEARCH =
  "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(sa));
}

async function geocodeLandmark(
  name: string,
  city: string,
): Promise<{
  lat: number;
  lon: number;
  placeId: string;
  formattedAddress: string;
  placeTypes: string[];
  googleName: string;
} | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY missing");

  const query = `${name}, ${city}`;
  const url = `${PLACES_TEXT_SEARCH}?input=${encodeURIComponent(
    query,
  )}&inputtype=textquery&fields=place_id,name,geometry,formatted_address,types&key=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== "OK" || !json.candidates?.length) return null;
  const c = json.candidates[0];
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

export async function runGeocode(
  input: PipelineInput,
  landmarks: DiscoveredLandmark[],
): Promise<GeocodeResult> {
  if (!input.startPoint) {
    throw new Error("startPoint missing — pipeline requires explicit start point");
  }
  const startPoint = {
    lat: input.startPoint.lat,
    lon: input.startPoint.lon,
    source: "input" as const,
  };

  const geocoded: GeocodedLandmark[] = [];
  const failed: GeocodeResult["failed"] = [];

  console.log(`[geocode] ${landmarks.length} landmarks à géocoder via Google Places (aucun filtre)`);

  for (const lm of landmarks) {
    const result = await geocodeLandmark(lm.name, input.city);
    if (!result) {
      failed.push({ landmark: lm, reason: "Google Places returned no candidate" });
      console.log(`  ✗ "${lm.name}" — pas trouvé par Google`);
      continue;
    }
    const distance = haversineMeters(startPoint, { lat: result.lat, lon: result.lon });
    geocoded.push({
      ...lm,
      ...result,
      distanceFromStartM: Math.round(distance),
    });
    console.log(`  ✓ "${lm.name}" → "${result.googleName}" (${result.lat}, ${result.lon}, ${Math.round(distance)}m)`);
  }

  console.log(`[geocode] ${geocoded.length} géocodés / ${failed.length} non trouvés`);
  return { geocoded, failed, startPoint };
}
