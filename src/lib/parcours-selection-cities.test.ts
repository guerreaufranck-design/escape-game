/**
 * Tests synthétiques de bout-en-bout sur la sélection :
 * 5 villes réalistes avec leurs caractéristiques propres.
 *
 * On simule ce que Google Places retournerait, puis on vérifie que
 * selectStopsByGeometry produit un parcours valide (N stops, tous
 * dispersés, scalable).
 */

import type { NearbyCandidate } from "./geocode";
import {
  computeAdaptiveMinDist,
  haversineMetersBetween,
  selectStopsByGeometry,
} from "./parcours-selection";

let pass = 0,
  fail = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(msg);
    console.error(`  ❌ ${msg}`);
  }
}

function mkPOI(
  name: string,
  lat: number,
  lon: number,
  rating: number,
  reviews: number,
  types: string[],
  centerLat: number,
  centerLon: number,
): NearbyCandidate {
  return {
    name,
    lat,
    lon,
    placeId: `place_${name.replace(/[^a-z0-9]/gi, "_")}`,
    types,
    rating,
    userRatingsTotal: reviews,
    distanceM: haversineMetersBetween(
      { lat, lon },
      { lat: centerLat, lon: centerLon },
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────
// VILLE 1 : LA ROCHELLE — historique côtière, dense au centre
// Reproduit le bug observé : 3 stops protestants à 19m/89m
// ─────────────────────────────────────────────────────────────────────
console.log("\n🏙️  VILLE 1 : La Rochelle (centre dense, 2.5km, 9 stops)\n");
{
  const center = { lat: 46.158, lon: -1.151 };
  const candidates: NearbyCandidate[] = [
    // Les 3 protestants pathologiques (cluster à 90m carré)
    mkPOI("Saint Saviour Church", 46.1588398, -1.1503243, 4.5, 350, ["church"], 46.158, -1.151),
    mkPOI("Église Protestante Unie", 46.1595593, -1.1498208, 4.3, 80, ["church"], 46.158, -1.151),
    mkPOI("Musée Protestant", 46.1594995, -1.1495889, 4.4, 120, ["museum"], 46.158, -1.151),
    // Les vrais monuments emblématiques de La Rochelle
    mkPOI("Tour Saint-Nicolas", 46.1551, -1.1518, 4.6, 2800, ["tourist_attraction", "monument", "castle"], 46.158, -1.151),
    mkPOI("Tour de la Chaîne", 46.1556, -1.1525, 4.5, 2200, ["tourist_attraction", "fort"], 46.158, -1.151),
    mkPOI("Tour de la Lanterne", 46.1560, -1.1545, 4.4, 1700, ["tourist_attraction", "monument"], 46.158, -1.151),
    mkPOI("Grosse Horloge", 46.1581, -1.1537, 4.5, 1900, ["tourist_attraction", "monument"], 46.158, -1.151),
    mkPOI("Vieux Port", 46.1564, -1.1537, 4.7, 5300, ["tourist_attraction", "park"], 46.158, -1.151),
    mkPOI("Hôtel de Ville", 46.1597, -1.1518, 4.3, 460, ["tourist_attraction", "city_hall"], 46.158, -1.151),
    mkPOI("Cathédrale Saint-Louis", 46.1606, -1.1517, 4.2, 360, ["cathedral", "tourist_attraction"], 46.158, -1.151),
    mkPOI("Musée du Nouveau Monde", 46.1617, -1.1510, 4.4, 280, ["museum", "tourist_attraction"], 46.158, -1.151),
    mkPOI("Musée Maritime", 46.1517, -1.1486, 4.5, 950, ["museum", "tourist_attraction"], 46.158, -1.151),
    mkPOI("Aquarium de La Rochelle", 46.1499, -1.1474, 4.6, 12000, ["aquarium", "tourist_attraction"], 46.158, -1.151),
    mkPOI("Marché Central", 46.1582, -1.1518, 4.4, 420, ["tourist_attraction"], 46.158, -1.151),
    mkPOI("Parc Charruyer", 46.1620, -1.1565, 4.6, 1850, ["park"], 46.158, -1.151),
    // Une floppée de POIs random (cafés, restaus) pour faire 60 candidats
    ...Array.from({ length: 30 }, (_, i) =>
      mkPOI(
        `Random POI ${i}`,
        46.158 + (Math.cos(i) * 0.01),
        -1.151 + (Math.sin(i) * 0.012),
        3.5 + (i % 5) * 0.2,
        50 + i * 10,
        i % 3 === 0 ? ["tourist_attraction"] : ["cafe"],
        46.158,
        -1.151,
      ),
    ),
  ];

  const result = selectStopsByGeometry({
    candidates,
    targetN: 9,
    minN: 6,
    minDistanceM: computeAdaptiveMinDist(9, 2500),
  });

  console.log(`  Pool: ${candidates.length} candidats, picked: ${result.selected.length}`);
  console.log(`  minPairDist observed: ${Math.round(result.actualMinPairDistanceM)}m`);
  console.log(`  Stops picked:`);
  for (const s of result.selected) {
    console.log(`    - ${s.name} (${s.rating}★, ${s.userRatingsTotal} reviews)`);
  }

  check(result.success, "La Rochelle should succeed");
  check(result.selected.length === 9, `Expected 9 stops, got ${result.selected.length}`);
  check(
    result.actualMinPairDistanceM >= 100,
    `All pairs ≥ 100m floor, min=${Math.round(result.actualMinPairDistanceM)}m`,
  );
  // Le bug La Rochelle : on doit avoir AU PLUS 1 des 3 protestants
  const protestantClusterPicked = result.selected.filter(
    (s) =>
      s.name === "Saint Saviour Church" ||
      s.name === "Église Protestante Unie" ||
      s.name === "Musée Protestant",
  );
  check(
    protestantClusterPicked.length <= 1,
    `BUG ORIGINAL — max 1 stop du cluster protestant (89m + 19m), got ${protestantClusterPicked.length}: ${protestantClusterPicked.map((s) => s.name).join(", ")}`,
  );
  // Et le top des monuments doit être sélectionné (gros rating + popularité)
  const topPicked = result.selected.some((s) => s.name === "Tour Saint-Nicolas");
  check(topPicked, "Tour Saint-Nicolas (4.6★ 2800 reviews) doit être dans la sélection");
}

// ─────────────────────────────────────────────────────────────────────
// VILLE 2 : ALBARRACÍN — petit village médiéval (sparse mais joli)
// ─────────────────────────────────────────────────────────────────────
console.log("\n🏙️  VILLE 2 : Albarracín (petit village, 1km, 6 stops)\n");
{
  const center = { lat: 40.4067, lon: -1.4444 };
  const candidates: NearbyCandidate[] = [
    mkPOI("Castillo Mayor", 40.4071, -1.4458, 4.5, 480, ["castle", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Catedral del Salvador", 40.4076, -1.4441, 4.3, 220, ["cathedral"], center.lat, center.lon),
    mkPOI("Plaza Mayor", 40.4070, -1.4442, 4.6, 1100, ["plaza", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Torre del Andador", 40.4093, -1.4458, 4.4, 180, ["monument", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Casa de Julianeta", 40.4068, -1.4447, 4.5, 240, ["tourist_attraction"], center.lat, center.lon),
    mkPOI("Iglesia de Santa María", 40.4058, -1.4439, 4.4, 95, ["church"], center.lat, center.lon),
    mkPOI("Casa de la Comunidad", 40.4069, -1.4434, 4.2, 60, ["tourist_attraction"], center.lat, center.lon),
    mkPOI("Mirador del Castillo", 40.4080, -1.4475, 4.7, 320, ["park", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Café Local", 40.4071, -1.4445, 3.8, 25, ["cafe"], center.lat, center.lon),
  ];

  const result = selectStopsByGeometry({
    candidates,
    targetN: 6,
    minN: 5,
    minDistanceM: computeAdaptiveMinDist(6, 1000),
  });

  console.log(`  Pool: ${candidates.length} candidats, picked: ${result.selected.length}`);
  console.log(`  minPairDist observed: ${Math.round(result.actualMinPairDistanceM)}m`);
  console.log(`  Relaxation steps: ${result.relaxationSteps}`);

  check(result.success, "Albarracín should succeed even small pool");
  check(
    result.selected.length >= 5,
    `Expected ≥5 stops, got ${result.selected.length}`,
  );
  check(
    result.actualMinPairDistanceM >= 100,
    `All pairs ≥ 100m floor, min=${Math.round(result.actualMinPairDistanceM)}m`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// VILLE 3 : PARIS centre — dense extrême, 9 stops
// ─────────────────────────────────────────────────────────────────────
console.log("\n🏙️  VILLE 3 : Paris centre (dense extrême, 1.5km, 9 stops)\n");
{
  const center = { lat: 48.8566, lon: 2.3522 };
  // Paris centre : on simule 60+ POIs de top qualité dans 1.5km
  const candidates: NearbyCandidate[] = [];
  // Vrais monuments
  const realParisMonuments = [
    ["Notre-Dame", 48.8530, 2.3499, 4.7, 35000],
    ["Sainte-Chapelle", 48.8554, 2.3450, 4.7, 12000],
    ["Conciergerie", 48.8556, 2.3458, 4.4, 5500],
    ["Hôtel de Ville", 48.8566, 2.3522, 4.5, 8200],
    ["Centre Pompidou", 48.8607, 2.3525, 4.5, 22000],
    ["Place des Vosges", 48.8553, 2.3656, 4.7, 9100],
    ["Place de la Bastille", 48.8532, 2.3692, 4.4, 12000],
    ["Tour Saint-Jacques", 48.8579, 2.3496, 4.4, 1800],
    ["Pont Neuf", 48.8566, 2.3416, 4.6, 4500],
    ["Pont des Arts", 48.8585, 2.3373, 4.6, 7300],
    ["Île de la Cité", 48.8559, 2.3478, 4.6, 5800],
    ["Théâtre du Châtelet", 48.8589, 2.3478, 4.4, 1500],
  ] as const;
  for (const [name, lat, lon, rating, reviews] of realParisMonuments) {
    candidates.push(
      mkPOI(
        name,
        lat,
        lon,
        rating,
        reviews,
        ["tourist_attraction", "monument"],
        center.lat,
        center.lon,
      ),
    );
  }
  // + 50 random POIs (cafés, restaus, magasins, fontaines)
  for (let i = 0; i < 50; i++) {
    const angle = (i * 137.5) % 360;
    const r = 0.005 + (i % 7) * 0.0015;
    candidates.push(
      mkPOI(
        `Random Paris ${i}`,
        center.lat + r * Math.cos((angle * Math.PI) / 180),
        center.lon + r * Math.sin((angle * Math.PI) / 180),
        3.8 + (i % 8) * 0.1,
        50 + i * 30,
        i % 4 === 0 ? ["tourist_attraction"] : ["cafe"],
        center.lat,
        center.lon,
      ),
    );
  }

  const result = selectStopsByGeometry({
    candidates,
    targetN: 9,
    minN: 6,
    minDistanceM: computeAdaptiveMinDist(9, 1500),
  });

  console.log(`  Pool: ${candidates.length} candidats, picked: ${result.selected.length}`);
  console.log(`  minPairDist observed: ${Math.round(result.actualMinPairDistanceM)}m`);

  check(result.success, "Paris should always succeed");
  check(result.selected.length === 9, `Expected 9 stops, got ${result.selected.length}`);
  // Les top monuments parisiens doivent être pickés (haut rating + reviews).
  // Note : avec 12 monuments groupés dans 1.5km et minDist=500m+, mathématiquement
  // on en pick 4-5 max (les autres sont à <500m d'un déjà pické). Le reste est
  // rempli par d'autres POIs qualité. C'est le comportement souhaité.
  const topPicked = result.selected.filter((s) =>
    realParisMonuments.some(([name]) => name === s.name),
  );
  check(
    topPicked.length >= 4,
    `Au moins 4 vrais monuments pickés (les autres sont géométriquement trop proches), got ${topPicked.length}`,
  );
  // Le TOP DU TOP (Notre-Dame) doit toujours être pris
  const notreDamePicked = result.selected.some((s) => s.name === "Notre-Dame");
  check(notreDamePicked, "Notre-Dame (top score Paris) doit être picked");
}

// ─────────────────────────────────────────────────────────────────────
// VILLE 4 : TENERIFE Costa Adeje — moderne, peu d'histoire ancienne
// Démontre que le système marche aussi pour des thèmes inventés
// ─────────────────────────────────────────────────────────────────────
console.log("\n🏙️  VILLE 4 : Costa Adeje, Tenerife (moderne touristique, 2.5km, 7 stops)\n");
{
  const center = { lat: 28.0916, lon: -16.7411 };
  const candidates: NearbyCandidate[] = [
    mkPOI("Playa del Duque", 28.0907, -16.7405, 4.5, 6800, ["beach", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Siam Park", 28.0727, -16.7263, 4.7, 28000, ["amusement_park"], center.lat, center.lon),
    mkPOI("Plaza del Duque", 28.0950, -16.7400, 4.3, 850, ["plaza", "tourist_attraction"], center.lat, center.lon),
    mkPOI("Iglesia San Eugenio", 28.0884, -16.7384, 4.2, 220, ["church"], center.lat, center.lon),
    mkPOI("Costa Adeje Golf", 28.1020, -16.7392, 4.4, 1300, ["tourist_attraction"], center.lat, center.lon),
    mkPOI("Mirador La Caleta", 28.1112, -16.7613, 4.7, 980, ["park"], center.lat, center.lon),
    mkPOI("Centro Comercial Plaza", 28.0930, -16.7414, 4.0, 1500, ["tourist_attraction"], center.lat, center.lon),
    mkPOI("La Caleta Village", 28.1102, -16.7607, 4.5, 1900, ["tourist_attraction"], center.lat, center.lon),
    mkPOI("Aqualand Costa Adeje", 28.0824, -16.7322, 4.4, 15000, ["amusement_park"], center.lat, center.lon),
    mkPOI("Paseo Marítimo", 28.0905, -16.7395, 4.6, 4200, ["park"], center.lat, center.lon),
    ...Array.from({ length: 20 }, (_, i) =>
      mkPOI(
        `Restaurant Tenerife ${i}`,
        center.lat + (Math.cos(i * 0.7) * 0.01),
        center.lon + (Math.sin(i * 0.7) * 0.014),
        3.8 + (i % 5) * 0.15,
        30 + i * 20,
        ["restaurant"],
        center.lat,
        center.lon,
      ),
    ),
  ];

  const result = selectStopsByGeometry({
    candidates,
    targetN: 7,
    minN: 5,
    minDistanceM: computeAdaptiveMinDist(7, 2500),
  });

  console.log(`  Pool: ${candidates.length} candidats, picked: ${result.selected.length}`);
  console.log(`  minPairDist observed: ${Math.round(result.actualMinPairDistanceM)}m`);

  check(result.success, "Tenerife should succeed");
  check(result.selected.length === 7, `Expected 7 stops, got ${result.selected.length}`);
}

// ─────────────────────────────────────────────────────────────────────
// VILLE 5 : MEGA-PARCOURS 20 STOPS — démonstration scale
// ─────────────────────────────────────────────────────────────────────
console.log("\n🏙️  VILLE 5 : Mega-parcours 20 stops sur 5km\n");
{
  const center = { lat: 48.8566, lon: 2.3522 };
  // 100 POIs uniformément répartis sur 5 km
  const candidates: NearbyCandidate[] = Array.from({ length: 100 }, (_, i) => {
    const seed = i * 17 + 1;
    const r = ((seed * 9301 + 49297) % 233280) / 233280;
    const theta = ((seed * 7411) % 6283) / 1000;
    const radius = Math.sqrt(r);
    const dLat = radius * (5000 / 111000) * Math.sin(theta);
    const dLon =
      radius * (5000 / (111000 * Math.cos((center.lat * Math.PI) / 180))) *
      Math.cos(theta);
    return mkPOI(
      `POI_${i}`,
      center.lat + dLat,
      center.lon + dLon,
      3.5 + (i % 10) * 0.15,
      10 + i * 17,
      i % 3 === 0 ? ["tourist_attraction"] : ["cafe"],
      center.lat,
      center.lon,
    );
  });

  const result = selectStopsByGeometry({
    candidates,
    targetN: 20,
    minN: 15,
    minDistanceM: computeAdaptiveMinDist(20, 5000),
  });

  console.log(`  Pool: ${candidates.length} candidats, picked: ${result.selected.length}`);
  console.log(`  minPairDist observed: ${Math.round(result.actualMinPairDistanceM)}m`);
  console.log(`  minDist used: ${result.finalMinDistanceUsedM}m`);

  check(result.success, "20 stops mega-parcours should succeed");
  check(result.selected.length === 20, `Expected 20 stops, got ${result.selected.length}`);
  check(
    result.actualMinPairDistanceM >= 100,
    `Hard floor 100m holds at scale, got ${Math.round(result.actualMinPairDistanceM)}m`,
  );
}

// ═════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`SUMMARY (cities) : ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`\nFAILURES:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`\n✅ ALL CITIES PASSED — selection is production-ready`);
}
