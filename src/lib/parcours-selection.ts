/**
 * Sélection greedy géo-dispersée de POIs pour un parcours escape game.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  PHILOSOPHIE — ÉCRITE LE 2026-05-13 POUR SORTIR DU CYCLE DE PATCHES
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ce module remplace l'ancienne approche "Claude curation" qui essayait
 * de faire choisir thématiquement les stops par un LLM. C'était la
 * source de tous les bugs récurrents (twin_stops à 19m/89m, cluster
 * fallback contradictoire, exemptions narrative_mode, etc.).
 *
 * La NOUVELLE règle d'or :
 *
 *   "Les stops sont des POINTS GPS choisis pour la QUALITÉ DE LA BALADE.
 *    Le thème est imposé PAR-DESSUS par Claude qui écrit la fiction.
 *    L'AR révèle l'énigme — pas une plaque physique pré-existante.
 *    Donc on peut TOUT inventer narrativement sur n'importe quel POI."
 *
 *   → La sélection est PUREMENT GÉOMÉTRIQUE + qualité touristique
 *   → Le thème n'entre PAS dans cette phase
 *   → Mathématiquement IMPOSSIBLE d'avoir 2 stops < minDistance
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  ALGORITHME
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. Score chaque candidat sur "attractivité touristique" :
 *        score = ratingBonus(rating, reviews) + typeBonus(types)
 *      → AUCUN signal thématique (le thème = Claude post-sélection)
 *
 *   2. Trie par score décroissant.
 *
 *   3. Greedy avec contrainte min-distance :
 *      - Pick le top score
 *      - Pour chaque candidat suivant : ACCEPT si distance ≥ minDist
 *        à TOUS les déjà-sélectionnés, SINON skip
 *      - Continue jusqu'à atteindre targetN ou épuiser candidates
 *
 *   4. Si selected.length < minN, on RELAX minDist progressivement
 *      (par paliers de 50m, jamais < ABSOLUTE_FLOOR_M=100m) et on
 *      retente. Si même à 100m on ne trouve pas minN, on ÉCHOUE
 *      proprement (zone vraiment trop sparse, pas de patch fallback).
 *
 *   5. Output : SelectionResult avec selected, rejected, et métriques
 *      diagnostiques (actualMinDistance, actualN, relaxationApplied).
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  CE QUE CE MODULE NE FAIT PAS (volontairement)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ❌ Appels LLM (zéro Claude / Gemini / Perplexity ici)
 *   ❌ Curation thématique
 *   ❌ Walkability check (consécutifs ≤ maxJump) — fait en aval
 *   ❌ Ordering pour le parcours — fait en aval (nearest neighbor)
 *   ❌ Validation post-construction — la garantie est mathématique
 *
 *   Ce module est PURE FUNCTION : input → output, sans side-effects.
 *   100% testable unitairement.
 */

import type { NearbyCandidate } from "./geocode";

/** Plancher absolu en dessous duquel 2 POIs sont "au même endroit
 *  physique" (même bâtiment, même cour, même portail). Jamais relaxé,
 *  jamais bypass. */
export const ABSOLUTE_FLOOR_M = 100;

/** Pas de relaxation progressif de minDist quand on est sous minN. */
const RELAXATION_STEP_M = 50;

/** Hard caps pour computeAdaptiveMinDist : jamais en dessous de 150m
 *  (lisibilité narrative), jamais au-dessus de 600m (sinon les stops
 *  sont trop dispersés et la balade casse). */
const MIN_ADAPTIVE_M = 150;
const MAX_ADAPTIVE_M = 600;

/**
 * Types Google Places considérés "tourismement attractifs" — bonus de
 * score si présents. Ne FILTRE rien (un POI sans ces types est encore
 * éligible), juste prioritaire dans le greedy.
 *
 * Volontairement large : on accepte qu'un café réputé soit utilisé
 * comme stop si rien de mieux dans la zone. L'AR + la narration le
 * rendent intéressant.
 */
const TOURISM_TYPE_BONUS: Record<string, number> = {
  tourist_attraction: 3.0,
  museum: 2.5,
  art_gallery: 2.5,
  historical_landmark: 3.0,
  monument: 3.0,
  castle: 3.0,
  fort: 3.0,
  palace: 3.0,
  church: 1.5,
  cathedral: 2.0,
  synagogue: 1.5,
  mosque: 1.5,
  temple: 1.5,
  park: 1.0,
  plaza: 1.5,
  fountain: 1.0,
  city_hall: 1.5,
  library: 1.0,
  university: 1.0,
  zoo: 1.5,
  aquarium: 1.5,
  amusement_park: 1.0,
  stadium: 1.0,
  // Catégories "pas de bonus mais pas pénalisé" — implicit 0
};

export interface SelectionParams {
  /** Liste brute de candidats Google Places (typ. 60-150). */
  candidates: NearbyCandidate[];
  /** Nombre de stops désirés (ex 9). */
  targetN: number;
  /** Plancher minimum : si on ne peut pas atteindre, on ÉCHOUE. */
  minN: number;
  /** Distance minimum entre 2 stops (en mètres). Initial value ;
   *  peut être relaxée jusqu'à ABSOLUTE_FLOOR_M=100m si nécessaire. */
  minDistanceM: number;
}

export interface SelectionRejection {
  candidate: NearbyCandidate;
  reason: string;
}

export interface SelectionResult {
  /** Stops sélectionnés (longueur ≥ minN si success=true). */
  selected: NearbyCandidate[];
  /** Tous les candidats rejetés, avec raison. */
  rejected: SelectionRejection[];
  /** Indique si le greedy a atteint targetN ou seulement minN ou en
   *  dessous. */
  success: boolean;
  /** Distance min observée entre 2 stops sélectionnés (diagnostic). */
  actualMinPairDistanceM: number;
  /** Si > minDistanceM initial, indique la relaxation appliquée. */
  finalMinDistanceUsedM: number;
  /** Nombre de relaxations qui ont été appliquées pour atteindre minN. */
  relaxationSteps: number;
  /** Si success=false, raison détaillée pour debug / opérateur. */
  failureReason?: string;
}

/**
 * Computation du score "attractivité touristique" d'un candidat.
 *
 * Combine 3 signaux :
 *   1. rating × log(reviews+1) — qualité Google Maps perçue, lissée
 *      pour ne pas surpondérer les 5★ avec 3 reviews
 *   2. types-based bonus — un musée vaut plus qu'un café générique
 *   3. proximité au startPoint — décay léger pour préférer les POIs
 *      proches quand c'est égalité par ailleurs (évite les outliers)
 *
 * Output : score réel (typiquement entre 0 et 15). Pas normalisé,
 * sert uniquement à classer en interne.
 */
export function computeTouristicScore(candidate: NearbyCandidate): number {
  // Signal 1 : rating × log(reviews) — Bayesian-ish
  const rating = candidate.rating ?? 3.5;
  const reviews = candidate.userRatingsTotal ?? 1;
  // (rating - 3) recentre autour de 3 (1-2★ = malus, 4-5★ = bonus)
  // log10(reviews+1) lisse : 10 reviews ≈ 1.0, 100 ≈ 2.0, 1000 ≈ 3.0
  const ratingScore = (rating - 3) * Math.log10(reviews + 1);

  // Signal 2 : type bonus
  let typeBonus = 0;
  for (const t of candidate.types ?? []) {
    typeBonus += TOURISM_TYPE_BONUS[t] ?? 0;
  }

  // Signal 3 : proximity decay (préférence pour les POIs proches du
  // startPoint quand le score est égal par ailleurs). Léger, ne domine
  // jamais le score thématique/qualité.
  // À 0m : bonus 1.0. À 2500m : bonus ~0. Linéaire.
  const proximityBonus = Math.max(0, 1 - candidate.distanceM / 2500);

  return ratingScore + typeBonus + proximityBonus;
}

/**
 * Distance entre 2 candidats en mètres (haversine).
 */
export function haversineMetersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Compute la min-distance entre 2 stops dans un set (sur toutes les
 * paires). Diagnostic — sert à l'output SelectionResult.
 */
export function computeMinPairDistance(stops: NearbyCandidate[]): number {
  if (stops.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const d = haversineMetersBetween(stops[i], stops[j]);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Distance minimum adaptative selon stopCount et taille de zone.
 *
 * Idée géométrique : on veut que les N stops soient uniformément
 * répartis dans la zone (disque de rayon zoneRadiusM). La surface
 * par stop est donc π·r²/N. Le rayon du "disque équivalent" autour
 * de chaque stop est √(surface/π) = r/√N. C'est notre minDist naturel.
 *
 * Exemples concrets :
 *   - La Rochelle 9 stops, 2500m → minDist = 833m (clamped à MAX=600m)
 *   - Paris centre 9 stops, 1500m → minDist = 500m
 *   - Albarracín 6 stops, 1000m → minDist = 408m
 *   - Petit village 6 stops, 500m → minDist = 204m
 *   - Roadtrip 6 stops, 30000m → minDist = 12247m (clamped à MAX=600m,
 *     mais en roadtrip on swappera maxDistance, pas minDistance)
 *
 * Clamps [MIN_ADAPTIVE_M, MAX_ADAPTIVE_M] = [150m, 600m].
 */
export function computeAdaptiveMinDist(
  stopCount: number,
  zoneRadiusM: number,
): number {
  if (stopCount < 1) return MIN_ADAPTIVE_M;
  const natural = zoneRadiusM / Math.sqrt(stopCount);
  return Math.max(MIN_ADAPTIVE_M, Math.min(MAX_ADAPTIVE_M, natural));
}

/**
 * Vérifie si un candidat respecte la contrainte de min-distance par
 * rapport à un set de stops déjà sélectionnés.
 *
 * Retourne `null` si OK (pas de conflit), ou les détails du plus proche
 * conflit si distance < minDist.
 */
function checkMinDistance(
  candidate: NearbyCandidate,
  selected: NearbyCandidate[],
  minDistanceM: number,
): { conflictWith: NearbyCandidate; distanceM: number } | null {
  let closest: NearbyCandidate | null = null;
  let closestDist = Infinity;
  for (const s of selected) {
    const d = haversineMetersBetween(candidate, s);
    if (d < closestDist) {
      closestDist = d;
      closest = s;
    }
  }
  if (closest && closestDist < minDistanceM) {
    return { conflictWith: closest, distanceM: closestDist };
  }
  return null;
}

/**
 * Greedy core : étant donné une liste TRIÉE par score décroissant,
 * pick les top sous contrainte min-distance.
 */
function greedyPickWithMinDist(
  sortedCandidates: NearbyCandidate[],
  targetN: number,
  minDistanceM: number,
): { selected: NearbyCandidate[]; rejected: SelectionRejection[] } {
  const selected: NearbyCandidate[] = [];
  const rejected: SelectionRejection[] = [];

  for (const candidate of sortedCandidates) {
    if (selected.length >= targetN) {
      rejected.push({
        candidate,
        reason: `target ${targetN} reached, candidate not needed`,
      });
      continue;
    }

    if (selected.length === 0) {
      selected.push(candidate);
      continue;
    }

    const conflict = checkMinDistance(candidate, selected, minDistanceM);
    if (conflict) {
      rejected.push({
        candidate,
        reason: `${Math.round(conflict.distanceM)}m from "${conflict.conflictWith.name}" (< ${minDistanceM}m floor)`,
      });
    } else {
      selected.push(candidate);
    }
  }

  return { selected, rejected };
}

/**
 * Sélectionne des stops bien dispersés parmi une liste de candidats.
 *
 * Pure function — pas d'IO, pas de side effects, complètement testable.
 *
 * @see SelectionParams
 * @see SelectionResult
 */
export function selectStopsByGeometry(params: SelectionParams): SelectionResult {
  const { candidates, targetN, minN } = params;
  let { minDistanceM } = params;

  // Garde-fou : on ne descend JAMAIS sous le plancher absolu
  if (minDistanceM < ABSOLUTE_FLOOR_M) {
    minDistanceM = ABSOLUTE_FLOOR_M;
  }

  // Score + tri (immutable, on travaille sur une copie)
  const scored = candidates
    .map((c) => ({ candidate: c, score: computeTouristicScore(c) }))
    .sort((a, b) => b.score - a.score);
  const sortedCandidates = scored.map((s) => s.candidate);

  // Tentative initiale avec la minDistance demandée
  let attemptMinDist = minDistanceM;
  let { selected, rejected } = greedyPickWithMinDist(
    sortedCandidates,
    targetN,
    attemptMinDist,
  );
  let relaxationSteps = 0;

  // Relaxation progressive si on est sous minN
  while (selected.length < minN && attemptMinDist > ABSOLUTE_FLOOR_M) {
    attemptMinDist = Math.max(
      ABSOLUTE_FLOOR_M,
      attemptMinDist - RELAXATION_STEP_M,
    );
    relaxationSteps++;
    const retry = greedyPickWithMinDist(
      sortedCandidates,
      targetN,
      attemptMinDist,
    );
    selected = retry.selected;
    rejected = retry.rejected;
  }

  const actualMinPairDistanceM = computeMinPairDistance(selected);
  const success = selected.length >= minN;

  return {
    selected,
    rejected,
    success,
    actualMinPairDistanceM,
    finalMinDistanceUsedM: attemptMinDist,
    relaxationSteps,
    ...(success
      ? {}
      : {
          failureReason: `Could not select ${minN} stops even with relaxed minDistance=${attemptMinDist}m (absolute floor). Got only ${selected.length}. Candidates pool: ${candidates.length}. Zone too sparse OR candidates too clustered.`,
        }),
  };
}
