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
 * Vérifie que les tokens DISTINCTIFS du nom demandé apparaissent
 * dans le nom retourné par le geocoder. "Distinctif" = hors stopword
 * et hors nom de ville (qu'on retire des deux côtés pour ne pas
 * valider un match basé uniquement sur "Clervaux" présent partout).
 *
 * Stratégie de seuil (durcie 2026-05-17 post-Zadar) :
 *  - 1 token distinctif       → match obligatoire (100 %)
 *  - 2 tokens distinctifs     → match obligatoire des DEUX
 *    Cas réel Zadar : "Crkva sv. Marije" [crkva, marije] vs
 *    "Crkva sv. Frane" [crkva, frane] — 1/2 match sur "crkva" passait
 *    avec l'ancien seuil "≥ 1 token". Maintenant les 2 doivent matcher,
 *    le faux positif est attrapé.
 *  - 3+ tokens distinctifs    → ≥ 60 % des tokens demandés présents
 *    Tolère les variations de display name de Google (qui peut retourner
 *    "Iglesia del Carmen" pour "Iglesia de Nuestra Señora del Carmen"
 *    — 2/4 = 50% donc rejeté, mais c'est OK : c'est probablement une
 *    chapelle différente du même nom court).
 *
 * Cas d'usage initial conservé : Google Places sur "Pont sur la Clerve,
 * Clervaux" retourne "Abbaye Saint-Maurice, Clervaux" parce que le pont
 * n'est pas un POI nommé chez eux. La ville matche mais aucun des tokens
 * distinctifs ("pont", "clerve") n'apparaît dans la réponse → on rejette.
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
  let matches = 0;
  for (const t of reqTokens) {
    if (retTokens.has(t)) matches++;
  }
  // Pour 1-2 tokens : require ALL match (très strict — un nom court
  // qui ne match qu'à moitié est probablement un POI différent).
  // Pour 3+ tokens : require ≥ 60 % (tolère les abrégés Google).
  const required =
    reqTokens.size <= 2
      ? reqTokens.size
      : Math.ceil(reqTokens.size * 0.6);
  return matches >= required;
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

  /**
   * Audit-log every accepted geocode result. Surface in Vercel runtime
   * logs the `formatted_address` returned by Google + distance from
   * the referencePoint + the resolved provider/confidence. This is the
   * cheapest possible debug aid for the operator : grep the logs of any
   * generation to see "this stop landed at <address>, <dist>m from
   * city centre" and spot the homonyms / hallucinations BEFORE a player
   * arrives there.
   *
   * Added 2026-05-17 post Aegina v1 (3/8 GPS hallucinated, none
   * surfaced in logs at gen time).
   */
  const logResolution = (label: string, r: GeocodeResult) => {
    const dist = refPoint
      ? Math.round(haversineMeters({ lat: r.lat, lon: r.lon }, refPoint))
      : null;
    const distStr = dist !== null ? `${dist}m from refPoint` : "no refPoint";
    console.info(
      `[geocode] ✓ "${landmarkName}" via ${label} → "${r.displayName}" ` +
        `(${r.confidence}, ${distStr})`,
    );
    // SUSPICIOUS signal : the resolved displayName doesn't contain the
    // city we asked for. Possible homonym from another city slipped
    // through the bias. Worth a manual look — not enough to reject
    // (Google sometimes omits the city in formatted_address when it's
    // implied by region).
    if (city) {
      const cityKey = city.toLowerCase().split(/[\s,]+/).find((t) => t.length >= 4);
      if (cityKey && !r.displayName.toLowerCase().includes(cityKey)) {
        console.warn(
          `[geocode] ⚠ SUSPICIOUS: "${landmarkName}" resolved to ` +
            `"${r.displayName}" which does NOT contain expected city ` +
            `token "${cityKey}". Possible cross-city homonym.`,
        );
      }
    }
  };

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

  // Audit log : surface the resolved address + distance from refPoint
  // + provider so generation logs become greppable for GPS hallucinations.
  if (result) {
    logResolution(result.source, result);
  } else {
    console.warn(
      `[geocode] ✗ NO MATCH for "${landmarkName}" in "${city}, ${country}" — all providers exhausted`,
    );
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
/**
 * Types Google Places à REJETER quand on cherche un landmark touristique.
 *
 * Origine du fix (2026-05-19, bug Montpellier stop 3) : Google a renvoyé
 * le `place_id` du "Tunnel de la Comédie" (route 4 voies souterraine)
 * pour la requête "Place de la Comédie". Le tunnel a un meilleur score
 * de pertinence chez Google parce qu'il est nommé de la même façon
 * et le routing API le retourne par défaut.
 *
 * Politique : on filtre TOUT candidat qui contient l'un de ces types,
 * peu importe les autres types qu'il a. Si le seul candidat valide est
 * rejeté, on bascule sur viaGoogleGeocoding puis Nominatim.
 *
 * On NE liste PAS `establishment` ni `point_of_interest` comme requis
 * positifs — ça exclurait des places publiques sans POI dédié, des
 * jardins, des cimetières, etc. qui sont des landmarks valides.
 */
const FORBIDDEN_PLACE_TYPES = new Set([
  // Infrastructures routières — JAMAIS un landmark touristique
  "route",
  "street_address",
  "street_number",
  "intersection",
  "premise",
  "subpremise",
  // Transit — le joueur ne veut pas atterrir dans une station
  "bus_station",
  "subway_station",
  "train_station",
  "transit_station",
  "light_rail_station",
  "airport",
  "taxi_stand",
  // Parkings & service — non touristique
  "parking",
  "gas_station",
  "car_rental",
  "car_repair",
  "car_wash",
  "car_dealer",
  // ATM / divers utilitaires
  "atm",
  "bank",
  "post_office",
  // Tunnels & routes secondaires (Google ne les tag pas tous mais
  // certains apparaissent avec ces types via OSM cross-refs)
  "tunnel",
  "highway",
]);

/**
 * Vérifie qu'un candidat Google Places est un landmark acceptable.
 * Rejette si AU MOINS UN type interdit est présent.
 */
function isAcceptablePlaceType(types: string[] | undefined): boolean {
  if (!types || types.length === 0) return true; // Google a omis → on tolère
  for (const t of types) {
    if (FORBIDDEN_PLACE_TYPES.has(t)) return false;
  }
  return true;
}

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
  // 2026-05-19 — `types` ajouté au fields pour pouvoir filtrer les
  // candidats infrastructurels (route, tunnel, transit, parking…). Sans
  // ce filtre, Google retournait "Tunnel de la Comédie" (route 4 voies
  // souterraine) pour la query "Place de la Comédie, Montpellier".
  url.searchParams.set("fields", "name,geometry,place_id,formatted_address,types");
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
        types?: string[];
      }>;
    };
    if (data.status !== "OK" || !data.candidates?.length) return null;
    // Parcours TOUS les candidats (findplacefromtext peut en renvoyer
    // jusqu'à plusieurs sur des requêtes ambiguës). On garde le PREMIER
    // qui a un type acceptable. Si tous sont rejetés, on retourne null
    // et le fallback viaGoogleGeocoding / Nominatim prend la relève.
    //
    // Bug fix Montpellier 2026-05-19 : Google retournait le tunnel
    // (type=`route`) comme premier candidat pour "Place de la Comédie".
    // Avec ce filtre, le tunnel est rejeté → fallback sur Geocoding API
    // qui retourne la vraie place.
    for (const c of data.candidates) {
      if (!c.geometry?.location) continue;
      if (!isAcceptablePlaceType(c.types)) {
        console.warn(
          `[geocode] Google Places candidate REJECTED for "${landmark}" — types=[${(c.types ?? []).join(",")}] include forbidden infra type. Candidate name="${c.name}". Falling through to next candidate / fallback.`,
        );
        continue;
      }
      return {
        lat: c.geometry.location.lat,
        lon: c.geometry.location.lng,
        displayName: c.formatted_address || c.name,
        source: "google_places",
        confidence: "high",
        externalId: c.place_id,
      };
    }
    return null;
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
        types?: string[];
        geometry: {
          location: { lat: number; lng: number };
          location_type: string;
        };
      }>;
    };
    if (data.status !== "OK" || !data.results?.length) return null;
    // Bug fix Montpellier 2026-05-19 : même filtrage que viaGooglePlaces.
    // Geocoding API peut aussi retourner des infrastructures (route,
    // tunnel, transit) — on rejette et on parcourt jusqu'au premier
    // candidat acceptable.
    for (const r of data.results) {
      if (!isAcceptablePlaceType(r.types)) {
        console.warn(
          `[geocode] Google Geocoding result REJECTED for "${landmark}" — types=[${(r.types ?? []).join(",")}] include forbidden infra type. Result address="${r.formatted_address}". Falling through.`,
        );
        continue;
      }
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
    }
    return null;
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

// ════════════════════════════════════════════════════════════════════
// Multi-strategy robust geocoder (2026-05-21)
// ════════════════════════════════════════════════════════════════════
/**
 * `geocodeLocationRobust` — exhaust N progressive fallback strategies
 * before declaring a landmark "ungeocodable".
 *
 * MOTIVATION (root cause observed 2026-05-21 on roadtrip
 * `l-itineraire-code-de-vinci`, Loire Valley) :
 *
 *   Perplexity proposed "Maison de la Magie Robert-Houdin, Blois"
 *   (a real landmark with sub-10m Google geocode). Pipeline called
 *   `geocodeLocation(name, city="Loire Valley, France", country, ...)`.
 *   But "Loire Valley, France" is a SEO tourist label, not a Google-
 *   indexed administrative entity. Google biased the search around an
 *   ambiguous area, returned a low-confidence result that got rejected
 *   internally → `geocodeLocation` returned null → pipeline fell back
 *   to NARRATIVE_OFFSET mode (startPoint + 350m) → landmark stored
 *   at (47.619, 1.517) — 14 km from the real location.
 *
 * THE FIX is not to weaken `geocodeLocation`'s strictness. It's to
 * RETRY with PROGRESSIVELY MORE PERMISSIVE inputs before giving up.
 * Each strategy peels one layer of input ambiguity:
 *
 *   Strategy 1 (primary)   : (name, city, country, refPoint, maxDist)
 *                            — exact contract from caller, full bias.
 *   Strategy 2             : (name, "", country, refPoint, maxDist)
 *                            — drop the ambiguous city bias. Useful
 *                              when city is a SEO label ("Loire Valley")
 *                              or a multi-commune ("Greater London").
 *   Strategy 3             : (firstTokenOfName, "", country, refPoint,
 *                              maxDist)
 *                            — drop ", city" suffix in the name itself
 *                              ("Maison de la Magie Robert-Houdin, Blois"
 *                              → "Maison de la Magie Robert-Houdin").
 *                              Google handles bare landmark names better
 *                              with a refPoint bias than with a "name +
 *                              wrong-city" hybrid.
 *   Strategy 4             : same name + country, NO refPoint bias,
 *                            but post-filter haversine < maxDist*1.2.
 *                            — last-resort wide search to catch landmarks
 *                              that exist worldwide but happen to be in
 *                              the play zone (e.g. "Pont des Arts" exists
 *                              in many cities, but if there's one in our
 *                              maxDist window it wins).
 *
 * If all 4 fail → return null → caller's existing narrative-fallback
 * behavior kicks in. We don't change the behavioral contract — only the
 * recall.
 *
 * COST : each call to `geocodeLocation` triggers 1 Google Places +
 * potentially 1 Google Geocoding API call (~$0.005 each). Worst case
 * 4 strategies × 2 APIs = $0.04 per UNREACHABLE landmark (and most
 * landmarks resolve on strategy 1 = $0.01). For an 8-stop game with
 * 3 ambiguous candidates : ~$0.12 worst case. Acceptable to avoid
 * silent quality drift.
 *
 * INSTRUMENTATION : each strategy logs which one succeeded. Operators
 * can grep `[geocodeRobust] strategy N succeeded` to spot bias issues
 * (lots of "strategy 2" success = OddballTrip city transform is lossy).
 */
export async function geocodeLocationRobust(
  landmarkName: string,
  city: string,
  country: string,
  options?: GeocodeOptions,
): Promise<{ result: GeocodeResult; strategy: 1 | 2 | 3 | 4 } | null> {
  if (!landmarkName?.trim()) return null;
  const refPoint = options?.referencePoint;
  const maxDist = options?.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;

  // ── Strategy 1: full bias (exact caller contract) ──────────────────
  {
    const r = await geocodeLocation(landmarkName, city, country, options);
    if (r) {
      console.info(
        `[geocodeRobust] strategy 1 (full bias) succeeded for "${landmarkName}"`,
      );
      return { result: r, strategy: 1 };
    }
  }

  // ── Strategy 2: drop city bias ─────────────────────────────────────
  // Most common save when `city` is a SEO label (e.g. "Loire Valley",
  // "Provence", "Costa Brava"). Google handles `name + country` with a
  // refPoint bias better than a name + invented-city hybrid.
  {
    const r = await geocodeLocation(landmarkName, "", country, options);
    if (r) {
      console.info(
        `[geocodeRobust] strategy 2 (no city bias) succeeded for "${landmarkName}" — likely city="${city}" was an ambiguous label`,
      );
      return { result: r, strategy: 2 };
    }
  }

  // ── Strategy 3: drop ", city" suffix from the name ─────────────────
  // Perplexity often appends ", {city}" to landmark names. When the
  // city we're carrying is wrong/ambiguous, the trailing ", city" in
  // the name itself can mislead Google (it treats it as a location
  // constraint, not a disambiguator).
  const nameWithoutCitySuffix = landmarkName.split(",")[0].trim();
  if (nameWithoutCitySuffix && nameWithoutCitySuffix !== landmarkName) {
    const r = await geocodeLocation(
      nameWithoutCitySuffix,
      "",
      country,
      options,
    );
    if (r) {
      console.info(
        `[geocodeRobust] strategy 3 (name truncated to "${nameWithoutCitySuffix}") succeeded`,
      );
      return { result: r, strategy: 3 };
    }
  }

  // ── Strategy 4: last-resort wide search, no refPoint bias ──────────
  // Some Perplexity proposals are real but unindexed near our refPoint
  // (small museums, archaeological sub-sites). Drop the bias entirely
  // and accept any result that haversine-falls within maxDist*1.2.
  if (refPoint) {
    const r = await geocodeLocation(nameWithoutCitySuffix || landmarkName, "", country, {
      maxDistanceM: maxDist * 1.2,
      // no referencePoint — Google can search worldwide
    });
    if (r) {
      const dist = haversineMeters(
        { lat: r.lat, lon: r.lon },
        refPoint,
      );
      if (dist <= maxDist * 1.2) {
        console.info(
          `[geocodeRobust] strategy 4 (no refPoint, post-filter) succeeded at ${Math.round(dist)}m from refPoint`,
        );
        return { result: r, strategy: 4 };
      } else {
        console.warn(
          `[geocodeRobust] strategy 4 returned a result but it's ${Math.round(dist / 1000)} km from refPoint (> ${(maxDist * 1.2) / 1000} km tolerance) — rejected`,
        );
      }
    }
  }

  console.warn(
    `[geocodeRobust] ALL 4 strategies failed for "${landmarkName}" (city="${city}", country="${country}") — caller will fall back to narrative mode if applicable`,
  );
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Cross-geocoder validation (Sprint 2.1, 2026-05-21)
// ════════════════════════════════════════════════════════════════════
/**
 * `crossValidateGeocode` — re-geocode a landmark with a SECONDARY
 * provider (Nominatim / OpenStreetMap) and compare the result with the
 * primary (Google) coords. Returns a divergence breakdown that quality
 * scoring (Sprint 2.2) consumes.
 *
 * MOTIVATION : Google can return a high-confidence-looking result that
 * is actually wrong (e.g. homonym in another city slipped through a
 * weak bias). A single-provider geocode has no way to detect this.
 * Comparing against an independent secondary provider catches the
 * divergence : if Google and Nominatim agree within 100m, we're 99%
 * confident in the coord. If they diverge > 500m, something fishy is
 * going on — flag for review.
 *
 * COST : 0. Nominatim is free (OSM-hosted). We pace at 1 req/s globally
 * to honor their usage policy (already enforced via `paceNominatim`).
 *
 * INTEGRATION : called by the quality scorer in pipeline-validators
 * after game_steps are inserted, OR by the pipeline post-discovery
 * before insertion if we want a hard gate.
 *
 * RETURNS :
 *   - null  : Nominatim has no match → can't validate, no info either way.
 *   - { distanceM, confidence, ... } : we got a Nominatim hit. Caller
 *     decides what threshold = "divergent" (we suggest > 500m).
 */
export interface CrossValidationResult {
  /** Distance in meters between primary (Google) and secondary
   *  (Nominatim) geocodes. 0 = perfect agreement. */
  distanceM: number;
  /** Coordinates Nominatim returned (for logs/debug). */
  secondaryLat: number;
  secondaryLon: number;
  /** Nominatim's `display_name` — useful to detect homonym slipping
   *  through Google (e.g. Google → "Notre-Dame de Paris", Nominatim →
   *  "Notre-Dame du Havre" = obvious different cities). */
  secondaryDisplayName: string;
  /** Nominatim's confidence (`high` for buildings/amenities). */
  secondaryConfidence: "high" | "medium" | "low";
  /** Heuristic categorical assessment of the divergence :
   *  - "agree"     : distance ≤ 100m (high confidence)
   *  - "close"     : 100m < distance ≤ 500m (acceptable, log info)
   *  - "diverge"   : 500m < distance ≤ 2km (warn, flag for review)
   *  - "conflict"  : distance > 2km (severe, possible homonym, recommend block)
   */
  verdict: "agree" | "close" | "diverge" | "conflict";
}

export async function crossValidateGeocode(
  landmarkName: string,
  primaryLat: number,
  primaryLon: number,
  city: string,
  country: string,
  refPoint?: { lat: number; lon: number },
): Promise<CrossValidationResult | null> {
  try {
    const nominatimResult = await viaNominatim(
      landmarkName,
      city,
      country,
      refPoint,
    );
    if (!nominatimResult) {
      // Nominatim didn't find it. No info either way — caller should
      // not treat this as a problem; many landmarks are Google-only
      // (newly opened museums, private estates).
      console.log(
        `[crossValidate] Nominatim has no match for "${landmarkName}" — skipping cross-check (this is OK)`,
      );
      return null;
    }
    const distanceM = haversineMeters(
      { lat: primaryLat, lon: primaryLon },
      { lat: nominatimResult.lat, lon: nominatimResult.lon },
    );
    let verdict: CrossValidationResult["verdict"];
    if (distanceM <= 100) verdict = "agree";
    else if (distanceM <= 500) verdict = "close";
    else if (distanceM <= 2_000) verdict = "diverge";
    else verdict = "conflict";

    if (verdict === "diverge" || verdict === "conflict") {
      console.warn(
        `[crossValidate] ⚠ ${verdict.toUpperCase()} for "${landmarkName}" : Google=(${primaryLat.toFixed(5)},${primaryLon.toFixed(5)}) vs Nominatim=(${nominatimResult.lat.toFixed(5)},${nominatimResult.lon.toFixed(5)}) — distance ${Math.round(distanceM)}m. Nominatim says "${nominatimResult.displayName}"`,
      );
    } else {
      console.log(
        `[crossValidate] ${verdict} for "${landmarkName}" — distance ${Math.round(distanceM)}m`,
      );
    }
    return {
      distanceM,
      secondaryLat: nominatimResult.lat,
      secondaryLon: nominatimResult.lon,
      secondaryDisplayName: nominatimResult.displayName,
      secondaryConfidence: nominatimResult.confidence,
      verdict,
    };
  } catch (err) {
    console.warn(
      `[crossValidate] Nominatim threw for "${landmarkName}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
