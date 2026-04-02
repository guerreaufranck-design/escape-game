/**
 * Anthropic Claude API client for creative game content generation
 * Uses Claude Sonnet for riddle creation, narrative, and formatting
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ResearchedLocation } from "./perplexity";

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
  const client = getAnthropicClient();

  // Format locations for the prompt
  const locationsText = locations
    .map(
      (loc, i) => `Location ${i + 1}: ${loc.name}
- GPS: ${loc.latitude}, ${loc.longitude}
- What to observe: ${loc.whatToObserve}
- ANSWER: ${loc.answer}
- Answer type: ${loc.answerType}
- Source: ${loc.source}
- Theme link: ${loc.themeLink || "N/A"}`
    )
    .join("\n\n");

  const prompt = `You are an expert escape game designer with a talent for immersive storytelling. I am giving you ${locations.length} verified locations in ${city}, ${country}, with confirmed answers. Your job is to select the best 6 and create an unforgettable escape game around them.

ABSOLUTE RULE: The answer_text field must contain ONLY the short answer provided below. It will be a number, a year, or a single word/name. Do NOT expand it into a sentence. Do NOT add any description. Copy it EXACTLY as shown. Example: if the answer is 5, write "5" not "five stone arches".

GAME PARAMETERS:
- City: ${city}, ${country}
- Theme: ${theme}
- Narrative: ${narrative}
- Difficulty: ${difficulty}/5
- Steps: 6 (select the best 6 from the ${locations.length} locations below for narrative flow and walking route)
- Language: English (will be auto-translated by the app)

FOR EACH OF THE 6 STEPS, create a JSON object with:

1. "title": An evocative, mysterious title (max 8 words)
2. "latitude": Use EXACTLY the coordinates provided below — do not modify them
3. "longitude": Use EXACTLY the coordinates provided below — do not modify them
4. "validation_radius_meters": Between 15 and 50 meters (adjust based on location size)
5. "riddle_text": An immersive riddle (3-5 sentences) that:
   - Does NOT name the location or the answer directly
   - Weaves into the ongoing narrative
   - Guides the player toward the location through atmospheric clues
   - Tells them exactly WHAT to observe or count, without revealing the answer
   - References the previous step's discovery to create narrative continuity
6. "answer_text": Copy ONLY the short answer from the data below. A number must stay a number. A year must stay a year. NEVER turn it into a sentence.
7. "hints": Array of EXACTLY 3 hints:
   - Hint 1 (order: 1): Poetic and vague — sets the mood, gives a subtle direction
   - Hint 2 (order: 2): Moderate — tells the player what TYPE of thing to look for and roughly where
   - Hint 3 (order: 3): Very direct — nearly gives the answer without stating it explicitly
8. "anecdote": A fascinating, true historical anecdote (2-3 sentences). Make it captivating — this is the player's reward.
9. "bonus_time_seconds": 0 for straightforward steps, 30-60 for harder ones

NARRATIVE REQUIREMENTS:
- Step 1: Hook the player. The story begins with excitement and intrigue.
- Steps 2-5: Build tension progressively. Each step reveals a new fragment of the mystery.
- Step 6: Provide a powerful, satisfying conclusion.
- Each riddle MUST reference the previous discovery to create continuity.
- Tone: mysterious, poetic, historically rich.

VERIFIED LOCATIONS WITH GAME-READY ANSWERS:

${locationsText}

Return ONLY a valid JSON array of 6 objects, no additional text, no commentary, no markdown formatting.`;

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

  if (!Array.isArray(steps) || steps.length < 4) {
    throw new Error(`Expected at least 4 steps, got ${steps?.length || 0}`);
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
