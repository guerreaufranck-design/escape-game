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
/**
 * Rayon maximum (mètres) au-delà duquel on rejette un résultat
 * géocodé même s'il vient avec confidence high. Utilisé quand un
 * `referencePoint` est fourni — typiquement le centre de la ville
 * du jeu. Sans ce garde-fou, Google Maps peut shifter sur un homonyme
 * célèbre (ex: "Pont Saint-Pierre" à 800 km au lieu de la même rue
 * dans le village du jeu) et le joueur arrive à 100 km du parcours.
 *
 * 2 km est la valeur par défaut : un parcours fait ~4-5 km cumulés
 * à pied, donc tous les stops doivent tenir dans un disque d'≈ 2 km
 * de rayon autour du startPoint. À ~25 min de marche depuis le centre,
 * le stop le plus excentré reste atteignable pour un jeu de 1h30-2h.
 * Au-delà, l'aller-retour explose le budget marche. Si un cas
 * exceptionnel le justifie, le pipeline peut surcharger via maxDistanceM.
 */
const DEFAULT_MAX_DISTANCE_M = 2_000;

/**
 * Rayon préféré (mètres) pour le `locationbias` de Google Places /
 * Geocoding. Aligné sur DEFAULT_MAX_DISTANCE_M : on biaise Google sur
 * le même rayon qu'on accepte en sortie.
 */
const PREFERRED_BIAS_RADIUS_M = 2_000;

/**
 * Stopwords multilingues — articles, prépositions et particules qui
 * n'aident pas à différencier deux landmarks. On les exclut du token-
 * matching pour ne pas valider un faux positif sur "le", "de", "the",
 * etc. quand un homonyme partage juste une particule courante.
 */
const STOPWORDS = new Set([
  // FR
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "au", "aux",
  "sur", "sous", "dans", "vers", "pour", "par", "chez", "avec",
  // EN
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "with", "by", "from",
  // ES
  "el", "los", "las", "y", "o", "en", "para", "con", "por", "del", "al",
  // IT
  "il", "lo", "gli", "ed", "per", "nel", "alla", "dello", "della",
  // DE
  "der", "die", "das", "den", "dem", "ein", "eine", "und", "oder", "für", "mit", "auf", "an",
]);

/**
 * Tokenise un nom pour comparaison sémantique.
 *  - lowercase
 *  - dénormalise les diacritiques (é → e, ü → u)
 *  - supprime ponctuation et tirets
 *  - garde les mots de 3+ caractères, hors stopwords
 */
function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/**
 * Vérifie qu'au moins un token DISTINCTIF du nom demandé apparaît
 * dans le nom retourné par le geocoder. "Distinctif" = hors stopword
 * et hors nom de ville (qu'on retire des deux côtés pour ne pas
 * valider un match basé uniquement sur "Clervaux" présent partout).
 *
 * Cas d'usage : Google Places sur "Pont sur la Clerve, Clervaux"
 * retourne "Abbaye Saint-Maurice, Clervaux" parce que le pont n'est
 * pas un POI nommé chez eux. La ville matche mais aucun des tokens
 * distinctifs ("pont", "clerve") n'apparaît dans la réponse → on
 * rejette pour éviter le faux positif.
 */
function namesMatch(requested: string, returned: string, city: string): boolean {
  const reqTokens = nameTokens(requested);
  const cityTokens = nameTokens(city);
  for (const t of cityTokens) reqTokens.delete(t);
  if (reqTokens.size === 0) {
    // Le nom demandé n'a pas de token distinctif au-delà de la ville
    // (ex: "Clervaux" tout seul) — on ne peut rien valider, on accepte.
    return true;
  }
  const retTokens = nameTokens(returned);
  for (const t of reqTokens) {
    if (retTokens.has(t)) return true;
  }
  return false;
}

export interface GeocodeOptions {
  /**
   * Point de référence (typiquement le centre de la ville du jeu).
   * Quand fourni :
   *  - injecté en `locationbias` côté Google Places + Geocoding
   *  - injecté en `viewbox` + `bounded=1` côté Nominatim (filtrage strict)
   *  - validation haversine post-résultat : tout résultat à > maxDistanceM
   *    du referencePoint est rejeté (= traité comme miss, fallback enclenché).
   *
   * Si NON fourni : comportement legacy (pas de bias, pas de validation
   * de distance). Compat ascendante pour les anciens callers.
   */
  referencePoint?: { lat: number; lon: number };
  /** Rayon max accepté en mètres (défaut DEFAULT_MAX_DISTANCE_M = 1,5 km). */
  maxDistanceM?: number;
}

export async function geocodeLocation(
  landmarkName: string,
  city: string,
  country: string,
  options?: GeocodeOptions,
): Promise<GeocodeResult | null> {
  if (!landmarkName?.trim()) return null;
  const refKey = options?.referencePoint
    ? `@${options.referencePoint.lat.toFixed(3)},${options.referencePoint.lon.toFixed(3)}`
    : '';
  const cacheKey = `${landmarkName}|${city}|${country}${refKey}`.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }
  const refPoint = options?.referencePoint;
  const maxDistance = options?.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;

  let result: GeocodeResult | null = null;

  // Primary: Google when a key is present. Places "findplacefromtext"
  // targets named landmarks and is consistently sub-10 m on famous
  // locations; Geocoding is the fallback when Places returns nothing
  // (street addresses, plazas without their own POI). We tolerate
  // confidence "high" or "medium" — APPROXIMATE / "low" results are
  // worse than 100 m off and would defeat the purpose of GPS-first;
  // we drop down to Nominatim instead and keep its result if better.
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      result = await viaGooglePlaces(landmarkName, city, country, refPoint);
    } catch (err) {
      console.warn(
        `[geocode] Google Places threw for "${landmarkName}":`,
        err instanceof Error ? err.message : err,
      );
    }
    // Validations en cascade :
    // (1) hors du rayon ? — homonyme à 800 km
    // (2) nom du résultat divergent du nom demandé ? — Google a
    //     fallback sur le POI le plus célèbre quand le nom demandé
    //     n'existe pas chez eux (ex: "Pont sur la Clerve, Clervaux"
    //     → renvoie "Abbaye Saint-Maurice, Clervaux" parce que le
    //     pont n'est pas catalogué). On le détecte par token-overlap.
    if (result && refPoint && isOutOfRange(result, refPoint, maxDistance, landmarkName)) {
      result = null;
    }
    if (result && !namesMatch(landmarkName, result.displayName, city)) {
      console.warn(
        `[geocode] Name mismatch (Google Places) for "${landmarkName}" — got "${result.displayName}". Treating as miss.`,
      );
      result = null;
    }
    if (!result) {
      try {
        result = await viaGoogleGeocoding(landmarkName, city, country, refPoint);
      } catch (err) {
        console.warn(
          `[geocode] Google Geocoding threw for "${landmarkName}":`,
          err instanceof Error ? err.message : err,
        );
      }
      if (result && refPoint && isOutOfRange(result, refPoint, maxDistance, landmarkName)) {
        result = null;
      }
      if (result && !namesMatch(landmarkName, result.displayName, city)) {
        console.warn(
          `[geocode] Name mismatch (Google Geocoding) for "${landmarkName}" — got "${result.displayName}". Treating as miss.`,
        );
        result = null;
      }
    }
    // Reject Google "low" confidence (APPROXIMATE) — it's neighbourhood-
    // level at best and would put the player 100+ m from the real
    // landmark. Force a Nominatim attempt; if Nominatim does better
    // we keep that, otherwise we fall through to "result stays low"
    // and the caller will reject the stop.
    if (result && result.confidence === "low") {
      console.warn(
        `[geocode] Google returned low confidence for "${landmarkName}", trying Nominatim`,
      );
      try {
        const osm = await viaNominatim(landmarkName, city, country, refPoint);
        if (osm && osm.confidence !== "low") {
          if (refPoint && isOutOfRange(osm, refPoint, maxDistance, landmarkName)) {
            // Nominatim aussi a dérapé → on garde le low de Google,
            // le caller traitera comme miss.
          } else {
            result = osm;
          }
        }
      } catch { /* keep low-confidence Google result */ }
    }
  }

  // Fallback: Nominatim. Free, no key, polite rate-limit applies.
  if (!result) {
    try {
      result = await viaNominatim(landmarkName, city, country, refPoint);
    } catch (err) {
      console.warn(
        `[geocode] Nominatim threw for "${landmarkName}":`,
        err instanceof Error ? err.message : err,
      );
    }
    if (result && refPoint && isOutOfRange(result, refPoint, maxDistance, landmarkName)) {
      result = null;
    }
    if (result && !namesMatch(landmarkName, result.displayName, city)) {
      console.warn(
        `[geocode] Name mismatch (Nominatim) for "${landmarkName}" — got "${result.displayName}". Treating as miss.`,
      );
      result = null;
    }
  }

  // Final guard: a "low" confidence result (whatever the source) is
  // worse than a clean rejection — the pipeline downstream will fail
  // loud and the operator will fix the landmarkName. Better that than
  // shipping a 200 m drift to a paying customer.
  if (result && result.confidence === "low") {
    console.warn(
      `[geocode] All providers returned low confidence for "${landmarkName}" — treating as miss`,
    );
    result = null;
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

/**
 * Construit une query géocodage propre, sans dupliquer la ville si
 * elle est déjà dans `landmark`.
 *
 * Cas typique : Perplexity retourne des landmarks au format
 * "Église Saint-Maclou, Rouen" (ville déjà incluse). Si on concatène
 * naïvement city + country, on obtient
 *   "Église Saint-Maclou, Rouen, Old Rouen, France, France"
 * — purée illisible où Google Places se perd, fallback sur un
 * landmark différent ou retourne rien. Le namesMatch en aval rejette,
 * et le candidat est marqué "non trouvé" alors qu'il existe.
 *
 * Stratégie : on extrait les TOKENS distinctifs de la ville (proper
 * nouns de longueur ≥ 4, hors stopwords) et on regarde si AU MOINS UN
 * apparaît dans le landmark. Ça détecte tous les cas de duplication
 * même quand la ville opérateur est qualifiée ("Old Rouen", "Vieux
 * Lyon", "Centro Storico Roma") alors que le landmark n'a que la
 * forme courte ("...Rouen", "...Lyon", "...Roma"). Le pays est
 * toujours ajouté pour disambiguer le pays côté Google.
 */
function buildGeocodeQuery(landmark: string, city: string, country: string): string {
  if (!city) return country ? `${landmark}, ${country}` : landmark;

  const landmarkLower = landmark.toLowerCase();
  // Tokens distinctifs de la ville : ≥ 4 chars, hors stopwords/qualifiants.
  // 4+ chars élimine les particules ("le", "de", "old", "new") et garde
  // les noms propres ("Rouen", "Lyon", "Paris", "Storico", "Centro").
  const cityTokens = nameTokens(city);
  const distinctiveCityTokens = [...cityTokens].filter((t) => t.length >= 4);

  // Si UN token distinctif est déjà dans le landmark → on skip city.
  for (const t of distinctiveCityTokens) {
    if (landmarkLower.includes(t)) {
      return country ? `${landmark}, ${country}` : landmark;
    }
  }

  return `${landmark}, ${city}, ${country}`;
}

async function viaGooglePlaces(
  landmark: string,
  city: string,
  country: string,
  refPoint?: { lat: number; lon: number },
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  const query = buildGeocodeQuery(landmark, city, country);
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
  );
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "name,geometry,place_id,formatted_address");
  url.searchParams.set("key", apiKey);
  // Anti-homonyme : pousse Google vers la zone du jeu. Format Places
  // API : `circle:RADIUS@LAT,LNG`. Si le landmark a un homonyme célèbre
  // (Pont Saint-Pierre Paris vs village), Google priorise celui dans
  // le rayon du bias. Le filtre haversine en aval rattrape les rares
  // qui passent quand même (l'API de bias n'est pas une exclusion stricte).
  if (refPoint) {
    url.searchParams.set(
      "locationbias",
      `circle:${PREFERRED_BIAS_RADIUS_M}@${refPoint.lat},${refPoint.lon}`,
    );
  }

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
  refPoint?: { lat: number; lon: number },
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", buildGeocodeQuery(landmark, city, country));
  url.searchParams.set("key", apiKey);
  // Anti-homonyme : `bounds` est un viewport préféré (south,west|north,east).
  // Geocoding API n'a pas de cercle, donc on calcule un carré ~ équivalent
  // au rayon souhaité (1° lat ≈ 111 km, 1° lon ≈ 111 km × cos(lat)).
  if (refPoint) {
    const dLat = PREFERRED_BIAS_RADIUS_M / 111_000;
    const dLon = PREFERRED_BIAS_RADIUS_M / (111_000 * Math.cos((refPoint.lat * Math.PI) / 180));
    const south = (refPoint.lat - dLat).toFixed(6);
    const north = (refPoint.lat + dLat).toFixed(6);
    const west = (refPoint.lon - dLon).toFixed(6);
    const east = (refPoint.lon + dLon).toFixed(6);
    url.searchParams.set("bounds", `${south},${west}|${north},${east}`);
  }

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
  refPoint?: { lat: number; lon: number },
): Promise<GeocodeResult | null> {
  await paceNominatim();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", buildGeocodeQuery(landmark, city, country));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  // Anti-homonyme : viewbox + bounded=1 = filtre STRICT. Tout résultat
  // hors de la box est exclu directement par Nominatim (contrairement
  // à Google où locationbias est juste une préférence). Format Nominatim :
  // `viewbox=west,north,east,south` (pas la convention south,west|north,east
  // de Google — attention au piège).
  if (refPoint) {
    const dLat = PREFERRED_BIAS_RADIUS_M / 111_000;
    const dLon = PREFERRED_BIAS_RADIUS_M / (111_000 * Math.cos((refPoint.lat * Math.PI) / 180));
    const south = (refPoint.lat - dLat).toFixed(6);
    const north = (refPoint.lat + dLat).toFixed(6);
    const west = (refPoint.lon - dLon).toFixed(6);
    const east = (refPoint.lon + dLon).toFixed(6);
    url.searchParams.set("viewbox", `${west},${north},${east},${south}`);
    url.searchParams.set("bounded", "1");
  }

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
 * Vérifie si un résultat géocodé est hors du rayon accepté autour
 * du point de référence. Utilisé pour rattraper les rares cas où
 * Google Places renvoie un homonyme à l'autre bout de la planète
 * malgré le `locationbias` (qui n'est qu'une préférence). Log
 * explicite pour permettre l'audit après coup.
 */
function isOutOfRange(
  result: GeocodeResult,
  refPoint: { lat: number; lon: number },
  maxDistanceM: number,
  landmarkName: string,
): boolean {
  const distance = haversineMeters({ lat: result.lat, lon: result.lon }, refPoint);
  if (distance > maxDistanceM) {
    console.warn(
      `[geocode] "${landmarkName}" rejeté : ${Math.round(distance / 1000)} km du centre ville (max ${Math.round(maxDistanceM / 1000)} km). Probable homonyme parasité — fallback enclenché.`,
    );
    return true;
  }
  return false;
}


/**
 * Candidat issu de Google Places nearbysearch — un POI réel,
 * géocodé sub-10m, dans la zone du parcours. C'est la SOURCE DE
 * VÉRITÉ pour la liste des landmarks possibles : tous les éléments
 * sont garantis géocodables (puisqu'ils viennent de Google), donc
 * la pipeline ne peut JAMAIS rater leur position.
 */
export interface NearbyCandidate {
  /** Nom Google ("Cathédrale Notre-Dame de Rouen"). */
  name: string;
  /** Coords sub-10m. */
  lat: number;
  lon: number;
  /** place_id Google — pour dédup et fetch détails. */
  placeId: string;
  /** Types Google (`tourist_attraction`, `church`, `museum`…) — info
   *  de fond utilisée par Claude pour juger la pertinence thématique. */
  types: string[];
  /** Adresse formatée si Google la fournit ("Rue Saint-Romain, Rouen"). */
  address?: string;
  /** Note Google (1-5) si dispo, signal de notoriété/qualité. */
  rating?: number;
  /** Nombre de reviews — autre signal de notoriété. */
  userRatingsTotal?: number;
  /** Distance au point de référence en mètres. */
  distanceM: number;
}

/**
 * Types Google Places considérés comme PAYANTS par défaut. La pipeline
 * filtre cette liste quand `accessibility: "free"` est demandé : les
 * musées, galeries d'art et monuments ticketés sont EXCLUS du Google
 * nearbysearch — ainsi Claude ne les pickera jamais comme stops.
 *
 * Note: c'est une heuristique, pas une vérité absolue. Certains musées
 * sont gratuits (ex. Louvre le 1er dimanche du mois, beaucoup de petits
 * musées municipaux). Mais 90%+ sont payants → mieux vaut sur-filtrer
 * et laisser Claude piocher des stops 100% en plein air. Les sites
 * exclus seront utilisés en upsell GYG cross-sell post-jeu.
 */
export const PAID_PLACE_TYPES: readonly string[] = ["museum", "art_gallery"];

/**
 * Types Google Places considérés comme GRATUITS / accessibles depuis
 * la voie publique. Liste utilisée quand `accessibility: "free"` :
 * églises, places, parcs, mairies, bibliothèques (souvent ouvertes
 * sans ticket), tourist_attractions (souvent monuments extérieurs).
 */
export const FREE_PLACE_TYPES: readonly string[] = [
  "tourist_attraction",
  "church",
  "library",
  "city_hall",
  "park",
  "place_of_worship",
  "synagogue",
  "mosque",
  "hindu_temple",
];

/**
 * Découvre TOUS les POIs patrimoniaux/touristiques dans un rayon
 * autour d'un point. C'est la PHASE 1 du flow GPS-first : on récolte
 * la liste exhaustive des landmarks RÉELS de la zone, puis on
 * laisse Claude choisir les 8 qui collent le mieux au thème.
 *
 * Avantage majeur sur l'ancien flow Perplexity-first : tous les
 * candidats sont GARANTIS géocodables (sub-10m, place_id Google),
 * donc impossible de rater une étape pour cause de "nom obscur".
 * On peut TOUJOURS publier 8 stops dans une zone urbaine normale
 * (Rouen retourne typiquement 30-50 candidats dans 2 km).
 *
 * Multi-types parce que Google nearbysearch n'accepte qu'UN seul
 * `type` par appel. On fait un appel par type, on fusionne +
 * dédup par place_id. Types choisis pour pertinence escape game :
 * monuments visibles depuis la rue, pas restaurants/cafés/stores
 * qui sont trop nombreux et peu narrativement utiles.
 */
export async function discoverNearbyLandmarks(
  refPoint: { lat: number; lon: number },
  options: {
    /** Rayon en mètres. Défaut 2 km. */
    radiusM?: number;
    /** Limite de candidats à retourner (après dédup). Défaut 50. */
    limit?: number;
    /** Types Google à inclure. Défaut : un mix tourisme + patrimoine. */
    types?: string[];
  } = {},
): Promise<NearbyCandidate[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[discoverNearbyLandmarks] GOOGLE_MAPS_API_KEY missing");
    return [];
  }

  const radiusM = options.radiusM ?? 2_000;
  const limit = options.limit ?? 50;
  // Mix de types qui maximise la couverture sans bruit. On exclut
  // restaurant/cafe/store/lodging (peu narrativement utiles).
  const types = options.types ?? [
    "tourist_attraction",
    "museum",
    "church",
    "art_gallery",
    "library",
    "city_hall",
    "park",
    "place_of_worship",
    "synagogue",
    "mosque",
    "hindu_temple",
  ];

  const seen = new Map<string, NearbyCandidate>();

  for (const type of types) {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    );
    url.searchParams.set("location", `${refPoint.lat},${refPoint.lon}`);
    url.searchParams.set("radius", String(radiusM));
    url.searchParams.set("type", type);
    url.searchParams.set("key", apiKey);

    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url.toString(), { signal: ac.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status: string;
        results?: Array<{
          name: string;
          place_id: string;
          types?: string[];
          rating?: number;
          user_ratings_total?: number;
          vicinity?: string;
          geometry?: { location: { lat: number; lng: number } };
        }>;
        error_message?: string;
      };
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        console.warn(
          `[discoverNearbyLandmarks] type=${type} status=${data.status}: ${data.error_message ?? ""}`,
        );
        continue;
      }
      for (const r of data.results ?? []) {
        if (!r.place_id || !r.geometry?.location) continue;
        if (seen.has(r.place_id)) continue;
        const lat = r.geometry.location.lat;
        const lon = r.geometry.location.lng;
        const distanceM = haversineMeters({ lat, lon }, refPoint);
        if (distanceM > radiusM) continue;
        seen.set(r.place_id, {
          name: r.name,
          lat,
          lon,
          placeId: r.place_id,
          types: r.types ?? [type],
          address: r.vicinity,
          rating: r.rating,
          userRatingsTotal: r.user_ratings_total,
          distanceM,
        });
      }
    } catch (err) {
      console.warn(
        `[discoverNearbyLandmarks] type=${type} threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Tri par distance croissante, cap au limit
  const ranked = [...seen.values()].sort((a, b) => a.distanceM - b.distanceM);
  return ranked.slice(0, limit);
}

/**
 * Compte rapide des POIs touristiques/patrimoniaux dans un rayon
 * autour d'un point. Sert à valider la viabilité d'une zone AVANT
 * qu'oddballtrip publie une fiche produit : si 1.5 km autour du
 * startPoint contient < 8 monuments, le jeu n'a aucune chance de
 * publier — autant prévenir l'opérateur tout de suite.
 *
 * Utilise Google Places nearbysearch (un appel par type, fusion +
 * dédup côté client). Ne retourne pas les détails — juste un total.
 */
export async function countNearbyMonuments(
  refPoint: { lat: number; lon: number },
  radiusM: number,
): Promise<{ total: number; byType: Record<string, number> }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[countNearbyMonuments] GOOGLE_MAPS_API_KEY missing");
    return { total: 0, byType: {} };
  }

  // Types Google qui correspondent aux landmarks "jouables" pour un
  // escape game outdoor. On exclut restaurant/cafe/store/lodging
  // (trop nombreux, peu narrativement utiles).
  const types = [
    "tourist_attraction",
    "church",
    "museum",
    "art_gallery",
    "library",
    "city_hall",
    "park",
  ];

  const seen = new Set<string>();
  const byType: Record<string, number> = {};

  for (const type of types) {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    );
    url.searchParams.set("location", `${refPoint.lat},${refPoint.lon}`);
    url.searchParams.set("radius", String(radiusM));
    url.searchParams.set("type", type);
    url.searchParams.set("key", apiKey);

    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url.toString(), { signal: ac.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status: string;
        results?: Array<{ place_id: string }>;
      };
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") continue;

      const before = seen.size;
      for (const r of data.results ?? []) {
        if (r.place_id) seen.add(r.place_id);
      }
      byType[type] = seen.size - before;
    } catch (err) {
      console.warn(
        `[countNearbyMonuments] type=${type} threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { total: seen.size, byType };
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
