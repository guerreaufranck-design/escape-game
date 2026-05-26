/**
 * SELECT v5 — Claude Sonnet 4.5 choisit les 8 best parmi le pool géocodé.
 *
 * Le rôle de Claude : raisonnement sémantique. Il reçoit :
 *   - le pool de landmarks géocodés (nom Perplexity + nom Google + GPS + distance start)
 *   - le scénario complet du buyer
 *   - le mode de transport + rayon
 * Et il choisit :
 *   - TARGET_STOPS (8) — ou MIN_STOPS (5) si vraiment pas possible
 *   - en respectant la qualité city-tour (cf. config)
 *   - en triant en ordre de parcours optimal
 *
 * Output : SelectionResult avec les landmarks choisis (sous-ensemble du pool,
 * dans l'ordre de visite). PAS de riddle/answer/anecdote ici — c'est narrate
 * qui les écrira.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";
import type { GeocodeResult, GeocodedLandmark, PipelineInput } from "./types";

export interface SelectionResult {
  selected: GeocodedLandmark[];
  rationale: string;
  rawMarkdown: string;
}

function buildSelectionPrompt(input: PipelineInput, geocode: GeocodeResult): string {
  const pool = geocode.geocoded
    .map(
      (g, i) =>
        `${i + 1}. "${g.name}"
   - Google name: "${g.googleName}"
   - GPS: ${g.lat}, ${g.lon}
   - Distance from start: ${g.distanceFromStartM} m
   - Description (from research): ${g.narrativeTitle ?? "(none)"}`,
    )
    .join("\n\n");

  // Detect if pool index 0 is a forced start point (marked by runGeocode)
  const hasForcedStart =
    geocode.geocoded.length > 0 &&
    geocode.geocoded[0].narrativeTitle?.includes("[FORCED START]");
  const forcedStartBlock = hasForcedStart
    ? `\n## NON-NEGOTIABLE constraint — FIRST STOP IS LOCKED

The buyer explicitly chose **candidate #1 ("${geocode.geocoded[0].googleName}")** as their starting landmark. This is what they will see on their map as "your starting point" and what they will physically arrive at.

**You MUST place candidate #1 as your step_order=1.** Do not skip it. Do not reorder it. Pick ${CONFIG.TARGET_STOPS - 1} additional landmarks for steps 2 through ${CONFIG.TARGET_STOPS}, ordered for an optimal route from the forced start.
`
    : "";

  return `You are selecting the landmarks for an outdoor escape game / city tour in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.${forcedStartBlock}

## Scenario (buyer-provided, English-native)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative direction**: ${input.narrative ?? "(none)"}

## Geographic context

- Start point: ${input.startPoint.lat}, ${input.startPoint.lon}
- Transport mode: ${input.transportMode}
- Search radius: ${input.radiusKm} km
- Estimated total duration: ${input.estimatedDurationMin} minutes

## Verified landmark pool (${geocode.geocoded.length} candidates, all geocoded by Google Maps)

${pool}

## Your task — CITY-TOUR FIRST philosophy

This product is FIRST a city-tour (tourist discovers the city's heritage), SECOND a thematic game (narrative woven on top). Therefore prioritize **city-tour quality**, not strict thematic fit.

**Pick exactly ${CONFIG.TARGET_STOPS} landmarks** (fallback ${CONFIG.MIN_STOPS} minimum if pool too small) following this priority order :

1. **City-tour quality** : pick the heritage that a tourist MUST see in this city
2. **Geographic coherence** : design a smooth visit route (no zigzag, respect transport mode and duration)
3. **Variety** : mix iconic + lesser-known if both are heritage-grade
4. **Thematic relevance** : tiebreaker only — used to rank between two equally important sites

**Examples of good selection logic** :
- Étretat theme Lupin → pick Falaise d'Aval, Aiguille, Maurice Leblanc house, Manneporte even though only the last has direct Lupin link — they're THE Étretat
- Vaduz theme "WWII Regiment" → pick the Castle, Cathedral, National Museum, Town Square (these are Vaduz's main heritage), even if no direct WWII angle

**Order the selection** in the optimal visit sequence (start near start point, build narrative momentum, climax near the end).

## Output (JSON only, no preamble)

\`\`\`json
{
  "selected": [
    {
      "step_order": 1,
      "name": "<verbatim name from pool>",
      "rationale": "<1 sentence why this landmark for this game>"
    },
    {
      "step_order": 2,
      "name": "<verbatim>",
      "rationale": "<1 sentence>"
    },
    ... (up to ${CONFIG.TARGET_STOPS})
  ],
  "rationale": "<2-3 sentences explaining the route logic>"
}
\`\`\`

The "name" field MUST exactly match a landmark in the pool (use the exact name or Google name verbatim). The narration step uses these names to retrieve GPS coords — no invention.`;
}

export async function runSelect(
  input: PipelineInput,
  geocode: GeocodeResult,
): Promise<SelectionResult> {
  if (geocode.geocoded.length === 0) {
    throw new Error("Select: no geocoded landmarks to choose from");
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(
    `[v5 select] Claude ${CONFIG.CLAUDE_MODEL} sélectionne ${CONFIG.TARGET_STOPS} best parmi ${geocode.geocoded.length}`,
  );
  const t0 = Date.now();
  const prompt = buildSelectionPrompt(input, geocode);
  const response = await client.messages.create({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 3000,
    temperature: CONFIG.CLAUDE_TEMPERATURE,
    messages: [{ role: "user", content: prompt }],
  });
  const dur = Math.round((Date.now() - t0) / 1000);

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Select response not parseable. Preview: ${text.slice(0, 300)}`);
  }

  let parsed: { selected: Array<{ step_order: number; name: string; rationale: string }>; rationale: string };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Select JSON parse failed: ${e instanceof Error ? e.message : "?"}`);
  }

  if (!Array.isArray(parsed.selected) || parsed.selected.length < CONFIG.MIN_STOPS) {
    throw new Error(
      `Select returned only ${parsed.selected?.length ?? 0} landmarks (need ≥${CONFIG.MIN_STOPS})`,
    );
  }

  // Map selected names back to GeocodedLandmark
  const selected: GeocodedLandmark[] = [];
  for (const sel of parsed.selected) {
    const hit = geocode.geocoded.find(
      (g) =>
        g.name === sel.name ||
        g.googleName === sel.name ||
        g.name.toLowerCase() === sel.name.toLowerCase() ||
        g.googleName.toLowerCase() === sel.name.toLowerCase(),
    );
    if (hit) {
      selected.push({ ...hit, order: sel.step_order, narrativeTitle: sel.rationale });
    } else {
      console.warn(`[v5 select] Claude a renvoyé "${sel.name}" introuvable dans le pool — skip`);
    }
  }

  if (selected.length < CONFIG.MIN_STOPS) {
    throw new Error(
      `Select : après matching back au pool, seulement ${selected.length}/${parsed.selected.length} landmarks valides`,
    );
  }

  // ── Safety : enforce forced start at position 1, même si Claude a ignoré ──
  // Le prompt demande explicitement à Claude de mettre le forced start à
  // step_order=1. Mais on ne fait JAMAIS confiance aveugle au LLM — si Claude
  // l'a déplacé en 2e/3e position, ou retiré, on le réinjecte de force.
  const forcedStart = geocode.geocoded[0];
  if (forcedStart?.narrativeTitle?.includes("[FORCED START]")) {
    const currentIdx = selected.findIndex((s) => s.placeId === forcedStart.placeId);
    if (currentIdx === -1) {
      // Claude l'a complètement retiré → on le réinjecte en tête + on retire le dernier
      console.warn(
        `[v5 select] Claude a IGNORÉ le forced start "${forcedStart.googleName}" — réinjection en step_order=1 (drop du dernier de sa sélection)`,
      );
      selected.unshift({ ...forcedStart, order: 1 });
      if (selected.length > CONFIG.TARGET_STOPS) selected.pop();
    } else if (currentIdx !== 0) {
      // Claude l'a déplacé → on le swap en première position
      console.warn(
        `[v5 select] Claude a placé le forced start en step_order=${currentIdx + 1} au lieu de 1 — swap`,
      );
      const [start] = selected.splice(currentIdx, 1);
      selected.unshift({ ...start, order: 1 });
    }
    // Re-numbering pour rester cohérent
    for (let i = 0; i < selected.length; i++) {
      selected[i] = { ...selected[i], order: i + 1 };
    }
  }

  console.log(`[v5 select] Claude done in ${dur}s — ${selected.length} sélectionnés`);
  return {
    selected,
    rationale: parsed.rationale,
    rawMarkdown: text,
  };
}
