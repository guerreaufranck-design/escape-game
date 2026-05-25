/**
 * SELECT v3 — Claude trie le pool géocodé + écrit le jeu en EN.
 *
 * Le pool reçu vient de geocode.ts (déjà filtré sur similarity / radius /
 * dedup). Claude reçoit le pool + le scénario buyer + l'avertissement
 * éditorial éventuel. Il :
 *   - choisit 7-9 landmarks les plus pertinents
 *   - les ordonne en parcours fluide (pas de zigzag)
 *   - écrit riddle/answer/anecdote/AR dialogue/landmark history en EN
 *   - compose intro + epilogue + énigme finale
 *
 * Output : StructuredGame avec sourceLanguage="en". Traduction en lang
 * client se fait à l'étape suivante (translate.ts).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  DiscoveryResult,
  GeocodeResult,
  PipelineInput,
  StructuredGame,
} from "./types";

const MODEL = "claude-sonnet-4-5-20250929";

export async function runSelect(
  input: PipelineInput,
  discovery: DiscoveryResult,
  geocode: GeocodeResult,
): Promise<StructuredGame> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const poolDesc = geocode.geocoded
    .map(
      (g, i) =>
        `${i + 1}. "${g.name}" → Google: "${g.googleName}", GPS ${g.lat}, ${g.lon}, ${g.distanceFromStartM}m from start.${
          g.narrativeTitle ? ` Relevance: ${g.narrativeTitle.slice(0, 200)}.` : ""
        }`,
    )
    .join("\n");

  const warningBlock = discovery.warning
    ? `\n**Editorial warning from research phase**: ${discovery.warning}\n`
    : "";

  const prompt = `You are designing an outdoor escape game in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.

## Scenario (from buyer, English-native)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative**: ${input.narrative ?? "(none)"}
${warningBlock}

## Verified landmark pool (already filtered by Google Places — all within 1.75 km of start, all real, no duplicates)

${poolDesc}

## Your task

1. **Pick 7 to 9 landmarks** from the pool above. Maximum thematic relevance.
2. **Order them** in the most logical WALKING sequence — avoid zigzag, prefer a smooth arc (e.g. start central → loop outward → climax at the most dramatic spot).
3. **Write all content in ENGLISH** (translation to user's language happens later).
4. **For each stop**: a title with format "Landmark name — Narrative subtitle", a riddle observable from outside, a simple answer, a hint, an anecdote with real history, an AR character voice line, a treasure reward narrative.
5. **Compose game-wide content**: title, description, intro narrative, epilogue, final riddle requiring whole-game knowledge.
6. **Editorial honesty**: if the buyer's brief contains a historically dubious claim (per the warning above), present the game as "inspired by local memory" rather than reconstruction of a non-event. Stay anchored in verifiable facts.

## Schema — respond with this exact JSON

\`\`\`json
{
  "meta": {
    "title": "string — English game title",
    "description": "string — 1-2 sentences for product page",
    "intro": "string — 3-5 sentences immersive intro, second person",
    "epilogue": "string — 3-5 sentences closing",
    "epilogueTitle": "string — short title",
    "finalRiddleText": "string — synthesis riddle requiring whole game",
    "finalAnswer": "string — simple answer (UPPERCASE word OR number)",
    "finalAnswerExplanation": "string — 2-3 sentences"
  },
  "stops": [
    {
      "step_order": 1,
      "title": "Landmark Name — Narrative Subtitle",
      "landmarkName": "Exact landmark name from pool above",
      "latitude": <number from pool>,
      "longitude": <number from pool>,
      "placeId": "<placeId from pool>",
      "riddle": "Observable riddle 2-3 sentences (count, date, name on facade...)",
      "answer": "UPPERCASE word or number",
      "hints": [{"text": "Hint if stuck", "order": 1}],
      "anecdote": "Real historical anecdote 2-3 sentences",
      "arCharacterType": "guide_male | guide_female | scholar | monk | soldier",
      "arCharacterDialogue": "Immersive 1-2 sentences in the archetype's voice",
      "arFacadeText": "Same as answer, UPPERCASE",
      "arTreasureReward": "Symbolic virtual reward description",
      "landmarkHistory": {"en": "2-3 sentences about the landmark history"},
      "validationRadiusMeters": 30,
      "bonusTimeSeconds": 30
    }
  ]
}
\`\`\`

## Strict rules

- ALL content in English
- \`landmarkName\` MUST be one of the names from the pool above (verbatim)
- \`latitude\`, \`longitude\`, \`placeId\` MUST be from the pool (no invention)
- \`answer\` = \`arFacadeText\` always (same string)
- Latin answers acceptable (VERITAS, REFUGIUM, LIBERTAS...) for atmosphere
- 7-9 stops, no more no less

Respond with JSON only, no preamble, no markdown wrapper.`;

  console.log(`[v3 select] Calling Claude Sonnet 4.5 on pool of ${geocode.geocoded.length} landmarks...`);
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
    throw new Error(`Select response not parseable as JSON. Preview: ${text.slice(0, 300)}`);
  }

  let parsed: StructuredGame;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(
      `Select JSON parse failed: ${e instanceof Error ? e.message : "?"}. Preview: ${jsonMatch[0].slice(0, 300)}`,
    );
  }

  if (!Array.isArray(parsed.stops) || parsed.stops.length < 7) {
    throw new Error(`Select returned only ${parsed.stops?.length ?? 0} stops (need ≥7)`);
  }

  parsed.sourceLanguage = "en";

  // Defaults if Claude forgot fields
  parsed.stops = parsed.stops.map((s) => ({
    ...s,
    arCharacterType: s.arCharacterType || "guide_male",
    validationRadiusMeters: s.validationRadiusMeters ?? 30,
    bonusTimeSeconds: s.bonusTimeSeconds ?? 30,
    landmarkHistory: s.landmarkHistory ?? { en: "" },
  }));

  console.log(`[v3 select] Claude done in ${dur}s — ${parsed.stops.length} stops selected`);
  return parsed;
}
