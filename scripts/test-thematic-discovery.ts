/**
 * Test the Perplexity thematic discovery in isolation.
 * Goal: confirm Perplexity proposes good thematic landmarks before we
 * burn a full pipeline run. Then geocode each via Google Places to see
 * how many survive — that's the true signal for the pipeline.
 *
 * Usage:
 *   npx tsx scripts/test-thematic-discovery.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { discoverThematicLandmarks } from "../src/lib/perplexity";
import { geocodeLocation, haversineMeters } from "../src/lib/geocode";

const CITY = "Clervaux";
const COUNTRY = "Luxembourg";
const THEME = "The Shadow's Oath";
const THEME_DESCRIPTION =
  "Uncover a wartime conspiracy in historic Clervaux. Follow the Shadow's Oath through WWII secrets hidden in the town's landmarks.";
const NARRATIVE = `December 1944. The Battle of the Bulge ravages the Ardennes. Clervaux, called the "Luxembourgish Alamo", witnesses fierce American resistance against the German offensive. Beneath the surface of the chaos, a clandestine pact is forged — the Shadow's Oath — a secret armistice between resistance fighters and German officers to spare civilian lives. As the player, you retrace the steps of those who chose humanity over hatred, decoding clues left in the stones of churches, the cobblestones of squares, and the shadows of the castle.`;

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log(`Testing Perplexity discovery for: ${CITY}, ${COUNTRY}`);
  console.log(`Theme: ${THEME}`);
  console.log("══════════════════════════════════════════════════════════\n");

  const candidates = await discoverThematicLandmarks({
    city: CITY,
    country: COUNTRY,
    theme: THEME,
    themeDescription: THEME_DESCRIPTION,
    narrative: NARRATIVE,
    // Hard-coded Clervaux Castle GPS for the test
    startPoint: { lat: 50.0545, lon: 6.0301 },
    needed: 8,
    excludeNames: [],
  });

  console.log(`\n→ Perplexity returned ${candidates.length} candidate(s):\n`);

  // Show the raw candidates first (always available regardless of geocode availability)
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`${i + 1}. ${c.name}`);
    console.log(`   ${c.description}`);
    if (c.source) console.log(`   source: ${c.source}`);
    console.log("");
  }

  // Try geocoding each candidate. Falls back to Nominatim if no Google key.
  const cityGeo = await geocodeLocation(`${CITY}, ${COUNTRY}`, CITY, COUNTRY);
  if (!cityGeo) {
    console.warn(
      "⚠️  Could not geocode city center locally — skipping geocode pass.",
    );
    console.warn(
      "    The pipeline running on Vercel (with GOOGLE_MAPS_API_KEY) will geocode each candidate.",
    );
    return;
  }
  const cityRef = { lat: cityGeo.lat, lon: cityGeo.lon };
  console.log(
    `\nCity center: ${cityRef.lat.toFixed(4)}, ${cityRef.lon.toFixed(4)}\n`,
  );

  let geocoded = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`${i + 1}. ${c.name}\n`);

    const geo = await geocodeLocation(c.name, CITY, COUNTRY, {
      referencePoint: cityRef,
    });

    if (!geo) {
      console.log(`   ❌ NOT GEOCODABLE → would be dropped\n`);
      failed++;
      continue;
    }
    const distM = haversineMeters(cityRef, { lat: geo.lat, lon: geo.lon });
    console.log(
      `   ✅ ${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}  (${Math.round(distM)} m from center, src=${geo.source}, conf=${geo.confidence})`,
    );
    console.log(`   maps: https://www.google.com/maps?q=${geo.lat},${geo.lon}\n`);
    geocoded++;
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(`Result: ${geocoded}/${candidates.length} candidates geocoded`);
  console.log(`        ${failed} dropped (not on Google/Nominatim)`);
  console.log("══════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
