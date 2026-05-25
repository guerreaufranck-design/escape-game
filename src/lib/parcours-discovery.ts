/**
 * Découverte canonique d'un parcours d'escape game.
 *
 * Architecture GOOGLE-FIRST + CURATION CLAUDE :
 *   1. Google Places nearbysearch retourne TOUS les POIs réels
 *      (tourist_attraction, museum, church, monument, park, etc.)
 *      dans 2 km autour du startPoint. Typiquement 30-100 candidats
 *      pour une zone urbaine, tous géocodés sub-10m.
 *   2. Claude reçoit la liste complète + le thème, et SÉLECTIONNE
 *      les `stopCount` qui collent le mieux au thème ET forment un
 *      parcours marchable cohérent.
 *   3. NN reorder depuis startPoint.
 *   4. Walkability filter (1 km max inter-stop).
 *
 * Pourquoi cette architecture (vs ancienne Perplexity-first) :
 *   ❌ Perplexity-first : Perplexity invente des noms ("Grosseteste
 *      Tower"), certains hallucinés, certains formatés bizarrement,
 *      certains obscurs. On essaie de géocoder en aval, on perd
 *      30-50 % au passage. Résultat : 6/8 ou 4/8 stops, échecs
 *      récurrents.
 *   ✅ Google-first : la liste de départ EST déjà géocodée, donc
 *      Claude choisit parmi des éléments tous valides. Garantie de
 *      `stopCount` stops à chaque génération si Google a au moins
 *      `stopCount` POIs dans la zone (cas standard).
 *
 * Backup Perplexity (optionnel, pour sub-POIs archéo) :
 *   Si Google retourne < stopCount candidats (rare, sites isolés
 *   type Éphèse), on enrichit avec Perplexity pour trouver des
 *   sub-monuments connus mais non-indexés Google. Ces stops passent
 *   en mode "narratif" : GPS approximatif (centre du site parent),
 *   navigation par texte ("trouve la Bibliothèque de Celsus").
 *
 * Contrat de qualité :
 *   - Tous les landmarks sont des POIs RÉELS issus de Google.
 *   - Tous sont à ≤ 2 km du startPoint.
 *   - Aucun saut > 1 km entre stops consécutifs après NN reorder.
 */

import {
  discoverThematicLandmarks,
  deepResearchTheme,
  type VerifiedThemeContext,
} from "./perplexity";
import { pickThematicLandmarksFromList } from "./anthropic";
import {
  discoverNearbyLandmarks,
  geocodeLocation,
  geocodeLocationRobust,
  haversineMeters,
  FREE_PLACE_TYPES,
  type NearbyCandidate,
} from "./geocode";
import {
  selectStopsByGeometry,
  computeAdaptiveMinDist,
} from "./parcours-selection";
import { discoverThematicPois, discoverPatrimonialFill } from "./ai-discovery";
import { validateThematicPois } from "./poi-validation";
import { proposeThematicLandmarks } from "./pipeline-landmark-proposer";

/**
 * Diamètre maximum (mètres) de la "boîte" géographique qui englobe le
 * point de départ + tous les stops. C'est la contrainte définie avec
 * le client le 2026-05-15 (post-incident Julien) :
 *   - on raisonne en DIAMÈTRE pairwise et pas en rayon-depuis-startPoint
 *   - 3.5 km de diamètre = zone walkable cohérente même quand le
 *     startPoint est en périphérie de la zone historique
 *
 * Appliqué uniquement en walking. En roadtrip on garde l'ancien rayon
 * adaptatif (jusqu'à 60 km).
 */
const DIAMETER_CAP_M = 3_500;

/**
 * Pour un roadtrip, enrichit chaque seedSite avec lat/lon si elles ne
 * sont pas déjà fournies. Géocode le nom via Google Geocoding API (~$0.005
 * par site, négligeable). Les sites qui ne se géocodent pas sont SKIPPED
 * (Claude curation continue sans eux).
 *
 * Pourquoi : OddballTrip envoie typiquement `{ name, access }` sans coords.
 * Sans coords, on ne peut pas faire de nearbysearch additionnel autour
 * du seedSite → on reste cantonné autour du startPoint, ce qui défait
 * tout l'intérêt du roadtrip (cas Girona du 11/05 : 5 stops centre-ville
 * uniquement, aucun Costa Brava). Avec coords, on peut élargir la
 * couverture Google Places sur les zones thématiquement importantes.
 */
async function enrichSeedSitesWithCoords(
  seedSites: Array<{
    name: string;
    access: "libre" | "payant" | "mixte";
    lat?: number;
    lon?: number;
    note?: string;
  }>,
  city: string,
  country: string,
  refPoint: { lat: number; lon: number },
  maxDistanceM: number,
): Promise<Array<{
  name: string;
  access: "libre" | "payant" | "mixte";
  lat: number;
  lon: number;
  note?: string;
  source: "provided" | "geocoded";
}>> {
  const enriched: Array<{
    name: string;
    access: "libre" | "payant" | "mixte";
    lat: number;
    lon: number;
    note?: string;
    source: "provided" | "geocoded";
  }> = [];

  // Parallel geocoding pour pas séquentialiser 7-10 appels Google
  const tasks = seedSites.map(async (seed) => {
    // Path 1: coords déjà fournies par OddballTrip → on les utilise direct
    if (typeof seed.lat === "number" && typeof seed.lon === "number") {
      return {
        name: seed.name,
        access: seed.access,
        lat: seed.lat,
        lon: seed.lon,
        note: seed.note,
        source: "provided" as const,
      };
    }
    // Path 2: pas de coords → géocodage à la volée. La fonction utilise
    // refPoint pour rejeter les hits qui s'éloignent trop (anti-faux-positif
    // sur des noms ambigus type "Cathédrale" qui géocoderaient à Paris au
    // lieu de la ville régionale).
    const geo = await geocodeLocation(seed.name, city, country, {
      referencePoint: refPoint,
      maxDistanceM,
    });
    if (geo) {
      return {
        name: seed.name,
        access: seed.access,
        lat: geo.lat,
        lon: geo.lon,
        note: seed.note,
        source: "geocoded" as const,
      };
    }
    return null;
  });

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) enriched.push(r.value);
  }
  return enriched;
}

/**
 * (Sprint A, 2026-05-22) Pool enrichment via Perplexity-sourced iconic sites.
 *
 * For each historically-iconic site Perplexity Deep Research identified
 * for the theme (Cathédrale Saint-Nazaire for a Cathar-massacre theme,
 * Tour Carbonnière for a Huguenot prison theme, etc.), do a TARGETED
 * Google Places findPlaceFromText lookup to retrieve its place_id +
 * GPS + types, and return as `NearbyCandidate[]` ready to merge into
 * the discovery pool.
 *
 * Why this exists : Google Places nearbysearch ranks candidates by
 * rating × distance, so for THEMED historic games the actual heritage
 * sites that ARE the theme are OFTEN missing from the top 60 (modern
 * restaurants, city halls, contemporary art galleries surface instead
 * because they have more Google reviews). The Béziers Cathar test
 * 22/05/2026 hit exactly this : 0 of the canonical Cathar massacre
 * sites (Cathédrale Saint-Nazaire, Église Madeleine) were in the pool
 * → auto-repair via reshuffle couldn't rescue, escalation forced.
 *
 * This function plugs the gap : Perplexity already KNOWS the iconic
 * sites for a given theme. We just need to convert them to first-class
 * pool candidates with the same trust contract (Google place_id +
 * sub-10m GPS).
 *
 * Distance tolerance : the Perplexity-named sites are CANONICAL, so we
 * accept up to 2× the discovery radius. A 3 km cathédrale on a 1.5 km
 * walking parcours is still walkable for a F1-grade theme experience.
 *
 * Anti-hallucination preserved : every enrichment result must come back
 * from Google Places API with a real place_id + types. Failed lookups
 * (no candidate, network error, ambiguous name) are silently skipped —
 * never fabricated.
 */
async function enrichPoolWithPerplexityIconicSites(
  iconicSites: VerifiedThemeContext["iconicSites"],
  city: string,
  country: string,
  startPoint: { lat: number; lon: number },
  maxDistanceM: number,
  existingPlaceIds: Set<string>,
): Promise<NearbyCandidate[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || iconicSites.length === 0) return [];

  const tasks = iconicSites.map(async (site): Promise<NearbyCandidate | null> => {
    try {
      const query = `${site.name}, ${city}, ${country}`;
      const url = new URL(
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
      );
      url.searchParams.set("input", query);
      url.searchParams.set("inputtype", "textquery");
      url.searchParams.set(
        "fields",
        "name,geometry,place_id,formatted_address,types,rating,user_ratings_total",
      );
      url.searchParams.set("key", apiKey);
      url.searchParams.set(
        "locationbias",
        `circle:${Math.round(maxDistanceM)}@${startPoint.lat},${startPoint.lon}`,
      );
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
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
            rating?: number;
            user_ratings_total?: number;
          }>;
        };
        if (data.status !== "OK" || !data.candidates?.length) return null;
        const c = data.candidates[0];
        if (!c.place_id || !c.geometry?.location) return null;
        if (existingPlaceIds.has(c.place_id)) return null; // already in pool
        const distanceM = haversineMeters(
          { lat: c.geometry.location.lat, lon: c.geometry.location.lng },
          startPoint,
        );
        if (distanceM > maxDistanceM) return null;
        return {
          name: c.name,
          lat: c.geometry.location.lat,
          lon: c.geometry.location.lng,
          placeId: c.place_id,
          types: c.types ?? [],
          address: c.formatted_address,
          rating: c.rating,
          userRatingsTotal: c.user_ratings_total,
          distanceM,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn(
        `[enrichPool] failed for "${site.name}": ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  });

  const results = await Promise.allSettled(tasks);
  const enriched: NearbyCandidate[] = [];
  // Mutate caller's existingPlaceIds set so duplicates within the
  // enrichment batch itself don't sneak through (rare but possible).
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      if (!existingPlaceIds.has(r.value.placeId)) {
        existingPlaceIds.add(r.value.placeId);
        enriched.push(r.value);
      }
    }
  }
  return enriched;
}

/**
 * Rayon de recherche autour du startPoint, ADAPTATIF au stopCount.
 *
 * Logique : on vend une DURÉE (~90 min), pas un nombre de stops fixe.
 * Quand stopCount baisse, on doit étendre le rayon pour que la marche
 * cumulée reste équivalente — sinon un jeu de 4 stops dans 2 km tient
 * en 30 min et ne respecte pas le pitch "tour de ville en jouant".
 *
 *   stopCount = 8 → 2 km   (current, ~750m moyen entre stops)
 *   stopCount = 7 → 2.2 km
 *   stopCount = 6 → 2.5 km
 *   stopCount = 5 → 2.8 km
 *   stopCount = 4 → 3.2 km
 *   stopCount ≤ 3 → 3.5 km (extreme spread, tour large d'une ville)
 */
function radiusForStopCount(stopCount: number): number {
  // 2026-05-13 — bump radius walking pour viser une expérience demi-journée
  // (~1h30-2h30 de jeu cumulé) au lieu d'une simple promenade 90 min.
  // Logique : humain marche 6 km/h. Avec radius=2.5km et 9 stops, le joueur
  // fait ~5-7 km de marche cumulée + 27 min cumulé AR (3 min × 9 stops) =
  // 1h30 à 2h30 d'expérience. Sweet spot pour une fiche premium.
  if (stopCount >= 9) return 2_500; // 9 stops étalés sur 5 km diamètre
  if (stopCount === 8) return 2_700;
  if (stopCount === 7) return 2_900;
  if (stopCount === 6) return 3_100;
  return 3_400; // ≤5 (ne devrait plus arriver — clamp à 6 minimum upstream)
}

/**
 * Distance MAX entre deux stops consécutifs, ADAPTATIVE au stopCount.
 * Même logique que le radius : moins de stops = hops plus longs pour
 * tenir la durée totale (~6 km cumulés = ~75 min de marche).
 *
 *   stopCount = 8 → 1500m   (current floor, ~18 min)
 *   stopCount = 7 → 1700m
 *   stopCount = 6 → 1900m
 *   stopCount = 5 → 2200m
 *   stopCount = 4 → 2600m
 *   stopCount ≤ 3 → 3000m   (~36 min de marche entre 2 stops, tolérable
 *                            sur un parcours short et touristique)
 *
 * On reste sous le seuil "trop dispersé" (4 km) qui casserait la
 * cohérence narrative — au-delà, le joueur oublie ce qu'il vient de
 * résoudre.
 */
function maxInterStopFor(stopCount: number): number {
  // 2026-05-13 — bump aligné avec radius x1.3 pour permettre des hops
  // plus longs cohérents avec le format demi-journée. Sinon le walkability
  // filter dropperait des stops valides juste parce qu'ils sont à 1.5km
  // d'un voisin, ce qui est OK à pied à 6 km/h (~15 min de marche).
  if (stopCount >= 9) return 1_800; // 9 stops → hops jusqu'à 1.8 km
  if (stopCount === 8) return 2_000;
  if (stopCount === 7) return 2_200;
  if (stopCount === 6) return 2_400;
  return 2_700; // ≤5 (clamp upstream à 6)
}

/**
 * Paramètres spatiaux ROADTRIP (driving / mixed). Override des fonctions
 * walking ci-dessus quand transportMode != "walking". Tous en mètres.
 *
 * Logique : on rend le rayon de discovery PROPORTIONNEL à `radiusKm`
 * fourni par OddballTrip (default 30 km, jusqu'à 60 km). Le max-hop entre
 * stops monte à ~radius/2 pour permettre une vraie couverture régionale.
 * Le min-hop reste comme en walking (300-800m) parce que même en voiture,
 * 2 sites à 200m l'un de l'autre c'est un doublon visuel.
 */
function roadtripParams(stopCount: number, radiusKm: number) {
  const radiusM = Math.round(radiusKm * 1000);
  // max-hop = radius/2 environ pour couvrir la zone sans aller-retour
  // au startPoint à chaque stop. Cap à 30 km (au-delà, narratif perdu).
  const maxInterStopM = Math.min(Math.round(radiusM * 0.6), 30_000);
  // min-hop : on garde les valeurs walking (un doublon est un doublon
  // peu importe le mode de transport)
  const minInterStopM = minInterStopFor(stopCount);
  return { radiusM, maxInterStopM, minInterStopM };
}

/**
 * Plancher ABSOLU en dessous duquel on ne publie JAMAIS un jeu, peu
 * importe le stopCount demandé ou la sparsité de la zone.
 *
 * Évolution du seuil :
 *   2026-05-06 : 5 stops minimum (décision commerciale initiale)
 *   2026-05-09 : 6 stops minimum — un escape game outdoor 90 min mérite
 *                au moins 6 étapes pour structurer le récit (intro,
 *                montée, twist, descente, révélation, conclusion).
 *                5 c'est juste mais ça coupe la dramaturgie.
 *
 * Si une zone donne <6 walkables au radius/maxHop standard, le pipeline
 * ÉLARGIT progressivement (cf. wideningMultiplier dans discoverParcours)
 * et bumpe la difficulté à 5/5 ("attention parcours costaud") plutôt
 * que d'amputer le jeu.
 */
const ABSOLUTE_MIN_STOPS = 6;

/**
 * Plafond ABSOLU au-dessus duquel le jeu devient trop long pour le format
 * 90 min. 9 stops × ~10 min/stop = ~1h30 pile. Au-delà, fatigue joueur,
 * baisse de l'attention dans le 2e tiers, narrative qui se dilue.
 */
const ABSOLUTE_MAX_STOPS = 9;

/**
 * Plancher dérivé du stopCount demandé, mais jamais sous ABSOLUTE_MIN_STOPS.
 *
 *   stopCount = 9 (max)      → plancher 7 (tolère 2 drops)
 *   stopCount = 8            → plancher 6
 *   stopCount = 7            → plancher 6
 *   stopCount = 6 (min)      → plancher 6 (aucun drop)
 *   stopCount ≤ 5            → plancher 6 (force à 6 — oddballtrip
 *                              doit demander au moins 6)
 */
function minStopsForPublish(stopCount: number): number {
  return Math.max(ABSOLUTE_MIN_STOPS, stopCount - 2);
}

/**
 * Distance MINIMALE adaptative entre deux stops consécutifs après NN
 * reorder. UNIVERSELLE pour tous les jeux. Évite les "twin stops"
 * (deux POIs adjacents qui font le même endroit physique) — typique
 * de Los Cristianos où Bibliothèque + Centro Cultural à 16m étaient
 * comptés comme 2 stops distincts → joueur visite 3 vrais lieux pour
 * 5 vendus.
 *
 * Logique : on veut couvrir LA VILLE (vrai tour de quartier), pas
 * tasser tous les stops dans un mouchoir de poche. Plus le stopCount
 * est bas, plus on espace pour que le parcours reste consistant en
 * couverture spatiale.
 *
 *   stopCount = 3  →  MIN 800m  (parcours ≥ 2.4 km cumulés)
 *   stopCount = 4  →  MIN 600m  (parcours ≥ 2.4 km)
 *   stopCount = 5  →  MIN 500m  (parcours ≥ 2.5 km)
 *   stopCount = 6  →  MIN 400m  (parcours ≥ 2.4 km)
 *   stopCount = 7  →  MIN 350m  (parcours ≥ 2.4 km)
 *   stopCount = 8+ →  MIN 300m  (parcours ≥ 2.4 km)
 */
function minInterStopFor(stopCount: number): number {
  if (stopCount <= 3) return 800;
  if (stopCount === 4) return 600;
  if (stopCount === 5) return 500;
  if (stopCount === 6) return 400;
  if (stopCount === 7) return 350;
  return 300; // stopCount >= 8
}

/**
 * Plancher ABSOLU en dessous duquel deux stops sont considérés comme
 * le même endroit physique (même bâtiment, même cour, même portail).
 * Sous ce seuil, le drop est DÉFINITIF — jamais restauré, même si
 * cela fait passer le jeu sous minStops. Mieux vaut un jeu court mais
 * propre qu'un jeu "à 5 stops" dont 2 sont au même endroit.
 *
 * Cas observés : Aegina hôtels à 28m, Rothenburg Aussichtspunkte à 63m,
 * Prague musée pédago ↔ synagogue à 88m. Tous étaient des doublons
 * physiques restaurés à tort par le garde-fou minStops.
 */
// 2026-05-25 — user-mandated removal of inter-stop minimum distance constraint.
// Operator décide. Perplexity peut proposer Landesmuseum + Postmuseum (50m
// d'écart, même bâtiment) si pertinent. Pas de garde-fou bloquant.
const ABSOLUTE_MIN_INTER_STOP_M = 0;

export interface DiscoveredStop {
  /** Nom géocodable du landmark ("Cathédrale Notre-Dame de Rouen"). */
  name: string;
  /** Phrase d'une ligne expliquant le contexte thématique. */
  description: string;
  /** URL source si dispo (Wikipedia / site patrimoine). */
  source?: string;
  /** Coordonnées GPS sub-10m issues de Google Places. */
  lat: number;
  lon: number;
  /** place_id Google si dispo (pour dédup et photos). */
  placeId?: string;
  /** Distance en mètres au startPoint, pour debug/logs. */
  distanceFromStartM: number;
  /**
   * Mode du stop pour le gameplay :
   *   - "radar"     : POI Google indexé, GPS précis sub-10m, le
   *                   joueur est tracké via radar (rayon validation 30m).
   *   - "narrative" : sub-monument d'un site archéologique (ex. Bibliothèque
   *                   de Celsus dans Éphèse) que Google n'indexe pas séparément.
   *                   GPS = centre du site parent. Le riddle inclut une hint
   *                   de navigation textuelle ("Remonte la Voie des Curètes
   *                   jusqu'à..."). Validation rayon plus large (~80m).
   */
  stopMode: "radar" | "narrative";
  /** Pour mode narrative : phrase qui guide le joueur depuis le stop
   *  précédent jusqu'à ce sub-monument. `undefined` pour mode radar
   *  (le radar guide tout seul). */
  navigationHint?: string;
  /** Types Google si dispo (info pour Claude lors de la génération). */
  types?: string[];
  /** Note Google si dispo (signal de notoriété). */
  rating?: number;
}

export interface DiscoverParcoursParams {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
  /**
   * (Sprint I, 2026-05-22) — Rich product page description from
   * OddballTrip. Passed to the Claude landmark proposer (Sprint I) to
   * ground its suggestions on the customer's promise. Also propagated
   * to other downstream prompts via game-pipeline (Sprint 6.2ter).
   */
  productDescription?: string;
  startPoint: { lat: number; lon: number };
  stopCount: number;
  /**
   * Multiplicateur de widening appliqué à `radiusForStopCount` et
   * `maxInterStopFor`. Utilisé par game-pipeline en cas de zone sparse :
   * le pipeline retry avec multiplier 1 → 1.5 → 2.5 jusqu'à atteindre
   * ≥ 5 walkables. Default 1 (pas de widening).
   *
   * Quand multiplier > 1, le pipeline doit aussi auto-bumper la
   * difficulté du jeu publié à 5/5 ("parcours costaud, longues marches
   * entre stops") pour ne pas surprendre le joueur.
   */
  wideningMultiplier?: number;
  /**
   * Mode de transport du parcours. Override le radius/max-hop via
   * roadtripParams() quand != "walking". Cf. contrat OddballTrip 2026-05-10.
   */
  transportMode?: "walking" | "driving" | "mixed";
  /**
   * Rayon de discovery custom en km. Si présent, override radiusForStopCount.
   * Walking par défaut 1.5 km, driving / mixed 30 km, jusqu'à 60 km cap.
   */
  radiusKm?: number;
  /**
   * Sites pré-curatés OddballTrip (Perplexity 1ère passe). Suggestions
   * passées comme HINTS à Claude curation, pas constraints. Sert aussi
   * à déterminer le ratio "free access" du parcours final.
   */
  roadtripSeedSites?: Array<{
    name: string;
    access: "libre" | "payant" | "mixte";
    lat?: number;
    lon?: number;
    note?: string;
  }>;
  /**
   * Mode d'accessibilité du parcours. Détermine si la pipeline accepte
   * des POIs payants (musées, galeries, monuments ticketés) comme stops :
   *
   *   - `any` (défaut)  : tous les POIs Google sont éligibles. Le jeu
   *                       peut inclure des musées si Claude juge qu'ils
   *                       collent au thème — le joueur paie l'entrée
   *                       à sa charge si nécessaire.
   *   - `free`          : Google nearbysearch n'inclut que les types
   *                       d'accès libre (cf. FREE_PLACE_TYPES dans
   *                       geocode.ts) ET Claude reçoit une directive
   *                       d'exclusion pour ne JAMAIS picker un POI
   *                       payant. Le jeu est jouable 100% depuis la
   *                       voie publique sans ticket. Cas commercial :
   *                       fiches "balade gratuite Klook", marché
   *                       price-sensitive, scolaires, jeunes voyageurs.
   *
   * Les POIs payants exclus du parcours sont récupérables séparément
   * pour l'upsell GYG cross-sell post-jeu (chantier 3).
   */
  accessibility?: "free" | "any";
  /**
   * (2026-05-21) Permet d'injecter le contexte Perplexity Deep Research
   * obtenu DEHORS (typiquement précalculé dans un step Inngest dédié
   * phase1a-deep-research). Quand présent, `discoverParcours` NE
   * RELANCE PAS `deepResearchTheme` en interne — il utilise l'objet
   * fourni tel quel.
   *
   * Motivation : Perplexity sonar-deep-research prend 2-5 min sur
   * roadtrips à grand rayon. Combiné avec Google + scoring Claude
   * dans le même `step.run()`, ça pétait le timeout HTTP Inngest Cloud
   * → Vercel SDK (~2m43s). On le sort donc en sub-step amont.
   *
   * Si absent : comportement historique (deepResearchTheme inline,
   * en parallèle des nearbysearches Google).
   */
  injectedVerifiedContext?: VerifiedThemeContext;
}

export interface DiscoverParcoursResult {
  success: boolean;
  /** Liste finale ordonnée par NN depuis startPoint, prête pour la
   *  génération d'énigmes. Vide si success=false. */
  landmarks: DiscoveredStop[];
  /** Candidats Perplexity rejetés au géocodage ou par les filtres.
   *  Loggés pour audit, pas exposés au joueur. */
  rejected: Array<{ name: string; reason: string }>;
  /** Code d'erreur structuré quand success=false. */
  errorCode?:
    | "DISCOVERY_FAILED"
    | "TOO_FEW_LANDMARKS"
    | "PARCOURS_TOO_DISPERSED";
  error?: string;
  /**
   * Contexte vérifié sourcé via Perplexity Deep Research. Passé à Claude
   * generateGameSteps comme ANCHORS factuels — vrais personnages, vraies
   * dates, sites iconiques, traditions documentées avec citations URL.
   * Vide si Perplexity API absente ou échec.
   */
  verifiedContext?: VerifiedThemeContext;
  /**
   * Contexte par-stop posé par la discovery Gemini quand elle a réussi.
   * Chaque entrée porte le role PATRIMONIAL (l'histoire complète du
   * lieu, indépendamment du thème — ce qui alimente landmark_history
   * dans la card de stop) ET le role THÉMATIQUE (lien au thème du jeu,
   * peut être vide — alimente l'anecdote).
   *
   * Architecture 2026-05-16 (post-incident Julien) :
   *   - patrimoine first : on choisit les lieux pour leur valeur de
   *     visite, pas pour leur match thématique
   *   - thème en fil rouge : le narrateur tisse l'histoire du jeu par
   *     dessus, mais ne définit pas la sélection
   *
   * Vide si fallback Google Places legacy.
   */
  thematicContext?: Array<{
    placeId: string;
    patrimonialRole: string;
    thematicRole: string;
    citation: string;
    category: "patrimonial_landmark" | "thematic_anchor" | "micro_memorial";
  }>;
  /**
   * Quelle source a alimenté le pool de candidats final :
   *   - "gemini_thematic" : pipeline nominale 2026-05-15 (Gemini → Google)
   *   - "google_places"   : fallback legacy (Gemini hors-service ou
   *                         zéro résultat thématique)
   */
  discoverySource?: "gemini_thematic" | "google_places";
  /**
   * Mode de transport effectif après auto-escalation (vision 2026-05-16).
   * Peut différer du `transportMode` reçu en input si le mode walking
   * n'a pas trouvé assez de POIs dans 3.5 km et qu'on a escaladé à
   * mixed (15 km) ou driving (30 km). Le pipeline utilise cette
   * valeur pour mettre à jour games.transport_mode au moment de
   * l'INSERT, garantissant que la fiche produit OddballTrip reflète
   * la réalité (le client achète "tour à pied" et reçoit "tour mixte"
   * si l'algorithme l'a escaladé — à signaler côté OddballTrip).
   */
  escalatedTransportMode?: "walking" | "mixed" | "driving";
  /** Diamètre effectif (mètres) utilisé après escalation. */
  escalatedDiameterM?: number;
  /**
   * (Sprint 6.2quater, 2026-05-22) — Full Google Places candidate pool
   * BEFORE the Claude scoring pick. Carries up to 60-150 POIs with
   * GPS + types + ratings, deduplicated & filtered by radius/rendez-
   * vous gap, ready for re-scoring by the thematic auto-repair step.
   *
   * Without this exposure, the unchosen 50+ candidates were silently
   * discarded after Phase 1b — wasted data. Now auto-repair can re-
   * tap them when the initial Claude pick has thematic drift.
   *
   * Each entry is JSON-serializable (NearbyCandidate is flat numbers
   * + strings — no Date/Map/Set), survives Inngest step boundaries.
   */
  allCandidates?: NearbyCandidate[];
}

/**
 * Trouve un parcours marchable de `stopCount` landmarks autour de
 * `startPoint`, thématiquement alignés sur `theme` + `themeDescription`.
 *
 * Étapes :
 *   1. Google Places nearbysearch → 30-100 candidats RÉELS dans 2 km
 *   2. Claude curate les `stopCount` meilleurs pour le thème
 *   3. NN reorder depuis startPoint
 *   4. Walkability filter (drop outliers > 1 km saut)
 *   5. Si Google a < stopCount candidats → enrichissement Perplexity
 *      (sub-monuments archéo non-indexés Google) en mode narrative
 */
export async function discoverParcours(
  params: DiscoverParcoursParams,
): Promise<DiscoverParcoursResult> {
  const startTs = Date.now();
  const rejected: Array<{ name: string; reason: string }> = [];
  // Plancher dérivé du stopCount demandé (cf. minStopsForPublish).
  // stopCount=8 → 6 ; stopCount=5 → 3 ; stopCount=4 → 3.
  const minStops = minStopsForPublish(params.stopCount);
  // Walkability adaptative : moins de stops = hops plus longs + zone plus
  // large, pour tenir la durée 90 min vendue indépendamment du nombre
  // d'étapes. Cf. radiusForStopCount + maxInterStopFor.
  // Widening multiplier appliqué quand le pipeline retry sur zone sparse.
  const widening = params.wideningMultiplier ?? 1;

  // Mode transport : "walking" = comportement historique inchangé,
  // "driving" / "mixed" = roadtrip avec rayon élargi (30-50 km typiquement).
  const transportMode = params.transportMode ?? "walking";
  const isRoadtrip = transportMode !== "walking";

  // Rayon + max-hop : si roadtrip, on dérive de radiusKm (default 30 km).
  // Sinon walking historique avec radiusForStopCount/maxInterStopFor.
  let radiusM: number;
  let maxInterStopM: number;
  if (isRoadtrip) {
    const radiusKm = params.radiusKm ?? 30;
    const rt = roadtripParams(params.stopCount, radiusKm);
    radiusM = Math.round(rt.radiusM * widening);
    maxInterStopM = Math.round(rt.maxInterStopM * widening);
  } else {
    radiusM = Math.round(radiusForStopCount(params.stopCount) * widening);
    maxInterStopM = Math.round(maxInterStopFor(params.stopCount) * widening);
  }

  // Mode d'accès : "free" filtre la liste des types Google AVANT le
  // nearbysearch (élimine museum/art_gallery), et passe une directive
  // d'exclusion à Claude pour qu'il ne picker JAMAIS un POI payant.
  const accessibility = params.accessibility ?? "any";
  const googleTypes = accessibility === "free" ? [...FREE_PLACE_TYPES] : undefined;

  console.log(
    `[discoverParcours] Starting discovery for "${params.theme}" in ${params.city}, startPoint=${params.startPoint.lat.toFixed(4)},${params.startPoint.lon.toFixed(4)}, stopCount=${params.stopCount} (min=${minStops}, radius=${radiusM}m, maxHop=${maxInterStopM}m, widening=${widening}x, accessibility=${accessibility}, transportMode=${transportMode}${isRoadtrip ? `, seedSites=${params.roadtripSeedSites?.length ?? 0}` : ""})`,
  );

  // ============================================
  // PHASE 0 : AI-FIRST thematic discovery (Gemini)
  // ============================================
  // 2026-05-15 — incident Julien Alba. Pipeline Google-first sortait des
  // hôtels modernes pour un jeu Résistance parce que c'est ce que Google
  // Places retourne en `type=tourist_attraction` triés par notoriété.
  // Les vrais lieux de mémoire (Monumento alla Liberazione, Centro Studi
  // Fenoglio, Sala della Resistenza...) n'étaient même pas dans le pool.
  //
  // Nouvelle architecture : Gemini 2.5 Pro avec Google Search grounding
  // énumère les lieux thématiquement pertinents (avec source citation),
  // puis Google Maps Geocoding canonicalise les GPS. La fiction n'est
  // plus brodée sur des hôtels — elle est ancrée sur des lieux réels.
  //
  // Walking uniquement. Roadtrip reste sur l'ancien flow (Gemini ne sait
  // pas bien découvrir des POIs distants sur 30-60 km — c'est plus du
  // travail "trace ce road trip" qui demande un autre prompt).
  let aiCandidates: NearbyCandidate[] = [];
  let thematicContext: Array<{
    placeId: string;
    patrimonialRole: string;
    thematicRole: string;
    citation: string;
    category: "patrimonial_landmark" | "thematic_anchor" | "micro_memorial";
  }> = [];
  let discoverySource: "gemini_thematic" | "google_places" = "google_places";

  // Diamètre dynamique selon mode :
  //   - walking : 3.5 km initial, auto-escaladable à 15 km puis 30 km
  //     si Gemini ne trouve pas assez de matière dans le rayon serré.
  //   - mixed/driving : (radiusKm × 2), plafonné à 60 km
  //     pour absorber les jeux régionaux (Cap Sounion, Costa Brava,
  //     Egine entière avec Temple Aphaia + Paliachora à 12 km).
  //
  // Vision 2026-05-16-ter — AUTO-ESCALADE :
  // Si un mode walking ne trouve PAS assez de sites patrimoniaux dans
  // 3.5 km (cas Egine : centre-ville pauvre, sites majeurs à 12 km),
  // on n'abandonne pas — on élargit progressivement à mixed (15 km)
  // puis driving (30 km). Le jeu publie en mode adapté avec un flag
  // `transportModeEscalated` pour l'admin et la fiche produit.
  //
  // Avant : Gemini patrimoine-first GATED sur walking → mixed/driving
  // retombait sur Google Places legacy = hôtels modernes au lieu de
  // mémoriaux. Maintenant Gemini tourne pour TOUS les modes.

  /** Niveaux d'escalade quand walking ne suffit pas. */
  const ESCALATION_LADDER: Array<{
    label: "walking" | "mixed" | "driving";
    diameterM: number;
    minPoisRequired: number;
  }> = isRoadtrip
    ? [
        {
          label: (transportMode as "mixed" | "driving"),
          diameterM: Math.min(Math.round((params.radiusKm ?? 30) * 2 * 1000), 60_000),
          minPoisRequired: minStops,
        },
      ]
    : [
        { label: "walking", diameterM: DIAMETER_CAP_M, minPoisRequired: minStops },
        { label: "mixed", diameterM: 15_000, minPoisRequired: minStops },
        { label: "driving", diameterM: 30_000, minPoisRequired: minStops },
      ];

  let escalatedMode: "walking" | "mixed" | "driving" = isRoadtrip
    ? (transportMode as "mixed" | "driving")
    : "walking";
  let escalatedDiameterM = ESCALATION_LADDER[0].diameterM;
  let geminiDiameterCapM = ESCALATION_LADDER[0].diameterM;

  for (const tier of ESCALATION_LADDER) {
    geminiDiameterCapM = tier.diameterM;
    escalatedMode = tier.label;
    escalatedDiameterM = tier.diameterM;
    console.log(
      `[discoverParcours] Trying tier: ${tier.label} (diameter ${Math.round(tier.diameterM / 1000)} km, min ${tier.minPoisRequired} POIs)`,
    );

    try {
      const rawPois = await discoverThematicPois({
        city: params.city,
        country: params.country,
        title: params.theme, // theme tag = closest thing to title we have here
        theme: params.theme,
        themeDescription: params.themeDescription,
        startPoint: params.startPoint,
        stopCount: params.stopCount,
        diameterCapM: tier.diameterM,
      });

      if (rawPois.length > 0) {
        const validation = await validateThematicPois(rawPois, {
          city: params.city,
          country: params.country,
          startPoint: params.startPoint,
          diameterCapM: geminiDiameterCapM,
        });

        console.log(
          `[discoverParcours] Gemini Pass 1 (thematic): ${rawPois.length} raw → ${validation.candidates.length} validated (${validation.rejected.length} rejected during validation)`,
        );

        // ── PASS 2 : Patrimoine-first fill (vision 2026-05-16) ──
        // Si la passe thématique a sous-livré, on demande à Gemini les
        // MONUMENTS MAJEURS de la ville (théme optionnel) plutôt que
        // de combler avec Google Places type=tourist_attraction qui
        // ramène hotels/restos/parks.
        //
        // Critère de déclenchement : on a moins que `stopCount` POIs
        // validés (et non minStops — on vise toujours le nombre
        // demandé, le fallback patrimoine c'est mieux que d'aller en
        // dessous du target).
        let mergedCandidates = validation.candidates;
        let mergedContext = validation.themedContext;
        const mergedRejected = validation.rejected;
        if (mergedCandidates.length < params.stopCount) {
          const missing = params.stopCount - mergedCandidates.length;
          // On demande 50% de plus que le manquant pour absorber les
          // rejets validation/diameter.
          const targetFill = Math.ceil(missing * 1.5);
          const excluded = mergedCandidates.map((c) => c.name);
          console.log(
            `[discoverParcours] Gemini Pass 1 short (${mergedCandidates.length}/${params.stopCount}). Launching Pass 2 patrimonial-fill for ${targetFill} more POIs (excluded ${excluded.length})`,
          );

          const fillPois = await discoverPatrimonialFill(
            {
              city: params.city,
              country: params.country,
              title: params.theme,
              theme: params.theme,
              themeDescription: params.themeDescription,
              startPoint: params.startPoint,
              stopCount: targetFill,
              diameterCapM: geminiDiameterCapM,
            },
            excluded,
            targetFill,
          );

          if (fillPois.length > 0) {
            const fillValidation = await validateThematicPois(fillPois, {
              city: params.city,
              country: params.country,
              startPoint: params.startPoint,
              diameterCapM: geminiDiameterCapM,
            });
            console.log(
              `[discoverParcours] Gemini Pass 2 (patrimonial fill): ${fillPois.length} raw → ${fillValidation.candidates.length} validated`,
            );
            // Dédup par placeId entre Pass 1 et Pass 2
            const seen = new Set(mergedCandidates.map((c) => c.placeId));
            for (let i = 0; i < fillValidation.candidates.length; i++) {
              const cand = fillValidation.candidates[i];
              const ctx = fillValidation.themedContext[i];
              if (seen.has(cand.placeId)) continue;
              seen.add(cand.placeId);
              mergedCandidates = [...mergedCandidates, cand];
              mergedContext = [...mergedContext, ctx];
            }
            for (const r of fillValidation.rejected) {
              mergedRejected.push({
                name: r.name,
                reason: `Pass 2 fill rejected: ${r.reason}`,
              });
            }
            console.log(
              `[discoverParcours] After Pass 2 merge: ${mergedCandidates.length} POIs total`,
            );
          } else {
            console.warn(
              `[discoverParcours] Pass 2 patrimonial-fill returned 0 POIs — continuing with what Pass 1 gave us`,
            );
          }
        }

        if (mergedCandidates.length >= minStops) {
          aiCandidates = mergedCandidates;
          thematicContext = mergedContext;
          discoverySource = "gemini_thematic";
          for (const r of mergedRejected) {
            rejected.push({ name: r.name, reason: r.reason });
          }
          console.log(
            `[discoverParcours] ✅ Tier "${tier.label}" succeeded with ${mergedCandidates.length} POIs (cap ${Math.round(tier.diameterM / 1000)} km). Break escalation.`,
          );
          break; // sort de la boucle ESCALATION_LADDER
        } else {
          console.warn(
            `[discoverParcours] Tier "${tier.label}" insufficient (${mergedCandidates.length}/${minStops}). Will escalate to next tier if available.`,
          );
        }
      } else {
        console.warn(
          `[discoverParcours] Tier "${tier.label}" — Gemini returned 0 POIs. Will escalate to next tier if available.`,
        );
      }
    } catch (err) {
      console.warn(
        `[discoverParcours] Tier "${tier.label}" threw: ${err instanceof Error ? err.message : err}. Will escalate to next tier if available.`,
      );
    }
  } // end ESCALATION_LADDER for-loop

  if (aiCandidates.length === 0) {
    console.warn(
      `[discoverParcours] All escalation tiers exhausted (walking → mixed → driving). Falling back to Google Places legacy flow.`,
    );
  } else if (escalatedMode !== (transportMode as string)) {
    console.warn(
      `[discoverParcours] AUTO-ESCALATION : transport mode "${transportMode}" → "${escalatedMode}" (diameter ${Math.round(escalatedDiameterM / 1000)} km). Site density too low for original mode.`,
    );
  }

  const useGeminiPool = discoverySource === "gemini_thematic";

  // ============================================
  // PHASE 1 : Google Places + Perplexity Deep Research (parallèle)
  // ============================================
  // Google = source de vérité GÉOGRAPHIQUE (POIs walkables géocodés sub-10m).
  // Perplexity Deep Research = source de vérité FACTUELLE thématique
  // (sites iconiques, vrais personnages, vraies dates, traditions documentées
  // avec citations URL). Lancés en PARALLÈLE pour ne pas séquentialiser.
  //
  // Bug observé en prod sans Perplexity DR : Hakata "Mongol invasion" ignorait
  // le vrai mur Genkō Bōrui ; La Laguna ignorait Amaro Pargo ; Cluny inventait
  // un faux dernier abbé. Perplexity DR fournit ces ANCHORS factuels à Claude
  // pour qu'il les tisse dans les anecdotes (sites cités, sources URL).
  // Limit Google candidats : pour walking 60 c'est large (2 km dense),
  // pour roadtrip 30-50 km il faut plus de candidats pour avoir de quoi
  // sélectionner thématiquement. ~150 candidats sur 50 km = top.
  const candidateLimit = isRoadtrip ? 150 : 60;

  // ── ROADTRIP : enrichissement seedSites + multi-centre discovery ──
  // En walking : 1 seul nearbysearch centré sur startPoint (suffit
  // largement pour 1.5 km).
  // En roadtrip : 1 nearbysearch sur startPoint + 1 mini-nearbysearch
  // (radius 3 km) AUTOUR DE CHAQUE SEEDSITE. Sans ça, Google trie par
  // distance et ne retourne que les POIs proches du startPoint, ignorant
  // les sites distants pourtant fondamentaux pour le thème (cas Girona
  // 11/05 : 5 stops centre-ville, zéro Costa Brava à 30 km).
  let enrichedSeedSites: Awaited<ReturnType<typeof enrichSeedSitesWithCoords>> = [];
  if (isRoadtrip && params.roadtripSeedSites?.length) {
    enrichedSeedSites = await enrichSeedSitesWithCoords(
      params.roadtripSeedSites,
      params.city,
      params.country,
      params.startPoint,
      // Tolérance distance : on accepte qu'un seedSite soit jusqu'à 2×
      // radiusM du startPoint. À 30 km radius, ça permet 60 km de
      // tolérance — couvre les fiches "hub + arrière-pays".
      radiusM * 2,
    );
    const geocodedCount = enrichedSeedSites.filter((s) => s.source === "geocoded").length;
    console.log(
      `[discoverParcours] Roadtrip seedSites enrichment: ${enrichedSeedSites.length}/${params.roadtripSeedSites.length} resolved (${geocodedCount} geocoded, ${enrichedSeedSites.length - geocodedCount} provided)`,
    );
  }

  // Discovery : 1 search startPoint + N searches per seedSite (radius 3 km)
  // Skip si Gemini a déjà fourni un pool thématique validé — pas la
  // peine de re-lister Google Places, on ne va pas s'en servir.
  const discoveryCalls: Array<Promise<NearbyCandidate[]>> = [];
  if (!useGeminiPool) {
    discoveryCalls.push(
      discoverNearbyLandmarks(params.startPoint, {
        radiusM: radiusM,
        limit: candidateLimit,
        types: googleTypes,
      }),
    );
    // Mini-nearbysearches centrés sur chaque seedSite enrichi.
    // 3 km de rayon = couvre la zone "site phare + alentours immédiats"
    // sans déborder sur d'autres clusters. Limit 30 par seedSite (Tossa
    // de Mar village + Costa Brava côte n'en a pas plus thématiquement).
    for (const seed of enrichedSeedSites) {
      discoveryCalls.push(
        discoverNearbyLandmarks(
          { lat: seed.lat, lon: seed.lon },
          { radiusM: 3_000, limit: 30, types: googleTypes },
        ),
      );
    }
  }

  // (2026-05-21) Si l'appelant nous a injecté un VerifiedThemeContext
  // (typiquement précalculé en sub-step Inngest dédié phase1a-deep-
  // research), on saute l'appel Perplexity ici — sinon on le lance en
  // parallèle des nearbysearches comme avant. Le but est de pouvoir
  // sortir Perplexity Deep Research (2-5 min) d'un step.run() Inngest
  // qui dépasserait sinon le timeout HTTP ~2m43s sur les roadtrips.
  const deepResearchPromise: Promise<VerifiedThemeContext> = params
    .injectedVerifiedContext
    ? Promise.resolve(params.injectedVerifiedContext)
    : deepResearchTheme({
        city: params.city,
        country: params.country,
        theme: params.theme,
        themeDescription: params.themeDescription,
        narrative: params.narrative,
      });

  const allDiscoveryResults = await Promise.allSettled([
    Promise.allSettled(discoveryCalls),
    deepResearchPromise,
  ]);

  // Aggregate + dedup les nearbysearches (multi-centres)
  // Si Gemini a fourni un pool thématique, on l'utilise tel quel et on
  // ignore les sous-recherches Google Places (qui ont été skippées plus
  // haut). Sinon, comportement legacy : on agrège les multi-centres.
  let googleCandidates: NearbyCandidate[] = useGeminiPool ? aiCandidates : [];
  const verifiedCtxResult = allDiscoveryResults[1];

  if (!useGeminiPool && allDiscoveryResults[0].status === "fulfilled") {
    const seenPlaceIds = new Set<string>();
    for (const callResult of allDiscoveryResults[0].value) {
      if (callResult.status === "fulfilled") {
        for (const candidate of callResult.value) {
          if (!seenPlaceIds.has(candidate.placeId)) {
            seenPlaceIds.add(candidate.placeId);
            // Recalcule distanceM relative au startPoint (pas au seedSite
            // qui a servi de centre de la mini-search). Ainsi tous les
            // candidats partagent la même métrique de distance pour le
            // tri downstream et la walkability check.
            const distanceM = haversineMeters(
              { lat: candidate.lat, lon: candidate.lon },
              params.startPoint,
            );
            googleCandidates.push({ ...candidate, distanceM });
          }
        }
      } else {
        console.warn(
          `[discoverParcours] Sub-nearbysearch threw: ${callResult.reason instanceof Error ? callResult.reason.message : callResult.reason}`,
        );
      }
    }
    // Tri final par distance au startPoint croissante (cohérent avec
    // walking flow historique). Les seedSite candidats arrivent
    // mécaniquement plus loin dans le tri, mais sont quand même dans
    // le pool — Claude peut les choisir.
    googleCandidates.sort((a, b) => a.distanceM - b.distanceM);
  } else if (!useGeminiPool) {
    console.warn(
      `[discoverParcours] Multi-center nearbysearch threw: ${allDiscoveryResults[0].status === "rejected" ? (allDiscoveryResults[0].reason instanceof Error ? allDiscoveryResults[0].reason.message : allDiscoveryResults[0].reason) : "(no calls dispatched)"}`,
    );
  }

  let verifiedContext: VerifiedThemeContext | undefined;
  if (verifiedCtxResult.status === "fulfilled") {
    verifiedContext = verifiedCtxResult.value;
  } else {
    console.warn(
      `[discoverParcours] Perplexity Deep Research threw: ${verifiedCtxResult.reason instanceof Error ? verifiedCtxResult.reason.message : verifiedCtxResult.reason} — pipeline continues without verified context`,
    );
  }

  console.log(
    `[discoverParcours] Candidate pool ready: ${googleCandidates.length} POIs from "${discoverySource}" source (within ${radiusM}m)`,
  );

  // ════════════════════════════════════════════════════════════════
  // SPRINT A (2026-05-22) — POOL ENRICHMENT VIA PERPLEXITY ICONIC SITES
  // ════════════════════════════════════════════════════════════════
  // Post-incident Béziers Cathars 22/05 : Google nearbysearch sorts
  // candidates by rating × distance, so for historic themes (Cathars,
  // Huguenots, Templars, etc.) the actual heritage that IS the theme
  // is OFTEN missing from the top 60 candidates (modern restaurants,
  // city halls, and contemporary art galleries surface instead).
  //
  // Symptom : auto-repair via pool reshuffle (Sprint 6.2quater) can
  // only re-pick from the existing pool. If Cathédrale Saint-Nazaire,
  // Église Madeleine, Tour des Bénédictins etc. aren't IN the pool,
  // no amount of re-ranking saves the game.
  //
  // Fix : after the standard Google nearbysearch, run a TARGETED
  // findPlaceFromText query for each iconic site that Perplexity
  // Deep Research identified for this theme. Merge results into the
  // candidate pool at the TOP (high priority signal).
  //
  // Trust : every enrichment goes through Google Places API → real
  // place_id, sub-10m GPS, validated types. Same trust level as
  // nearbysearch. No fabrication.
  if (verifiedContext && verifiedContext.iconicSites.length > 0) {
    const beforeEnrich = googleCandidates.length;
    const existingPlaceIds = new Set(googleCandidates.map((c) => c.placeId));
    const enrichmentTolerance = radiusM * (isRoadtrip ? 2 : 1.3);
    const enriched = await enrichPoolWithPerplexityIconicSites(
      verifiedContext.iconicSites,
      params.city,
      params.country,
      params.startPoint,
      enrichmentTolerance,
      existingPlaceIds,
    );
    if (enriched.length > 0) {
      // Prepend = high priority signal for thematic scoring downstream.
      // Claude curation + auto-repair both see these as TOP candidates.
      googleCandidates = [...enriched, ...googleCandidates];
      console.log(
        `[discoverParcours] Pool enriched : +${enriched.length} Perplexity iconic sites (was ${beforeEnrich}, now ${googleCandidates.length}). Names : ${enriched.map((c) => c.name).join(", ")}`,
      );
    } else {
      console.log(
        `[discoverParcours] Pool enrichment found 0 new iconic sites (all ${verifiedContext.iconicSites.length} either failed geocode or already in pool)`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SPRINT I (2026-05-22) — CLAUDE-PROPOSED LANDMARK ENRICHMENT
  // ════════════════════════════════════════════════════════════════
  // Béziers V4 (22/05 18:23) showed that even WITH Sprint A's Perplexity
  // enrichment, the canonical theme sites (Cathédrale Saint-Nazaire,
  // Église de la Madeleine, Tour Pépézuc) were still missing. Perplexity
  // DR sometimes lists thematic categories ("medieval church") without
  // the specific monument names a historian would name.
  //
  // This third enrichment source asks Claude Haiku, primed with the
  // theme + themeDescription + productDescription + city, to propose
  // 6-8 NAMED physical landmarks tied to the theme. Each proposal is
  // then geocoded via Google Places findPlaceFromText (anti-halluc
  // guard : invented names fail the lookup silently).
  //
  // Trust : same contract as Sprint A (every result goes through
  // Google Places API). Tolerance: same as Sprint A (1.3× / 2×
  // depending on transport mode).
  //
  // The user's argument 22/05 : "Cathares Béziers is the niche test —
  // qui peut le plus peut le moins. If THIS works, 95% of games work."
  try {
    const beforeProposer = googleCandidates.length;
    const existingPlaceIds2 = new Set(googleCandidates.map((c) => c.placeId));
    const proposals = await proposeThematicLandmarks({
      city: params.city,
      country: params.country,
      theme: params.theme,
      themeDescription: params.themeDescription,
      productDescription: params.productDescription,
      existingPoolNames: googleCandidates.slice(0, 30).map((c) => c.name),
      maxProposals: 8,
    });
    if (proposals.length > 0) {
      console.log(
        `[discoverParcours] Sprint I — Claude proposed ${proposals.length} thematic landmarks for lookup: ${proposals.map((p) => p.name).join(" | ")}`,
      );
      // Run findPlaceFromText for each proposal via the same Sprint A
      // helper (treat proposals as if they were iconicSites). Reuse the
      // existing enrichPoolWithPerplexityIconicSites function.
      const enrichmentTolerance = radiusM * (isRoadtrip ? 2 : 1.3);
      const proposalEnriched = await enrichPoolWithPerplexityIconicSites(
        proposals.map((p) => ({
          name: p.name,
          significance: p.rationale,
          sources: ["claude-haiku-proposed"],
        })),
        params.city,
        params.country,
        params.startPoint,
        enrichmentTolerance,
        existingPlaceIds2,
      );
      if (proposalEnriched.length > 0) {
        googleCandidates = [...proposalEnriched, ...googleCandidates];
        console.log(
          `[discoverParcours] Sprint I — geocoded ${proposalEnriched.length}/${proposals.length} Claude proposals into pool (was ${beforeProposer}, now ${googleCandidates.length}). Names : ${proposalEnriched.map((c) => c.name).join(", ")}`,
        );
      } else {
        console.log(
          `[discoverParcours] Sprint I — Claude proposals all failed geocode or already in pool (${proposals.length} attempted)`,
        );
      }
    } else {
      console.log(
        `[discoverParcours] Sprint I — Claude returned 0 landmark proposals (insufficient theme knowledge or empty pool result)`,
      );
    }
  } catch (err) {
    console.warn(
      `[discoverParcours] Sprint I — Claude landmark proposer failed: ${err instanceof Error ? err.message : err}. Pipeline continues with existing pool.`,
    );
  }

  // S9 (2026-05-20) — RENDEZ-VOUS GAP : on filtre les POIs trop proches
  // du startPoint pour que le Stop 1 soit toujours à distance de marche
  // significative depuis le point de rendez-vous.
  //
  // Avant ce fix : le 1er stop était souvent le POI le plus proche du
  // startPoint (à 7-50m). Le joueur arrivait au RDV, validait Stop 1
  // en 13 secondes (cf. cas observé Zadar 2026-05-17), et ressentait
  // que le jeu n'avait "pas vraiment commencé". Le briefing perdait
  // sa fonction psychologique de "RDV → ensuite ça commence".
  //
  // Politique : tous les stops doivent être ≥ MIN_GAP_FROM_START_M du
  // startPoint. Walking : 150m (≈ 2 min de marche). Roadtrip : 500m
  // (en voiture le concept "trop proche" est différent).
  //
  // Garde-fou : si le filtre retire trop de candidats (< minN restants),
  // on relâche à 100m puis on annule le filtre. Pas question de planter
  // un jeu pour cette UX optim.
  const MIN_GAP_FROM_START_M = isRoadtrip ? 500 : 150;
  const RELAX_GAP_M = isRoadtrip ? 250 : 100;
  const beforeFilter = googleCandidates.length;
  const filteredStrict = googleCandidates.filter(
    (c) => c.distanceM >= MIN_GAP_FROM_START_M,
  );
  if (filteredStrict.length >= minStops) {
    googleCandidates = filteredStrict;
    console.log(
      `[discoverParcours] Rendez-vous gap applied: ${beforeFilter} → ${googleCandidates.length} candidates (excluded POIs < ${MIN_GAP_FROM_START_M}m from startPoint, kept ${googleCandidates.length} ≥ minN=${minStops})`,
    );
  } else {
    const filteredRelaxed = googleCandidates.filter(
      (c) => c.distanceM >= RELAX_GAP_M,
    );
    if (filteredRelaxed.length >= minStops) {
      googleCandidates = filteredRelaxed;
      console.warn(
        `[discoverParcours] Rendez-vous gap RELAXED to ${RELAX_GAP_M}m (strict ${MIN_GAP_FROM_START_M}m would have left only ${filteredStrict.length} < minN=${minStops}). Kept ${googleCandidates.length} candidates.`,
      );
    } else {
      console.warn(
        `[discoverParcours] Rendez-vous gap SKIPPED entirely — even at ${RELAX_GAP_M}m only ${filteredRelaxed.length} candidates remain < minN=${minStops}. Stop 1 may be very close to startPoint. Consider widening discovery radius if this happens often.`,
      );
    }
  }
  if (verifiedContext) {
    console.log(
      `[discoverParcours] Perplexity Deep Research: ${verifiedContext.iconicSites.length} iconic sites, ${verifiedContext.realFigures.length} figures, ${verifiedContext.events.length} events, ${verifiedContext.localTraditions.length} traditions`,
    );
  }

  // ============================================
  // PHASE 2 : SÉLECTION GÉOMÉTRIQUE PURE (no LLM)
  // ============================================
  //
  // ARCHITECTURE 2026-05-13 — fin du cycle de patches.
  //
  // PRINCIPE : on choisit les stops UNIQUEMENT pour la qualité de
  // la balade (POIs dispersés + attractifs touristiquement). Le
  // THÈME n'entre PAS dans la sélection — il est imposé en aval
  // par Claude qui écrit la fiction "DANS le thème" par-dessus les
  // POIs choisis. Les indices sont révélés par AR — on peut tout
  // inventer narrativement.
  //
  // Cette philosophie résout par construction TOUS les bugs
  // récurrents :
  //   - Plus jamais de twin_stops < 100m (impossible mathématiquement)
  //   - Plus jamais de cluster pathologique (rejeté par greedy)
  //   - Plus jamais de needs_review "zone sparse" (relaxation graduelle
  //     jusqu'au plancher 100m, échec clair sinon)
  //   - Plus de bypass via Claude "qui interprète" minDist
  //
  // L'ancienne curation pickThematicLandmarksFromList est volontairement
  // REMPLACÉE (pas patchée). Si on a besoin un jour d'un mode
  // "fidélité historique stricte" sur certains thèmes, ce sera un
  // FLAG explicite, pas le comportement par défaut.
  let claudePicks: DiscoveredStop[] = [];

  // Min-distance entre stops, adaptatif :
  //   - Plus le jeu a de stops dans une zone donnée, plus on resserre
  //   - Hard floor 100m (ABSOLUTE_FLOOR_M dans parcours-selection.ts)
  //   - Plafond 600m (sinon les stops sont trop espacés et la balade
  //     perd son intérêt)
  // Roadtrip override : en mode driving/mixed, on accepte des écarts
  // bien plus grands (les stops peuvent être à 10 km l'un de l'autre).
  // Pour roadtrip, minDist = max(150m, radius/sqrt(N)) plafonné à 600m
  // pour l'aspect "exploration ville" même en roadtrip. La walkability
  // entre stops d'un roadtrip est gérée par le maxInterStopM, pas le min.
  const minInterStopForSelection = computeAdaptiveMinDist(
    params.stopCount,
    radiusM,
  );
  console.log(
    `[discoverParcours] Geometric selection params: stopCount=${params.stopCount}, minN=${minStops}, minDist=${Math.round(minInterStopForSelection)}m (adaptive from radius=${radiusM}m)`,
  );

  const selection = selectStopsByGeometry({
    candidates: googleCandidates,
    targetN: params.stopCount,
    minN: minStops,
    minDistanceM: minInterStopForSelection,
  });

  console.log(
    `[discoverParcours] Selection result: ${selection.selected.length}/${params.stopCount} picked, ` +
      `actualMinPairDist=${Math.round(selection.actualMinPairDistanceM)}m, ` +
      `finalMinDistUsed=${selection.finalMinDistanceUsedM}m, ` +
      `relaxationSteps=${selection.relaxationSteps}, ` +
      `rejected=${selection.rejected.length}`,
  );

  if (!selection.success) {
    console.warn(
      `[discoverParcours] Selection failed: ${selection.failureReason}`,
    );
  }

  // Convertit les candidats sélectionnés en DiscoveredStop. Tous en
  // mode "radar" — les stops viennent de Google Places donc géocodés
  // sub-10m, le radar du joueur sait précisément où le guider.
  claudePicks = selection.selected.map((c) => ({
    name: c.name,
    description: `${c.types.slice(0, 2).join(", ")}, ${Math.round(c.distanceM)}m from start`,
    source: c.placeId
      ? `https://www.google.com/maps/place/?q=place_id:${c.placeId}`
      : undefined,
    lat: c.lat,
    lon: c.lon,
    placeId: c.placeId,
    distanceFromStartM: c.distanceM,
    stopMode: "radar",
    types: c.types,
    rating: c.rating,
  }));

  // Les rejets de la sélection vont dans rejected[] pour audit
  // (utile pour debug : "pourquoi tel POI n'a pas été pris ?").
  for (const r of selection.rejected) {
    rejected.push({
      name: r.candidate.name,
      reason: r.reason,
    });
  }

  // ============================================
  // PHASE 3 : Enrichissement Perplexity (mode narrative)
  // ============================================
  // Si on n'a pas atteint stopCount avec Google seul, on demande à
  // Perplexity des sub-monuments thématiques connus mais non-indexés
  // Google séparément (cas typique : sites archéologiques type Éphèse
  // où "Bibliothèque de Celsus" n'a pas son propre place_id).
  // Ces stops passent en mode "narrative" : GPS = startPoint approximé,
  // navigation par hint textuel.
  if (claudePicks.length < params.stopCount) {
    const stillNeeded = params.stopCount - claudePicks.length;
    console.log(
      `[discoverParcours] Need ${stillNeeded} more stops — querying Perplexity for sub-monuments`,
    );
    // Compteur narrative : les stops qui ne se géocodent pas sont
    // anchored à des coords offset autour du startPoint (cf. NARRATIVE_OFFSET_M)
    // pour ne pas tous se superposer au même point. Sinon le hard-floor
    // 100m les massacre tous (cas Garachico où 4 stops Perplexity ont
    // tous échoué le geocode et ont collisé à 0m du startPoint).
    let narrativeIndex = 0;
    const NARRATIVE_OFFSET_M = 350; // Distance des stops narrative au startPoint
    try {
      const usedNames = new Set(claudePicks.map((p) => p.name.toLowerCase()));
      const perplexityCandidates = await discoverThematicLandmarks({
        city: params.city,
        country: params.country,
        theme: params.theme,
        themeDescription: params.themeDescription,
        narrative: params.narrative,
        startPoint: params.startPoint,
        needed: stillNeeded,
        excludeNames: claudePicks.map((p) => p.name),
      });

      for (const cand of perplexityCandidates) {
        if (claudePicks.length >= params.stopCount) break;
        if (usedNames.has(cand.name.toLowerCase())) continue;

        // Tentative de géocodage Google MULTI-STRATEGY (2026-05-21) :
        // si la stratégie 1 (caller contract) échoue, on retry avec city
        // vide / nom tronqué / pas de refPoint avant de tomber en
        // narrative. Cf. `geocodeLocationRobust` pour le détail des 4
        // stratégies. Le cas qui motive ce code : Perplexity propose un
        // landmark réel ("Maison de la Magie Robert-Houdin, Blois") mais
        // OddballTrip a transformé la city en label SEO ambigu ("Loire
        // Valley") → strategy 1 échoue, strategy 2 (sans bias city)
        // récupère la vraie coord. Sans ce code, on tombait en narrative
        // mode à 350m du startPoint, à 14 km du vrai endroit.
        const robust = await geocodeLocationRobust(
          cand.name,
          params.city,
          params.country,
          {
            referencePoint: params.startPoint,
            maxDistanceM: radiusM,
          },
        );
        const geo = robust ? robust.result : null;
        if (robust && robust.strategy > 1) {
          console.warn(
            `[discoverParcours] Geocode RECOVERY via strategy ${robust.strategy} for "${cand.name}" — input city="${params.city}" was likely ambiguous`,
          );
        }

        if (geo) {
          // Trouvé : mode radar standard
          const placeId = geo.externalId ?? `geocoded:${cand.name}`;
          if (claudePicks.some((p) => p.placeId === placeId)) {
            rejected.push({
              name: cand.name,
              reason: "duplicate place_id with existing pick",
            });
            continue;
          }
          claudePicks.push({
            name: cand.name,
            description: cand.description,
            source: cand.source,
            lat: geo.lat,
            lon: geo.lon,
            placeId,
            distanceFromStartM: haversineMeters(params.startPoint, {
              lat: geo.lat,
              lon: geo.lon,
            }),
            stopMode: "radar",
          });
          console.log(
            `[discoverParcours] Perplexity radar pick: "${cand.name}" → ${geo.lat.toFixed(6)},${geo.lon.toFixed(6)}`,
          );
        } else {
          // Non géocodé : mode narrative spread en cercle autour du
          // startPoint. Avant 2026-05-07, tous les stops narrative
          // partageaient lat/lon = startPoint → tous à 0m du premier →
          // hard-floor 100m les massacrait (cas Garachico). Maintenant
          // chaque stop narrative est placé à un angle différent à
          // NARRATIVE_OFFSET_M (350m) du startPoint. Le radar pointe
          // vers une zone autour, le navigationHint guide le joueur
          // vers le vrai bâtiment depuis cette zone.
          //
          // 6 angles à 60° d'écart suffisent pour stopCount jusqu'à 8 :
          //   index 0 = N (0°), 1 = NE (60°), 2 = SE (120°), 3 = S (180°),
          //   4 = SW (240°), 5 = NW (300°), 6+ wrap autour.
          const angleRad = (narrativeIndex * Math.PI) / 3; // 60° par stop
          const dLat = (NARRATIVE_OFFSET_M / 111_000) * Math.cos(angleRad);
          const dLon =
            (NARRATIVE_OFFSET_M /
              (111_000 *
                Math.max(0.01, Math.cos((params.startPoint.lat * Math.PI) / 180)))) *
            Math.sin(angleRad);
          narrativeIndex++;
          const narrativeLat = params.startPoint.lat + dLat;
          const narrativeLon = params.startPoint.lon + dLon;
          claudePicks.push({
            name: cand.name,
            description: cand.description,
            source: cand.source,
            lat: narrativeLat,
            lon: narrativeLon,
            placeId: `narrative:${cand.name}`,
            distanceFromStartM: NARRATIVE_OFFSET_M,
            stopMode: "narrative",
            navigationHint: `Walk through the site until you reach the ${cand.name}. Once you stand before it, open the AR camera.`,
          });
          console.log(
            `[discoverParcours] Perplexity NARRATIVE pick: "${cand.name}" (no Google place_id, anchored at startPoint)`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[discoverParcours] Perplexity enrichment threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // PHASE 3.7 — NARRATIVE OFFSET RESCUE (Sprint 5, 2026-05-21)
  // ════════════════════════════════════════════════════════════════════
  // CONTEXT : even after `geocodeLocationRobust` chains 4 progressive
  // strategies, some legitimate iconic landmarks can still fall to
  // narrative mode because Google's strict-validation rejects results
  // it considers "homonym-suspicious" (e.g. when the displayName lacks
  // the expected city token). This caught us 2026-05-21 on Versailles :
  // "Palace of Versailles" landed at narrative offset (350m from Place
  // d'Armes startPoint), even though Google AND Nominatim BOTH know the
  // exact coords (48.8044, 2.1203).
  //
  // The signature of this bug is unmistakable : a stop whose
  // `distanceFromStartM` matches NARRATIVE_OFFSET_M (350m) ±50m. We use
  // this signature to detect "suspect narrative picks" and run ONE more
  // rescue geocode with a much wider tolerance (5× the original radiusM,
  // bypassing the homonym-suspicious veto).
  //
  // POLICY :
  //   - Only attempt rescue for stops at NARRATIVE_OFFSET_M ±50m (= the
  //     fallback's signature). Stops at other narrative offsets (e.g.
  //     archaeological sub-monuments correctly placed via siteId) are
  //     left alone.
  //   - Accept the rescue result only if it lands within 1.5× radiusM
  //     of startPoint (sanity check, avoids accepting a homonym from
  //     across the planet).
  //   - On success : convert to "radar" mode, drop the "Walk through..."
  //     nav hint, validation rayon falls back to 30m via the downstream
  //     mode→radius mapping.
  //
  // QUALITATIVE : zero degradation. We only ADD a rescue path. If
  // rescue fails, we keep the existing narrative-mode pick (no
  // regression). The narrative-mode UX is preserved for genuine
  // archaeological sub-monuments where it's the right behavior.
  //
  // INSTRUMENTATION : every rescue logs `[narrativeRescue] OK` or
  // `[narrativeRescue] SKIP`. Operators can grep these to track the
  // rate of upstream geocode-validation false negatives.
  const NARRATIVE_RESCUE_TOLERANCE_M = 50;
  const NARRATIVE_RESCUE_WIDE_RADIUS_MULT = 5;
  const NARRATIVE_RESCUE_ACCEPT_RADIUS_MULT = 1.5;
  for (let i = 0; i < claudePicks.length; i++) {
    const pick = claudePicks[i];
    if (pick.stopMode !== "narrative") continue;
    // Heuristic : is this pick at the exact NARRATIVE_OFFSET signature?
    // We use the 350m constant from the narrative-fallback block above.
    const offsetGuess = haversineMeters(
      { lat: pick.lat, lon: pick.lon },
      params.startPoint,
    );
    // The narrative-fallback above sets distanceFromStartM = 350m exactly.
    // Match against 350 ±tolerance.
    if (Math.abs(offsetGuess - 350) > NARRATIVE_RESCUE_TOLERANCE_M) {
      continue; // not a fallback signature, leave it alone
    }

    console.log(
      `[narrativeRescue] Attempting rescue for "${pick.name}" (current GPS ${pick.lat.toFixed(5)},${pick.lon.toFixed(5)} = exact NARRATIVE_OFFSET signature)`,
    );

    try {
      const wide = await geocodeLocationRobust(
        pick.name,
        params.city,
        params.country,
        {
          referencePoint: params.startPoint,
          maxDistanceM: radiusM * NARRATIVE_RESCUE_WIDE_RADIUS_MULT,
        },
      );
      if (!wide) {
        console.log(
          `[narrativeRescue] SKIP "${pick.name}" — even wide-radius geocode failed`,
        );
        continue;
      }
      const realDist = haversineMeters(
        { lat: wide.result.lat, lon: wide.result.lon },
        params.startPoint,
      );
      if (realDist > radiusM * NARRATIVE_RESCUE_ACCEPT_RADIUS_MULT) {
        console.warn(
          `[narrativeRescue] SKIP "${pick.name}" — wide geocode returned a result ${Math.round(realDist / 1000)}km from startPoint (> ${(radiusM * NARRATIVE_RESCUE_ACCEPT_RADIUS_MULT) / 1000}km accept threshold), likely a homonym`,
        );
        continue;
      }
      // Rescue successful : convert to radar mode.
      const oldGps = `${pick.lat.toFixed(5)},${pick.lon.toFixed(5)}`;
      pick.lat = wide.result.lat;
      pick.lon = wide.result.lon;
      pick.placeId = wide.result.externalId ?? `geocoded:${pick.name}`;
      pick.distanceFromStartM = realDist;
      pick.stopMode = "radar";
      pick.navigationHint = undefined;
      console.log(
        `[narrativeRescue] ✅ OK "${pick.name}" — was at ${oldGps} (narrative offset), now ${pick.lat.toFixed(5)},${pick.lon.toFixed(5)} (radar, ${Math.round(realDist)}m from startPoint, strategy ${wide.strategy})`,
      );
    } catch (err) {
      console.warn(
        `[narrativeRescue] SKIP "${pick.name}" — rescue threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (claudePicks.length < minStops) {
    return {
      success: false,
      landmarks: [],
      rejected,
      errorCode: "TOO_FEW_LANDMARKS",
      error: `Only ${claudePicks.length} landmarks could be assembled around startPoint (Google: ${googleCandidates.length}, after enrichment: ${claudePicks.length}). Minimum is ${minStops}. Probable cause: zone too sparse (rural / suburban) or theme too narrow.`,
    };
  }

  // ============================================
  // PHASE 4 : NN reorder depuis startPoint
  // ============================================
  // Greedy nearest-neighbor pour un parcours physiquement cohérent.
  let ordered = greedyNearestNeighborFromStart(claudePicks, params.startPoint);

  // ============================================
  // PHASE 4.5 : Dedup "twin stops" (distance MIN)
  // ============================================
  // Si Claude a quand même retenu deux stops trop proches (cas Los
  // Cristianos : Biblioteca + Centro Cultural à 16m), on supprime le
  // moins essentiel. On garde le 1er rencontré dans l'ordre NN (=
  // celui le plus proche du startPoint a priori).
  //
  // Universel pour tous les jeux. minInterStopM dérivé du stopCount :
  // plus le jeu est court, plus l'écart minimum est grand (sinon un
  // jeu de 5 stops dans 300m = nul).
  // Deux niveaux de dedup :
  //   - HARD (< ABSOLUTE_MIN_INTER_STOP_M, ~100m) : même endroit physique,
  //     drop définitif, JAMAIS restauré même si on tombe sous minStops.
  //     Mieux vaut un jeu court mais propre qu'un jeu avec 2 stops au
  //     même endroit. Cas couverts : hôtels Aegina à 28m, viewpoints
  //     Rothenburg à 63m, twin Prague à 88m.
  //   - SOFT (entre ABSOLUTE_MIN et minInter) : éloignés mais sous le
  //     min-spacing désiré pour le stopCount. Drop par défaut, mais
  //     restaurables si la dedup nous fait passer sous minStops (cas
  //     vieille ville compacte type Ávila).
  const minInter = minInterStopFor(params.stopCount);
  const dedupedOrder: DiscoveredStop[] = [];
  const softDropped: DiscoveredStop[] = []; // restaurables si nécessaire
  for (const stop of ordered) {
    // EXEMPTION narrative-mode (cf. fix Garachico 2026-05-07) : les
    // stops narrative ne sont PAS au "même endroit physique" — ils sont
    // anchored sur des coords offset autour du startPoint pour des sites
    // archéologiques où le radar ne peut pas pointer un sub-monument
    // précis. Le hard-floor 100m a été conçu pour les VRAIS doublons de
    // bâtiments (Aphaia/Museum à 73m). On ne l'applique pas aux stops
    // narrative, ni quand on les compare à un stop kept narrative.
    if (stop.stopMode === "narrative") {
      dedupedOrder.push(stop);
      continue;
    }
    let conflict: { kept: DiscoveredStop; distance: number } | null = null;
    for (const kept of dedupedOrder) {
      // Skip comparison contre un kept narrative — pour la même raison.
      if (kept.stopMode === "narrative") continue;
      const d = haversineMeters(
        { lat: stop.lat, lon: stop.lon },
        { lat: kept.lat, lon: kept.lon },
      );
      if (d < minInter) {
        conflict = { kept, distance: d };
        break;
      }
    }
    if (!conflict) {
      dedupedOrder.push(stop);
      continue;
    }
    if (conflict.distance < ABSOLUTE_MIN_INTER_STOP_M) {
      console.warn(
        `[discoverParcours] HARD DROP "${stop.name}" — only ${Math.round(conflict.distance)}m from "${conflict.kept.name}" (< ${ABSOLUTE_MIN_INTER_STOP_M}m absolute floor, same place). Never restored.`,
      );
      rejected.push({
        name: stop.name,
        reason: `same physical location as "${conflict.kept.name}" (${Math.round(conflict.distance)}m, hard floor < ${ABSOLUTE_MIN_INTER_STOP_M}m — never restored)`,
      });
    } else {
      console.warn(
        `[discoverParcours] SOFT DROP twin "${stop.name}" — ${Math.round(conflict.distance)}m from "${conflict.kept.name}" (< ${minInter}m min-spacing for stopCount=${params.stopCount}, restorable).`,
      );
      softDropped.push(stop);
      rejected.push({
        name: stop.name,
        reason: `twin stop, ${Math.round(conflict.distance)}m from "${conflict.kept.name}" (< ${minInter}m min-spacing for ${params.stopCount}-stop game)`,
      });
    }
  }
  if (dedupedOrder.length < ordered.length) {
    console.log(
      `[discoverParcours] Dedup: ${ordered.length - dedupedOrder.length} twin stops removed (${softDropped.length} soft, restorable), ${dedupedOrder.length} kept`,
    );

    // GARDE-FOU : si la dedup nous fait passer SOUS minStops, on
    // restaure UNIQUEMENT les soft drops (>= ABSOLUTE_MIN_INTER_STOP_M).
    // Les hard drops (< 100m, même endroit) ne sont JAMAIS restaurés —
    // si après restore on est encore sous minStops, le pipeline laissera
    // la phase TOO_FEW_LANDMARKS faire son travail.
    if (dedupedOrder.length < minStops && softDropped.length > 0) {
      const restored = [...dedupedOrder];
      for (const twin of softDropped) {
        if (restored.length >= minStops) break;
        restored.push(twin);
        const idx = rejected.findIndex(
          (r) => r.name === twin.name && r.reason.includes("twin stop"),
        );
        if (idx >= 0) rejected.splice(idx, 1);
      }
      console.warn(
        `[discoverParcours] Dedup would have left only ${dedupedOrder.length} stops (< minStops=${minStops}). Restoring ${restored.length - dedupedOrder.length} soft twin(s) to reach floor. Zone is very compact — soft twins accepted as fallback.`,
      );
      ordered = restored;
    } else {
      ordered = dedupedOrder;
    }
  }

  // ============================================
  // PHASE 5 : Élagage walkability inter-stops
  // ============================================
  // Tant qu'un saut > 1 km existe ET qu'on a > minStops,
  // on retire le stop le plus excentré (somme des distances aux voisins
  // immédiats), puis on re-NN.
  while (
    ordered.length > minStops &&
    maxInterStopJump(ordered) > maxInterStopM
  ) {
    let worstIdx = -1;
    let worstScore = -1;
    for (let i = 0; i < ordered.length; i++) {
      let score = 0;
      if (i > 0) {
        score += haversineMeters(
          { lat: ordered[i].lat, lon: ordered[i].lon },
          { lat: ordered[i - 1].lat, lon: ordered[i - 1].lon },
        );
      }
      if (i < ordered.length - 1) {
        score += haversineMeters(
          { lat: ordered[i].lat, lon: ordered[i].lon },
          { lat: ordered[i + 1].lat, lon: ordered[i + 1].lon },
        );
      }
      if (score > worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }
    const [dropped] = ordered.splice(worstIdx, 1);
    rejected.push({
      name: dropped.name,
      reason: `inter-stop jump > ${maxInterStopM}m, dropped during walkability pruning`,
    });
    console.warn(
      `[discoverParcours] DROP "${dropped.name}" — too far from neighbors, ${ordered.length} remaining`,
    );
    ordered = greedyNearestNeighborFromStart(ordered, params.startPoint);
  }

  // ============================================
  // PHASE 5.5 : Dégradation gracieuse (cluster densest)
  // ============================================
  // Si après pruning on a encore un saut > MAX, on tente un DERNIER
  // sauvetage : trouver le plus gros cluster compact dans la liste
  // restante et publier UNIQUEMENT ce cluster (parcours réduit mais
  // marchable). Mieux qu'un rejet hard pour l'opérateur qui voit son
  // achat échouer.
  //
  // Algorithme : pour chaque stop, on calcule combien d'autres stops
  // sont à ≤ maxInterStopM de lui (cluster size autour de ce point).
  // On garde le cluster max, qui définit le sous-ensemble walkable.
  if (maxInterStopJump(ordered) > maxInterStopM) {
    console.warn(
      `[discoverParcours] After pruning, max jump still ${Math.round(maxInterStopJump(ordered))}m. Attempting cluster-densest fallback...`,
    );

    // Trouve le cluster le plus dense
    let bestClusterCenter = -1;
    let bestClusterSize = 0;
    for (let i = 0; i < ordered.length; i++) {
      const clusterMembers = [i];
      for (let j = 0; j < ordered.length; j++) {
        if (i === j) continue;
        const d = haversineMeters(
          { lat: ordered[i].lat, lon: ordered[i].lon },
          { lat: ordered[j].lat, lon: ordered[j].lon },
        );
        if (d <= maxInterStopM) clusterMembers.push(j);
      }
      if (clusterMembers.length > bestClusterSize) {
        bestClusterSize = clusterMembers.length;
        bestClusterCenter = i;
      }
    }

    if (bestClusterCenter >= 0 && bestClusterSize >= minStops) {
      // Reconstitue le cluster autour du centre identifié
      const clusterStops: DiscoveredStop[] = [];
      for (let j = 0; j < ordered.length; j++) {
        const d = haversineMeters(
          {
            lat: ordered[bestClusterCenter].lat,
            lon: ordered[bestClusterCenter].lon,
          },
          { lat: ordered[j].lat, lon: ordered[j].lon },
        );
        if (d <= maxInterStopM) clusterStops.push(ordered[j]);
      }

      // Drop les outliers (non-cluster) avec un message clair
      for (const stop of ordered) {
        if (!clusterStops.includes(stop)) {
          rejected.push({
            name: stop.name,
            reason: `outside densest walkable cluster (graceful degradation, ${bestClusterSize} stops kept instead of failing)`,
          });
        }
      }

      ordered = greedyNearestNeighborFromStart(clusterStops, params.startPoint);
      console.warn(
        `[discoverParcours] Cluster fallback succeeded — ${ordered.length} walkable stops kept (vs ${params.stopCount} requested). Game will publish with reduced count + warning.`,
      );
    } else {
      // Cluster fallback ÉCHOUE aussi (zone trop sparse pour minStops
      // dans maxInterStopM). Là on rejette vraiment.
      return {
        success: false,
        landmarks: [],
        rejected,
        errorCode: "PARCOURS_TOO_DISPERSED",
        error: `Even in the densest sub-cluster, only ${bestClusterSize} stops walkable (need ${minStops} minimum). Zone is too sparse for any walkable parcours. Restrict the city to a smaller, denser quartier OR change theme.`,
      };
    }
  }

  // ============================================
  // PHASE 6 : Cap au stopCount demandé
  // ============================================
  if (ordered.length > params.stopCount) {
    const dropped = ordered.splice(params.stopCount);
    for (const d of dropped) {
      rejected.push({
        name: d.name,
        reason: "exceeds requested stopCount, kept the closer ones",
      });
    }
  }

  const durationMs = Date.now() - startTs;
  const radarCount = ordered.filter((s) => s.stopMode === "radar").length;
  const narrativeCount = ordered.filter((s) => s.stopMode === "narrative").length;
  console.log(
    `[discoverParcours] DONE in ${Math.round(durationMs / 1000)}s — ${ordered.length} landmarks (${radarCount} radar, ${narrativeCount} narrative, ${rejected.length} rejected) — source=${discoverySource}`,
  );

  // Filter the thematic context to only the stops that survived all
  // the selection/dedup/walkability passes. Downstream narrative gen
  // joins by placeId.
  const survivingPlaceIds = new Set(
    ordered.map((s) => s.placeId).filter((p): p is string => Boolean(p)),
  );
  const filteredThematicContext = thematicContext.filter((t) =>
    survivingPlaceIds.has(t.placeId),
  );

  return {
    success: true,
    landmarks: ordered,
    rejected,
    verifiedContext,
    thematicContext: filteredThematicContext.length > 0 ? filteredThematicContext : undefined,
    discoverySource,
    escalatedTransportMode: escalatedMode,
    escalatedDiameterM,
    // Sprint 6.2quater (2026-05-22) — expose the full Google Places
    // candidate pool so the thematic auto-repair step can re-tap it
    // when the initial pick has drift. The pool is post-radius-filter
    // and post-rendez-vous-gap-filter (cleaner data than raw nearby
    // search). Cap to 60 entries to keep Inngest serialization small.
    allCandidates: googleCandidates.slice(0, 60),
  };
}

/**
 * Greedy nearest-neighbor : démarre depuis startPoint, prend le stop
 * le plus proche, puis le plus proche du suivant, etc. Pour 8 stops
 * c'est suffisant ; un vrai TSP donnerait un gain marginal.
 */
function greedyNearestNeighborFromStart(
  stops: DiscoveredStop[],
  startPoint: { lat: number; lon: number },
): DiscoveredStop[] {
  const remaining = [...stops];
  const ordered: DiscoveredStop[] = [];
  let cursor = startPoint;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(cursor, {
        lat: remaining[i].lat,
        lon: remaining[i].lon,
      });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    cursor = { lat: picked.lat, lon: picked.lon };
  }
  return ordered;
}

function maxInterStopJump(stops: DiscoveredStop[]): number {
  let m = 0;
  for (let i = 1; i < stops.length; i++) {
    const d = haversineMeters(
      { lat: stops[i - 1].lat, lon: stops[i - 1].lon },
      { lat: stops[i].lat, lon: stops[i].lon },
    );
    if (d > m) m = d;
  }
  return m;
}
