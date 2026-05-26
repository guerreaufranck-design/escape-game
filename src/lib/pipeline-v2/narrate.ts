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

/**
 * Directives narratives en fonction du transport mode.
 *
 * Mandat user 2026-05-26 :
 *   - walking : narration continue, transitions courtes, joueur à pied
 *   - mixed / driving : narration "chapitrée", joueur peut étaler sur
 *                       plusieurs sessions (1 journée OU 1 semaine — on
 *                       NE mentionne PAS de durée précise).
 *   - mixed = driving pour le ton (dès qu'il y a 1 trajet voiture, le
 *     ton "voyage" prend le dessus).
 *   - Voix AR identique entre walking et roadtrip (pas de switch
 *     ElevenLabs) — seul le texte change.
 */
function transportDirectives(transportMode: "walking" | "mixed" | "driving"): string {
  if (transportMode === "walking") {
    return `## Transport-aware writing directives (WALKING mode)

The player will WALK from one landmark to the next (5-15 minutes between stops, all on foot, in a compact area).

- **intro** : the player STANDS at the start point with the city in front of them — direct, immersive, urgent.
  Example tone : "Before you, the old town stretches out. You have today, no more — let the trail begin."
- **anecdote** : tight, continuous narrative — assume the player just walked from the previous stop and arrives energized.
- **arCharacterDialogue** : energetic, complicit, urgent — like a friend whispering "look at THIS detail before they notice us".
- **landmarkHistory** : strict heritage focus on the landmark itself (no landscape/road framing).
- **arTreasureReward** : compact symbolic object (a sealed parchment, a small carved seal, a coin).
- **epilogue** : closes the LOOP — the player ends near the start, the trail is "complete in one motion".
- **DO NOT mention** : "your journey will take X days", "rest at an inn", "roads ahead". The player is here NOW, in one session.`;
  }

  // mixed | driving — same tone (dès qu'il y a 1 segment voiture, on traite comme roadtrip)
  return `## Transport-aware writing directives (ROADTRIP mode — mixed/driving)

The player will DRIVE between landmarks (10-40 min car rides between most stops, possibly spread over MULTIPLE sessions — could be 1 day, could be a full week).

- **intro** : the player is at the WHEEL, about to start a journey — open horizon tone, panoramic feel.
  Example tone : "The road waits. Take it at your own pace — what matters is that you arrive at each place with the right eyes."
- **anecdote** : reflective, allows space — assume the player just drove for 20+ minutes through landscape to reach this stop. Acknowledge arrival when natural.
- **arCharacterDialogue** : "drive-in" tone — the character RECOGNIZES the player has come from afar : "You traveled far — listen before you continue." Calm, contemplative, never urgent.
- **landmarkHistory** : heritage of the landmark PLUS optional landscape/territorial context (the relief, the historic route, the river crossed) — 2-3 sentences total.
- **arTreasureReward** : "carnet de route" / journey tokens — a stamped page, a piece of map, a relic of passage. Something that ACCUMULATES over the journey.
- **epilogue** : closes the JOURNEY (not the loop) — the player has crossed territory and time, and carries it forward.
- **DO NOT mention** specific durations like "your 2-day trip" — players will choose their own pacing (some do it all in one day, others over a week). Use OPEN time language : "your journey", "this voyage", "the road you take", "at your own pace".`;
}

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
**Audience**: tourists novice to this city, no insider knowledge required
${warningBlock}

## Selected landmarks (chosen by selection step, IN THE GIVEN ORDER — do not reorder)

${stopsList}

## CITY-TOUR philosophy

Some of these landmarks were chosen for city-tour value (must-see heritage), even if their direct thematic link is weak. Your job is to **weave the scenario narrative AROUND each landmark**, no matter what it is. Example : theme Lupin + stop "Falaise d'Aval" → write a riddle/anecdote connecting Maurice Leblanc's inspiration to the cliffs.

${transportDirectives(input.transportMode)}

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
- DO NOT anchor any specific duration anywhere in the text ("2 days", "a weekend", "in 90 minutes"). Players choose their own pacing — use open time language ("your journey", "at your own pace", "today", "your trail").
- Apply the **Transport-aware writing directives** above verbatim — they override any default narrative reflex.

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
