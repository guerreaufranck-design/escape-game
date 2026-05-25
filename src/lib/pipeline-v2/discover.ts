/**
 * DISCOVERY v4 — Perplexity sonar-deep-research, MAXIMUM coverage.
 *
 * Mandat user 2026-05-25 :
 *   - "j'ai dit le maximum" — pas 10-30, le MAXIMUM
 *   - Pas de pré-sélection à cette étape
 *   - Pas de filtre côté code
 *   - Contrainte rayon 1.75 km dans le prompt (diamètre 3.5 km imposé)
 *
 * Perplexity sort TOUT ce qu'il trouve. Google geocode ensuite (sans
 * filtre). Perplexity (passe 2) sélectionne les 8 meilleurs en fonction
 * du scénario.
 */

import type { DiscoveredLandmark, DiscoveryResult, PipelineInput } from "./types";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar-deep-research";

/** Diamètre walking imposé par le mandat user. */
export const WALKING_DIAMETER_KM = 3.5;

/**
 * Calcule le rayon de recherche en km en fonction du mode de transport
 * et du radius envoyé par OddballTrip.
 *
 *   - walking          → 1.75 km (diamètre 3.5 km, mandat user 2026-05-25)
 *   - mixed/driving    → input.radiusKm si présent (ex: roadtrip Étretat 60 km)
 *                        sinon défaut 15 km (= diamètre 30 km)
 */
export function computeRadiusKm(input: PipelineInput): number {
  const mode = input.transportMode ?? "walking";
  if (mode === "walking") {
    return WALKING_DIAMETER_KM / 2;
  }
  // Mixed / driving — roadtrip : on respecte ce qu'OddballTrip a envoyé
  if (typeof input.radiusKm === "number" && input.radiusKm > 0) {
    return input.radiusKm;
  }
  return 15; // défaut roadtrip si payload silencieux
}

export function buildDiscoveryPrompt(input: PipelineInput): string {
  if (!input.startPoint) {
    throw new Error("startPoint is required for discovery");
  }

  const { lat, lon } = input.startPoint;
  const radiusKm = computeRadiusKm(input);
  const mode = input.transportMode ?? "walking";

  return `I'm designing an outdoor experience in ${input.city}${
    input.country ? `, ${input.country}` : ""
  } — a CITY-TOUR played with a narrative theme layered on top.

**Theme (narrative overlay)**: ${input.theme}
${input.themeDescription ? `**Brief**: ${input.themeDescription}` : ""}
${input.productDescription ? `**Role-play context**: ${input.productDescription}` : ""}
${input.narrative ? `**Narrative direction**: ${input.narrative}` : ""}

**Start point GPS**: ${lat}, ${lon}
**Transport mode**: ${mode}
**Constraint**: every landmark must be within a ${radiusKm} km radius of the start point (diameter ${radiusKm * 2} km).

## CRITICAL — what to include

This product is FIRST a city tour, SECOND a thematic game. The customer pays to discover the city's MAJOR heritage while playing — the theme is a narrative thread woven on top.

**List the MAJOR landmarks of the city within the radius**, even if they have no direct link to the theme or scenario.

Include the city's **major sites only** :
- Historic monuments and significant buildings
- Major churches, cathedrals, abbeys
- Castles, fortresses, ramparts
- Famous squares, iconic bridges
- Major museums
- Notable viewpoints, beaches, cliffs (if cultural/touristic significance)
- Important memorials

**Exclude** : small commerce, minor curiosities, generic gardens, ordinary public buildings (post offices, schools), commemorative plaques unless famous.

A great viewpoint, a famous bridge, the main cathedral — these ALL belong in the list, even if they have no direct link to the theme. Claude will weave the thematic narrative around them in a later step.

**Do NOT pre-filter on theme relevance**. The thematic selection happens in a second pass.

For each landmark provide:
- **Exact name** as it appears on Google Maps / official sources
- **Brief description** (1 sentence about what it is)
- **Source** (Wikipedia, tourist board, OSM, news, archive — anything reliable)

## Format

Respond in clean markdown with exactly these sections :

### Editorial Warning
2-3 sentences if the scenario contains historically problematic or inaccurate angles. Write "None" if no warning.

### Landmarks
Numbered list. For each :

\`\`\`
N. **Exact landmark name**
- Relevance: <1 sentence>
- Source: <citation>
\`\`\`

Start directly with "### Editorial Warning". No preamble.`;
}

export async function callPerplexity(prompt: string): Promise<{
  content: string;
  citations: string[];
}> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");

  const res = await fetch(PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 8000,
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
  landmarks: Array<{ order: number; name: string; relevance: string; source?: string }>;
  warning?: string;
} {
  const warningMatch = markdown.match(
    /#{2,4}\s*Editorial\s+Warning[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );
  const landmarksMatch = markdown.match(
    /#{2,4}\s*Landmarks[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );

  const warning = warningMatch?.[1]?.trim();
  const cleanWarning =
    warning && !/^none|^aucun|^no\s+/i.test(warning) ? warning : undefined;

  const landmarks: Array<{
    order: number;
    name: string;
    relevance: string;
    source?: string;
  }> = [];

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
      const relevance = extractField(subBody, ["relevance", "pertinence", "why"]) ?? "";
      const source = extractField(subBody, ["source", "citation"]);
      landmarks.push({
        order: positions[i].order,
        name: positions[i].name,
        relevance,
        source,
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

export async function runDiscovery(input: PipelineInput): Promise<DiscoveryResult> {
  if (!input.startPoint) {
    throw new Error("startPoint missing — pipeline requires explicit start point");
  }

  const radiusKm = computeRadiusKm(input);
  console.log(`[discover] Perplexity sonar-deep-research, max landmarks, rayon ${radiusKm} km (mode=${input.transportMode ?? "walking"}) autour de ${input.startPoint.lat},${input.startPoint.lon}`);
  const t0 = Date.now();
  const prompt = buildDiscoveryPrompt(input);
  const { content, citations } = await callPerplexity(prompt);
  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`[discover] Perplexity done in ${dur}s, ${content.length} chars, ${citations.length} citations`);

  const parsed = parseDiscoveryMarkdown(content);
  console.log(`[discover] ${parsed.landmarks.length} landmarks bruts trouvés, warning=${parsed.warning ? "YES" : "no"}`);

  if (parsed.landmarks.length < 5) {
    throw new Error(
      `Discovery returned only ${parsed.landmarks.length} landmarks (need ≥5 minimum from research). Preview: ${content.slice(0, 500)}`,
    );
  }

  const landmarks: DiscoveredLandmark[] = parsed.landmarks.map((l) => ({
    order: l.order,
    name: l.name,
    narrativeTitle: l.relevance,
    riddle: "",
    answer: "",
    hint: "",
    anecdote: l.relevance,
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
