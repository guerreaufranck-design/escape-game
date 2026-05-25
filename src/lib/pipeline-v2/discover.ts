/**
 * DISCOVERY v3 — Perplexity sonar-deep-research, anglais natif.
 *
 * Principe :
 *   - Le payload OddballTrip est en EN natif (theme, themeDescription,
 *     productDescription, narrative). On l'envoie verbatim à Perplexity.
 *   - On demande TOUS les landmarks pertinents au scénario dans un rayon
 *     de 1.75 km du startPoint (diamètre 3.5 km imposé par l'opérateur).
 *   - Pas de limite de nombre — on veut un pool large que Claude triera.
 *   - sonar-deep-research pour minimiser les hallucinations (recherche
 *     approfondie multi-sources avec citations).
 */

import type { DiscoveredLandmark, DiscoveryResult, PipelineInput } from "./types";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar-deep-research";

/** Diamètre max du parcours (km). User mandate 2026-05-25. */
export const MAX_DIAMETER_KM = 3.5;

export function buildDiscoveryPrompt(input: PipelineInput): string {
  if (!input.startPoint) {
    throw new Error("startPoint is required for v3 discovery (rayon de 1.75 km)");
  }

  const { lat, lon } = input.startPoint;
  const radiusKm = MAX_DIAMETER_KM / 2;

  return `I'm designing an outdoor escape game in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

**Theme**: ${input.theme}
${input.themeDescription ? `**Brief**: ${input.themeDescription}` : ""}
${input.productDescription ? `**Role-play context**: ${input.productDescription}` : ""}
${input.narrative ? `**Narrative direction**: ${input.narrative}` : ""}

**Start point**: ${lat}, ${lon}
**Hard constraint**: all landmarks MUST be physically within a ${radiusKm} km radius (diameter ${MAX_DIAMETER_KM} km) of the start point. Outside this zone = not usable.

## Your task

List ALL landmarks (monuments, historic sites, squares, bridges, statues, museums, churches, gardens, viewpoints, memorials, commemorative plaques, local curiosities, anything visitable from outside) that are RELEVANT to this scenario and located within ${radiusKm} km of the start point.

**Do NOT limit yourself to 8 landmarks**. Give EVERYTHING that fits. The thematic selection will be done later by another step. Right now I need maximum coverage — better to have 25 candidates than 8.

For each landmark provide:
- **Precise name** (specific enough that Google Maps will find it unambiguously, e.g. "Cathédrale Saint-Florin de Vaduz" not just "the cathedral")
- **Why it's relevant** to the scenario (1 sentence)
- **Source** (Wikipedia, tourist board, OSM, news, archive — whatever you find, cite it)

## Format

Respond in clean markdown with these exact section headers :

### Editorial Warning
2-3 sentences if the scenario contains historically problematic or inaccurate angles (e.g. fictional events presented as historical fact). Write "None" if no warning.

### Landmarks
Numbered list. For each landmark :

\`\`\`
N. **Precise landmark name**
- Relevance: <1 sentence>
- Source: <citation>
\`\`\`

### Suggested Order
Just list the names in walking order, comma-separated.

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
      max_tokens: 6000,
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

/**
 * Parse le markdown structuré de Perplexity.
 * Tolérant aux variantes (## au lieu de ###, sections manquantes, etc).
 */
export function parseDiscoveryMarkdown(
  markdown: string,
): {
  landmarks: Array<{ order: number; name: string; relevance: string; source?: string }>;
  warning?: string;
  suggestedOrder: string[];
} {
  // Sections
  const warningMatch = markdown.match(
    /#{2,4}\s*Editorial\s+Warning[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );
  const landmarksMatch = markdown.match(
    /#{2,4}\s*Landmarks[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );
  const orderMatch = markdown.match(
    /#{2,4}\s*Suggested\s+Order[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );

  const warning = warningMatch?.[1]?.trim();
  const cleanWarning =
    warning && !/^none|^aucun|^no\s+/i.test(warning) ? warning : undefined;

  const suggestedOrder = orderMatch?.[1]
    ? orderMatch[1]
        .split(/[,\n]/)
        .map((s) => s.replace(/^\s*\d+\.\s*/, "").replace(/^\*+|\*+$/g, "").trim())
        .filter((s) => s.length > 2)
    : [];

  const landmarks: Array<{ order: number; name: string; relevance: string; source?: string }> = [];
  if (landmarksMatch) {
    const body = landmarksMatch[1];
    // Match each numbered item with its details
    const headerRegex = /(?:^|\n)\s*(\d{1,2})\.\s+\*\*([^*\n]+)\*\*/g;
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

  return { landmarks, warning: cleanWarning, suggestedOrder };
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
    throw new Error("startPoint missing — v3 pipeline requires explicit start point");
  }

  console.log(`[v3 discover] Calling Perplexity sonar-deep-research for ${input.city}...`);
  const t0 = Date.now();
  const prompt = buildDiscoveryPrompt(input);
  const { content, citations } = await callPerplexity(prompt);
  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[v3 discover] Perplexity done in ${dur}s — ${content.length} chars, ${citations.length} citations`,
  );

  const parsed = parseDiscoveryMarkdown(content);
  console.log(
    `[v3 discover] Parsed ${parsed.landmarks.length} landmarks, warning=${parsed.warning ? "YES" : "no"}`,
  );

  if (parsed.landmarks.length < 5) {
    throw new Error(
      `Discovery returned only ${parsed.landmarks.length} landmarks (need ≥5 to start). Preview: ${content.slice(0, 500)}`,
    );
  }

  // Adapt to DiscoveredLandmark shape (riddle/answer/anecdote filled later by select.ts)
  const landmarks: DiscoveredLandmark[] = parsed.landmarks.map((l) => ({
    order: l.order,
    name: l.name,
    narrativeTitle: l.relevance,
    riddle: "",
    answer: "",
    hint: "",
    anecdote: l.relevance, // temp, replaced by select.ts
    sources: l.source ? [l.source] : [],
  }));

  return {
    landmarks,
    intro: "", // generated by select.ts in EN
    epilogue: "",
    warning: parsed.warning,
    citations,
    rawMarkdown: content,
  };
}
