/**
 * ROUTE OPTIMIZE (2026-06-08) — réordonne géométriquement les stops sélectionnés
 * pour produire une marche logique (sans zigzag).
 *
 * Pourquoi : le LLM (select.ts) choisit de bons landmarks mais ordonne mal la
 * route — il "raisonne" la géographie au lieu de la calculer, d'où des allers-
 * retours (ex. Boston : Old North au nord → Tea Party au sud → backtrack). On
 * garde donc le LLM pour le CHOIX (qualité narrative) et on confie l'ORDRE à un
 * calcul déterministe : plus-proche-voisin depuis le départ + amélioration 2-opt
 * sur un chemin OUVERT (on ne revient pas au départ).
 *
 * Le départ (index 0) est TOUJOURS figé — c'est le point de rendez-vous / forced
 * start. Seuls les stops 2..N sont réordonnés. Le dernier stop du chemin optimal
 * devient le climax narratif (la narration s'adapte à l'ordre reçu).
 */

/** Distance haversine en mètres entre deux points {lat, lon}. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Longueur totale d'un chemin ouvert (somme des segments consécutifs), en mètres. */
export function routeLengthM(stops: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += haversineM(stops[i - 1], stops[i]);
  return total;
}

/**
 * Réordonne `stops` pour minimiser la distance de marche totale.
 * - stops[0] reste figé (point de départ).
 * - Plus-proche-voisin depuis le départ, puis 2-opt (chemin ouvert).
 * Renvoie un NOUVEAU tableau (mêmes objets, ré-ordonnés). Ne mute pas l'entrée.
 */
export function optimizeRoute<T extends { lat: number; lon: number }>(stops: T[]): T[] {
  // Trop court ou coordonnées invalides → on ne touche pas.
  if (stops.length <= 3) return [...stops];
  if (stops.some((s) => typeof s.lat !== "number" || typeof s.lon !== "number" || Number.isNaN(s.lat) || Number.isNaN(s.lon))) {
    return [...stops];
  }

  // 1) Plus-proche-voisin depuis le départ figé.
  const start = stops[0];
  const remaining = stops.slice(1);
  const path: T[] = [start];
  let current: T = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    path.push(current);
  }

  // 2) 2-opt sur chemin ouvert (index 0 figé). Inverse un segment [i..j] tant
  //    que ça raccourcit le total. Borné pour rester déterministe et rapide.
  const n = path.length;
  let improved = true;
  let guard = 0;
  const maxPasses = 50;
  while (improved && guard < maxPasses) {
    improved = false;
    guard++;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // Gain = (d(i-1,i) + d(j,j+1)) - (d(i-1,j) + d(i,j+1))
        const a = path[i - 1];
        const b = path[i];
        const c = path[j];
        const d = j + 1 < n ? path[j + 1] : null;
        const before = haversineM(a, b) + (d ? haversineM(c, d) : 0);
        const after = haversineM(a, c) + (d ? haversineM(b, d) : 0);
        if (after + 1e-6 < before) {
          // Inverse le segment i..j.
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = path[lo];
            path[lo] = path[hi];
            path[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }

  return path;
}
