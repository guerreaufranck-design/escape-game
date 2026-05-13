/**
 * Tests unitaires pour parcours-selection.ts.
 *
 * Aucun framework de test (no Vitest/Jest setup dans ce projet) : on
 * exécute ce fichier directement avec `npx tsx src/lib/parcours-selection.test.ts`.
 * Si tous les tests passent → output "ALL TESTS PASSED".
 * Si un test échoue → throw + exit 1.
 *
 * Couvre :
 *   - Cas dégénérés (vide, 1 candidat, candidates < minN)
 *   - Cas dense parfait (60 candidats Paris-like → 9 stops dispersés)
 *   - Cas sparse (Albarracín-like, 12 candidats serrés → relaxation OK)
 *   - Cas cluster pathologique (3 stops < 50m + reste dispersé → cluster filtré)
 *   - Cas réel La Rochelle (60 candidats dont 3 protestants serrés)
 *   - Cas géant (20 stops sur 5km → fonctionne aussi, échelle prouvée)
 *   - Adaptive minDist sur différentes tailles de zone
 *   - Score : un POI 5★ avec 1000 reviews + tourist_attraction bat un café 3★ 5 reviews
 */

import type { NearbyCandidate } from "./geocode";
import {
  ABSOLUTE_FLOOR_M,
  computeAdaptiveMinDist,
  computeMinPairDistance,
  computeTouristicScore,
  haversineMetersBetween,
  selectStopsByGeometry,
} from "./parcours-selection";

// ─────────────────────────────────────────────────────────────────────
// Test framework minimaliste
// ─────────────────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(msg);
    console.error(`❌ FAIL: ${msg}`);
  }
}

function test(name: string, fn: () => void) {
  console.log(`\n📋 ${name}`);
  try {
    fn();
  } catch (e) {
    failCount++;
    const msg = `${name}: ${e instanceof Error ? e.message : e}`;
    failures.push(msg);
    console.error(`❌ THREW: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers pour fabriquer des candidats synthétiques
// ─────────────────────────────────────────────────────────────────────
function mkCandidate(
  name: string,
  lat: number,
  lon: number,
  opts: Partial<NearbyCandidate> = {},
): NearbyCandidate {
  return {
    name,
    lat,
    lon,
    placeId: `place_${name.replace(/\s+/g, "_")}`,
    types: opts.types ?? ["tourist_attraction"],
    distanceM: opts.distanceM ?? 0,
    rating: opts.rating ?? 4.0,
    userRatingsTotal: opts.userRatingsTotal ?? 100,
    address: opts.address,
  };
}

/**
 * Génère N candidats uniformément répartis sur un disque autour d'un center.
 * Utilise un random seedé pour reproductibilité.
 */
function generateUniformCandidates(
  centerLat: number,
  centerLon: number,
  radiusM: number,
  n: number,
  prefix: string = "POI",
): NearbyCandidate[] {
  const candidates: NearbyCandidate[] = [];
  // Convert radius from meters to degrees approximation
  const radiusDegLat = radiusM / 111_000;
  const radiusDegLon = radiusM / (111_000 * Math.cos((centerLat * Math.PI) / 180));
  // Deterministic pseudo-random based on index
  for (let i = 0; i < n; i++) {
    const seed = i * 17 + 1;
    const r = ((seed * 9301 + 49297) % 233280) / 233280; // [0,1)
    const theta = ((seed * 7411) % 6283) / 1000; // [0, 2π)
    // Sqrt for uniform disk distribution
    const radius = Math.sqrt(r);
    const dLat = radius * radiusDegLat * Math.sin(theta);
    const dLon = radius * radiusDegLon * Math.cos(theta);
    const lat = centerLat + dLat;
    const lon = centerLon + dLon;
    candidates.push(
      mkCandidate(`${prefix}_${i}`, lat, lon, {
        distanceM: haversineMetersBetween({ lat, lon }, { lat: centerLat, lon: centerLon }),
        rating: 3.5 + (i % 10) * 0.15, // 3.5 to 4.85
        userRatingsTotal: 10 + i * 17,
        types: ["tourist_attraction"],
      }),
    );
  }
  return candidates;
}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

test("haversineMetersBetween: Paris ↔ Londres ≈ 343km", () => {
  const d = haversineMetersBetween(
    { lat: 48.8566, lon: 2.3522 }, // Paris
    { lat: 51.5074, lon: -0.1278 }, // London
  );
  assert(
    d > 340_000 && d < 350_000,
    `Paris↔London should be ~343km, got ${Math.round(d)}m`,
  );
});

test("haversineMetersBetween: même point = 0m", () => {
  const d = haversineMetersBetween(
    { lat: 46.158, lon: -1.151 },
    { lat: 46.158, lon: -1.151 },
  );
  assert(d < 0.001, `Same point should be 0m, got ${d}m`);
});

test("computeAdaptiveMinDist: scale logique", () => {
  // Petite ville dense (Albarracín 6 stops, 1000m radius)
  const d1 = computeAdaptiveMinDist(6, 1000);
  assert(d1 >= 150 && d1 <= 600, `Albarracín → ${d1}m, expected 150-600`);
  // La Rochelle 9 stops, 2500m radius → clamped à 600m
  const d2 = computeAdaptiveMinDist(9, 2500);
  assert(d2 === 600, `La Rochelle → ${d2}m, expected 600 (clamped)`);
  // Roadtrip 6 stops, 30000m radius → clamped à 600m
  const d3 = computeAdaptiveMinDist(6, 30000);
  assert(d3 === 600, `Roadtrip → ${d3}m, expected 600 (clamped)`);
  // Très petit village (3 stops, 300m) → 150m floor
  const d4 = computeAdaptiveMinDist(3, 300);
  assert(d4 === 173 || (d4 >= 150 && d4 <= 200), `Tiny village → ${d4}m`);
});

test("computeTouristicScore: 5★ tourist_attraction > 3★ cafe", () => {
  const great = mkCandidate("Iconic Monument", 0, 0, {
    rating: 4.9,
    userRatingsTotal: 5000,
    types: ["tourist_attraction", "monument"],
    distanceM: 500,
  });
  const meh = mkCandidate("Random Cafe", 0, 0, {
    rating: 3.2,
    userRatingsTotal: 12,
    types: ["cafe"],
    distanceM: 500,
  });
  const sGreat = computeTouristicScore(great);
  const sMeh = computeTouristicScore(meh);
  assert(
    sGreat > sMeh + 2,
    `Iconic (${sGreat.toFixed(2)}) should massively beat cafe (${sMeh.toFixed(2)})`,
  );
});

test("computeTouristicScore: proximity decay léger mais présent", () => {
  const near = mkCandidate("Near", 0, 0, {
    rating: 4.0,
    userRatingsTotal: 100,
    types: ["tourist_attraction"],
    distanceM: 100,
  });
  const far = mkCandidate("Far", 0, 0, {
    rating: 4.0,
    userRatingsTotal: 100,
    types: ["tourist_attraction"],
    distanceM: 2400,
  });
  const sNear = computeTouristicScore(near);
  const sFar = computeTouristicScore(far);
  assert(
    sNear > sFar && sNear < sFar + 1.5,
    `Near (${sNear.toFixed(2)}) should beat far (${sFar.toFixed(2)}) by < 1.5`,
  );
});

test("selectStopsByGeometry: cas vide → success=false, no crash", () => {
  const result = selectStopsByGeometry({
    candidates: [],
    targetN: 9,
    minN: 6,
    minDistanceM: 200,
  });
  assert(!result.success, "Empty input should not succeed");
  assert(result.selected.length === 0, "No selection on empty input");
});

test("selectStopsByGeometry: 1 candidat, targetN=9 → 1 selected", () => {
  const result = selectStopsByGeometry({
    candidates: [mkCandidate("Lonely", 46.158, -1.151)],
    targetN: 9,
    minN: 6,
    minDistanceM: 200,
  });
  assert(result.selected.length === 1, "Should select the single candidate");
  assert(!result.success, "Below minN, should fail");
});

test("selectStopsByGeometry: 60 candidats uniformes 2.5km, 9 stops → tous dispersés ≥ 600m", () => {
  // La Rochelle-like : 60 POIs uniformément répartis dans 2.5km
  const cands = generateUniformCandidates(46.158, -1.151, 2500, 60, "Paris");
  const result = selectStopsByGeometry({
    candidates: cands,
    targetN: 9,
    minN: 6,
    minDistanceM: 600,
  });
  assert(result.success, `Should succeed, got ${result.selected.length}/9`);
  assert(
    result.selected.length === 9,
    `Should pick exactly 9, got ${result.selected.length}`,
  );
  assert(
    result.actualMinPairDistanceM >= 600,
    `All pairs should be ≥ 600m, min observed = ${Math.round(result.actualMinPairDistanceM)}m`,
  );
});

test("selectStopsByGeometry: cluster pathologique (3 stops à 50m) → max 1 du cluster", () => {
  // Reproduit le bug La Rochelle : 3 POIs thématiquement parfaits à 89m/19m
  // Ils ont tous le score MAX (5★ + 1000 reviews + tourist_attraction)
  const cluster = [
    mkCandidate("Saint Saviour Church", 46.1588398, -1.1503243, {
      rating: 5.0,
      userRatingsTotal: 2000,
      types: ["tourist_attraction", "church"],
    }),
    mkCandidate("Église Protestante Unie", 46.1595593, -1.1498208, {
      rating: 5.0,
      userRatingsTotal: 2000,
      types: ["tourist_attraction", "church"],
    }),
    mkCandidate("Musée Protestant", 46.1594995, -1.1495889, {
      rating: 5.0,
      userRatingsTotal: 2000,
      types: ["tourist_attraction", "museum"],
    }),
  ];
  // + 20 autres POIs bien dispersés ailleurs dans la ville
  const others = generateUniformCandidates(46.158, -1.151, 2500, 20, "Other");
  const all = [...cluster, ...others];
  const result = selectStopsByGeometry({
    candidates: all,
    targetN: 9,
    minN: 6,
    minDistanceM: 200,
  });
  assert(result.success, `Should succeed, got ${result.selected.length}/9`);
  const clusterSelected = result.selected.filter((s) =>
    cluster.some((c) => c.placeId === s.placeId),
  );
  assert(
    clusterSelected.length <= 1,
    `Max 1 du cluster doit être sélectionné, got ${clusterSelected.length}`,
  );
  // Aucune paire < 200m
  for (let i = 0; i < result.selected.length; i++) {
    for (let j = i + 1; j < result.selected.length; j++) {
      const d = haversineMetersBetween(
        result.selected[i],
        result.selected[j],
      );
      assert(
        d >= 200,
        `Pair ${result.selected[i].name} ↔ ${result.selected[j].name} = ${Math.round(d)}m < 200m`,
      );
    }
  }
});

test("selectStopsByGeometry: zone sparse → relaxation graduelle jusqu'à 100m", () => {
  // 8 POIs serrés dans 300m radius — minDist 200m impossible, doit relaxer
  const cands = generateUniformCandidates(46.158, -1.151, 300, 8, "Sparse");
  const result = selectStopsByGeometry({
    candidates: cands,
    targetN: 9,
    minN: 6,
    minDistanceM: 200,
  });
  // Avec 300m radius et 8 candidats, relaxation va kicker
  assert(
    result.relaxationSteps > 0,
    `Should have applied relaxation, got ${result.relaxationSteps} steps`,
  );
  assert(
    result.finalMinDistanceUsedM <= 200,
    `Final minDist should be relaxed, got ${result.finalMinDistanceUsedM}m`,
  );
  assert(
    result.finalMinDistanceUsedM >= ABSOLUTE_FLOOR_M,
    `Never below ${ABSOLUTE_FLOOR_M}m floor, got ${result.finalMinDistanceUsedM}m`,
  );
});

test("selectStopsByGeometry: 20 stops sur 5km → fonctionne aussi (scale)", () => {
  const cands = generateUniformCandidates(48.8566, 2.3522, 5000, 80, "Paris");
  const result = selectStopsByGeometry({
    candidates: cands,
    targetN: 20,
    minN: 15,
    minDistanceM: computeAdaptiveMinDist(20, 5000),
  });
  assert(result.success, `Should succeed for 20 stops`);
  assert(
    result.selected.length === 20,
    `Should pick exactly 20, got ${result.selected.length}`,
  );
});

test("selectStopsByGeometry: aucun candidat < ABSOLUTE_FLOOR_M après relaxation extrême", () => {
  // 2 candidats à 50m l'un de l'autre, et 4 autres bien dispersés
  const tooClose = [
    mkCandidate("Twin A", 46.158, -1.151),
    mkCandidate("Twin B", 46.1583, -1.1513), // ~40m de Twin A
  ];
  const others = generateUniformCandidates(46.165, -1.16, 1000, 4, "Far");
  const all = [...tooClose, ...others];
  const result = selectStopsByGeometry({
    candidates: all,
    targetN: 9,
    minN: 5,
    minDistanceM: 300,
  });
  // Twin A et Twin B sont à ~40m, < ABSOLUTE_FLOOR. Au pire on en pick UN seul.
  const twinAB = result.selected.filter(
    (s) => s.placeId === tooClose[0].placeId || s.placeId === tooClose[1].placeId,
  );
  assert(
    twinAB.length <= 1,
    `At most 1 of the < 50m twins should be picked, got ${twinAB.length}`,
  );
  // Vérif : aucun paire < ABSOLUTE_FLOOR_M même après relaxation
  for (let i = 0; i < result.selected.length; i++) {
    for (let j = i + 1; j < result.selected.length; j++) {
      const d = haversineMetersBetween(
        result.selected[i],
        result.selected[j],
      );
      assert(
        d >= ABSOLUTE_FLOOR_M,
        `Pair ${result.selected[i].name} ↔ ${result.selected[j].name} = ${Math.round(d)}m < ABSOLUTE_FLOOR=${ABSOLUTE_FLOOR_M}m`,
      );
    }
  }
});

test("selectStopsByGeometry: score domine le tri (un POI moins prioritaire mais 5★ peut passer avant)", () => {
  // 2 POIs au même endroit logique : un 5★ 1000 reviews, un 3★ 5 reviews
  // Ils sont à >> minDist du reste — le 5★ devrait être sélectionné, pas le 3★
  const star = mkCandidate("Iconic 5★", 46.158, -1.151, {
    rating: 4.9,
    userRatingsTotal: 5000,
    types: ["tourist_attraction", "monument"],
  });
  const meh = mkCandidate("Meh 3★", 46.158, -1.151, {
    rating: 3.0,
    userRatingsTotal: 5,
    types: [],
  });
  const others = generateUniformCandidates(46.165, -1.16, 1500, 10, "Other");
  const all = [meh, star, ...others]; // ordre n'importe pas, l'algo tri
  const result = selectStopsByGeometry({
    candidates: all,
    targetN: 9,
    minN: 6,
    minDistanceM: 200,
  });
  const starSelected = result.selected.some((s) => s.placeId === star.placeId);
  const mehSelected = result.selected.some((s) => s.placeId === meh.placeId);
  assert(
    starSelected && !mehSelected,
    `5★ should be picked, 3★ should be filtered (both at same place). Star=${starSelected}, Meh=${mehSelected}`,
  );
});

test("computeMinPairDistance: cohérence", () => {
  const stops = [
    mkCandidate("A", 46.158, -1.151),
    mkCandidate("B", 46.16, -1.155), // ~400m de A
    mkCandidate("C", 46.18, -1.18), // > 3km de A et B
  ];
  const min = computeMinPairDistance(stops);
  assert(min > 350 && min < 450, `Min should be ~400m (A↔B), got ${Math.round(min)}m`);
});

// ═════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`SUMMARY : ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log(`\nFAILURES:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`\n✅ ALL TESTS PASSED`);
}
