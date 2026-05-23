import { config } from "dotenv";
config({ path: "/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local" });

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
const startPoint = { lat: 43.3449428, lon: 3.2130024 };
const radiusM = 2900 * 1.3; // walking 7 stops × Sprint A tolerance

const landmarks = [
  "Cathédrale Saint-Nazaire de Béziers",
  "Remparts de Béziers",
  "Église de la Madeleine de Béziers",
  "Porte de Narbonne, Béziers",
  "Rue de la Cité, Béziers",
  "Musée Fabregat, Béziers",
  "Pont Vieux de Béziers",
  "Château de Raissac, Béziers",
];

function haversine(a,b){const R=6371000;const toRad=d=>d*Math.PI/180;const dLat=toRad(b.lat-a.lat);const dLon=toRad(b.lon-a.lon);const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))}

for (const name of landmarks) {
  const query = `${name}, Beziers, France`;
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "name,geometry,place_id,formatted_address,types,rating,user_ratings_total");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("locationbias", `circle:${Math.round(radiusM)}@${startPoint.lat},${startPoint.lon}`);

  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n=== "${name}" ===`);
  console.log(`  status: ${data.status}`);
  if (data.candidates?.length) {
    const c = data.candidates[0];
    const d = haversine(startPoint, { lat: c.geometry.location.lat, lon: c.geometry.location.lng });
    console.log(`  found: "${c.name}" place_id=${c.place_id}`);
    console.log(`  types: [${(c.types ?? []).join(", ")}]`);
    console.log(`  distance from start: ${Math.round(d)}m  (tolerance ${Math.round(radiusM)}m)`);
    console.log(`  within tolerance: ${d <= radiusM ? "✅" : "❌ DROPPED"}`);
    console.log(`  rating: ${c.rating ?? "?"} (${c.user_ratings_total ?? "?"} reviews)`);
  } else {
    console.log(`  ❌ NO RESULTS`);
  }
}
