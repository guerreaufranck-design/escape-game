/**
 * Local test runner for pipeline-simple.ts
 *
 * Runs the FULL simple discovery pipeline against REAL API keys (Google +
 * Anthropic), prints the output. Lets us validate quality + reliability
 * BEFORE deploying to production.
 *
 * Usage :
 *   cd /Users/franckguerreau/Documents/ESCAPE-GAME
 *   npx tsx .claude/worktrees/great-cartwright-89fbe9/scripts/test-pipeline-simple.mjs
 */
import { config } from "dotenv";
config({ path: "/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local" });

import { runSimpleDiscovery } from "../src/lib/pipeline-simple.ts";

// Béziers Cathares — the niche stress test
const TEST_CASE = {
  city: "Beziers",
  country: "France",
  theme: "The Sorcerer and the Muggles",
  themeDescription:
    "Cathar sorcery and the 1209 Albigensian Crusade massacre of Béziers. The most powerful Cathar parfait, known as the Sorcerer of Béziers, hid a coded grimoire throughout the medieval city before the crusaders breached the walls on July 22, 1209.",
  productDescription: `Béziers, July 22, 1209. The crusaders encircle the city. Within the walls, Catholics and Cathars have lived side by side for decades. The Cathars — those "sorcerers" the Church accuses of possessing forbidden knowledge — know that time is running out. The most powerful among them, a parfait known as the Sorcerer of Béziers, spent his final hours concealing a coded grimoire throughout the city. His secrets — a blend of alchemy, ciphered manuscripts, and advanced medieval knowledge — must not fall into the hands of the Inquisitors. Eight centuries later, you are the initiates tasked with reassembling the grimoire.`,
  startPoint: { lat: 43.3449428, lon: 3.2130024 },
  targetStopCount: 7,
  minStopCount: 5,
};

async function main() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log(`TEST : ${TEST_CASE.theme}`);
  console.log(`CITY : ${TEST_CASE.city}, ${TEST_CASE.country}`);
  console.log(
    `START : ${TEST_CASE.startPoint.lat}, ${TEST_CASE.startPoint.lon}`,
  );
  console.log(`TARGET : ${TEST_CASE.targetStopCount} stops, floor ${TEST_CASE.minStopCount}`);
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  const t0 = Date.now();
  const result = await runSimpleDiscovery(TEST_CASE);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n══════ DIAGNOSTICS ══════\n");
  console.log(`success         : ${result.success}`);
  console.log(`duration        : ${dt}s`);
  console.log(`raw pool        : ${result.diagnostics.rawPoolCount}`);
  console.log(`after filter    : ${result.diagnostics.afterTypeFilter}`);
  console.log(`Claude scored   : ${result.diagnostics.scoredCount}`);
  console.log(
    `tier counts     : T1=${result.diagnostics.tier1Count} T2=${result.diagnostics.tier2Count} T3=${result.diagnostics.tier3Count}`,
  );
  console.log(`average score   : ${result.diagnostics.averageScore}`);
  console.log(`min score final : ${result.diagnostics.minScoreInFinal}`);
  console.log(`fallback used   : ${result.diagnostics.fallbackUsed}`);

  if (result.errorMessage) {
    console.log(`\n❌ ERROR : ${result.errorMessage}`);
  }

  console.log("\n══════ NOTES ══════\n");
  for (const n of result.diagnostics.notes) console.log(`  • ${n}`);

  console.log(`\n══════ ${result.stops.length} STOPS ══════\n`);
  for (let i = 0; i < result.stops.length; i++) {
    const s = result.stops[i];
    console.log(`${i + 1}. ${s.name}`);
    console.log(`   Tier ${s.tier} | Score ${s.themeScore}/10`);
    console.log(`   GPS ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} | ${Math.round(s.distanceFromStartM)}m from start`);
    console.log(`   Rationale: ${s.rationale}`);
    if (s.realFigure) {
      console.log(
        `   👤 Real figure : ${s.realFigure.name} (${s.realFigure.lifespan ?? "?"}) — ${s.realFigure.role}`,
      );
    }
    if (s.realEvent) {
      console.log(
        `   📅 Real event : ${s.realEvent.date} — ${s.realEvent.description}`,
      );
    }
    console.log("");
  }

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log(
    `RESULT : ${result.success ? "✅ SUCCESS" : "❌ FAILED"}  (${dt}s, ${result.stops.length} stops)`,
  );
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
}

main().catch((err) => {
  console.error("UNCAUGHT ERROR:", err);
  process.exit(1);
});
