/**
 * GEOCODE v3 — Google Places Text Search + 3 filtres durs.
 *
 * Filtres :
 *   1. SIMILARITY ≥ 0.5 entre nom landmark proposé et nom retourné Google
 *      (évite "Pont de la Poulie" → "Rue de la Poulie")
 *   2. DISTANCE ≤ 1.75 km du startPoint (diamètre 3.5 km imposé)
 *      (évite "Tombeau de Godefroy" à 3.4 km)
 *   3. DEDUPLICATION : si 2 résultats à < 50m → rejet du 2e
 *      (évite stops 4+7+1 = même GPS)
 *
 * Anti-bias : on ne passe AUCUN GPS à Google. Juste "{name}, {city}".
 * Si Google ne trouve pas, on rejette.
 */

import type {
  DiscoveredLandmark,
  GeocodeResult,
  GeocodedLandmark,
  PipelineInput,
} from "./types";
import { MAX_DIAMETER_KM } from "./discover";

const PLACES_TEXT_SEARCH =
  "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";

/** Rayon max autour du startPoint (km). */
const MAX_RADIUS_KM = MAX_DIAMETER_KM / 2;

/** Seuil de similarité nom → résultat Google. */
const SIMILARITY_THRESHOLD = 0.5;

/** Distance minimale entre 2 stops (m) — en dessous = doublon. */
const DEDUP_DISTANCE_M = 50;

// ─────────────────────────────────────────────────────────────
// Helpers : Haversine + string similarity
// ─────────────────────────────────────────────────────────────

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

/** Stopwords FR + EN + DE + ES — supprimés avant comparaison. */
const STOPWORDS = new Set([
  "de", "la", "le", "les", "du", "des", "d", "l",
  "of", "the", "a", "an", "and", "et", "in", "on", "to",
  "von", "der", "die", "das",
  "el", "los", "las",
  "saint", "st", "sainte", "ste", "san", "santa",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctiveWords(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Similarité Jaccard sur les mots distinctifs.
 *
 * Cas notables :
 *   - "Pont de la Poulie" vs "Rue de la Poulie" → 0.33 (REJET)
 *   - "Château de Bouillon" vs "Château-fort de Bouillon" → 0.67 (ACCEPT)
 *   - "Château" vs "Château de Bouillon" (substring) → 0.9 (ACCEPT)
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  // Substring containment (one entirely inside the other) = high score
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const wa = distinctiveWords(a);
  const wb = distinctiveWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;

  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = new Set([...wa, ...wb]).size;
  return inter / union;
}

// ─────────────────────────────────────────────────────────────
// Google Places call
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Orchestrateur
// ─────────────────────────────────────────────────────────────

export async function runGeocode(
  input: PipelineInput,
  landmarks: DiscoveredLandmark[],
): Promise<GeocodeResult> {
  if (!input.startPoint) {
    throw new Error("startPoint missing — v3 geocode requires explicit start point");
  }
  const startPoint = {
    lat: input.startPoint.lat,
    lon: input.startPoint.lon,
    source: "input" as const,
  };

  const geocoded: GeocodedLandmark[] = [];
  const failed: GeocodeResult["failed"] = [];

  console.log(
    `[v3 geocode] ${landmarks.length} candidates → 3 filters (similarity ≥${SIMILARITY_THRESHOLD}, radius ≤${MAX_RADIUS_KM}km, dedup ≥${DEDUP_DISTANCE_M}m)`,
  );

  for (const lm of landmarks) {
    const result = await geocodeLandmark(lm.name, input.city);
    if (!result) {
      failed.push({ landmark: lm, reason: "Google Places returned no candidate" });
      console.log(`  ✗ "${lm.name}" — no Google result`);
      continue;
    }

    // FILTRE 1 — similarity
    const sim = nameSimilarity(lm.name, result.googleName);
    if (sim < SIMILARITY_THRESHOLD) {
      failed.push({
        landmark: lm,
        reason: `similarity ${sim.toFixed(2)} < ${SIMILARITY_THRESHOLD} (Google returned "${result.googleName}")`,
      });
      console.log(
        `  ✗ "${lm.name}" — similarity ${sim.toFixed(2)} (Google: "${result.googleName}")`,
      );
      continue;
    }

    // FILTRE 2 — distance from start
    const dist = haversineMeters(startPoint, { lat: result.lat, lon: result.lon });
    if (dist > MAX_RADIUS_KM * 1000) {
      failed.push({
        landmark: lm,
        reason: `distance ${(dist / 1000).toFixed(2)}km > ${MAX_RADIUS_KM}km radius`,
      });
      console.log(`  ✗ "${lm.name}" — ${(dist / 1000).toFixed(2)}km from start (>${MAX_RADIUS_KM}km)`);
      continue;
    }

    // FILTRE 3 — dedup
    const dup = geocoded.find(
      (g) =>
        haversineMeters({ lat: g.lat, lon: g.lon }, { lat: result.lat, lon: result.lon }) <
        DEDUP_DISTANCE_M,
    );
    if (dup) {
      const d = Math.round(
        haversineMeters({ lat: dup.lat, lon: dup.lon }, { lat: result.lat, lon: result.lon }),
      );
      failed.push({ landmark: lm, reason: `duplicate of "${dup.name}" (${d}m apart, < ${DEDUP_DISTANCE_M}m floor)` });
      console.log(`  ✗ "${lm.name}" — duplicate of "${dup.name}" (${d}m)`);
      continue;
    }

    geocoded.push({
      ...lm,
      ...result,
      distanceFromStartM: Math.round(dist),
    });
    console.log(
      `  ✓ "${lm.name}" → ${result.googleName} (sim ${sim.toFixed(2)}, ${Math.round(dist)}m)`,
    );
  }

  console.log(`[v3 geocode] DONE — ${geocoded.length} ok, ${failed.length} rejected`);
  return { geocoded, failed, startPoint };
}
