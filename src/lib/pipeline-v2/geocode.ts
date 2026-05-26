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

/**
 * Géocode le start point textuel envoyé par OddballTrip.
 *
 * Contexte (2026-05-26) : OddballTrip n'a pas d'outils GPS fiables — ils
 * envoyaient soit des coords approximatives (centroïde ville), soit
 * complètement fausses (cf. dump Funbooker 78 drafts : 15-20 starts à
 * 5-40 km du stop 1). Décision : OddballTrip envoie un texte type
 * "Notre Dame de Paris - Paris" et notre pipeline géocode via Google.
 *
 * Le landmark résolu sera ENSUITE :
 *   1. Utilisé comme startPoint pour radius/distance calculations
 *   2. Injecté comme stop 1 forcé dans le pool de select.ts
 *   3. Affiché comme "point de départ" au joueur PWA (cohérent avec stop 1)
 *
 * Retourne `null` si Google ne trouve rien → l'appelant doit halter
 * la pipeline (needs_review) plutôt qu'inventer un GPS.
 */
export async function geocodeStartPoint(
  text: string,
  city: string,
): Promise<{
  lat: number;
  lon: number;
  placeId: string;
  googleName: string;
  formattedAddress: string;
  placeTypes: string[];
} | null> {
  // Cleanup du séparateur OddballTrip "Nom - Ville" — on garde juste le nom
  // pour ne pas dédoubler la ville dans la requête Google.
  const cleanName = text.replace(/\s*[-—–]\s*[^-—–]+$/, "").trim() || text;
  console.log(`[v5 geocode] Resolving start point: "${text}" → "${cleanName}" in ${city}`);
  const r = await geocodeOne(cleanName, city);
  if (!r) {
    console.warn(`[v5 geocode] Start point "${text}" UNRESOLVED by Google Places`);
    return null;
  }
  console.log(
    `[v5 geocode] Start point resolved: "${r.googleName}" @ ${r.lat}, ${r.lon} (placeId=${r.placeId})`,
  );
  return r;
}

export async function runGeocode(
  input: PipelineInput,
  landmarks: DiscoveredLandmark[],
  /**
   * Si fourni, ce landmark sera INJECTÉ comme premier élément du pool
   * (et marqué `[FORCED START]` dans `narrativeTitle`). Si un landmark
   * du même placeId existe déjà dans la liste Perplexity, il est dédupé.
   * Utilisé par build-game-v2 / validate-draft après resolveStartPoint.
   */
  forcedStartLandmark?: {
    lat: number;
    lon: number;
    placeId: string;
    googleName: string;
    formattedAddress: string;
    placeTypes: string[];
  } | null,
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

  // ── Inject forced start landmark (dedupe by placeId) ──
  if (forcedStartLandmark) {
    const existingIdx = geocoded.findIndex((g) => g.placeId === forcedStartLandmark.placeId);
    const distance = haversineMeters(startPoint, {
      lat: forcedStartLandmark.lat,
      lon: forcedStartLandmark.lon,
    });
    const startEntry: GeocodedLandmark = {
      order: 0,
      name: forcedStartLandmark.googleName,
      narrativeTitle: "[FORCED START] Buyer-chosen starting landmark — MUST be stop 1",
      riddle: "",
      answer: "",
      hint: "",
      anecdote: "",
      sources: [],
      lat: forcedStartLandmark.lat,
      lon: forcedStartLandmark.lon,
      placeId: forcedStartLandmark.placeId,
      formattedAddress: forcedStartLandmark.formattedAddress,
      placeTypes: forcedStartLandmark.placeTypes,
      googleName: forcedStartLandmark.googleName,
      distanceFromStartM: Math.round(distance),
    };
    if (existingIdx >= 0) {
      // Le landmark forcé EST déjà dans le pool Perplexity → on le promeut
      // à index 0 et on garde son anecdote/riddle Perplexity (richer).
      console.log(`[v5 geocode] Forced start "${forcedStartLandmark.googleName}" déjà dans le pool Perplexity (idx ${existingIdx}) — promu à idx 0`);
      const [existing] = geocoded.splice(existingIdx, 1);
      geocoded.unshift({
        ...existing,
        narrativeTitle: `[FORCED START] ${existing.narrativeTitle ?? ""}`.trim(),
      });
    } else {
      console.log(`[v5 geocode] Forced start "${forcedStartLandmark.googleName}" injecté à idx 0 (pas dans Perplexity)`);
      geocoded.unshift(startEntry);
    }
  }

  console.log(`[v5 geocode] ${geocoded.length} géocodés (dont ${forcedStartLandmark ? "1 forced start" : "aucun forced"}), ${failed.length} non trouvés`);
  return { geocoded, failed, startPoint };
}
