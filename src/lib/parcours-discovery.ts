/**
 * Découverte canonique d'un parcours d'escape game.
 *
 * SOURCE UNIQUE de landmarks : Perplexity (recherche web thématique) +
 * Google Places (géocodage sub-10m). Pas de fallback, pas de branche
 * conditionnelle sur les stops opérateur — l'entrée est l'INTENTION
 * (theme, narrative, startPoint), la sortie est un parcours marchable
 * de N landmarks documentés.
 *
 * Pourquoi cette refonte : sur les 5 premiers tests de production,
 * 1 jeu sur 4 publiait avec un défaut critique parce que la pipeline
 * essayait de réparer des landmarks faiblement thématiques fournis par
 * un LLM amont. La cause racine n'est pas dans nos garde-fous (qui
 * fonctionnent) — c'est dans l'input. Avec Perplexity comme source
 * canonique testée (cf. Clervaux/Battle of the Bulge : Castle, BoB
 * Museum, GI Monument, Pak43, Hôtel Claravallis), le jeu publié est
 * thématiquement aligné par construction.
 *
 * Contrat de qualité :
 *   - Tous les landmarks sont des lieux RÉELS, géolocalisables
 *     précisément (Google Places sub-10m), avec source web documentée.
 *   - Tous les landmarks sont à ≤ 1.5 km du startPoint.
 *   - Aucun saut entre stops consécutifs ne dépasse 1 km après NN reorder.
 *   - Dédup par place_id pour éviter les doublons.
 */

import { discoverThematicLandmarks } from "./perplexity";
import { geocodeLocation, haversineMeters } from "./geocode";

/** Rayon maximal autour du startPoint dans lequel les landmarks sont
 *  acceptés. Au-delà, le parcours n'est plus marchable depuis le point
 *  de départ choisi par l'opérateur. */
const RADIUS_AROUND_START_M = 1_500;

/** Distance maximale autorisée entre deux stops consécutifs après le
 *  NN reorder. Au-delà, le parcours impose une marche absurde. */
const MAX_INTER_STOP_M = 1_000;

/** Plancher en dessous duquel on rejette le jeu : un parcours < 6
 *  stops est trop court pour livrer l'expérience promise. */
const MIN_STOPS_TO_PUBLISH = 6;

export interface DiscoveredStop {
  /** Nom géocodable du landmark ("Hôtel Claravallis, Clervaux"). */
  name: string;
  /** Phrase d'une ligne expliquant le lien thématique documenté.
   *  Servira de `whatToObserve` pour Claude #1 qui écrira l'énigme. */
  description: string;
  /** URL source citée par Perplexity (Wikipedia, site patrimoine, etc.). */
  source?: string;
  /** Coordonnées GPS sub-10m issues de Google Places. */
  lat: number;
  lon: number;
  /** place_id Google si dispo (pour dédup et photos). */
  placeId?: string;
  /** Distance en mètres au startPoint, pour debug/logs. */
  distanceFromStartM: number;
}

export interface DiscoverParcoursParams {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
  startPoint: { lat: number; lon: number };
  stopCount: number;
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
}

/**
 * Trouve un parcours marchable de `stopCount` landmarks autour de
 * `startPoint`, thématiquement alignés sur `theme` + `themeDescription`.
 *
 * Étapes :
 *   1. Perplexity propose stopCount + 4 candidats documentés
 *   2. Géocode chacun via Google Places (sub-10m, biased au startPoint)
 *   3. Drop les non-géocodables et les > 1.5 km du startPoint
 *   4. NN reorder depuis startPoint
 *   5. Tant qu'un saut > 1 km ET stops > 6, drop le plus excentré + re-NN
 *   6. Si stops finaux < 6, retourne errorCode
 */
export async function discoverParcours(
  params: DiscoverParcoursParams,
): Promise<DiscoverParcoursResult> {
  const startTs = Date.now();
  const rejected: Array<{ name: string; reason: string }> = [];

  console.log(
    `[discoverParcours] Starting discovery for "${params.theme}" in ${params.city}, startPoint=${params.startPoint.lat.toFixed(4)},${params.startPoint.lon.toFixed(4)}, stopCount=${params.stopCount}`,
  );

  // === PHASE 1 : Découverte Perplexity ===
  let candidates: Awaited<ReturnType<typeof discoverThematicLandmarks>>;
  try {
    candidates = await discoverThematicLandmarks({
      city: params.city,
      country: params.country,
      theme: params.theme,
      themeDescription: params.themeDescription,
      // On passe la narration pour le ton — Perplexity est briefé pour
      // ne PAS lier les landmarks à la fiction (cf. perplexity.ts), juste
      // au sujet historique réel sous-jacent.
      narrative: params.narrative,
      // CRITIQUE : Perplexity reçoit le startPoint pour ancrer sa
      // recherche AU BON ENDROIT. Sans ça, il choisit la zone la plus
      // thématiquement riche (qui peut être à 10 km du startPoint réel)
      // et tous ses candidats sont ensuite rejetés par le filtre 1,5 km
      // (cf. test Greek/Themistocles : Perplexity choisit Piraeus,
      // startPoint à Athens, 6 candidats sur 7 perdus).
      startPoint: params.startPoint,
      // On en demande quelques-uns en plus que stopCount pour absorber
      // les drops au géocodage et au filtre walkability.
      needed: params.stopCount,
      excludeNames: [],
    });
  } catch (err) {
    return {
      success: false,
      landmarks: [],
      rejected,
      errorCode: "DISCOVERY_FAILED",
      error: `Perplexity discovery threw: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (candidates.length === 0) {
    return {
      success: false,
      landmarks: [],
      rejected,
      errorCode: "DISCOVERY_FAILED",
      error: `Perplexity returned 0 candidates for "${params.theme}" in ${params.city}. Check the theme description — it must point to a real-world subject (era, event, person, movement).`,
    };
  }

  console.log(
    `[discoverParcours] Perplexity returned ${candidates.length} candidate(s)`,
  );

  // === PHASE 2 : Géocodage Google Places ===
  const geocoded: DiscoveredStop[] = [];
  const seenPlaceIds = new Set<string>();

  for (const cand of candidates) {
    const geo = await geocodeLocation(
      cand.name,
      params.city,
      params.country,
      // Bias serré sur le startPoint : Google nous renvoie le résultat
      // dans la zone du parcours, pas un homonyme à 100 km.
      // maxDistanceM = RADIUS_AROUND_START_M : on rejette directement
      // les résultats hors zone (Phase 3 ci-dessous est redondante mais
      // gardée pour l'audit log explicite).
      {
        referencePoint: params.startPoint,
        maxDistanceM: RADIUS_AROUND_START_M,
      },
    );

    if (!geo) {
      console.log(
        `[discoverParcours] DROP "${cand.name}" — not geocodable or > ${RADIUS_AROUND_START_M}m from startPoint`,
      );
      rejected.push({
        name: cand.name,
        reason: "not geocodable or out of parcours zone",
      });
      continue;
    }

    // Dédup par place_id (Perplexity peut citer 2 fois le même lieu
    // sous deux noms légèrement différents).
    const placeId = geo.externalId ?? `geocoded:${cand.name}`;
    if (seenPlaceIds.has(placeId)) {
      console.log(
        `[discoverParcours] DROP "${cand.name}" — duplicate place_id`,
      );
      rejected.push({
        name: cand.name,
        reason: "duplicate of another candidate",
      });
      continue;
    }
    seenPlaceIds.add(placeId);

    const distanceFromStartM = haversineMeters(params.startPoint, {
      lat: geo.lat,
      lon: geo.lon,
    });

    geocoded.push({
      name: cand.name,
      description: cand.description,
      source: cand.source,
      lat: geo.lat,
      lon: geo.lon,
      placeId,
      distanceFromStartM,
    });

    console.log(
      `[discoverParcours] KEEP "${cand.name}" → ${geo.lat.toFixed(6)},${geo.lon.toFixed(6)} (${Math.round(distanceFromStartM)}m from start, src=${geo.source})`,
    );
  }

  if (geocoded.length < MIN_STOPS_TO_PUBLISH) {
    return {
      success: false,
      landmarks: [],
      rejected,
      errorCode: "TOO_FEW_LANDMARKS",
      error: `Only ${geocoded.length} of ${candidates.length} Perplexity candidates could be geocoded within ${RADIUS_AROUND_START_M}m of startPoint. Minimum is ${MIN_STOPS_TO_PUBLISH}. Possibilities: theme too narrow, startPoint in low-density area, or candidate names too obscure for Google.`,
    };
  }

  // === PHASE 3 : NN reorder depuis startPoint ===
  // Greedy nearest-neighbor pour que le parcours soit physiquement cohérent
  // (pas de zigzag) du point de vue du joueur qui démarre au startPoint.
  let ordered = greedyNearestNeighborFromStart(geocoded, params.startPoint);

  // === PHASE 4 : Élagage walkability inter-stops ===
  // Tant qu'un saut > 1 km existe ET qu'on peut se permettre de drop
  // (stops > 6), on retire le stop avec le plus gros score d'éloignement
  // (somme des distances aux voisins immédiats), puis on re-NN.
  while (
    ordered.length > MIN_STOPS_TO_PUBLISH &&
    maxInterStopJump(ordered) > MAX_INTER_STOP_M
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
      reason: `inter-stop jump > ${MAX_INTER_STOP_M}m, dropped during walkability pruning`,
    });
    console.warn(
      `[discoverParcours] DROP "${dropped.name}" — too far from neighbors (jump > ${MAX_INTER_STOP_M}m), ${ordered.length} remaining`,
    );
    ordered = greedyNearestNeighborFromStart(ordered, params.startPoint);
  }

  if (maxInterStopJump(ordered) > MAX_INTER_STOP_M) {
    return {
      success: false,
      landmarks: [],
      rejected,
      errorCode: "PARCOURS_TOO_DISPERSED",
      error: `After walkability pruning, max inter-stop jump still ${Math.round(maxInterStopJump(ordered))}m > ${MAX_INTER_STOP_M}m. Theme + startPoint produce landmarks too dispersed for a walking game. Try a tighter theme or a different startPoint.`,
    };
  }

  // === PHASE 5 : Cap au stopCount demandé ===
  // On peut avoir géocodé plus que stopCount (on demandait stopCount + 4
  // à Perplexity). On garde les `stopCount` premiers du NN (= les plus
  // proches du startPoint), pour un parcours qui démarre serré et
  // rayonne légèrement.
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
  console.log(
    `[discoverParcours] DONE in ${Math.round(durationMs / 1000)}s — ${ordered.length} landmarks (${rejected.length} rejected)`,
  );

  return {
    success: true,
    landmarks: ordered,
    rejected,
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
