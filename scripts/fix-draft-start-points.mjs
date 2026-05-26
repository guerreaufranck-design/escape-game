#!/usr/bin/env node
/**
 * Fix one-shot des start points foireux dans game_drafts.
 *
 * Contexte (2026-05-26) : OddballTrip / Funbooker a envoyé pour les 78
 * drafts pré-validés des coordonnées GPS souvent fausses (centroïde
 * Wikipedia, parfois à 30-40 km du stop 1 réel). Cf. dump 25/05.
 *
 * Fix : pour chaque draft validated avec un tableau stops non-vide, on
 * met start_point_lat / _lon / _text = stops[0]. Plus de divergence entre
 * le "start" affiché au joueur et le stop 1 réel.
 *
 * Run :  node scripts/fix-draft-start-points.mjs
 * Dry-run : DRY_RUN=1 node scripts/fix-draft-start-points.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);

const DRY = process.env.DRY_RUN === "1";
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: drafts, error } = await s
  .from("game_drafts")
  .select("slug, city, start_point_lat, start_point_lon, start_point_text, stops")
  .eq("status", "validated");
if (error) {
  console.error("ERR list drafts:", error);
  process.exit(1);
}

console.log(`\n🔍 ${drafts.length} drafts validated trouvés${DRY ? " (DRY RUN, aucune écriture)" : ""}`);

let fixed = 0;
let skipped = 0;
let drift = 0; // count of drafts where start was significantly off

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(sa));
}

for (const d of drafts) {
  if (!Array.isArray(d.stops) || d.stops.length === 0) {
    skipped++;
    continue;
  }
  const stop1 = d.stops[0];
  if (typeof stop1?.lat !== "number" || typeof stop1?.lon !== "number") {
    console.log(`  ⚠️  ${d.slug} — stops[0] sans lat/lon valide, skip`);
    skipped++;
    continue;
  }

  const oldLat = d.start_point_lat;
  const oldLon = d.start_point_lon;
  const oldText = d.start_point_text;
  const newLat = stop1.lat;
  const newLon = stop1.lon;
  const newText = stop1.name ?? d.start_point_text ?? null;

  const isSame =
    typeof oldLat === "number" &&
    typeof oldLon === "number" &&
    Math.abs(oldLat - newLat) < 0.0001 &&
    Math.abs(oldLon - newLon) < 0.0001;
  if (isSame) {
    // déjà aligné, rien à faire
    skipped++;
    continue;
  }

  // distance ancienne pour info
  let kmDrift = null;
  if (typeof oldLat === "number" && typeof oldLon === "number") {
    kmDrift = haversineKm({ lat: oldLat, lon: oldLon }, { lat: newLat, lon: newLon });
    if (kmDrift > 1) drift++;
  }
  const driftStr = kmDrift !== null ? ` (drift ${kmDrift.toFixed(1)} km)` : "";

  console.log(
    `  ✏️  ${d.slug} (${d.city})${driftStr}\n     OLD ${oldLat},${oldLon} "${oldText ?? "—"}"\n     NEW ${newLat},${newLon} "${newText}"`,
  );

  if (!DRY) {
    const { error: upErr } = await s
      .from("game_drafts")
      .update({
        start_point_lat: newLat,
        start_point_lon: newLon,
        start_point_text: newText,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", d.slug);
    if (upErr) {
      console.error(`     ❌ update failed: ${upErr.message}`);
      continue;
    }
  }
  fixed++;
}

console.log(`\n✅ Done`);
console.log(`   Fixed   : ${fixed}${DRY ? " (would have been written)" : ""}`);
console.log(`   Skipped : ${skipped} (no stops, no lat/lon, or already aligned)`);
console.log(`   Drift>1km : ${drift} drafts had a start ≥1km from their stop 1`);
