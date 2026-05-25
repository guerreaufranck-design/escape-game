/**
 * SELECT v4 — 2e appel Perplexity (= passe de sélection).
 *
 * Mandat user 2026-05-25 :
 *   "on va remettre en sortie de geocode perplexity qui choisit les meilleurs
 *    landmarks pour ce jeu 8 mini 5 attention le 5 est cas extrême"
 *
 * Reçoit :
 *   - Le scénario complet (theme, themeDescription, productDescription, narrative)
 *   - Le pool géocodé (sortie de geocode.ts) : nom Perplexity + nom Google +
 *     coords GPS + distance du startPoint
 *
 * Perplexity (sonar-deep-research) sélectionne les 8 meilleurs landmarks
 * pour ce scénario, en respectant le rayon, et propose un ordre de parcours.
 *
 * Si Perplexity en renvoie < 5 → on remonte une erreur (alerte email dans
 * l'orchestrator).
 */

import type { GeocodeResult, GeocodedLandmark, PipelineInput } from "./types";
import { computeRadiusKm } from "./discover";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar-deep-research";

export interface SelectionResult {
  /** Les 5-8 landmarks sélectionnés par Perplexity, dans l'ordre de visite. */
  selected: GeocodedLandmark[];
  /** Markdown brut de la réponse Perplexity pour audit. */
  rawMarkdown: string;
  /** Citations Perplexity. */
  citations: string[];
}

function buildSelectionPrompt(
  input: PipelineInput,
  geocode: GeocodeResult,
): string {
  const radiusKm = computeRadiusKm(input);

  const pool = geocode.geocoded
    .map(
      (g, i) =>
        `${i + 1}. "${g.name}"
   - Google name: "${g.googleName}"
   - GPS: ${g.lat}, ${g.lon}
   - Distance from start: ${g.distanceFromStartM} m
   - Why it fits (research note): ${g.narrativeTitle ?? "(none)"}`,
    )
    .join("\n\n");

  return `I'm finalizing the landmark selection for an outdoor escape game in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

## Scenario (from buyer)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative**: ${input.narrative ?? "(none)"}
**Transport mode**: ${input.transportMode ?? "walking"}
**Start point**: ${input.startPoint!.lat}, ${input.startPoint!.lon}
**Search radius**: ${radiusKm} km

## Geocoded pool (${geocode.geocoded.length} landmarks)

Each landmark below has been geocoded by Google Maps. The GPS coordinates are real and verified. Your job is to PICK the best 8 landmarks for the scenario and ORDER them in the most logical visit sequence.

${pool}

## Your task

1. **Select 8 landmarks** (5 minimum if you really can't find 8). Pick based on :
   - Strongest thematic fit with the scenario
   - Geographic coherence (a logical walking/driving route, no zigzag)
   - Variety (mix iconic + lesser-known if appropriate)
   - Realistic distance for the transport mode (${input.transportMode ?? "walking"})

2. **Order them** in the visit sequence (start near the start point, build narrative momentum, climax near the end).

3. **Reject** any candidate from the pool that doesn't fit the scenario, has wrong coordinates (Google misnamed), or duplicates another.

## Output format (strict)

Respond with exactly this markdown structure :

### Selected Landmarks (in visit order)

\`\`\`
1. **Exact landmark name from the pool**
2. **Exact landmark name from the pool**
...
\`\`\`

### Rationale
One paragraph explaining the selection logic.

Use the EXACT names from the pool above (verbatim, copy-paste). No extras, no inventions. If you select fewer than 5, explain why in the rationale.`;
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
      max_tokens: 3000,
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

function parseSelectionMarkdown(
  markdown: string,
  pool: GeocodedLandmark[],
): GeocodedLandmark[] {
  const selectedMatch = markdown.match(
    /#{2,4}\s*Selected\s+Landmarks[^\n]*\n([\s\S]*?)(?=\n#{2,4}|$)/i,
  );
  if (!selectedMatch) return [];

  const body = selectedMatch[1];
  // Match "N. **Name**" lines
  const headerRegex = /(?:^|\n)\s*(\d{1,2})\.\s+\*\*([^*\n]+)\*\*/g;
  const names: Array<{ order: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(body)) !== null) {
    names.push({
      order: parseInt(m[1], 10),
      name: m[2].trim().replace(/^["'«]+|["'»]+$/g, ""),
    });
  }

  // Match each selected name back to the pool (by exact name OR Google name)
  const result: GeocodedLandmark[] = [];
  for (const sel of names) {
    const hit = pool.find(
      (p) =>
        p.name === sel.name ||
        p.googleName === sel.name ||
        p.name.toLowerCase() === sel.name.toLowerCase() ||
        p.googleName.toLowerCase() === sel.name.toLowerCase(),
    );
    if (hit) {
      // Reassign step_order based on Perplexity's chosen sequence
      result.push({ ...hit, order: sel.order });
    } else {
      console.warn(`[select] Selected name "${sel.name}" not found in pool, skipping`);
    }
  }

  return result;
}

export async function runSelect(
  input: PipelineInput,
  geocode: GeocodeResult,
): Promise<SelectionResult> {
  if (geocode.geocoded.length === 0) {
    throw new Error("No geocoded landmarks to select from");
  }

  console.log(`[select] Perplexity passe 2 — sélection sur pool de ${geocode.geocoded.length} géocodés`);
  const t0 = Date.now();
  const prompt = buildSelectionPrompt(input, geocode);
  const { content, citations } = await callPerplexity(prompt);
  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`[select] Perplexity passe 2 done in ${dur}s`);

  const selected = parseSelectionMarkdown(content, geocode.geocoded);
  console.log(`[select] ${selected.length} landmarks sélectionnés par Perplexity`);

  return {
    selected,
    rawMarkdown: content,
    citations,
  };
}
