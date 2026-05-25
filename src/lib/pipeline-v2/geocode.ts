/**
 * GEOCODE v5 — Google Places pur, ZÉRO filtre.
 *
 * Mandat user :
 *   "google geocode n'a pas d'intelligence il est fait pour géolocaliser,
 *    donc il géolocalise tout les landmarks, tous"
 *   "je ne veux pas de filtres"
 *
 * Pour chaque landmark Perplexity, on demande à Google ses coords. On
 * garde ce qu'on a. Si Google ne trouve pas → on log et on saute. Pas
 * de filtre de similarité, de distance, ni de dedup côté code.
 *
 * Claude (étape suivante) sélectionnera en sachant tout du pool.
 */

import type {
  DiscoveredLandmark,
  GeocodeResult,
  GeocodedLandmark,
  PipelineInput,
} from "./types";

const PLACES_TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 *
      Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(sa));
}

async function geocodeOne(name: string, city: string): Promise<{
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
  const startPoint = {
    lat: input.startPoint.lat,
    lon: input.startPoint.lon,
    source: "input" as const,
  };

  const geocoded: GeocodedLandmark[] = [];
  const failed: GeocodeResult["failed"] = [];

  console.log(`[v5 geocode] ${landmarks.length} landmarks à géocoder (zéro filtre, on garde tout ce que Google trouve)`);

  for (const lm of landmarks) {
    const r = await geocodeOne(lm.name, input.city);
    if (!r) {
      failed.push({ landmark: lm, reason: "Google Places returned no candidate" });
      console.log(`  ✗ "${lm.name}" — Google n'a rien trouvé`);
      continue;
    }
    const distance = haversineMeters(startPoint, { lat: r.lat, lon: r.lon });
    geocoded.push({
      ...lm,
      ...r,
      distanceFromStartM: Math.round(distance),
    });
    console.log(`  ✓ "${lm.name}" → "${r.googleName}" (${r.lat}, ${r.lon}, ${Math.round(distance)}m)`);
  }

  console.log(`[v5 geocode] ${geocoded.length} géocodés, ${failed.length} non trouvés`);
  return { geocoded, failed, startPoint };
}
