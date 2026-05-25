/**
 * DISCOVER v5 — Perplexity sonar standard, prompt validé par l'opérateur.
 *
 * Philosophie :
 *   - City-tour FIRST : on cherche les richesses culturelles/historiques/
 *     touristiques de la ville. Le thème est une couche narrative en
 *     surcouche.
 *   - Ce que cherche un touriste dans un Lonely Planet / Le Routard / Michelin
 *   - EXCLURE : mairie, écoles, postes, gares, hôpitaux, commerces,
 *     hôtels, parcs génériques, bâtiments modernes sans statut
 *   - INCLURE : monuments historiques, cathédrales, châteaux, musées,
 *     places iconiques, ponts célèbres, mémoriaux significatifs,
 *     UNESCO, monuments classés
 *
 * Modèle : sonar (standard, rapide ~5-10s). Si hallucinations fréquentes,
 * passer à sonar-deep-research via CONFIG.PERPLEXITY_DISCOVER_MODEL.
 */

import { CONFIG } from "./config";
import type { DiscoveredLandmark, DiscoveryResult, PipelineInput } from "./types";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

export function buildDiscoveryPrompt(input: PipelineInput): string {
  const { lat, lon } = input.startPoint;
  const modeDesc = {
    walking: "walking",
    mixed: "mixed (car + walking)",
    driving: "driving",
  }[input.transportMode];

  return `I'm designing an outdoor escape game / city tour in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

Audience : tourists who DO NOT KNOW this city. No insider knowledge required.

**Scenario (narrative overlay)**:
- Theme: ${input.theme}
- Brief: ${input.themeDescription ?? "(none)"}
- Role-play: ${input.productDescription ?? "(none)"}
- Narrative direction: ${input.narrative ?? "(none)"}

**Geographic constraints**:
- Start point: ${lat}, ${lon}${input.startPointText ? ` (${input.startPointText})` : ""}
- Transport mode: ${modeDesc}
- Search radius: ${input.radiusKm} km around the start point
- Estimated duration: ${input.estimatedDurationMin} minutes total

**Your task**

This is FIRST a city-tour, SECOND a thematic game. The customer pays to discover the CULTURAL, HISTORIC AND TOURISTIC HERITAGE of the city while playing — the theme is a narrative layer on top.

List the **cultural / historic / touristic landmarks** within the radius. The good question to ask :

> "If a tourist with 1 day in this city pulled out a Lonely Planet / Le Routard / Michelin guide, what would the guide tell them to visit?"

**Include** (= what guidebooks list) :
- Historic monuments (cathedrals, abbeys, castles, fortresses, towers, ramparts)
- Heritage residences (princely residences, famous houses, châteaux)
- Major museums + archaeological sites
- Iconic squares, bridges, fountains, statues
- Famous gardens, viewpoints
- Beaches, cliffs, natural sites of cultural significance
- Memorials and commemorative sites IF they mark a historically significant event (Stolpersteine, war memorials, slavery memorials, etc)
- UNESCO sites, Monuments Historiques classés

**Exclude** (= what a guidebook would skip) :
- Mairie / town hall / city hall (administrative, not heritage)
- Schools, post offices, hospitals
- Ordinary public buildings without cultural status
- Shops, restaurants, hotels
- Modern buildings without architectural significance
- Generic parks without cultural anchor
- Train / bus stations (unless architecturally listed)

**Reachability**: respect the transport mode. Walking = walkable in the duration. Mixed/driving = car-accessible, can be farther.

For each landmark provide :
1. **Exact canonical name** as on Google Maps (in local language : "Cathédrale Saint-Florin", not English translation)
2. **Brief description** — 1 sentence : what is it culturally / historically
3. **Source** — Wikipedia URL, tourist board, or Wikidata reference

**Format** :

### Editorial Warning
2-3 sentences if scenario contains historically problematic / inaccurate angles. Write "None" if not.

### Landmarks

\`\`\`
1. **Exact landmark name**
- Description: <1 sentence cultural/historical>
- Source: <URL>

2. **Exact landmark name**
- Description: <1 sentence>
- Source: <URL>

(...all you find, no upper limit, no theme filter...)
\`\`\`

Start directly with "### Editorial Warning". No preamble.`;
}

export async function callPerplexity(prompt: string): Promise<{ content: string; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");

  const res = await fetch(PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.PERPLEXITY_DISCOVER_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: CONFIG.PERPLEXITY_TEMPERATURE,
      max_tokens: CONFIG.PERPLEXITY_MAX_TOKENS,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Perplexity ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return {
    content: json.choices?.[0]?.message?.content ?? "",
    citations: json.citations ?? [],
  };
}

export function parseDiscoveryMarkdown(markdown: string): {
  landmarks: Array<{ order: number; name: string; description: string; source?: string }>;
  warning?: string;
} {
  const warningMatch = markdown.match(/#{2,4}\s*Editorial\s+Warning[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i);
  const landmarksMatch = markdown.match(/#{2,4}\s*Landmarks[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i);

  const warning = warningMatch?.[1]?.trim();
  const cleanWarning = warning && !/^none|^aucun|^no\s+/i.test(warning) ? warning : undefined;

  const landmarks: Array<{ order: number; name: string; description: string; source?: string }> = [];
  if (landmarksMatch) {
    const body = landmarksMatch[1];
    const headerRegex = /(?:^|\n)\s*(\d{1,3})\.\s+\*\*([^*\n]+)\*\*/g;
    const positions: Array<{ index: number; order: number; name: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = headerRegex.exec(body)) !== null) {
      positions.push({
        index: m.index + m[0].length,
        order: parseInt(m[1], 10),
        name: m[2].trim().replace(/^["'«]+|["'»]+$/g, ""),
      });
    }
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      const end =
        i + 1 < positions.length
          ? positions[i + 1].index - positions[i + 1].order.toString().length - 6
          : body.length;
      const subBody = body.slice(start, end);
      landmarks.push({
        order: positions[i].order,
        name: positions[i].name,
        description: extractField(subBody, ["description", "relevance"]) ?? "",
        source: extractField(subBody, ["source", "citation"]),
      });
    }
  }
  return { landmarks, warning: cleanWarning };
}

function extractField(body: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(
      `[-*]\\s*\\*\\*${label}\\*\\*\\s*[:\\s]+([\\s\\S]*?)(?=\\n\\s*[-*]\\s*\\*\\*|\\n\\s*\\d+\\.\\s+\\*\\*|\\n#|$)`,
      "i",
    );
    const mm = body.match(re);
    if (mm) return mm[1].trim();
  }
  return undefined;
}

export async function runDiscover(input: PipelineInput): Promise<DiscoveryResult> {
  console.log(
    `[v5 discover] Perplexity ${CONFIG.PERPLEXITY_DISCOVER_MODEL}, rayon ${input.radiusKm} km (mode=${input.transportMode}) autour de ${input.startPoint.lat},${input.startPoint.lon}`,
  );
  const t0 = Date.now();
  const prompt = buildDiscoveryPrompt(input);
  const { content, citations } = await callPerplexity(prompt);
  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`[v5 discover] Perplexity done in ${dur}s, ${content.length} chars, ${citations.length} citations`);

  const parsed = parseDiscoveryMarkdown(content);
  console.log(
    `[v5 discover] ${parsed.landmarks.length} landmarks bruts, warning=${parsed.warning ? "YES" : "no"}`,
  );

  if (parsed.landmarks.length < CONFIG.MIN_STOPS) {
    throw new Error(
      `Discovery returned only ${parsed.landmarks.length} landmarks (need ≥${CONFIG.MIN_STOPS}). Preview: ${content.slice(0, 500)}`,
    );
  }

  const landmarks: DiscoveredLandmark[] = parsed.landmarks.map((l) => ({
    order: l.order,
    name: l.name,
    narrativeTitle: l.description,
    riddle: "",
    answer: "",
    hint: "",
    anecdote: l.description,
    sources: l.source ? [l.source] : [],
  }));

  return {
    landmarks,
    intro: "",
    epilogue: "",
    warning: parsed.warning,
    citations,
    rawMarkdown: content,
  };
}
