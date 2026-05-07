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
  /**
   * Real geocoder-friendly landmark name (e.g. "Abbaye Saint-Philibert,
   * Tournus"). Used by the GPS-first pipeline to thread the operator-
   * provided real name through to `game_steps.landmark_name` for audit.
   * Hidden from players.
   */
  landmarkName?: string;
}

/** A stop predefined by the game designer on oddballtrip */
export interface PredefinedStop {
  /** Public-facing name. May be poetic ("Le Sanctuaire des Pierres
   *  Anciennes"). What the player would see if Claude reuses it
   *  verbatim, but Claude usually writes its own creative title on
   *  top. */
  name: string;
  /** Real, geocoder-friendly landmark name ("Abbaye Saint-Philibert,
   *  Tournus"). Used by the pipeline to fetch authoritative GPS
   *  coordinates from Google Places / Nominatim. NEVER exposed to
   *  the player. Fallback: when missing, the pipeline geocodes
   *  `name` instead and crosses fingers. */
  landmarkName?: string;
  /** Free-text context provided by the operator — historical facts,
   *  what to observe, etc. Helps Claude write a richer riddle. */
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
        content: `I have a research report about ${locationCount} locations in a city for an outdoor AR escape game. Extract structured data.

For each location, provide a JSON object with:
- "name": exact name of the monument (string)
- "latitude": GPS latitude (6 decimal places, MANDATORY)
- "longitude": GPS longitude (6 decimal places, MANDATORY)
- "whatToObserve": player-facing instruction (string — see template below)
- "answer": a short evocative answer that will be revealed magically in AR (string)
- "answerType": "year" | "number" | "name"
- "answerSource": ALWAYS "virtual_ar" (the game runs entirely on AR-revealed answers)
- "source": source URL from the research (string, optional)
- "themeLink": one sentence on the place's historical / narrative significance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE GAME IS AR-FIRST. EVERY answer is rendered ON THE FACADE in AR.
There is NO requirement for the answer to be physically inscribed
on the building. INVENT a memorable, thematic answer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANSWER GUIDELINES:
- Type "year": a plausible year tied to the location's history (e.g. 1085, 1492, MCDXCII)
- Type "number": a small roman/arabic number with thematic resonance (III, VII, 3, 7, XIII)
- Type "name": ONE evocative word in any language — Latin, local language, theme-vocabulary
  (e.g. VERITAS, SANGRE, AMARO, REQUIESCAT, FIDES, REGINA, CORSARIO)
- Keep it SHORT: maximum 3 words, ideally 1.
- Make it memorable, dramatic, tied to the riddle's narrative beat.
- Same answer can appear twice across locations only if it's a recurring narrative motif.

WHAT TO OBSERVE — every entry uses this template (translated by the runtime):
  "Reach the location and point your camera at the facade — the AR will reveal the secret."

OTHER RULES:
- GPS coordinates from the research are AUTHORITATIVE. Use them exactly (6 decimals).
- If coordinates are missing, refuse to invent — set them to 0 and let the pipeline catch it.
- EVERY location in the research gets exactly ONE entry. No skips. No "UNVERIFIED".

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
    // Force every entry to virtual_ar — the AR-first flow doesn't keep
    // physical-answer steps any more. Even if the LLM tries to mark
    // something as "physical", we override here so downstream code can
    // assume answerSource = "virtual_ar" for every step.
    for (const loc of locations) {
      loc.answerSource = "virtual_ar";
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

/**
 * Candidat thématique retourné par la découverte Perplexity. Contient
 * uniquement le nom + une description courte ; la géolocalisation est
 * faite en aval par le pipeline via geocodeLocation() pour garantir
 * la précision sub-10 m. Source URL conservée pour la traçabilité.
 */
export interface ThematicLandmarkCandidate {
  /** Nom géocodable du lieu (ex. "Hôtel Claravallis, Clervaux"). */
  name: string;
  /** Phrase d'une ligne expliquant le lien thématique. Sera utilisée
   *  comme `whatToObserve` initial avant la regen narrative. */
  description: string;
  /** URL source citée par Perplexity quand disponible. Pas critique
   *  fonctionnellement, mais utile pour debug / audit. */
  source?: string;
}

/**
 * Découvre des landmarks RÉELS dans une ville qui sont thématiquement
 * connectés au scénario du jeu. Utilisé en backup quand des stops fournis
 * par oddballtrip sont introuvables au géocodage : plutôt que de prendre
 * n'importe quel POI patrimonial proche (ce que fait Google nearbysearch),
 * Perplexity cherche des lieux QUI ONT UN LIEN avec le thème vendu.
 *
 * Pourquoi Perplexity et pas Google : sur Clervaux/WWII, Google nearbysearch
 * renvoie des chapelles génériques (Lorette, Maria) parce qu'elles tagguent
 * `church` ou `tourist_attraction`. Perplexity sait que les vrais sites
 * mémoire de la Bataille des Ardennes sont l'Hôtel Claravallis, le Buste
 * du Colonel Fuller, le Pont sur la Clerve — landmarks que Google ignore
 * faute de catégorie ou trop spécifiques pour son index.
 *
 * Les noms retournés sont ENSUITE géocodés via Google Places dans le
 * pipeline pour obtenir des coordonnées sub-10 m. Ceux que Google ne
 * trouve pas (ex. "Maison Kratzenberg" peu indexée) sont droppés —
 * c'est OK, on accepte un parcours plus court mais propre.
 */
export async function discoverThematicLandmarks(params: {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  /** Narration intégrale du jeu — donne à Perplexity le contexte tonal
   *  pour comprendre quels landmarks "fittent" l'histoire. */
  narrative: string;
  /** Point de départ du parcours, transmis par oddballtrip. CRITIQUE :
   *  Perplexity DOIT chercher autour de ce point précis, pas autour du
   *  "centre-ville" abstrait. Sans ça, sur une `city` ambiguë comme
   *  "Port of Piraeus and historic center of Athens", Perplexity choisit
   *  une zone de son cru (la plus thématiquement pertinente : Piraeus
   *  pour Themistocle), tandis que mon pipeline filtre autour du
   *  startPoint réel (Athens). Résultat : 6 candidats sur 7 rejetés.
   *
   *  En passant les coords explicitement dans le prompt, on aligne le
   *  scope de découverte Perplexity avec celui du filtre 2 km. */
  startPoint: { lat: number; lon: number };
  /** Combien de candidats max à demander. On en demande TOUJOURS plus
   *  que `needed` (typiquement +50%) pour absorber le taux de drop au
   *  géocodage en aval. */
  needed: number;
  /** Noms de landmarks déjà utilisés (= stops opérateur réussis). On
   *  les pousse à Perplexity pour qu'il évite les doublons. */
  excludeNames?: string[];
}): Promise<ThematicLandmarkCandidate[]> {
  // Marge légère au-dessus de needed : on veut absorber les drops au
  // géocodage (Perplexity peut citer un nom obscur que Google ignore)
  // sans exiger un nombre absurde qui pousse Perplexity à fabriquer
  // ou à refuser. +2 est un bon compromis empirique.
  const requested = params.needed + 2;

  const exclusionBlock =
    params.excludeNames && params.excludeNames.length > 0
      ? `\n\nDO NOT propose these landmarks (already part of the parcours):\n${params.excludeNames.map((n) => `- ${n}`).join("\n")}`
      : "";

  // ATTENTION : on ne passe PAS \`params.narrative\` à Perplexity. La
  // narration est en partie fictionnelle (personnages inventés, intrigue
  // dramatisée par Claude pour le scénario du jeu). Si on la donne à
  // Perplexity, il refuse à juste titre de fabriquer des liens documentés
  // entre des landmarks réels et une histoire fictive — et retourne du
  // texte d'avertissement à la place de notre JSON. On lui passe seulement
  // \`theme\` + \`themeDescription\` qui pointent vers un sujet historique
  // réel ("Battle of the Bulge", "Renaissance art trail"), suffisant pour
  // la découverte. L'adaptation narrative en aval (Claude) habillera
  // ces landmarks réels avec la fiction.
  // GPS coordinates précises du point de départ — ON ANCRE Perplexity ICI.
  // Lui dire "around the city centre" est ambigu pour les villes complexes
  // (Athens-Piraeus, Greater London, Tokyo). Les coords sub-degré lèvent
  // toute ambiguïté.
  const startLat = params.startPoint.lat.toFixed(5);
  const startLon = params.startPoint.lon.toFixed(5);

  const prompt = `You are sourcing real, existing landmarks for an outdoor walking tour. The tour will be themed, but you only need to find REAL landmarks tied to a real historical/cultural subject — the storytelling layer is added later.

GEOGRAPHIC ANCHOR — search ONLY around this exact point:
- Starting point GPS: ${startLat}, ${startLon}
- City: ${params.city}, ${params.country}
- Search radius: 2 km maximum from the GPS point above (NOT from "the city centre" — use the exact coordinates).

REAL-WORLD SUBJECT (extracted from the tour's theme — this is what to anchor on):
- Theme: "${params.theme}"
- Pitch: ${params.themeDescription}

TASK: list UP TO ${requested} REAL landmarks within 2 km walking distance of the GPS starting point given above, that resonate with the subject. Returning fewer is FINE — quality over quantity. Use web search to confirm each landmark (a) exists, (b) is geographically within ~2 km of ${startLat},${startLon}, and (c) has a verifiable real-world link to the subject (era, event, movement, person, architectural style…). It is acceptable to include landmarks where the link is partial or atmospheric (a square central to the era's life, a building from the right century) as long as the era / topic matches.${exclusionBlock}

CRITICAL — IF THE STARTING POINT'S NEIGHBORHOOD HAS LITTLE TO DO WITH THE THEME:
The operator may have chosen a starting point in a neighborhood that doesn't perfectly match the theme. DO NOT compensate by proposing landmarks in another neighborhood far away. STICK to the 2 km radius around the GPS point. If you cannot find ${requested} good landmarks in that radius, return fewer — even returning 0 is fine. The pipeline downstream will surface the issue rather than ship a non-walkable tour. Returning landmarks 5+ km away from the GPS point is a HARD FAIL — they will be rejected by the geocoding filter and the tour will fail to publish.

INTERPRETING THE SUBJECT:
- If the theme references a war/battle, list memorials, command posts, museums, monuments, plaques, key buildings — within the 2 km radius.
- If the theme references an art movement or era, list museums, galleries, statues, period buildings, artist residences — within the 2 km radius.
- If the theme is broader ("medieval mystery", "Renaissance secrets"), list landmarks from that era — within the 2 km radius.
- The link must be DOCUMENTED in heritage/tourism/Wikipedia sources, not invented.

CRITERIA:
- Each landmark must EXIST today and be findable on Google Maps or via a Wikipedia / heritage / tourism URL.
- Within 2 km of GPS ${startLat},${startLon}, walkable.
- Prefer well-named landmarks (geocoding will fail on overly obscure names like "the third house on the left").
- A mix of types is welcome (building, monument, street, square, bridge, plaque, café with historical plaque).

OUTPUT FORMAT — strict JSON array, no markdown, no commentary, no preamble:
[
  {
    "name": "Hôtel Claravallis, Clervaux",
    "description": "Headquarters of Colonel Hurley Fuller during the Battle of the Bulge, hit by panzers on 17 December 1944.",
    "source": "https://www.tracesofwar.com/sights/135470/Memorial-Colonel-Hurley-E-Fuller.htm"
  }
]

The "name" field MUST be in a form Google Maps can geocode (real name + city). The "description" stays under 200 chars and explains the link concretely (date, person, event, style), not poetically.`;

  // sonar-pro : équilibre vitesse / qualité. Testé sur Clervaux/WWII
  // avec un retour de 8 candidats thématiquement pertinents (Castle,
  // Battle of the Bulge Museum, G.I. Monument, Pak43 Cannon, Sts
  // Cosmas-Damian, Klöppelkrieg Monument…). sonar-deep-research a été
  // testé mais retourne un RAPPORT en Markdown long de 50k chars avec
  // un `<think>…</think>` au début — pas du JSON, et sa nature
  // research-report résiste aux instructions de structuration. On
  // resterait sur du sonar-pro tant que la qualité des candidats
  // reste bonne ; passer à un 2-stage Perplexity research → Claude
  // JSON extraction (comme `researchPredefinedStops`) si nécessaire.
  let raw: string;
  try {
    raw = await callPerplexity(
      [{ role: "user", content: prompt }],
      "sonar-pro",
    );
  } catch (err) {
    console.warn(
      `[discoverThematicLandmarks] Perplexity call failed: ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }

  // Parse JSON robustly: Perplexity sometimes wraps in ```json``` blocks,
  // adds a preamble, or peppers the prose with citation-style "[1]"
  // brackets that confuse a naïve `\[...\]` regex. sonar-deep-research
  // adds `<think>...</think>` reasoning blocks that must be stripped
  // first or the regex catches the [ inside the thinking. Strategy:
  //   1. Strip <think>...</think> blocks (deep-research reasoning).
  //   2. Strip code-block fences if present.
  //   3. Find the FIRST '[' followed by '{' (start of object array).
  //   4. Walk forward counting bracket depth to find the matching ']'.
  let work = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const codeBlockMatch = work.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) work = codeBlockMatch[1];

  let jsonStr = "";
  // Find the start of a JSON array of objects: '[' then optional whitespace then '{'
  const startMatch = work.match(/\[\s*\{/);
  if (startMatch && startMatch.index !== undefined) {
    const startIdx = startMatch.index;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let end = -1;
    for (let i = startIdx; i < work.length; i++) {
      const ch = work[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > startIdx) jsonStr = work.substring(startIdx, end + 1);
  }

  if (!jsonStr) {
    console.warn(
      `[discoverThematicLandmarks] no JSON array of objects in response (${raw.length} chars): ${raw.substring(0, 500)}`,
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.warn(
      `[discoverThematicLandmarks] JSON parse failed: ${err instanceof Error ? err.message : err}\nRaw chunk: ${jsonStr.substring(0, 500)}`,
    );
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn(
      `[discoverThematicLandmarks] expected array, got ${typeof parsed}`,
    );
    return [];
  }

  const candidates: ThematicLandmarkCandidate[] = [];
  for (const entry of parsed) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      typeof (entry as { description?: unknown }).description === "string"
    ) {
      const e = entry as { name: string; description: string; source?: unknown };
      candidates.push({
        name: e.name.trim(),
        description: e.description.trim(),
        source: typeof e.source === "string" ? e.source : undefined,
      });
    }
  }

  console.log(
    `[discoverThematicLandmarks] Perplexity returned ${candidates.length} candidate(s) for theme "${params.theme}" in ${params.city}`,
  );
  return candidates;
}

/**
 * Deep Research thématique structuré pour ENRICHIR la generation Claude.
 *
 * Bug observé en prod (Hakata 2026-05-07) : Claude génère un parcours
 * "Mongol invasion" mais ignore le vrai mur Genkō Bōrui, invente un
 * "master strategist" fictionnel, et cite une fausse Roman numeral
 * (MCCXXXI = 1231 alors que l'invasion fut en 1281).
 *
 * Solution : avant de demander à Claude de générer, on appelle Perplexity
 * Sonar Deep Research pour obtenir des FACTS VÉRIFIÉS sourcés (Wikipedia,
 * Britannica, sites patrimoniaux). Puis Claude utilise ces facts comme
 * ANCHORS dans les anecdotes — le riddle reste fictionnel mais l'anecdote
 * cite les vrais personnages, dates, événements documentés.
 *
 * Coût : ~$0.40-0.50 par jeu (Sonar Deep Research). Compensé par le
 * switch ElevenLabs Flash qui économise $0.85 — net économie + qualité.
 */
export interface VerifiedThemeContext {
  /** Sites historiquement iconiques liés au thème — Claude curation
   *  les utilise pour prioriser dans la sélection POI Google. */
  iconicSites: Array<{
    name: string;
    /** Indication géo verbale, pas GPS ("centre historique", "côte ouest"). */
    locationHint?: string;
    significance: string;
    sources: string[];
  }>;
  /** Personnages historiques RÉELS attachés au lieu/thème, pour citation
   *  factuelle dans l'anecdote (jamais comme protagoniste fictif). */
  realFigures: Array<{
    name: string;
    role: string;
    lifespan?: string;
    sources: string[];
  }>;
  /** Événements précis avec date — privilégier ces dates pour magic words. */
  events: Array<{
    /** Date la plus précise possible : "1281-08-14" / "1281" / "13e siècle". */
    date: string;
    description: string;
    sources: string[];
  }>;
  /** Traditions / coutumes / légendes locales documentées. */
  localTraditions: Array<{
    description: string;
    sources: string[];
  }>;
  /** Résumé brut Perplexity pour fallback / debug. */
  rawSummary: string;
}

const EMPTY_CONTEXT: VerifiedThemeContext = {
  iconicSites: [],
  realFigures: [],
  events: [],
  localTraditions: [],
  rawSummary: "",
};

export async function deepResearchTheme(params: {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
}): Promise<VerifiedThemeContext> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.warn("[deepResearchTheme] PERPLEXITY_API_KEY missing — returning empty context");
    return EMPTY_CONTEXT;
  }

  const researchPrompt = `Conduct deep research on the following theme for a tourist outdoor walking experience in ${params.city}, ${params.country}.

THEME: ${params.theme}
PITCH: ${params.themeDescription}
NARRATIVE CONTEXT: ${params.narrative}

I need you to find AUTHORITATIVE, SOURCED information about this theme. Your output will be used to anchor the factual content of an outdoor walking game — accuracy is critical.

Please research and return:

1. **ICONIC SITES**: 5-8 historically documented sites in ${params.city} directly related to this theme (e.g. for "Mongol invasion at Hakata" → Genkō Bōrui defensive wall, Hakozaki-gū shrine, Imazu beach). Include WHY each is significant.

2. **REAL HISTORICAL FIGURES**: 3-6 named individuals with documented connection to this theme/place (e.g. for Mongol invasion → Hōjō Tokimune the regent, Suketomo the general, etc.). Include their role and lifespan when known.

3. **DATED EVENTS**: 4-8 specific events with exact or approximate dates (year-month-day if possible) tied to this theme.

4. **LOCAL TRADITIONS**: 2-4 still-living traditions, customs, or commemorations related to this theme.

For EACH item, cite at least 1 source URL (Wikipedia, official heritage sites, encyclopedias, museums).

Be especially attentive to ICONIC sites that an outdoor escape game MUST include — the most famous landmarks tied to the theme. If the theme mentions "stone wall" / "fortress" / "tomb" / "abbey", prioritize the actual physical site.

Output: a structured research report with clear sections. URL citations matter.`;

  let researchText: string;
  try {
    researchText = await callPerplexity(
      [
        {
          role: "system",
          content:
            "You are a meticulous historian and tour-guide researcher. Cite verifiable sources for every fact. Prefer Wikipedia / Britannica / official heritage sites / museums over blog posts. Note explicitly when something is legend vs documented history.",
        },
        { role: "user", content: researchPrompt },
      ],
      "sonar-deep-research",
    );
    console.log(
      `[deepResearchTheme] Perplexity returned ${researchText.length} chars of research for "${params.theme}" in ${params.city}`,
    );
  } catch (err) {
    console.warn(
      `[deepResearchTheme] Perplexity failed: ${err instanceof Error ? err.message : err}. Returning empty context.`,
    );
    return EMPTY_CONTEXT;
  }

  // Use Claude to extract structured JSON from the research report.
  // Claude is more reliable than Perplexity for structured extraction.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.warn("[deepResearchTheme] ANTHROPIC_API_KEY missing — returning rawSummary only");
    return { ...EMPTY_CONTEXT, rawSummary: researchText };
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `Extract structured JSON from this research report on ${params.theme} in ${params.city}.

RESEARCH:
${researchText.slice(0, 12000)}

Return STRICT JSON in this shape (no markdown, no commentary):
{
  "iconicSites": [
    { "name": "string", "locationHint": "string|null", "significance": "string", "sources": ["url1", "url2"] }
  ],
  "realFigures": [
    { "name": "string", "role": "string", "lifespan": "string|null", "sources": ["url1"] }
  ],
  "events": [
    { "date": "string (YYYY-MM-DD or YYYY or '13th century')", "description": "string", "sources": ["url1"] }
  ],
  "localTraditions": [
    { "description": "string", "sources": ["url1"] }
  ]
}

Rules:
- Each array max 8 items
- Sources MUST be full URLs (https://...)
- Only include items with at least 1 cited source
- For events, prefer specific dates (1281-08-14) over centuries
- Return ONLY the JSON object`,
        },
      ],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[deepResearchTheme] Claude did not return valid JSON — using rawSummary only");
      return { ...EMPTY_CONTEXT, rawSummary: researchText };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<VerifiedThemeContext>;
    const ctx: VerifiedThemeContext = {
      iconicSites: Array.isArray(parsed.iconicSites)
        ? parsed.iconicSites.slice(0, 8)
        : [],
      realFigures: Array.isArray(parsed.realFigures)
        ? parsed.realFigures.slice(0, 8)
        : [],
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, 8) : [],
      localTraditions: Array.isArray(parsed.localTraditions)
        ? parsed.localTraditions.slice(0, 8)
        : [],
      rawSummary: researchText.slice(0, 4000),
    };
    console.log(
      `[deepResearchTheme] Extracted ${ctx.iconicSites.length} sites, ${ctx.realFigures.length} figures, ${ctx.events.length} events, ${ctx.localTraditions.length} traditions`,
    );
    return ctx;
  } catch (err) {
    console.warn(
      `[deepResearchTheme] Claude extraction failed: ${err instanceof Error ? err.message : err}. Falling back to rawSummary only.`,
    );
    return { ...EMPTY_CONTEXT, rawSummary: researchText };
  }
}
