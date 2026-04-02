import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Returns a Gemini 2.5 Flash model instance.
 */
export function getGeminiModel() {
  return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
}

/**
 * Translates text to a target language using Gemini.
 * Accepts ISO 639-1 codes (fr, zh, ja, etc.) or full language names.
 */
export async function translateText(
  text: string,
  targetLang: string
): Promise<string> {
  const { getLanguageName } = await import("@/lib/i18n");
  const langName = getLanguageName(targetLang);
  const model = getGeminiModel();

  const result = await model.generateContent({
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
  });

  const response = result.response;
  return response.text().trim();
}

/**
 * Compares a player's photo (base64) with the expected landmark description.
 * Returns validation result with confidence score and feedback.
 */
export async function validatePhotoWithAI(
  playerPhotoBase64: string,
  expectedDescription: string
): Promise<{ isValid: boolean; confidence: number; feedback: string }> {
  const model = getGeminiModel();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu es un validateur de photos pour un jeu de piste en exterieur.

Le joueur devait photographier : "${expectedDescription}"

Analyse la photo fournie et determine :
1. Est-ce que l'image montre le lieu ou le sujet decrit ?
2. Quel est ton niveau de confiance ?
3. Donne un court feedback encourageant en francais.

Reponds UNIQUEMENT en JSON valide avec ce format exact :
{
  "isValid": true ou false,
  "confidence": 0.0 a 1.0,
  "feedback": "Message court et encourageant en francais"
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
      temperature: 0.2,
    },
  });

  const response = result.response;
  const text = response.text().trim();

  try {
    const parsed = JSON.parse(text) as {
      isValid?: boolean;
      confidence?: number;
      feedback?: string;
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
