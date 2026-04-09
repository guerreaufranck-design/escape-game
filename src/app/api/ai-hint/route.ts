import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

type HintLevel = "gentle" | "moderate" | "strong";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface AiHintRequestBody {
  sessionId: string;
  stepOrder: number;
  timeStuckSeconds: number;
  hintsAlreadyUsed: number;
  playerLanguage?: string;
}

interface AiHintResult {
  hint: string;
  level: HintLevel;
}

interface GeminiHintJson {
  hint?: string;
}

function getHintLevel(timeStuckSeconds: number): HintLevel {
  if (timeStuckSeconds < 180) return "gentle";
  if (timeStuckSeconds < 360) return "moderate";
  return "strong";
}

function getLevelInstruction(level: HintLevel): string {
  switch (level) {
    case "gentle":
      return "Give a very subtle hint — a poetic suggestion or a metaphor that points the player in the right direction without revealing anything specific. Be mysterious and atmospheric.";
    case "moderate":
      return "Give a moderate hint — tell the player what type of thing to look for (a number, a symbol, a word) and roughly where, but do not reveal the exact answer.";
    case "strong":
      return "Give a strong hint — be direct about what to look for and where, but do NOT reveal the exact answer itself. Encourage the player to make the final discovery themselves.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AiHintRequestBody;
    const {
      sessionId,
      stepOrder,
      timeStuckSeconds,
      hintsAlreadyUsed,
      playerLanguage = "fr",
    } = body;

    // Validate inputs
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId est requis" },
        { status: 400 }
      );
    }
    if (typeof stepOrder !== "number" || stepOrder < 1) {
      return NextResponse.json(
        { error: "stepOrder doit être un entier positif" },
        { status: 400 }
      );
    }
    if (typeof timeStuckSeconds !== "number" || timeStuckSeconds < 0) {
      return NextResponse.json(
        { error: "timeStuckSeconds doit être un nombre positif" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configurée" },
        { status: 500 }
      );
    }

    const supabase = createAdminClient();

    // 1. Retrieve session and step info
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("id, game_id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    const { data: step, error: stepError } = await supabase
      .from("game_steps")
      .select("title, riddle_text, answer_text, hints")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Étape introuvable" },
        { status: 404 }
      );
    }

    const level = getHintLevel(timeStuckSeconds);
    const levelInstruction = getLevelInstruction(level);

    // 2. Check if there's a pre-written hint for this level from the JSONB hints array
    interface PrewrittenHint {
      order: number;
      text: string;
    }
    const prewrittenHints = (step.hints as PrewrittenHint[] | null) ?? [];
    const hintIndexToUse = hintsAlreadyUsed; // 0-based index
    const preHint = prewrittenHints.find(
      (h) => h.order === hintIndexToUse + 1
    );

    // If we have a pre-written hint and the level allows it, use it as context for Gemini
    // We still run through Gemini to translate if needed and ensure quality

    const targetLang =
      playerLanguage && playerLanguage !== "fr" ? playerLanguage : null;

    // 3. Build the Gemini prompt
    const prompt = `You are a mysterious medieval narrator helping a player in an outdoor escape game in Carcassonne, France.

The player is stuck on this challenge:
TITLE: "${step.title}"
RIDDLE: "${step.riddle_text}"
${preHint ? `SUGGESTED HINT (adapt it): "${preHint.text}"` : ""}

The player has been stuck for ${Math.round(timeStuckSeconds / 60)} minute(s) and has used ${hintsAlreadyUsed} hint(s) already.

IMPORTANT RULES:
- NEVER reveal the exact answer: "${step.answer_text}"
- ${levelInstruction}
- Write in ${targetLang ? targetLang : "French"} language
- Keep the mysterious, atmospheric, medieval tone of a Cathare narrator
- Keep the hint concise (2-3 sentences maximum)
- If you are given a suggested hint, you may rephrase or adapt it to fit the language and tone

Return ONLY valid JSON in this exact format: {"hint": "<your hint here>"}`;

    const geminiPayload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    };

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini ai-hint error:", errText);
      return NextResponse.json(
        { error: "Erreur lors de la génération de l'indice" },
        { status: 502 }
      );
    }

    const geminiData = (await geminiRes.json()) as GeminiResponse;
    const rawText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let hint =
      preHint?.text ??
      "Prends le temps d'observer attentivement les détails autour de toi.";

    try {
      const parsed = JSON.parse(rawText) as GeminiHintJson;
      if (parsed.hint && typeof parsed.hint === "string") {
        hint = parsed.hint;
      }
    } catch {
      console.error("Failed to parse Gemini hint JSON:", rawText);
    }

    const result: AiHintResult = { hint, level };
    return NextResponse.json(result);
  } catch (err) {
    console.error("ai-hint route error:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
