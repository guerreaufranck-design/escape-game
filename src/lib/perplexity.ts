/**
 * Perplexity API client for deep research on game locations
 * Uses sonar-deep-research model for verified, sourced facts
 *
 * Two modes:
 * 1. Predefined stops: Research facts about specific locations provided by the game designer
 * 2. Discovery mode: Find and research locations from scratch (fallback)
 */

interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export interface ResearchedLocation {
  name: string;
  latitude: number;
  longitude: number;
  whatToObserve: string;
  answer: string;
  answerType: "year" | "number" | "name";
  source: string;
  themeLink?: string;
  /**
   * Where the answer lives:
   * - "physical": a real number/name/date carved or inscribed on the exterior
   * - "virtual_ar": Claude generated an answer that will be revealed via AR
   *   overlay when the player locks on the target (for places with no
   *   convenient physical indice)
   */
  answerSource?: "physical" | "virtual_ar";
}

/** A stop predefined by the game designer on oddballtrip */
export interface PredefinedStop {
  name: string;
  description?: string;
}

/**
 * Call Perplexity API
 * @param model - "sonar-deep-research" for research, "sonar-pro" for structured extraction
 */
async function callPerplexity(
  messages: PerplexityMessage[],
  model: string = "sonar-deep-research"
): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  console.log(`[Perplexity] Calling model: ${model}`);

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as PerplexityResponse;
  return data.choices[0].message.content;
}

/**
 * Use Claude to extract structured JSON from Perplexity's research report
 * Claude is much better at structured extraction than Perplexity
 */
async function extractJsonWithClaude(
  researchText: string,
  locationCount: number
): Promise<ResearchedLocation[]> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const client = new Anthropic({ apiKey });

  console.log("[Pipeline] Using Claude to extract JSON from research report...");

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `I have a research report about ${locationCount} locations in a city for an outdoor escape game. Extract structured data from this report.

For each location mentioned, provide a JSON object with these fields:
- "name": exact name of the monument (string)
- "latitude": GPS latitude with 6 decimal places (number)
- "longitude": GPS longitude with 6 decimal places (number)
- "whatToObserve": what the player should observe (string)
- "answer": the SHORT answer a player would give (string, max 3 words)
- "answerType": "year", "number", or "name" (string)
- "answerSource": "physical" OR "virtual_ar" (string)
- "source": any source URL mentioned in the research (string)
- "themeLink": one sentence about historical significance (string)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULE — YOU MUST NEVER RETURN "UNVERIFIED" OR SKIP A LOCATION.
EVERY location in the research report MUST get a concrete answer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STRATEGY TO CHOOSE THE ANSWER:

STEP 1 — Try "physical" first. Look for something real, visible from outside:
  a) A YEAR or DATE permanently carved in stone / inscribed on a plaque
     (example: "999", "1085", "ANNO 1605")
  b) A PROPER NAME permanently inscribed on the facade or heritage plaque
     (example: "Alfonso VI", "Samuel ha-Levi")
  c) A single unambiguous NUMBER of major architectural features
     (number of main doors, main towers, arches on the main facade)
  If you find one, set answerSource = "physical" and use the real value.
  For these: "whatToObserve" describes where exactly to look (which wall, which plaque).

STEP 2 — Fallback to "virtual_ar" when nothing physical fits.
  When the location has no obvious permanent inscription, or the research is
  unclear, INVENT a short, evocative answer consistent with the game theme:
    - A plausible year linked to the place's history (from the research report)
    - A short key word in the local language (max 1 word, 3-6 letters)
    - A roman numeral evoking the era (III, VII, XIII, MCDXCII)
    - A symbolic number linked to the theme (3 keys → "III", 7 seals → "VII")
  Set answerSource = "virtual_ar".
  For these: "whatToObserve" is always the same — the phrase:
    "Point your camera at the facade in AR mode — the answer will appear painted on the wall."

EVERY single location in the research gets its own entry in the output array.
NO UNVERIFIED. NO SKIPS. If physical fails, use virtual_ar. Period.

OTHER RULES:
- The answer must be SHORT: a year, a number, or max 3 words
- If GPS coordinates are in the research, use those exactly (6 decimals)
- If coordinates missing, estimate from the known location name
- answerType: "year" (1234, MCMLX), "number" (1, 3, 7, VII), or "name" (short word)

Return ONLY a valid JSON array of ${locationCount} objects. No markdown, no commentary.

RESEARCH REPORT:
${researchText}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  return parseLocationsFromResponse(responseText);
}

function parseLocationsFromResponse(rawResponse: string): ResearchedLocation[] {
  // Log raw response for debugging
  console.log("[Perplexity] Raw response length:", rawResponse.length);
  console.log("[Perplexity] First 500 chars:", rawResponse.substring(0, 500));

  // Try to extract JSON array from markdown/text response
  let jsonStr = "";

  // Method 1: Look for ```json ... ``` block
  const codeBlockMatch = rawResponse.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
  } else {
    // Method 2: Find the outermost [ ... ]
    const bracketMatch = rawResponse.match(/\[[\s\S]*\]/);
    if (bracketMatch) {
      jsonStr = bracketMatch[0];
    }
  }

  if (!jsonStr) {
    throw new Error(
      "Could not extract JSON from Perplexity response. Raw start: " +
        rawResponse.substring(0, 200)
    );
  }

  // Clean up common issues in Perplexity responses
  // Remove citation markers like [1], [2], etc.
  jsonStr = jsonStr.replace(/\[(\d+)\]/g, "");
  // Remove markdown links [text](url) that aren't part of JSON
  jsonStr = jsonStr.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Remove trailing commas before } or ]
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");

  try {
    const locations = JSON.parse(jsonStr) as ResearchedLocation[];
    if (!Array.isArray(locations) || locations.length < 1) {
      throw new Error(
        `Expected at least 1 location, got ${locations?.length || 0}`
      );
    }
    return locations;
  } catch (parseError) {
    console.error("[Perplexity] JSON parse error:", parseError);
    console.error("[Perplexity] Cleaned JSON (first 500):", jsonStr.substring(0, 500));
    throw new Error(
      `Failed to parse Perplexity JSON: ${parseError instanceof Error ? parseError.message : "Unknown"}`
    );
  }
}

const ANSWER_RULES = `The answer MUST be one of these types (in order of preference):
- A YEAR or DATE permanently carved in stone, inscribed on a metal plaque, or printed on an official ceramic heritage sign on the exterior wall (example: "1085", "1357", "ANNO 1605")
- A PROPER NAME permanently inscribed on the building facade, on a street sign, or on an official heritage plaque (example: "Alfonso VI", "Samuel ha-Levi")
- A single NUMBER that is absolutely unambiguous: number of main entrance doors (not windows, not small arches, not decorative elements) or number of main towers visible from one viewpoint

DO NOT provide:
- Architectural descriptions ("horseshoe arches", "square brick")
- Features only visible from inside the building
- Vague counts of decorative elements
- Answers that require interpretation or expert knowledge

I need answers that would survive 10 years without changing and that 10 different people would all report identically.`;

const JSON_FORMAT = `For each location provide your response as a JSON array with these fields:
- "name": exact name of the monument
- "latitude": GPS latitude (6 decimal places, verified against Google Maps)
- "longitude": GPS longitude (6 decimal places, verified against Google Maps)
- "whatToObserve": what exactly to look at (which wall, which plaque, at what height)
- "answer": the EXACT short answer (a year, a number, or a name - maximum 3 words)
- "answerType": "year", "number", or "name"
- "source": source URL confirming this specific detail
- "themeLink": one sentence connecting this place to the game theme

Return ONLY a valid JSON array, no additional text.`;

/**
 * MODE 1: Research facts about PREDEFINED stops
 * The game designer already chose the locations — Perplexity only finds verifiable facts
 * Flow: Perplexity (research text) → Claude (extract JSON)
 */
export async function researchPredefinedStops(
  city: string,
  country: string,
  theme: string,
  stops: PredefinedStop[]
): Promise<ResearchedLocation[]> {
  const stopsList = stops
    .map((s, i) => `${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}`)
    .join("\n");

  const prompt = `I need you to conduct deep research for an outdoor escape game in ${city}, ${country}, themed around "${theme}".

The game designer has already chosen these specific locations for the game. For EACH location below, find:
1. The exact GPS coordinates (latitude, longitude with 6 decimal places)
2. ONE specific observable detail that a player can verify by standing in front of the building WITHOUT entering or paying any fee

The observable detail should be:
- A YEAR or DATE permanently carved or inscribed on the exterior
- OR a PROPER NAME permanently inscribed on the building or on an official heritage plaque
- OR a NUMBER of major architectural features clearly countable from outside (main doors, towers, arches)

LOCATIONS TO RESEARCH:
${stopsList}

Research each location thoroughly. Provide GPS coordinates, historical facts, and the specific observable detail for each one.`;

  // Step 1: Perplexity Deep Research → full text report
  const researchReport = await callPerplexity(
    [{ role: "user", content: prompt }],
    "sonar-deep-research"
  );

  console.log(`[Perplexity] Research report received: ${researchReport.length} chars`);

  // Step 2: Claude extracts structured JSON from the report
  return extractJsonWithClaude(researchReport, stops.length);
}

/**
 * MODE 2: Discovery mode — find locations from scratch
 * Used when no predefined stops are provided
 * Flow: Perplexity (research text) → Claude (extract JSON)
 */
export async function researchGameLocations(
  city: string,
  country: string,
  theme: string,
  themeDescription: string
): Promise<ResearchedLocation[]> {
  const prompt = `I need you to conduct deep research for an outdoor escape game in ${city}, ${country}, themed around "${theme}" (${themeDescription}).

Find exactly 8 locations in ${city}'s historic center that are relevant to this theme. For each location, provide:
1. The exact GPS coordinates
2. Historical significance related to the theme
3. ONE specific observable detail that a player can verify from outside WITHOUT entering or paying:
   - A year/date carved or inscribed on the exterior
   - OR a name permanently inscribed on the building
   - OR a count of major architectural features (doors, towers, arches)

Research each location thoroughly with sources.`;

  // Step 1: Perplexity Deep Research → full text report
  const researchReport = await callPerplexity(
    [{ role: "user", content: prompt }],
    "sonar-deep-research"
  );

  console.log(`[Perplexity] Research report received: ${researchReport.length} chars`);

  // Step 2: Claude extracts structured JSON from the report
  const locations = await extractJsonWithClaude(researchReport, 8);

  if (locations.length < 8) {
    throw new Error(`Expected at least 8 locations, got ${locations.length}`);
  }

  return locations;
}
