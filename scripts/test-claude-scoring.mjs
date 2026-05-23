/**
 * Local test : Claude scoring step ONLY (Google bypassed with mock data).
 *
 * Validates the HEART of pipeline-simple : can Claude correctly
 * identify and rank Cathar-themed sites from a realistic pool of
 * Béziers candidates ?
 *
 * Mock pool below = the realistic mix of POIs Google Places nearbysearch
 * would return for Béziers (extracted from V5-bis/V6 actual results).
 *
 * Expected outcome :
 *   - Cathédrale Saint-Nazaire → Tier 1, score 9-10
 *   - Église de la Madeleine → Tier 1, score 9-10
 *   - Basilique Saint-Aphrodise → Tier 2, score 5-7 (right era, no tie)
 *   - Pont Vieux → Tier 2, score 5-7
 *   - Arènes Romaines → Tier 3, score 1-3 (wrong era)
 *   - Plateau des Poètes → Tier 3, score 1-3 (modern park)
 *   - 9 Écluses de Fonseranes → Tier 3, score 0-2 (18th-c canal)
 *   - Château de Raissac → Tier 3, score 1-3 (lodging facility)
 *   - Théâtre Municipal → Tier 3, score 1-3 (19th-c civic)
 *
 * If Claude correctly ranks these → ship the pipeline.
 */
import { config } from "dotenv";
config({ path: "/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local" });

import Anthropic from "@anthropic-ai/sdk";

// REALISTIC mock pool for Béziers (based on what Google nearbysearch
// actually returns within 2.5km of city center, post type-filter).
const MOCK_POOL = [
  {
    name: "Cathédrale Saint-Nazaire de Béziers",
    types: ["church", "place_of_worship", "tourist_attraction"],
    rating: 4.7,
    userRatingsTotal: 1850,
    distanceM: 350,
  },
  {
    name: "Église de la Madeleine",
    types: ["church", "place_of_worship"],
    rating: 4.5,
    userRatingsTotal: 320,
    distanceM: 80,
  },
  {
    name: "Basilique Saint-Aphrodise",
    types: ["church", "place_of_worship", "tourist_attraction"],
    rating: 4.4,
    userRatingsTotal: 290,
    distanceM: 520,
  },
  {
    name: "Pont Vieux",
    types: ["tourist_attraction"],
    rating: 4.6,
    userRatingsTotal: 1100,
    distanceM: 720,
  },
  {
    name: "Arènes Romaines de Béziers",
    types: ["tourist_attraction", "historical_landmark"],
    rating: 4.0,
    userRatingsTotal: 75,
    distanceM: 900,
  },
  {
    name: "Plateau des Poètes",
    types: ["park", "tourist_attraction"],
    rating: 4.5,
    userRatingsTotal: 2400,
    distanceM: 1100,
  },
  {
    name: "Théâtre Municipal de Béziers",
    types: ["tourist_attraction"],
    rating: 4.4,
    userRatingsTotal: 130,
    distanceM: 250,
  },
  {
    name: "Les 9 Écluses de Fonseranes",
    types: ["tourist_attraction", "historical_landmark"],
    rating: 4.5,
    userRatingsTotal: 8200,
    distanceM: 3100,
  },
  {
    name: "Maison de Ma Région de l'Hérault",
    types: ["city_hall"],
    rating: 4.2,
    userRatingsTotal: 45,
    distanceM: 180,
  },
  {
    name: "Pont-canal de l'Orb",
    types: ["tourist_attraction"],
    rating: 4.6,
    userRatingsTotal: 1900,
    distanceM: 2300,
  },
  {
    name: "Allées Paul Riquet",
    types: ["tourist_attraction"],
    rating: 4.4,
    userRatingsTotal: 880,
    distanceM: 290,
  },
  {
    name: "Église des Pénitents Bleus",
    types: ["church", "place_of_worship"],
    rating: 4.3,
    userRatingsTotal: 75,
    distanceM: 410,
  },
  {
    name: "Musée du Biterrois",
    types: ["museum", "tourist_attraction"],
    rating: 4.0,
    userRatingsTotal: 220,
    distanceM: 380,
  },
  {
    name: "Place de la Madeleine",
    types: ["tourist_attraction"],
    rating: 4.3,
    userRatingsTotal: 45,
    distanceM: 75,
  },
  {
    name: "Tour Pépézuc",
    types: ["historical_landmark"],
    rating: 4.4,
    userRatingsTotal: 60,
    distanceM: 220,
  },
  {
    name: "Hôtel de Ville de Béziers",
    types: ["city_hall", "tourist_attraction"],
    rating: 4.1,
    userRatingsTotal: 90,
    distanceM: 270,
  },
  {
    name: "Square Jean Moulin",
    types: ["park"],
    rating: 4.2,
    userRatingsTotal: 35,
    distanceM: 340,
  },
  {
    name: "Halles de Béziers",
    types: ["tourist_attraction"],
    rating: 4.3,
    userRatingsTotal: 410,
    distanceM: 460,
  },
];

const SYSTEM_PROMPT = `You are a heritage historian scoring outdoor escape-game candidate stops.

For each candidate POI in the pool, decide :
  1. How well does it fit the THEME ? (0-10 score, see scale below)
  2. What TIER is it ? (1 = canonical-for-theme, 2 = era-compatible heritage, 3 = generic-era-OK)
  3. Is there a REAL named figure tied to it ? (if you know one)
  4. Is there a REAL dated event tied to it ? (if you know one)

═══════════════════════════════════════════════════════════
SCORE SCALE (0-10)
═══════════════════════════════════════════════════════════
  10  THE iconic landmark for this theme
      Ex: Tour de Constance for "Huguenot prison 1572"
  7-9 Directly tied to theme : same person/event/era documented
  4-6 Era-compatible heritage, atmospheric fit
      Ex: 12th-c church in town for a Cathar massacre 1209 theme
  1-3 Right city wrong era OR irrelevant theme
      Ex: 19th-c park for a 1209 medieval theme
  0   Anti-thematic / breaks the period feel
      Ex: aquarium for a historical theme

═══════════════════════════════════════════════════════════
TIER PRIORITY
═══════════════════════════════════════════════════════════
  TIER 1 — Score 7-10 — canonical theme anchor
  TIER 2 — Score 4-6 — era-compatible heritage
  TIER 3 — Score 1-3 — generic / wrong era

═══════════════════════════════════════════════════════════
REAL FIGURES / EVENTS
═══════════════════════════════════════════════════════════
Only cite if you are CONFIDENT (Wikipedia-grade fact). If uncertain,
omit. Never fabricate.

OUTPUT — strict JSON ONLY (no markdown) :
{
  "candidates": [
    {
      "index": 0,
      "themeScore": 8,
      "rationale": "12th-c basilica, era-fit for Cathar narrative",
      "tier": 2,
      "realFigure": { "name": "...", "role": "...", "lifespan": "..." },
      "realEvent": { "date": "...", "description": "..." }
    },
    ... one entry PER candidate, no skips
  ]
}`;

const USER_PROMPT = `THEME : The Sorcerer and the Muggles
THEME DESCRIPTION : Cathar sorcery and the 1209 Albigensian Crusade massacre of Béziers. The most powerful Cathar parfait hid a coded grimoire throughout the medieval city before crusaders breached the walls on July 22, 1209.
CITY : Beziers, France

PRODUCT DESCRIPTION (customer's promise) :
"""Béziers, July 22, 1209. The crusaders encircle the city. Within the walls, Catholics and Cathars have lived side by side for decades. The Cathars — those "sorcerers" the Church accuses of possessing forbidden knowledge — know that time is running out. The most powerful among them, a parfait known as the Sorcerer of Béziers, spent his final hours concealing a coded grimoire throughout the city. His secrets — a blend of alchemy, ciphered manuscripts, and advanced medieval knowledge — must not fall into the hands of the Inquisitors. Eight centuries later, you are the initiates tasked with reassembling the grimoire."""

CANDIDATES (${MOCK_POOL.length}) :
${MOCK_POOL.map((c, i) => `[${i}] ${c.name} | types=[${c.types.join(",")}] | rating=${c.rating}(${c.userRatingsTotal}) | distance=${c.distanceM}m`).join("\n")}

Score each candidate. Return JSON only.`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY missing");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  console.log(`Scoring ${MOCK_POOL.length} Béziers candidates vs "1209 Cathar massacre" theme...\n`);
  const t0 = Date.now();
  const msg = await client.messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
    },
    { timeout: 60_000 },
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Claude responded in ${dt}s\n`);

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(jsonText);
  const scored = parsed.candidates ?? [];

  // Sort by tier asc, score desc
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.themeScore - a.themeScore;
  });

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log("RANKED CANDIDATES (Tier asc, Score desc) :\n");

  for (const c of scored) {
    const cand = MOCK_POOL[c.index];
    const figureNote = c.realFigure
      ? ` 👤 ${c.realFigure.name}${c.realFigure.lifespan ? ` (${c.realFigure.lifespan})` : ""} — ${c.realFigure.role}`
      : "";
    const eventNote = c.realEvent
      ? ` 📅 ${c.realEvent.date} — ${c.realEvent.description}`
      : "";
    console.log(
      `T${c.tier} | ${String(c.themeScore).padStart(2)}/10 | ${cand?.name ?? `[unknown idx ${c.index}]`}`,
    );
    console.log(`        ${c.rationale}`);
    if (figureNote) console.log(`       ${figureNote}`);
    if (eventNote) console.log(`       ${eventNote}`);
    console.log("");
  }

  const tier1 = scored.filter((c) => c.tier === 1);
  const tier2 = scored.filter((c) => c.tier === 2);
  const tier3 = scored.filter((c) => c.tier === 3);

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log(
    `SUMMARY : ${scored.length} scored | T1=${tier1.length} | T2=${tier2.length} | T3=${tier3.length}`,
  );

  // Build a final 7-stop selection
  console.log("\n══════ FINAL 7-STOP SELECTION ══════\n");
  const top7 = scored.slice(0, 7);
  const avg = top7.reduce((s, c) => s + c.themeScore, 0) / top7.length;
  for (let i = 0; i < top7.length; i++) {
    const c = top7[i];
    const cand = MOCK_POOL[c.index];
    console.log(`${i + 1}. ${cand?.name ?? "?"}  (T${c.tier}, ${c.themeScore}/10)`);
  }
  console.log(`\nAverage thematic score : ${avg.toFixed(2)}/10`);
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
