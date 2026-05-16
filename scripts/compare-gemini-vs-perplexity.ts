/**
 * A/B test : compare Gemini 2.5 Pro (grounded) vs Perplexity Sonar Deep
 * Research on the exact same Alba Resistance prompt. We're deciding which
 * one becomes the discovery backbone — quality matters more than the
 * 250× cost gap (Gemini 70€/month vs Perplexity 17500€/month at scale).
 *
 * Usage:
 *   npx tsx scripts/compare-gemini-vs-perplexity.ts
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

for (const rel of [".env.local", "../.env.local", "../../.env.local", "../../../.env.local", "../../../../.env.local"]) {
  const p = resolve(process.cwd(), rel);
  if (existsSync(p)) {
    config({ path: p, override: true });
    break;
  }
}

import { discoverThematicPois } from "../src/lib/ai-discovery";

const ALBA_PARAMS = {
  city: "Alba",
  country: "Italy",
  title: "La Résistance d'Alba",
  theme: "Résistance partisane Alba 1944",
  themeDescription:
    "Outdoor walking game on the 23-day Republic of Alba (October-November 1944), the partisan uprising led by Enrico Martini 'Mauri', and the literary chronicle of these events by Beppe Fenoglio.",
  startPoint: { lat: 44.7005, lon: 8.0354 },
  stopCount: 8,
  diameterCapM: 3_500,
};

const PERPLEXITY_PROMPT = `You are a heritage-and-place researcher building an outdoor walking game.

GAME
  Title: "${ALBA_PARAMS.title}"
  Theme: "${ALBA_PARAMS.theme}"
  Theme description: "${ALBA_PARAMS.themeDescription}"
  City: ${ALBA_PARAMS.city}, ${ALBA_PARAMS.country}
  Start point GPS: ${ALBA_PARAMS.startPoint.lat.toFixed(6)}, ${ALBA_PARAMS.startPoint.lon.toFixed(6)}

TASK
  Find 12 locations in ${ALBA_PARAMS.city} that are HISTORICALLY DOCUMENTED as directly linked to the theme. Cite the source.

HARD CONSTRAINTS
  1. Each location must be a REAL physical place with a street address that Google Maps can geocode.
  2. The maximum pairwise distance between any two locations (start point included) must be ≤ 3.5 km.
  3. Prefer locations of clear historical relevance: memorials, plaques, study centres, family residences, original buildings, public squares with documented events. Avoid modern hotels, restaurants, art galleries, or parks unless they are themselves of documented historical importance.
  4. Spread the locations across the city.

OUTPUT — JSON array, no markdown, no commentary:
[
  {
    "name": "<canonical local name as Google Maps would have it>",
    "address": "<full street address>",
    "lat": <number 6 decimals>,
    "lon": <number 6 decimals>,
    "historical_role": "<one sentence: why this matters for the theme>",
    "citation": "<URL or short source>",
    "access": "always_open" | "limited_access" | "unknown"
  }
]

Output ONLY the JSON array.`;

async function callPerplexity(): Promise<{
  rawText: string;
  durationMs: number;
  citations: string[];
}> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");

  const t0 = Date.now();
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar-deep-research",
      messages: [
        { role: "system", content: "You are a heritage-tourism researcher. Output only valid JSON arrays as requested." },
        { role: "user", content: PERPLEXITY_PROMPT },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`Perplexity HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  const citations: string[] = data?.citations ?? [];
  return { rawText: text, durationMs: Date.now() - t0, citations };
}

function extractJsonArray(raw: string): unknown[] | null {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("A/B test : Gemini 2.5 Pro grounded vs Perplexity Sonar Deep Research");
  console.log(`Subject : ${ALBA_PARAMS.title}`);
  console.log("══════════════════════════════════════════════════════════════════\n");

  // Run both in parallel
  console.log("Lancement parallèle Gemini + Perplexity...\n");
  const [geminiResult, perplexityResult] = await Promise.allSettled([
    (async () => {
      const t0 = Date.now();
      const pois = await discoverThematicPois(ALBA_PARAMS);
      return { pois, durationMs: Date.now() - t0 };
    })(),
    callPerplexity(),
  ]);

  // ─── Gemini summary ───
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("GEMINI 2.5 PRO (grounded)");
  console.log("─────────────────────────────────────────────────────────────────");
  if (geminiResult.status === "fulfilled") {
    const { pois, durationMs } = geminiResult.value;
    console.log(`✓ ${pois.length} POIs en ${Math.round(durationMs / 1000)}s`);
    for (const [i, p] of pois.entries()) {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     ${p.address}`);
      console.log(`     ${p.patrimonialRole.slice(0, 100)}${p.patrimonialRole.length > 100 ? "…" : ""}`);
    }
  } else {
    console.log(`✗ FAIL: ${geminiResult.reason}`);
  }

  console.log("");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("PERPLEXITY SONAR DEEP RESEARCH");
  console.log("─────────────────────────────────────────────────────────────────");
  if (perplexityResult.status === "fulfilled") {
    const { rawText, durationMs, citations } = perplexityResult.value;
    console.log(`Reçu en ${Math.round(durationMs / 1000)}s, ${citations.length} citations dans le payload\n`);

    const parsed = extractJsonArray(rawText);
    if (parsed) {
      console.log(`✓ ${parsed.length} POIs parsés:\n`);
      for (const [i, item] of parsed.entries()) {
        if (typeof item !== "object" || item === null) continue;
        const o = item as Record<string, unknown>;
        console.log(`  ${i + 1}. ${o.name ?? "(no name)"}`);
        console.log(`     ${o.address ?? "(no address)"}`);
        console.log(`     ${typeof o.historical_role === "string" ? o.historical_role.slice(0, 100) : "(no role)"}${typeof o.historical_role === "string" && o.historical_role.length > 100 ? "…" : ""}`);
      }
    } else {
      console.log(`✗ Could not parse JSON. Raw output:\n${rawText.slice(0, 2000)}`);
    }

    if (citations.length > 0) {
      console.log(`\nCITATIONS (top 10):`);
      for (const [i, c] of citations.slice(0, 10).entries()) {
        console.log(`  [${i + 1}] ${c}`);
      }
    }
  } else {
    console.log(`✗ FAIL: ${perplexityResult.reason}`);
  }
}

main().catch((e) => {
  console.error("Script crashed:", e);
  process.exit(1);
});
