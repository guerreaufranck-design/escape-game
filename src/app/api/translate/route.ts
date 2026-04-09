import { NextRequest, NextResponse } from "next/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// In-memory translation cache
const translationCache = new Map<string, { translated: string; language: string; rtl: boolean }>();

// Languages that use right-to-left script
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi"]);

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface TranslateRequestBody {
  text: string;
  targetLanguage: string;
  context?: string;
}

interface TranslateResult {
  translated: string;
  original?: string;
  language: string;
  rtl: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TranslateRequestBody;
    const { text, targetLanguage, context } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Le champ 'text' est requis" },
        { status: 400 }
      );
    }

    if (!targetLanguage || typeof targetLanguage !== "string") {
      return NextResponse.json(
        { error: "Le champ 'targetLanguage' est requis" },
        { status: 400 }
      );
    }

    const lang = targetLanguage.toLowerCase().trim();
    const rtl = RTL_LANGUAGES.has(lang);

    // If target language is French, return as-is (source language)
    if (lang === "fr") {
      return NextResponse.json<TranslateResult>({
        translated: text,
        language: "fr",
        rtl: false,
      });
    }

    // Check cache
    const cacheKey = `${text}-${lang}`;
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return NextResponse.json<TranslateResult>(cached);
    }

    // Call Gemini 2.0 Flash
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurée" },
        { status: 500 }
      );
    }

    const systemPrompt = `You are a professional translator specializing in immersive escape game content.
Translate the following French text to ${lang} (language code).
Preserve the mysterious, atmospheric, medieval tone of the original.
Keep proper nouns (place names, character names) as-is.
${context ? `Context: ${context}` : ""}
Return ONLY valid JSON in this exact format: {"translated": "<your translation here>"}`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\nText to translate:\n${text}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    };

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini translate error:", errText);
      return NextResponse.json(
        { error: "Erreur lors de la traduction" },
        { status: 502 }
      );
    }

    const geminiData = (await geminiRes.json()) as GeminiResponse;
    const rawText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let translated = text; // fallback to original
    try {
      const parsed = JSON.parse(rawText) as { translated?: string };
      if (parsed.translated && typeof parsed.translated === "string") {
        translated = parsed.translated;
      }
    } catch {
      console.error("Failed to parse Gemini translation JSON:", rawText);
    }

    const result: TranslateResult = { translated, language: lang, rtl };

    // Store in cache
    translationCache.set(cacheKey, result);

    return NextResponse.json<TranslateResult>(result);
  } catch (err) {
    console.error("translate route error:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
