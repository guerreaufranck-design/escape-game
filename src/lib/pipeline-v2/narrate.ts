/**
 * NARRATE v5 — Claude Sonnet 4.5 écrit la narration EN sur les 8 stops sélectionnés.
 *
 * Reçoit les stops déjà sélectionnés + ordonnés par select.ts. Doit habiller
 * chacun avec :
 *   - title, riddle, answer, hint, anecdote
 *   - ar_character_type/dialogue/facade/treasure
 *   - landmark_history
 * Et écrire game-wide :
 *   - title, description, intro, epilogue, final_riddle, final_answer
 *
 * Tout en EN (master). Traduction vers langue client se fait après.
 *
 * Si stop sans rapport direct avec thème → Claude tisse la narration
 * autour quand même (city-tour first).
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";
import type {
  GeocodedLandmark,
  PipelineInput,
  StructuredGame,
} from "./types";

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
          s.narrativeTitle ? ` · Why selected: ${s.narrativeTitle.slice(0, 200)}` : ""
        }`,
    )
    .join("\n");

  const warningBlock = editorialWarning
    ? `\n## Editorial warning from research\n${editorialWarning}\n`
    : "";

  const archetypeList = Object.keys(CONFIG.ELEVENLABS_ARCHETYPE_VOICES).join(" | ");

  const prompt = `You are writing the full narrative content for an outdoor escape game / city tour in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

## Scenario (buyer-provided, English-native)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative direction**: ${input.narrative ?? "(none)"}
**Difficulty**: ${input.difficulty}/5
**Genre**: ${input.genre ?? "historical"}
**Mode**: ${input.mode}
**Transport**: ${input.transportMode}
**Duration**: ${input.estimatedDurationMin} minutes
**Audience**: tourists novice to this city, no insider knowledge required
${warningBlock}

## Selected landmarks (chosen by selection step, IN THE GIVEN ORDER — do not reorder)

${stopsList}

## CITY-TOUR philosophy

Some of these landmarks were chosen for city-tour value (must-see heritage), even if their direct thematic link is weak. Your job is to **weave the scenario narrative AROUND each landmark**, no matter what it is. Example : theme Lupin + stop "Falaise d'Aval" → write a riddle/anecdote connecting Maurice Leblanc's inspiration to the cliffs.

## Your task

For EACH selected landmark (in the given order), write :
- title : "Landmark name — Narrative subtitle"
- riddle observable from outside (count, inscribed date, name on facade, architectural feature)
- answer (UPPERCASE word or number)
- hint
- anecdote (REAL historical fact, 2-3 sentences)
- arCharacterType (one of: ${archetypeList})
- arCharacterDialogue (immersive 1-2 sentences in archetype voice)
- arFacadeText (= answer, UPPERCASE)
- arTreasureReward (symbolic narrative reward)
- landmarkHistory.en (2-3 sentences real history of the place)

Then write game-wide content :
- title (English)
- description (1-2 sentences for product page)
- intro (3-5 sentences, immersive, second person)
- epilogue (3-5 sentences)
- finalRiddleText + finalAnswer + finalAnswerExplanation

## Strict rules

- ALL content in English
- DO NOT change landmark selection or order
- landmarkName must be verbatim from above (prefer Google name if available)
- latitude, longitude, placeId must be verbatim from above
- answer = arFacadeText (same UPPERCASE string)
- Latin answers acceptable (VERITAS, REFUGIUM, LIBERTAS...) for atmosphere
- Riddles must be solvable by a tourist who doesn't know the city

## Output schema (JSON only, no preamble)

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
      "arCharacterType": "${archetypeList.split(" | ")[0]}",
      "arCharacterDialogue": "string",
      "arFacadeText": "<same as answer>",
      "arTreasureReward": "string",
      "landmarkHistory": { "en": "string" },
      "validationRadiusMeters": ${CONFIG.VALIDATION_RADIUS_M},
      "bonusTimeSeconds": ${CONFIG.BONUS_TIME_S}
    }
  ]
}
\`\`\``;

  console.log(`[v5 narrate] Claude ${CONFIG.CLAUDE_MODEL} écrit la narration pour ${selected.length} stops`);
  const t0 = Date.now();
  const response = await client.messages.create({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: CONFIG.CLAUDE_MAX_TOKENS,
    temperature: CONFIG.CLAUDE_TEMPERATURE,
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
    throw new Error(`Narrate JSON parse failed: ${e instanceof Error ? e.message : "?"}`);
  }

  parsed.sourceLanguage = "en";
  parsed.stops = parsed.stops.map((s) => ({
    ...s,
    arCharacterType: s.arCharacterType || "guide_male",
    validationRadiusMeters: s.validationRadiusMeters ?? CONFIG.VALIDATION_RADIUS_M,
    bonusTimeSeconds: s.bonusTimeSeconds ?? CONFIG.BONUS_TIME_S,
    landmarkHistory: s.landmarkHistory ?? { en: "" },
  }));

  console.log(`[v5 narrate] Claude done in ${dur}s — ${parsed.stops.length} stops habillés EN`);
  return parsed;
}
