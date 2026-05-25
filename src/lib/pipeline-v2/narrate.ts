/**
 * NARRATE v4 — Claude Sonnet 4.5, narration uniquement.
 *
 * Mandat user 2026-05-25 :
 *   "ensuite narration claude"
 *
 * Rôle de Claude dans cette pipeline = écrire le contenu narratif (riddles,
 * anecdotes, dialogues AR, intro/épilogue, énigme finale) pour les
 * landmarks DÉJÀ sélectionnés par Perplexity passe 2. Claude ne décide PAS
 * quels landmarks utiliser (c'est Perplexity qui décide) — il les habille.
 *
 * Output : StructuredGame en EN (langue native OddballTrip). La traduction
 * vers la langue client se fait à l'étape suivante.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  GeocodedLandmark,
  PipelineInput,
  StructuredGame,
} from "./types";

const MODEL = "claude-sonnet-4-5-20250929";

export async function runNarrate(
  input: PipelineInput,
  selected: GeocodedLandmark[],
  editorialWarning?: string,
): Promise<StructuredGame> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stopsList = selected
    .map(
      (s, i) =>
        `${i + 1}. "${s.name}" / Google: "${s.googleName}" — GPS ${s.lat}, ${s.lon} (placeId ${s.placeId}, ${s.distanceFromStartM}m from start)${
          s.narrativeTitle ? ` · ${s.narrativeTitle.slice(0, 150)}` : ""
        }`,
    )
    .join("\n");

  const warningBlock = editorialWarning
    ? `\n## Editorial warning from research\n${editorialWarning}\n`
    : "";

  const prompt = `You are writing the narrative content for an outdoor escape game in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

## Scenario (from buyer, English-native)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative**: ${input.narrative ?? "(none)"}
**Transport mode**: ${input.transportMode ?? "walking"}
${warningBlock}

## Selected landmarks (already chosen by research — DO NOT change them, DO NOT reorder)

${stopsList}

## CRITICAL — Narrative weaving philosophy

This is a CITY-TOUR played with a thematic narrative on top. Some landmarks above were chosen for their CITY-TOUR value (major heritage sites) even if they don't directly fit the theme. Your job is to **weave the thematic narrative AROUND each landmark**, no matter what it is.

Example : if the theme is "Arsène Lupin" and a stop is "Falaise d'Aval" (a geological landmark, no Lupin link historically), you write a riddle/anecdote that connects the cliffs to Lupin's mystery (e.g. "Maurice Leblanc was inspired by these cliffs to write...", "Look at the arch — Lupin used such formations to hide..."). You DO NOT skip or replace the landmark. You make it work narratively.

This is essential : the customer must see the famous landmarks of the city AND feel the theme connects them.

## Your task

For EACH landmark above (in the order given), write :
- A narrative title combining landmark + scenario angle
- A riddle observable from outside (a year/date/name inscribed, a count of architectural features, etc.)
- A simple answer (uppercase word OR number)
- A hint if the player is stuck
- A historical anecdote rooted in real facts
- An AR character dialogue (immersive 1-2 sentences)
- An AR treasure reward narrative
- A landmark history (2-3 sentences)
- Pick an arCharacterType (guide_male / guide_female / scholar / monk / soldier)

Then write game-wide content :
- Title (English)
- Description (1-2 sentences for product page)
- Intro (3-5 sentences, immersive, second person)
- Epilogue (3-5 sentences)
- Final riddle requiring whole game knowledge + answer + explanation

## Strict rules

- ALL content in English
- DO NOT change the landmark selection or order from above
- \`landmarkName\` must be VERBATIM the name from "Selected landmarks" (use the Google name if available, the raw name otherwise)
- \`latitude\`, \`longitude\`, \`placeId\` must be VERBATIM from above
- \`answer\` = \`arFacadeText\` (same UPPERCASE string)
- Latin answers welcome (VERITAS, REFUGIUM, LIBERTAS...) if they fit the theme

## Output schema (respond with this JSON only, no preamble)

\`\`\`json
{
  "meta": {
    "title": "string",
    "description": "string",
    "intro": "string",
    "epilogue": "string",
    "epilogueTitle": "string",
    "finalRiddleText": "string",
    "finalAnswer": "string",
    "finalAnswerExplanation": "string"
  },
  "stops": [
    {
      "step_order": 1,
      "title": "Landmark Name — Narrative Subtitle",
      "landmarkName": "verbatim from above",
      "latitude": <verbatim>,
      "longitude": <verbatim>,
      "placeId": "<verbatim>",
      "riddle": "string",
      "answer": "string (UPPERCASE)",
      "hints": [{ "text": "string", "order": 1 }],
      "anecdote": "string",
      "arCharacterType": "guide_male | guide_female | scholar | monk | soldier",
      "arCharacterDialogue": "string",
      "arFacadeText": "<same as answer>",
      "arTreasureReward": "string",
      "landmarkHistory": { "en": "string" },
      "validationRadiusMeters": 30,
      "bonusTimeSeconds": 30
    }
  ]
}
\`\`\``;

  console.log(`[narrate] Claude Sonnet 4.5 écrit la narration pour ${selected.length} stops`);
  const t0 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });
  const dur = Math.round((Date.now() - t0) / 1000);

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Narrate response not parseable. Preview: ${text.slice(0, 300)}`);
  }

  let parsed: StructuredGame;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(
      `Narrate JSON parse failed: ${e instanceof Error ? e.message : "?"}. Preview: ${jsonMatch[0].slice(0, 300)}`,
    );
  }

  parsed.sourceLanguage = "en";

  parsed.stops = parsed.stops.map((s) => ({
    ...s,
    arCharacterType: s.arCharacterType || "guide_male",
    validationRadiusMeters: s.validationRadiusMeters ?? 30,
    bonusTimeSeconds: s.bonusTimeSeconds ?? 30,
    landmarkHistory: s.landmarkHistory ?? { en: "" },
  }));

  console.log(`[narrate] Claude done in ${dur}s — ${parsed.stops.length} stops habillés en EN`);
  return parsed;
}
