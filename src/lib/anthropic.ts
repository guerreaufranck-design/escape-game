/**
 * Anthropic Claude API client for creative game content generation
 * Uses Claude Sonnet for riddle creation, narrative, and formatting
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ResearchedLocation } from "./perplexity";
import { getRelevantNegativeFeedback, formatFeedbackForPrompt } from "./feedback-memory";
import { buildCharacterSelectionGuidance } from "./ar-sprites";

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
  /** 1-3 real cultural / heritage points the player passes ON THE WAY
   * to this step. Surfaced as a separate card in the UI so players
   * can expand "things to spot on the route". */
  route_attractions: Array<{ name: string; fact: string }>;
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

  const prompt = `You are an expert AR-tour designer. The product is half escape-game, half audio-guided heritage walk: the player physically walks between historical locations in ${city}, ${country}, and at each stop their phone reveals — IN AUGMENTED REALITY — a magical short answer painted on the facade. Solving the game = walking the city + reading what only the AR can show.

I am giving you ${locations.length} researched locations. Your job is to select the best ${stepCount} that form a SAFE WALKING ROUTE (no major roads to cross, all stops within ~10 minutes' walk of each other, ideally a coherent neighbourhood) and craft a single coherent narrative around them.

═══════════════════════════════════════════════════════════════════════
ABSOLUTE RULES (read twice)
═══════════════════════════════════════════════════════════════════════
A. EVERY step is "virtual_ar". The answer is NEVER a real inscription on
   the building. The answer is what the AR overlay magically reveals to
   the player when they point their phone at the facade. You have full
   creative liberty: a year, a Latin/Spanish/local-language word, a
   number, a roman numeral — pick the most dramatic + thematic option.

B. The riddle does NOT ask the player to read something off the wall.
   It tells them to GO to the place, OBSERVE the surroundings, and
   INVITES them to use their AR camera to make the secret appear.

C. The riddle IS the tour. Weave in REAL touristic / cultural / historical
   pointers about what the player is walking past on the way to the next
   stop. ("As you turn down Calle X, you'll pass the 16th-century
   wrought-iron balconies of the Borghi house — pause and notice the
   crest above the door...")

D. The answer_text field must contain ONLY the short answer. NEVER a
   sentence. Copy it EXACTLY as provided.

GAME PARAMETERS:
- City: ${city}, ${country}
- Theme: ${theme}
- Narrative: ${narrative}
- Difficulty: ${difficulty}/5
- Steps: ${stepCount}
- Language: English (auto-translated at runtime by the app)

═══════════════════════════════════════════════════════════════════════
FOR EACH OF THE ${stepCount} STEPS, create a JSON object with:
═══════════════════════════════════════════════════════════════════════

1. "title": Evocative, mysterious — max 8 words.

2. "latitude" + "longitude": EXACTLY the coordinates from the location data
   below. Do not round, do not nudge.

3. "validation_radius_meters": 25-50. Smaller for tight squares, larger for
   open plazas.

4. "riddle_text": 6-9 sentences. STRUCTURE in 3 movements — POETIC up
   front, EXPLICIT at the end. The player must walk away knowing
   EXACTLY (a) where to stand, (b) where to point the phone, (c) how
   to open AR, (d) what to do with what they see.

   (a) NARRATIVE STORY (2-3 sentences) — Tell a vivid micro-story tied
       to the place and the game theme. Past tense, in-character. Use
       sensory detail.
       Example tone: "Le corsaire passait par cette rue chaque soir,
       il s'arrêtait à la taverne du Lion Rouge pour y boire une chope
       de bière brune avant de retourner à son navire."

   (b) THEN vs NOW BRIDGE (1-2 sentences) — Anchor the past to what
       the player sees TODAY. Mention how the place evolved. This is
       the "tour guide" beat that turns the riddle into a heritage
       walk.
       Example tone: "Aujourd'hui cette taverne est devenue une
       petite boutique d'épices, mais sa façade en pierre n'a pas
       changé d'un cheveu depuis 1684."

   (c) AR INSTRUCTION (2-3 sentences) — TELL THE PLAYER TO GO TO THE
       LOCATION, then HUNT for the clue with their AR camera by
       scanning EVERYTHING around them.

       CRITICAL — DO NOT REVEAL where exactly the clue is hidden.
       That's the active-discovery part of the gameplay. The player
       must scan walls, ground, doorways, windows, balconies, signs,
       the sky, the corners — until the magical letters appear
       somewhere on a surface around them. Discovery > spoon-feeding.

       MANDATORY CLOSING TEMPLATE — adapt the wording but include
       EVERY element. Reference the BUTTON literally so the UI
       matches the riddle:

         "Rends-toi à [LIEU GÉNÉRAL: "la place du marché", "devant
         le monument", "au pied de la cathédrale"], puis appuie sur
         le grand bouton violet 'Ouvrir la Réalité Augmentée' en
         bas de ton écran. Une fois la caméra ouverte, balaie
         LENTEMENT tout ce qui t'entoure — les murs, le sol, les
         portes, les fenêtres, les recoins. Quelque part, des
         lettres dorées vont se matérialiser : c'est ta réponse.
         Note-la dans ton carnet pour passer à la suite."

       NEVER name "the north facade" / "the carved lion" / "the
       wooden studded door". Keep the destination generic ("at the
       church", "in front of the tower", "in the market square") so
       the discovery moment is the player's reward, not a checkbox.

5. "answer_text": ONLY the short evocative answer. A year, a roman
   numeral, ONE word. NEVER a sentence. Copy from the location data.

6. "hints": Array of EXACTLY 3 hints, in this STRICT JSON shape:
     [
       { "order": 1, "text": "atmospheric nudge" },
       { "order": 2, "text": "where to look + tell them to open the AR camera" },
       { "order": 3, "text": "shape of the answer (no spoiler)" }
     ]
   The "order" and "text" keys are MANDATORY. Do NOT return a string
   array like ["hint"] or a bare object — that breaks the pipeline.
   The array MUST be length 3, no more, no less.

   Each hint serves a distinct purpose — together they form a
   ladder so a stuck player can climb without skipping the step:

   Hint 1 — ATMOSPHERIC NUDGE
     Re-anchors the player in the riddle's world without giving away
     the mechanism. Refers to a real visible element of the place
     (a stone, a window, a colour) without saying what to do.
     Example: "The stones themselves remember the founding century."

   Hint 2 — OPEN THE CAMERA + WHERE TO LOOK
     This is the CRITICAL one. The player likely doesn't know the
     answer is hidden in AR. This hint MUST tell them to:
       (a) open / point their camera at a SPECIFIC surface
           ("aim your phone camera at the pediment above the main
           door", "open the AR camera and slowly sweep the south
           wall left to right")
       (b) name the surface in plain words anyone can find
     Without this hint, the player thinks the answer is hidden in the
     real-world stones and never opens the camera. Game-over.

   Hint 3 — SHAPE OF THE ANSWER
     Tells what FORMAT the answer takes, never the literal value.
     Example: "It's a Roman numeral followed by a single Latin word."

   Example (good for hint 2):
     "Open your phone's camera in the AR mode and aim it at the
     carved pediment above the main entrance — the magical letters
     will materialise on the stone."

   Example (bad — too vague):
     "Look around the church."

   Example (bad — spoils the answer):
     "Scan the wall, the answer is 1532."

   Hints are unlocked at a small time penalty. Never reveal the
   literal answer. Keep each hint under 200 characters.

7. "anecdote": 2-3 fascinating, factually-true sentences about the
   place's history. The player's reward after solving. This is where
   you can include a real verifiable historical fact from the research
   — not the answer, but the lore.

8. "bonus_time_seconds": 0 for easy stops, 30-60 for harder ones.

9. "answer_source": ALWAYS the literal string "virtual_ar". Every step.

10. "ar_character_type": The character archetype that materialises in AR
    when the player arrives. Drives the sprite that's rendered. Follow
    the selection procedure STRICTLY — DO NOT default to one or two
    characters across the whole game.
${buildCharacterSelectionGuidance(stepCount)}

11. "ar_character_dialogue": A short atmospheric line (1-2 sentences MAX,
    under 180 chars) the character whispers to the player. SET THE MOOD,
    tease the riddle, but NEVER state the answer. First-person, in
    character. Examples — monk: "I have guarded these stones since before
    your grandfather's grandfather drew breath..."; corsair ghost: "The
    sea took my body, but the harbour holds my secret still..."

12. "ar_facade_text": MUST equal answer_text converted to UPPERCASE,
    EXACTLY. No extra words, no decoration, no "PLATFORM IX" when the
    answer is "IX". The string the player sees on the facade in AR is
    the literal letters they will type into the notebook — they MUST
    match after a case-insensitive + whitespace comparison. Under 30
    characters.

13. "ar_treasure_reward": One sentence describing the magical object that
    appears when the step is solved (e.g. "A silver key engraved with a
    galleon and a crescent moon"). Pure flavour, themed to the narrative
    beat. Under 130 chars.

14. "route_attractions": Array of EXACTLY 1-3 short cultural / heritage
    points-of-interest the player will physically pass ON THE WAY to
    this step (or right next to it). Real, factual, concrete buildings
    / statues / fountains / bakeries / plaques. NOT fictional. Each
    entry uses this STRICT JSON shape:
      [
        {
          "name": "Maison Borghi (XVIIe siecle)",
          "fact": "Balcons en fer forge classes monuments historiques, restaures en 1987."
        },
        ...
      ]
    Mandatory keys: "name" (under 60 chars) + "fact" (one sentence
    factual under 140 chars). Do NOT return a string array — that
    breaks the pipeline. The UI shows these as a small expandable
    card "Sur le chemin, ne manque pas..." above the riddle, so the
    player can slow down and observe. Step 1 has no "way to" — for
    step 1, these can be points BEHIND the player or visible from
    the starting point. Always 1-3 entries, never empty.

═══════════════════════════════════════════════════════════════════════
GAME-WIDE INVARIANTS (apply across the whole array of ${stepCount} steps)
═══════════════════════════════════════════════════════════════════════

INV-1 UNIQUE ANSWERS — every answer_text in the array MUST be unique. No
two steps share the same answer. If you find yourself producing a
duplicate, change one of them — pick a different year, a different word,
a different roman numeral.

INV-2 CHARACTER DIVERSITY — across the ${stepCount} steps you MUST use at
least ${Math.min(5, stepCount)} DISTINCT ar_character_type values from the
catalogue. Repeating the same character on consecutive steps is
forbidden. If your first draft has the same character ≥3 times, rewrite
the offenders with a different archetype that still fits the site type.

INV-3 NO TIGHT THEME LOOP — across the ${stepCount} answers, vary the
TYPE: some years, some Latin / local-language single words, some roman
numerals. Aim for ~50% mix at minimum.

NARRATIVE REQUIREMENTS:
- Step 1: Hook the player. Begin with excitement and intrigue. Set the
  tone of the walk: "you're about to discover X corner of this city".
- Middle steps: Build tension. Each step references the previous
  discovery AND introduces what the player will physically see on the
  way to the next one.
- Step ${stepCount} (final): Land the story. Convergence + reveal.
- Tone: mysterious + poetic + historically grounded.
- THE PLAYER IS WALKING. Riddles must feel like a tour, not a quiz.

VERIFIED LOCATIONS WITH GAME-READY ANSWERS:

${locationsText}

Return ONLY a valid JSON array of EXACTLY ${stepCount} objects, no additional text, no commentary, no markdown formatting.${feedbackBlock}`;

  // 8192 tokens is more than enough for 8 steps × ~700 tokens each (riddle
  // 6-9 sentences + 4 AR fields + 3 hints + anecdote). The previous 4096
  // ceiling was getting truncated mid-JSON on 8-stop games with the new
  // longer prompt — Claude returned malformed JSON because its budget ran
  // out before closing the array. claude-sonnet-4 supports up to 64k
  // output, so 8192 is comfortable + cheap.
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  // Defensive: log when we're close to / at the cap so future spikes are
  // visible without staring at JSON parse errors.
  const stopReason = message.stop_reason;
  if (stopReason === "max_tokens") {
    console.warn(
      `[generateGameSteps] Claude hit max_tokens=8192. Output likely truncated; JSON parse may fail. Consider raising the cap or shortening the prompt.`,
    );
  }

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
  "answer_source": "virtual_ar",
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
