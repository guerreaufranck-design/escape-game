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
  haversineMeters,
  FREE_PLACE_TYPES,
  type NearbyCandidate,
} from "./geocode";

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
const ABSOLUTE_MIN_INTER_STOP_M = 100;

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
    `[discoverParcours] Starting GOOGLE-FIRST discovery for "${params.theme}" in ${params.city}, startPoint=${params.startPoint.lat.toFixed(4)},${params.startPoint.lon.toFixed(4)}, stopCount=${params.stopCount} (min=${minStops}, radius=${radiusM}m, maxHop=${maxInterStopM}m, widening=${widening}x, accessibility=${accessibility}, transportMode=${transportMode}${isRoadtrip ? `, seedSites=${params.roadtripSeedSites?.length ?? 0}` : ""})`,
  );

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
  const discoveryCalls: Array<Promise<NearbyCandidate[]>> = [
    discoverNearbyLandmarks(params.startPoint, {
      radiusM: radiusM,
      limit: candidateLimit,
      types: googleTypes,
    }),
  ];
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

  const allDiscoveryResults = await Promise.allSettled([
    Promise.allSettled(discoveryCalls),
    deepResearchTheme({
      city: params.city,
      country: params.country,
      theme: params.theme,
      themeDescription: params.themeDescription,
      narrative: params.narrative,
    }),
  ]);

  // Aggregate + dedup les nearbysearches (multi-centres)
  let googleCandidates: NearbyCandidate[] = [];
  const verifiedCtxResult = allDiscoveryResults[1];

  if (allDiscoveryResults[0].status === "fulfilled") {
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
  } else {
    console.warn(
      `[discoverParcours] Multi-center nearbysearch threw: ${allDiscoveryResults[0].reason instanceof Error ? allDiscoveryResults[0].reason.message : allDiscoveryResults[0].reason}`,
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
    `[discoverParcours] Google nearbysearch returned ${googleCandidates.length} candidate(s) within ${radiusM}m`,
  );
  if (verifiedContext) {
    console.log(
      `[discoverParcours] Perplexity Deep Research: ${verifiedContext.iconicSites.length} iconic sites, ${verifiedContext.realFigures.length} figures, ${verifiedContext.events.length} events, ${verifiedContext.localTraditions.length} traditions`,
    );
  }

  // ============================================
  // PHASE 2 : Curation thématique par Claude
  // ============================================
  // Claude reçoit la liste Google + le thème, et choisit les
  // `stopCount` qui collent le mieux. Si Google a >= stopCount
  // candidats, Claude pourra TOUJOURS retourner stopCount picks
  // (la fonction complète avec les plus proches en cas de manque).
  let claudePicks: DiscoveredStop[] = [];
  if (googleCandidates.length >= params.stopCount) {
    try {
      const curation = await pickThematicLandmarksFromList({
        theme: params.theme,
        themeDescription: params.themeDescription,
        narrative: params.narrative,
        candidates: googleCandidates.map((c) => ({
          name: c.name,
          types: c.types,
          address: c.address,
          rating: c.rating,
          distanceM: c.distanceM,
          // GPS coords pour que Claude calcule les distances
          // inter-candidats et garantisse un parcours walkable.
          lat: c.lat,
          lon: c.lon,
        })),
        needed: params.stopCount,
        // Contrainte walkability transmise EN AMONT à Claude pour
        // qu'il choisisse un cluster cohérent dès le départ — au
        // lieu qu'on filtre après et perde des stops.
        maxInterStopM: maxInterStopM,
        // Distance MIN entre stops — évite les "twins" type Bibliothèque
        // + Centro Cultural à 16m sur Los Cristianos qui faisaient
        // doublon dans les 5 stops vendus.
        minInterStopM: minInterStopFor(params.stopCount),
        // Mode "free" : Claude reçoit une directive d'exclusion pour
        // sauter tout candidat payant ambigu que Google aurait laissé
        // passer (church marquée tourist_attraction mais ticketée, etc.)
        accessibility,
        // Roadtrip seed sites : suggestions OddballTrip (Perplexity 1ère
        // passe). Claude les utilise comme HINTS de priorité, pas comme
        // contraintes. Si une seedSite est dans les candidats Google,
        // booster son score thématique. Si elle n'y est pas, pas grave.
        seedSiteNames: params.roadtripSeedSites?.map((s) => s.name),
      });
      console.log(
        `[discoverParcours] Claude curation: ${curation.selectedIndices.length} picked from ${googleCandidates.length} Google candidates. Rationale: ${curation.rationale}`,
      );
      // NOTE : on ne pousse PAS les non-sélectionnés dans rejected[].
      // Sur Rouen, Google retourne 60 candidats, Claude en pick 8 — les
      // 52 non-pickés sont juste les non-choisis, pas des "échecs".
      // Les remonter dans le callback STOPS_DROPPED induit l'opérateur
      // en erreur (l'email disait "52 stops droppés" alors que tout
      // s'est passé normalement). On ne logge dans rejected[] que les
      // VRAIS rejets : géocodage cassé, walkability fail, etc.
      claudePicks = curation.selectedIndices.map((i) => {
        const c = googleCandidates[i];
        return {
          name: c.name,
          description: `${c.types.slice(0, 2).join(", ")}, ${Math.round(c.distanceM)}m from start`,
          source: c.placeId ? `https://www.google.com/maps/place/?q=place_id:${c.placeId}` : undefined,
          lat: c.lat,
          lon: c.lon,
          placeId: c.placeId,
          distanceFromStartM: c.distanceM,
          stopMode: "radar",
          types: c.types,
          rating: c.rating,
        };
      });
    } catch (err) {
      console.warn(
        `[discoverParcours] Claude curation failed: ${err instanceof Error ? err.message : err} — falling back to top-${params.stopCount} by distance`,
      );
      claudePicks = googleCandidates.slice(0, params.stopCount).map((c) => ({
        name: c.name,
        description: `${c.types.slice(0, 2).join(", ")}, ${Math.round(c.distanceM)}m from start`,
        source: c.placeId ? `https://www.google.com/maps/place/?q=place_id:${c.placeId}` : undefined,
        lat: c.lat,
        lon: c.lon,
        placeId: c.placeId,
        distanceFromStartM: c.distanceM,
        stopMode: "radar",
        types: c.types,
        rating: c.rating,
      }));
    }
  } else {
    // Google a renvoyé < stopCount candidats. Cas rare (zone sparse,
    // erreur API, site archéo isolé). On utilisera tous ceux qu'il y a
    // et on essaiera l'enrichissement Perplexity en Phase 3.
    console.warn(
      `[discoverParcours] Google returned only ${googleCandidates.length} candidates (need ${params.stopCount}) — will try Perplexity enrichment`,
    );
    claudePicks = googleCandidates.map((c) => ({
      name: c.name,
      description: `${c.types.slice(0, 2).join(", ")}, ${Math.round(c.distanceM)}m from start`,
      source: c.placeId ? `https://www.google.com/maps/place/?q=place_id:${c.placeId}` : undefined,
      lat: c.lat,
      lon: c.lon,
      placeId: c.placeId,
      distanceFromStartM: c.distanceM,
      stopMode: "radar",
      types: c.types,
      rating: c.rating,
    }));
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

        // Tentative de géocodage Google : si trouvé, mode radar normal.
        // Sinon, mode narrative ancré sur le startPoint.
        const geo = await geocodeLocation(
          cand.name,
          params.city,
          params.country,
          {
            referencePoint: params.startPoint,
            maxDistanceM: radiusM,
          },
        );

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
    `[discoverParcours] DONE in ${Math.round(durationMs / 1000)}s — ${ordered.length} landmarks (${radarCount} radar, ${narrativeCount} narrative, ${rejected.length} rejected)`,
  );

  return {
    success: true,
    landmarks: ordered,
    rejected,
    verifiedContext,
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
