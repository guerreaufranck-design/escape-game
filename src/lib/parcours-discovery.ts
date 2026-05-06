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

import { discoverThematicLandmarks } from "./perplexity";
import { pickThematicLandmarksFromList } from "./anthropic";
import {
  discoverNearbyLandmarks,
  geocodeLocation,
  haversineMeters,
  type NearbyCandidate,
} from "./geocode";

/** Rayon maximal autour du startPoint dans lequel les landmarks sont
 *  acceptés. 2 km = ~25 min de marche depuis le centre, donc le stop
 *  le plus excentré reste à portée pour un escape game qui dure 1h30-2h.
 *  Au-delà, le parcours n'est plus marchable depuis le point de départ
 *  choisi par l'opérateur. */
const RADIUS_AROUND_START_M = 2_000;

/** Distance maximale autorisée entre deux stops consécutifs après le
 *  NN reorder. 1500m ≈ 18 min de marche, qui reste acceptable pour un
 *  escape game outdoor (pause narrative entre énigmes). Au-delà, le
 *  joueur perd vraiment le rythme.
 *
 *  Historique : démarré à 1000m (test Clervaux). Test Rothenburg a
 *  rejeté avec 1330m > 1000m parce que la ville fortifiée a 2 ponts
 *  de la vallée parmi ses POIs touristiques, à 600-800m sous le
 *  rocher. Aligner sur 1500m permet de publier ces parcours qui sont
 *  marchables même si tendus, et n'introduit rien d'absurde côté UX
 *  (18 min entre stops = pause narrative + photo + repos boisson). */
const MAX_INTER_STOP_M = 1_500;

/**
 * Plancher en dessous duquel on rejette le jeu, ADAPTATIF au stopCount
 * demandé. La règle : on tolère au max 2 drops (au pruning walkability
 * ou au géocodage), avec un plancher absolu de 3 stops.
 *
 *   stopCount = 8 (standard) → plancher 6 (tolère 2 drops)
 *   stopCount = 5 (Espagne, France court) → plancher 3 (tolère 2 drops)
 *   stopCount = 4 → plancher 3 (tolère 1 drop)
 *   stopCount = 3 → plancher 3 (aucun drop)
 */
function minStopsForPublish(stopCount: number): number {
  return Math.max(3, stopCount - 2);
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

  console.log(
    `[discoverParcours] Starting GOOGLE-FIRST discovery for "${params.theme}" in ${params.city}, startPoint=${params.startPoint.lat.toFixed(4)},${params.startPoint.lon.toFixed(4)}, stopCount=${params.stopCount} (min=${minStops})`,
  );

  // ============================================
  // PHASE 1 : Google Places nearbysearch
  // ============================================
  // Source de vérité géographique. Tous les candidats retournés sont
  // RÉELS, géocodés sub-10m, et dans le rayon. Multi-types pour
  // maximiser la couverture (urban + heritage + religious + cultural).
  let googleCandidates: NearbyCandidate[] = [];
  try {
    googleCandidates = await discoverNearbyLandmarks(params.startPoint, {
      radiusM: RADIUS_AROUND_START_M,
      limit: 60,
    });
  } catch (err) {
    console.warn(
      `[discoverParcours] Google nearbysearch threw: ${err instanceof Error ? err.message : err}`,
    );
  }

  console.log(
    `[discoverParcours] Google nearbysearch returned ${googleCandidates.length} candidate(s) within ${RADIUS_AROUND_START_M}m`,
  );

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
        maxInterStopM: MAX_INTER_STOP_M,
        // Distance MIN entre stops — évite les "twins" type Bibliothèque
        // + Centro Cultural à 16m sur Los Cristianos qui faisaient
        // doublon dans les 5 stops vendus.
        minInterStopM: minInterStopFor(params.stopCount),
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
            maxDistanceM: RADIUS_AROUND_START_M,
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
          // Non géocodé : mode narrative ancré sur le startPoint avec
          // hint de navigation. Le joueur recevra une indication
          // textuelle "Find the Library of Celsus, then open AR".
          claudePicks.push({
            name: cand.name,
            description: cand.description,
            source: cand.source,
            lat: params.startPoint.lat,
            lon: params.startPoint.lon,
            placeId: `narrative:${cand.name}`,
            distanceFromStartM: 0,
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
  const minInter = minInterStopFor(params.stopCount);
  const dedupedOrder: DiscoveredStop[] = [];
  for (const stop of ordered) {
    const tooClose = dedupedOrder.find(
      (kept) =>
        haversineMeters(
          { lat: stop.lat, lon: stop.lon },
          { lat: kept.lat, lon: kept.lon },
        ) < minInter,
    );
    if (tooClose) {
      console.warn(
        `[discoverParcours] DROP twin "${stop.name}" — too close to "${tooClose.name}" (< ${minInter}m). Universal min-spacing rule for stopCount=${params.stopCount}.`,
      );
      rejected.push({
        name: stop.name,
        reason: `twin stop, < ${minInter}m from "${tooClose.name}" (min-spacing rule for ${params.stopCount}-stop game)`,
      });
    } else {
      dedupedOrder.push(stop);
    }
  }
  if (dedupedOrder.length < ordered.length) {
    console.log(
      `[discoverParcours] Dedup: ${ordered.length - dedupedOrder.length} twin stops removed, ${dedupedOrder.length} kept`,
    );
    ordered = dedupedOrder;
  }

  // ============================================
  // PHASE 5 : Élagage walkability inter-stops
  // ============================================
  // Tant qu'un saut > 1 km existe ET qu'on a > minStops,
  // on retire le stop le plus excentré (somme des distances aux voisins
  // immédiats), puis on re-NN.
  while (
    ordered.length > minStops &&
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
  // sont à ≤ MAX_INTER_STOP_M de lui (cluster size autour de ce point).
  // On garde le cluster max, qui définit le sous-ensemble walkable.
  if (maxInterStopJump(ordered) > MAX_INTER_STOP_M) {
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
        if (d <= MAX_INTER_STOP_M) clusterMembers.push(j);
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
        if (d <= MAX_INTER_STOP_M) clusterStops.push(ordered[j]);
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
      // dans MAX_INTER_STOP_M). Là on rejette vraiment.
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
