/**
 * Dry-run the new Gemini-first discovery pipeline on the Alba Resistance
 * scenario that broke for Julien (incident 2026-05-15). Prints the
 * thematic POI pool Gemini proposes, then the Google-validated
 * candidates, then what selectStopsByGeometry would actually pick.
 *
 * NO DB writes. Just compares "what Gemini sees" vs "what got published
 * to Julien" to confirm the new pipeline solves the problem before we
 * rotate his game.
 *
 * Usage:
 *   npx tsx scripts/test-alba-discovery.ts
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Load env from any reasonable location
for (const rel of [".env.local", "../.env.local", "../../.env.local", "../../../.env.local", "../../../../.env.local"]) {
  const p = resolve(process.cwd(), rel);
  if (existsSync(p)) {
    config({ path: p, override: true });
    console.log(`[env] Loaded ${p}`);
    break;
  }
}

import { discoverThematicPois } from "../src/lib/ai-discovery";
import { validateThematicPois } from "../src/lib/poi-validation";

const ALBA_PARAMS = {
  city: "Alba",
  country: "Italy",
  title: "La Résistance d'Alba",
  theme: "Résistance partisane Alba 1944",
  themeDescription:
    "Outdoor walking game on the 23-day Republic of Alba (October-November 1944), the partisan uprising led by Enrico Martini 'Mauri', and the literary chronicle of these events by Beppe Fenoglio.",
  // Piazza Risorgimento devant la cathédrale (le startPoint d'Alba)
  startPoint: { lat: 44.7005, lon: 8.0354 },
  stopCount: 8,
  diameterCapM: 3_500,
};

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`Testing AI-first discovery for: ${ALBA_PARAMS.title}`);
  console.log(`City: ${ALBA_PARAMS.city}, ${ALBA_PARAMS.country}`);
  console.log(`Start: ${ALBA_PARAMS.startPoint.lat}, ${ALBA_PARAMS.startPoint.lon}`);
  console.log(`Diameter cap: ${ALBA_PARAMS.diameterCapM}m`);
  console.log(`Target stops: ${ALBA_PARAMS.stopCount}`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  console.log("─── PHASE 0a: Gemini Deep Research ───\n");
  const t0 = Date.now();
  const rawPois = await discoverThematicPois(ALBA_PARAMS);
  console.log(`\n→ ${rawPois.length} raw POIs from Gemini in ${Math.round((Date.now() - t0) / 1000)}s:\n`);
  for (const [i, p] of rawPois.entries()) {
    console.log(`${i + 1}. ${p.name}`);
    console.log(`     Adresse: ${p.address}`);
    console.log(`     GPS hint: ${p.latHint.toFixed(6)}, ${p.lonHint.toFixed(6)}`);
    console.log(`     Patrimoine: ${p.patrimonialRole.slice(0, 200)}`);
    if (p.thematicRole) console.log(`     Thématique: ${p.thematicRole}`);
    if (p.category) console.log(`     Cat: ${p.category}`);
    console.log(`     Source: ${p.citation}`);
    console.log("");
  }

  if (rawPois.length === 0) {
    console.error("Gemini returned 0 POIs — check GEMINI_API_KEY or model availability");
    process.exit(1);
  }

  console.log("\n─── PHASE 0b: Google Maps validation ───\n");
  const validation = await validateThematicPois(rawPois, {
    city: ALBA_PARAMS.city,
    country: ALBA_PARAMS.country,
    startPoint: ALBA_PARAMS.startPoint,
    diameterCapM: ALBA_PARAMS.diameterCapM,
  });

  console.log(`→ ${validation.candidates.length} validated POIs:\n`);
  for (const [i, c] of validation.candidates.entries()) {
    const ctx = validation.themedContext[i];
    console.log(`${i + 1}. ${c.name}`);
    console.log(`     Canon GPS: ${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`);
    console.log(`     Distance from start: ${Math.round(c.distanceM)}m`);
    console.log(`     Address: ${c.address ?? "(none)"}`);
    console.log(`     placeId: ${c.placeId}`);
    if (ctx) {
      console.log(`     Patrimoine: ${ctx.patrimonialRole.slice(0, 160)}`);
      if (ctx.thematicRole) console.log(`     Thème: ${ctx.thematicRole}`);
      console.log(`     Catégorie: ${ctx.category}`);
    }
    console.log("");
  }

  if (validation.rejected.length > 0) {
    console.log(`\n→ ${validation.rejected.length} rejected during validation:\n`);
    for (const r of validation.rejected) {
      console.log(`  ✗ ${r.name}: ${r.reason}`);
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("RÉSULTAT");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`Gemini → ${rawPois.length} POIs proposés`);
  console.log(`Google validation → ${validation.candidates.length} POIs canonicalisés`);
  console.log(`Rejets → ${validation.rejected.length}`);
  console.log("");
  console.log("ANCIEN POOL (Google Places only) pour comparaison :");
  console.log("  Hotel Calissano, Hotel Ristorante I Castelli, Parco Baden-Powell,");
  console.log("  Galleria Aganahuei, etc.");
  console.log("");
  console.log("NOUVEAU POOL (Gemini thématique) :");
  for (const c of validation.candidates) {
    console.log(`  ✓ ${c.name}`);
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
