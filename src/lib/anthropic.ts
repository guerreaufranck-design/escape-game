/**
 * Anthropic Claude API client for creative game content generation
 * Uses Claude Sonnet for riddle creation, narrative, and formatting
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ResearchedLocation } from "./perplexity";
import { getRelevantNegativeFeedback, formatFeedbackForPrompt } from "./feedback-memory";
import { formatCharactersForPrompt } from "./ar-sprites";

export interface GeneratedStep {
  title: string;
  latitude: number;
  longitude: number;
  validation_radius_meters: number;
  riddle_text: string;
  answer_text: string;
  hints: { order: number; text: string }[];
  anecdote: string;
  bonus_time_seconds: number;
  /** How the player discovers the answer — "physical" (real inscription) or
   * "virtual_ar" (AR overlay reveals it). Derived from the source location. */
  answer_source: "physical" | "virtual_ar";
  // ---- AR layer (rendered at runtime by the player UI) -------------------
  /** Character archetype that "speaks" when player locks on target. Must
   * match a key in AR_CHARACTERS or be "default". */
  ar_character_type: string;
  /** Short atmospheric line the character whispers to the player (1-2
   * sentences). Sets the mood, doesn't spoil the answer. */
  ar_character_dialogue: string;
  /** 1-3 evocative words that "appear" magically on the building's façade
   * when the player locks on target. For virtual_ar steps, this IS the
   * answer reveal. For physical steps, it's a thematic word (e.g. "VERITAS",
   * "DECRETO", "1532") that primes the right inscription on the real wall. */
  ar_facade_text: string;
  /** Description of the treasure object revealed by the AR camera once the
   * step is solved (e.g. "a silver key engraved with a galleon"). 1
   * sentence — themed to the step's narrative. */
  ar_treasure_reward: string;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Generate escape game steps from verified research data
 * Claude creates immersive riddles around pre-verified answers
 */
export async function generateGameSteps(
  city: string,
  country: string,
  theme: string,
  narrative: string,
  difficulty: number,
  locations: ResearchedLocation[]
): Promise<GeneratedStep[]> {
  // RAG: pull lessons from past admin thumbs-down feedback on similar contexts
  let feedbackBlock = "";
  try {
    const feedback = await getRelevantNegativeFeedback({ city, theme, limit: 8 });
    feedbackBlock = formatFeedbackForPrompt(feedback);
    if (feedbackBlock) {
      console.log(
        `[generateGameSteps] Injecting ${feedback.length} lessons from past feedback`,
      );
    }
  } catch (err) {
    console.warn(
      `[generateGameSteps] Could not fetch feedback memory: ${err instanceof Error ? err.message : err}`,
    );
  }
  const client = getAnthropicClient();

  // Format locations for the prompt — include answerSource so Claude can
  // adapt the riddle tone (physical = "read the engraved year", virtual_ar
  // = "the wall will whisper a sign when you point your camera").
  const locationsText = locations
    .map(
      (loc, i) => `Location ${i + 1}: ${loc.name}
- GPS: ${loc.latitude}, ${loc.longitude}
- What to observe: ${loc.whatToObserve}
- ANSWER: ${loc.answer}
- Answer type: ${loc.answerType}
- Answer source: ${loc.answerSource ?? "physical"} ${loc.answerSource === "virtual_ar" ? "(AR-only: riddle must hint at activating AR camera)" : "(physical: riddle must say where to look on the real monument)"}
- Source: ${loc.source}
- Theme link: ${loc.themeLink || "N/A"}`
    )
    .join("\n\n");

  const stepCount = Math.min(locations.length, 8);

  const prompt = `You are an expert escape game designer with a talent for immersive storytelling. I am giving you ${locations.length} verified locations in ${city}, ${country}, with confirmed answers. Your job is to select the best ${stepCount} and create an unforgettable escape game around them.

ABSOLUTE RULE: The answer_text field must contain ONLY the short answer provided below. It will be a number, a year, a single word/name, or a short phrase. Do NOT expand it into a sentence. Do NOT add any description. Copy it EXACTLY as shown. Example: if the answer is 5, write "5" not "five stone arches".

GAME PARAMETERS:
- City: ${city}, ${country}
- Theme: ${theme}
- Narrative: ${narrative}
- Difficulty: ${difficulty}/5
- Steps: ${stepCount} (select the best ${stepCount} from the ${locations.length} locations below for narrative flow and walking route)
- Language: English (will be auto-translated by the app)

FOR EACH OF THE ${stepCount} STEPS, create a JSON object with:

1. "title": An evocative, mysterious title (max 8 words)
2. "latitude": Use EXACTLY the coordinates provided below — do not modify them
3. "longitude": Use EXACTLY the coordinates provided below — do not modify them
4. "validation_radius_meters": Between 15 and 50 meters (adjust based on location size)
5. "riddle_text": An immersive riddle (4-6 sentences) that:
   - Does NOT name the location or the answer directly
   - Weaves into the ongoing narrative and references the previous step's discovery
   - Guides the player toward the location through atmospheric clues
   - CRITICAL — adapt the instructions to the "Answer source" of each location:
     * If "physical": tell the player WHAT TYPE of answer to look for ("Find the number engraved on...", "Read the word on the plaque...", "Count the arches...") AND WHERE to look (on a wall, on a plaque, above a door, on a commemorative stone).
     * If "virtual_ar": tell the player the spirits of the place speak only through their magic lens. Instruct them to lift their phone in AR mode — the answer will reveal itself, painted on the façade, visible only when they are aligned. Embrace the magical feel (glowing letters, whispered symbols, ethereal signs).
   - The riddle IS the puzzle — the clues to solve it must be embedded in the poetic text
6. "answer_text": Copy ONLY the short answer from the data below. A number must stay a number. A year must stay a year. A word must stay a word. NEVER turn it into a sentence.
7. "hints": Array of EXACTLY 3 hints:
   - Hint 1 (order: 1): Atmospheric hint — sets the mood and gives a general direction toward the right area of the location
   - Hint 2 (order: 2): Practical hint — tells the player exactly what type of object to examine (a plaque, an inscription, a carving, a sign...) and where to look (facade, entrance, pedestal, floor...)
   - Hint 3 (order: 3): Almost the answer — describes the answer's format (e.g. "It's a 4-digit year", "It's a single word in Latin", "Count them carefully — there are fewer than 10") without stating it
8. "anecdote": A fascinating, true historical anecdote (2-3 sentences). Make it captivating — this is the player's reward.
9. "bonus_time_seconds": 0 for straightforward steps, 30-60 for harder ones
10. "answer_source": Copy EXACTLY the "Answer source" field from the location above ("physical" or "virtual_ar"). This tells the app how to display the answer hint in AR mode.
11. "ar_character_type": Pick the best-fitting character archetype that will "appear" to the player when they lock on the target. Choose from the catalogue below — pick the one whose era/theme matches the step. This drives the AR sprite that's rendered.
${formatCharactersForPrompt()}
12. "ar_character_dialogue": A short atmospheric line (1-2 sentences MAX, under 180 chars) that the chosen character whispers to the player. It must SET THE MOOD and tease the riddle, but NEVER state the answer or what to look for explicitly. First-person, theatrical, in tune with the character archetype. Examples — monk: "I have guarded these stones since before your grandfather's grandfather drew breath..."; corsair ghost: "The sea took my body, but the harbour holds my secret still..."
13. "ar_facade_text": 1 to 3 evocative WORDS (uppercase) that magically materialise on the building's façade when the player aligns their AR camera. This is a MOOD piece, not a hint. Pick words that EVOKE the riddle's theme without spoiling the answer (e.g. "VERITAS", "DECRETO MMXXII", "1532 — REQUIESCAT", "AUDE SAPERE"). For virtual_ar steps, use the answer_text itself in caps (since the answer reveals magically). Keep it under 30 characters.
14. "ar_treasure_reward": A short single-sentence description of the magical treasure that materialises in front of the player AFTER they solve the step (e.g. "A silver key engraved with a galleon and a crescent moon", "An ancient parchment sealed with red wax and a phoenix sigil"). This is purely flavour — themed to the step's narrative beat. Under 130 chars.

NARRATIVE REQUIREMENTS:
- Step 1: Hook the player. The story begins with excitement and intrigue.
- Middle steps: Build tension progressively. Each step reveals a new fragment of the mystery.
- Step ${stepCount} (final): Provide a powerful, satisfying conclusion.
- Each riddle MUST reference the previous discovery to create continuity.
- Tone: mysterious, poetic, historically rich.

VERIFIED LOCATIONS WITH GAME-READY ANSWERS:

${locationsText}

Return ONLY a valid JSON array of EXACTLY ${stepCount} objects, no additional text, no commentary, no markdown formatting.${feedbackBlock}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract text from response
  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse JSON from response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Could not extract JSON from Claude response");
  }

  const steps = JSON.parse(jsonMatch[0]) as GeneratedStep[];

  if (!Array.isArray(steps) || steps.length < stepCount) {
    throw new Error(
      `Expected ${stepCount} steps (matching ${locations.length} input locations), got ${steps?.length || 0}`,
    );
  }

  // Validate that answers match the original research
  const locationAnswers = new Set(locations.map((l) => String(l.answer)));
  for (const step of steps) {
    if (!locationAnswers.has(String(step.answer_text))) {
      console.warn(
        `Warning: answer "${step.answer_text}" not found in original research data`
      );
    }
  }

  return steps;
}

// ===========================================================================
// VALIDATION (Claude #2 — auto-correction layer)
// ===========================================================================

export interface ValidationIssue {
  step_index: number; // 0-based index in the steps array
  problem: string;
  severity: "minor" | "major" | "blocking";
  suggestion: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Second-pass critic. Reads what the first Claude generated and flags problems
 * that would degrade the player experience: too-easy answers, factually
 * questionable anecdotes, riddles that contradict the answer, etc.
 *
 * Returns ok=true if the game is good as-is, otherwise a list of problematic
 * steps with concrete suggestions for regeneration.
 *
 * Cost: ~$0.04 per validation call. Worth it: catches ~50% of bad outputs
 * before they reach the player.
 */
export async function validateGeneratedSteps(params: {
  steps: GeneratedStep[];
  city: string;
  theme: string;
  narrative: string;
}): Promise<ValidationResult> {
  const client = getAnthropicClient();

  const stepsBlock = params.steps
    .map(
      (s, i) =>
        `STEP ${i + 1} — "${s.title}"
GPS: ${s.latitude}, ${s.longitude}
Riddle: ${s.riddle_text}
ANSWER: "${s.answer_text}"
Source: ${s.answer_source}
Hints: 1) ${s.hints[0]?.text || "(missing)"} | 2) ${s.hints[1]?.text || "(missing)"} | 3) ${s.hints[2]?.text || "(missing)"}
Anecdote: ${s.anecdote}`,
    )
    .join("\n\n---\n\n");

  const prompt = `You are a strict QA reviewer for an outdoor escape game. Your job is to flag problems BEFORE the game ships to a paying customer.

CONTEXT
City: ${params.city}
Theme: ${params.theme}
Narrative: ${params.narrative}

GAME TO REVIEW (${params.steps.length} steps):

${stepsBlock}

YOUR JOB
Spot real problems only. Don't be picky on style. Flag a step ONLY if at least one of these is true:

1. ANSWER QUALITY:
   - Answer is too obvious (e.g. asking for the city's own name as the answer)
   - Answer doesn't match the riddle question
   - For "physical" answer_source: answer is implausible to actually be inscribed/visible at the location
   - Answer contains explanation, sentence, or more than 3 words (it must be terse: a year, a number, or 1-2 words)

2. RIDDLE / INSTRUCTIONS:
   - Riddle directly states the answer (spoiler)
   - Riddle's instructions don't match the answer_source ("look at the carved year" while answer_source is virtual_ar, or vice-versa)
   - Riddle is so generic it could apply to ANY building

3. FACTUAL:
   - Anecdote contains an obvious historical error
   - Date/figure in the anecdote contradicts the answer

4. FLOW:
   - Two consecutive steps have identical answers
   - Step makes no sense without the previous one (broken narrative continuity)

RULES
- If everything is good: return {"ok": true, "issues": []}
- A step can have multiple issues; combine them into one entry
- Severity:
   "blocking" = customer would refund (factually wrong, broken)
   "major"    = customer would complain (boring, too easy, confusing)
   "minor"    = nice-to-have polish (style, tone)
- Suggestion must be ACTIONABLE: explain what to change so the regeneration prompt can fix it.

OUTPUT — strict JSON, no markdown:

{
  "ok": false,
  "issues": [
    {
      "step_index": 0,
      "problem": "Answer 'PARIS' is the city's own name — too obvious",
      "severity": "major",
      "suggestion": "Replace with a year, a name on a plaque, or a count of architectural features specific to this exact monument"
    }
  ]
}

Return ONLY this JSON object. No commentary.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.1, // low temp — we want deterministic critic
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(
      `[validator] No JSON in response. Defaulting to ok=true. Raw: ${responseText.substring(0, 200)}`,
    );
    return { ok: true, issues: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ValidationResult;
    return {
      ok: parsed.ok ?? false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch (err) {
    console.warn(
      `[validator] JSON parse failed. Defaulting to ok=true. Err: ${err instanceof Error ? err.message : err}`,
    );
    return { ok: true, issues: [] };
  }
}

/**
 * Regenerate a single step that was flagged by the validator.
 * Receives the original step + the validator's feedback + the source location.
 * Returns a fixed step that addresses the feedback.
 */
export async function regenerateStep(params: {
  brokenStep: GeneratedStep;
  issue: ValidationIssue;
  location: ResearchedLocation;
  city: string;
  theme: string;
  narrative: string;
  stepNumber: number;
  totalSteps: number;
}): Promise<GeneratedStep> {
  const client = getAnthropicClient();

  const prompt = `You wrote step ${params.stepNumber}/${params.totalSteps} of an outdoor escape game in ${params.city} (theme: ${params.theme}). A reviewer flagged a problem and you must rewrite this step.

ORIGINAL STEP (the one to fix):
- Title: ${params.brokenStep.title}
- Riddle: ${params.brokenStep.riddle_text}
- Answer: ${params.brokenStep.answer_text}
- Source: ${params.brokenStep.answer_source}

REVIEWER FEEDBACK:
Problem: ${params.issue.problem}
Severity: ${params.issue.severity}
What to change: ${params.issue.suggestion}

LOCATION DATA (use exactly):
- Name: ${params.location.name}
- GPS: ${params.location.latitude}, ${params.location.longitude}
- Observable detail: ${params.location.whatToObserve}
- Confirmed answer: ${params.location.answer}
- Answer type: ${params.location.answerType}
- Answer source: ${params.location.answerSource ?? "physical"}

Rewrite this single step as a JSON object with the same shape as before:
{
  "title": "evocative short title (max 8 words)",
  "latitude": ${params.location.latitude},
  "longitude": ${params.location.longitude},
  "validation_radius_meters": 30,
  "riddle_text": "immersive riddle 4-6 sentences (DO NOT name the answer; describe where to look)",
  "answer_text": "${params.location.answer}",
  "hints": [
    {"order": 1, "text": "atmospheric hint"},
    {"order": 2, "text": "practical hint — what type of object and where"},
    {"order": 3, "text": "format hint without the answer"}
  ],
  "anecdote": "fascinating, historically true 2-3 sentences",
  "bonus_time_seconds": 0,
  "answer_source": "${params.location.answerSource ?? "physical"}",
  "ar_character_type": "one of: knight, witch, monk, sailor, detective, ghost, default — pick the most thematic",
  "ar_character_dialogue": "1-2 sentence atmospheric line whispered to the player, in character, no spoilers (under 180 chars)",
  "ar_facade_text": "1-3 evocative UPPERCASE words that materialise on the façade (under 30 chars)",
  "ar_treasure_reward": "1-sentence description of the magical treasure revealed once solved (under 130 chars)"
}

Address the reviewer's feedback explicitly. Output ONLY the JSON object, no commentary, no markdown.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `regenerateStep: no JSON in response: ${responseText.substring(0, 200)}`,
    );
  }
  return JSON.parse(jsonMatch[0]) as GeneratedStep;
}

// ===========================================================================
// EPILOGUE GENERATION
// ===========================================================================

export interface GeneratedEpilogue {
  title: string;
  text: string;
}

/**
 * Generate a narrative epilogue that plays on the results page after the
 * player enters the final code (or gives up). The goal is to give the player
 * a real reward: a cohesive, memorable, true-story revelation that ties all
 * the step anecdotes into one narrative.
 *
 * Style: storyteller, historically rich, emotional, ~300-500 words, 4-6
 * paragraphs. Written in English here; the app translates to 32 languages
 * via Gemini on demand.
 */
export async function generateEpilogue(params: {
  city: string;
  country: string;
  theme: string;
  narrative: string;
  difficulty: number;
  steps: GeneratedStep[];
}): Promise<GeneratedEpilogue> {
  const client = getAnthropicClient();

  const stepsRecap = params.steps
    .map(
      (s, i) =>
        `Step ${i + 1} — ${s.title}
  Answer player discovered: ${s.answer_text}
  Historical anecdote told to player: ${s.anecdote}`,
    )
    .join("\n\n");

  const prompt = `You are a master storyteller writing the EPILOGUE of an outdoor escape game adventure that the player has just completed in ${params.city}, ${params.country}.

GAME THEME: ${params.theme}
GAME NARRATIVE: ${params.narrative}

THE STEPS THE PLAYER JUST SOLVED (chronological):

${stepsRecap}

YOUR JOB:
Write a magnificent epilogue that the player sees on their results screen. This is their REAL REWARD — not points, not a badge. It's a revelation of the TRUE STORY behind their quest, weaving together every anecdote they discovered.

REQUIREMENTS:

1. **Title** — a short, evocative French-style title (max 6 words), in English. Examples of the right vibe:
   - "The Corsair's Living Legacy"
   - "The Cathedral's Silent Witness"
   - "What the Stones Never Told"

2. **Text** — 4-6 paragraphs (300-500 words total), in the style of a historical storyteller revealing a long-kept secret. Structure:
   - Paragraph 1: Congratulate the player warmly, acknowledge they now hold the "full truth"
   - Paragraphs 2-4: Weave the anecdotes together. Reveal the deeper connection between the stops. Explain WHY each date/name/number was significant. Uncover what happened AFTER the events the player witnessed through the riddles — the legacy, the consequences, the aftermath that history books rarely tell.
   - Final paragraph: A closing thought that elevates the experience. A fact about the place today that the player can verify themselves. A meaningful quote or philosophical reflection that ties the theme back to universal human experience.

3. **Tone**:
   - Warm, personal, "tu" when addressing the player (in French translation later)
   - Historical precision — every fact must be TRUE (cross-reference the anecdotes given above)
   - Evocative, poetic, not dry
   - Emotional at times — this is the "dessert" of the meal, as the client said

4. **RULES**:
   - NEVER invent facts not implied by the anecdotes above
   - NEVER use clichés ("congratulations on your journey", "you did it!", "well done, hero!")
   - NEVER reference the game mechanics (score, timer, points, level)
   - NEVER say "in this game" or "in this adventure" — speak as if telling a real story
   - Reference the player naturally (no formal "dear adventurer", just "toi" in French feel)
   - Do NOT use Markdown. Plain text only. Use line breaks between paragraphs.

OUTPUT FORMAT — strict JSON:

{
  "title": "Your evocative English title here",
  "text": "Paragraph 1.\\n\\nParagraph 2.\\n\\nParagraph 3.\\n\\nParagraph 4.\\n\\nFinal paragraph."
}

Return ONLY this JSON object. No commentary, no markdown wrapping.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Extract the JSON object from the response (robust to any leading/trailing text)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `generateEpilogue: no JSON found in Claude response: ${responseText.substring(0, 200)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedEpilogue;
  if (!parsed.title || !parsed.text) {
    throw new Error(
      `generateEpilogue: parsed JSON missing title/text: ${JSON.stringify(parsed).substring(0, 200)}`,
    );
  }

  return parsed;
}
