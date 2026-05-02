import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Returns a Gemini 2.5 Flash model instance.
 *
 * NOTE: The @google/generative-ai SDK (deprecated by Google in favor of
 * @google/genai) ships with an x-goog-api-key header auth that has started
 * returning misleading API_KEY_INVALID errors on certain accounts. The
 * direct REST endpoint (?key=...) works fine — see translateText() below
 * for the workaround. Other places using getGeminiModel() (validatePhoto,
 * translateGameContent batch) still go through the SDK because they need
 * vision / streaming features. If those fail too, swap them to fetch.
 */
export function getGeminiModel() {
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

/**
 * Translates text to a target language using Gemini.
 *
 * Bypasses the @google/generative-ai SDK and calls the REST endpoint
 * directly. Uses the URL-param key auth which is more permissive than
 * the SDK's header auth (the SDK was failing with API_KEY_INVALID even
 * when curl with the same key succeeds).
 */
export async function translateText(
  text: string,
  targetLang: string
): Promise<string> {
  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(targetLang);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Translate the following text to ${langName}. Return ONLY the translated text, nothing else. Preserve any special markers like [FIELD:xxx] or [KEY:xxx] exactly as they are.\n\n${text}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini translateText ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const out =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ??
    "";
  return String(out).trim();
}

/**
 * Compares a player's photo (base64) with the expected landmark description.
 * Returns validation result with confidence score and feedback.
 *
 * When the photo does NOT match the expected target, Gemini is asked to
 * identify what the player actually photographed and provide a short
 * anecdote about it, to reinforce the discovery experience.
 */
export async function validatePhotoWithAI(
  playerPhotoBase64: string,
  expectedDescription: string,
  lang: string = "fr"
): Promise<{
  isValid: boolean;
  confidence: number;
  feedback: string;
  recognizedObject?: string;
  recognitionConfidence?: number;
  anecdote?: string;
  proximityHint?: string;
}> {
  const model = getGeminiModel();

  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(lang);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are a photo validator for an outdoor treasure hunt game.

The player was supposed to photograph: "${expectedDescription}"

TASK 1 — Match the photo against the target:
- Does the image show the place or subject described above?
- What is your confidence (0.0 to 1.0)?

TASK 2 — Only if the photo does NOT match the target, try to identify what it is.

CRITICAL RULES for identification (anti-hallucination):
- Only set "recognizedObject" if you are HIGHLY CONFIDENT of the specific, verifiable name (e.g. a famous monument you actually know). Use the "recognitionConfidence" field to report this confidence.
- If you only see a generic object (a fountain, a statue, a church, a building) without being certain of its specific identity, LEAVE "recognizedObject" EMPTY. Do not guess. Do not invent.
- Only write an "anecdote" if you know VERIFIABLE historical or cultural facts about the specific object you named. If unsure, leave it empty. Never fabricate dates, architects, or events.
- The "anecdote" MUST be ONE short sentence (maximum 20 words) — a teaser, not a lecture. It should intrigue, not distract from the game.
- Better to return empty fields than to hallucinate.
- All text MUST be written in ${langName}.

If the photo DOES match the target, just fill the "feedback" field with a short encouraging message in ${langName} and leave all other optional fields empty.

Reply ONLY with valid JSON in this exact format:
{
  "isValid": true or false,
  "confidence": 0.0 to 1.0,
  "feedback": "Short encouraging message in ${langName}",
  "recognizedObject": "Specific verified name, or empty string if not certain",
  "recognitionConfidence": 0.0 to 1.0,
  "anecdote": "ONE short VERIFIABLE sentence (max 20 words), or empty string",
  "proximityHint": "Short encouragement to keep searching nearby in ${langName}, or empty string"
}`,
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: playerPhotoBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
    },
  });

  const response = result.response;
  const text = response.text().trim();

  try {
    const parsed = JSON.parse(text) as {
      isValid?: boolean;
      confidence?: number;
      feedback?: string;
      recognizedObject?: string;
      recognitionConfidence?: number;
      anecdote?: string;
      proximityHint?: string;
    };
    return {
      isValid: parsed.isValid === true,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0,
      feedback:
        typeof parsed.feedback === "string"
          ? parsed.feedback
          : "Photo analysee.",
      recognizedObject:
        typeof parsed.recognizedObject === "string" && parsed.recognizedObject.trim()
          ? parsed.recognizedObject.trim()
          : undefined,
      recognitionConfidence:
        typeof parsed.recognitionConfidence === "number"
          ? Math.min(1, Math.max(0, parsed.recognitionConfidence))
          : undefined,
      anecdote:
        typeof parsed.anecdote === "string" && parsed.anecdote.trim()
          ? parsed.anecdote.trim()
          : undefined,
      proximityHint:
        typeof parsed.proximityHint === "string" && parsed.proximityHint.trim()
          ? parsed.proximityHint.trim()
          : undefined,
    };
  } catch {
    console.error("Erreur de parsing de la reponse Gemini:", text);
    return {
      isValid: false,
      confidence: 0,
      feedback: "Impossible d'analyser la photo. Reessayez.",
    };
  }
}

/**
 * Generates a short historical anecdote (2-3 sentences) about a place.
 */
export async function generateAnecdote(
  placeName: string,
  historicalContext: string,
  lang: string
): Promise<string> {
  const model = getGeminiModel();

  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(lang);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu es un narrateur passionne d'histoire locale. Genere une courte anecdote historique (2-3 phrases maximum) a propos de "${placeName}".

Contexte historique : ${historicalContext}

Regles :
- Ecris en ${langName}
- Sois captivant et informatif
- Reste factuel
- 2-3 phrases maximum
- Ne mets pas de titre, juste l'anecdote

Reponds UNIQUEMENT avec l'anecdote, rien d'autre.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
    },
  });

  const response = result.response;
  return response.text().trim();
}

/**
 * Generates short walking directions from one point to another.
 * Returns a concise instruction like "Dirigez-vous vers le nord en longeant la rue X".
 */
export async function generateWalkingDirections(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  destinationName: string,
  lang: string
): Promise<string> {
  const model = getGeminiModel();

  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(lang);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu es un guide de ville. Un joueur d'escape game outdoor doit se rendre a pied d'un point a un autre.

Point de depart : latitude ${fromLat}, longitude ${fromLon}
Destination : "${destinationName}" (latitude ${toLat}, longitude ${toLon})

Donne des indications de marche courtes et concretes en ${langName}.

REGLES :
- 1 a 2 phrases maximum
- Mentionne les rues principales, places ou reperes visuels si tu les connais
- Indique la direction cardinale (nord, sud, est, ouest)
- Sois precis et utile, pas vague
- Si tu ne connais pas les rues exactes, donne la direction generale et la distance approximative
- N'invente PAS de noms de rues si tu n'es pas certain

Reponds UNIQUEMENT avec les indications, rien d'autre.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
    },
  });

  const response = result.response;
  return response.text().trim();
}

/**
 * Generates progressive hints based on hint level.
 * Level 1 = vague, Level 2 = moderate, Level 3 = almost the answer.
 */
export async function generateSmartHint(
  riddle: string,
  answer: string,
  hintLevel: number,
  lang: string
): Promise<string> {
  const model = getGeminiModel();

  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(lang);

  const levelInstructions: Record<number, string> = {
    1: "Donne un indice tres vague et poetique. Une metaphore ou suggestion subtile qui oriente le joueur sans rien reveler de concret. Sois mysterieux.",
    2: "Donne un indice modere. Indique au joueur quel type de chose chercher (un nombre, un symbole, un mot) et approximativement ou, mais ne revele PAS la reponse exacte.",
    3: "Donne un indice fort et direct. Sois precis sur quoi chercher et ou, mais ne revele PAS la reponse exacte elle-meme. Le joueur doit faire la decouverte finale lui-meme.",
  };

  const instruction =
    levelInstructions[hintLevel] || levelInstructions[2];

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu es un narrateur mysterieux qui aide un joueur dans un jeu de piste en exterieur.

L'enigme actuelle : "${riddle}"

Niveau d'indice demande : ${hintLevel}/3

${instruction}

REGLES IMPORTANTES :
- Ne revele JAMAIS la reponse exacte : "${answer}"
- Ecris en ${langName}
- Garde un ton mysterieux et atmospherique
- 2-3 phrases maximum
- Sois encourageant

Reponds UNIQUEMENT avec l'indice, rien d'autre.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
    },
  });

  const response = result.response;
  return response.text().trim();
}
