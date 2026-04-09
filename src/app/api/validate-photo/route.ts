import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface ValidatePhotoRequestBody {
  sessionId: string;
  stepOrder: number;
  photoUrl: string;
  playerLanguage?: string;
}

interface ValidationResult {
  validated: boolean;
  confidence: number;
  reason: string;
}

interface GeminiValidationJson {
  validated?: boolean;
  confidence?: number;
  reason?: string;
}

async function translateReason(
  reason: string,
  targetLanguage: string,
  apiKey: string
): Promise<string> {
  if (!targetLanguage || targetLanguage === "fr") return reason;

  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `Translate this short feedback message from French to ${targetLanguage}. Keep it concise and encouraging. Return only the translated text, no JSON:\n\n${reason}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return reason;

    const data = (await res.json()) as GeminiResponse;
    const translated =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return translated || reason;
  } catch {
    return reason;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ValidatePhotoRequestBody;
    const { sessionId, stepOrder, photoUrl, playerLanguage = "fr" } = body;

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
    if (!photoUrl || typeof photoUrl !== "string") {
      return NextResponse.json(
        { error: "photoUrl est requis" },
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

    // 1. Retrieve session and game step
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
      .select("id, photo_reference, has_photo_challenge")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Étape introuvable" },
        { status: 404 }
      );
    }

    if (!step.has_photo_challenge || !step.photo_reference) {
      return NextResponse.json(
        { error: "Cette étape n'a pas de défi photo" },
        { status: 400 }
      );
    }

    // 2. Download image and convert to base64
    const imageRes = await fetch(photoUrl);
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: "Impossible de télécharger la photo" },
        { status: 400 }
      );
    }

    const contentType =
      imageRes.headers.get("content-type") ?? "image/jpeg";
    const imageBuffer = await imageRes.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");

    // 3. Call Gemini Vision
    const prompt = `You are validating a photo taken during an outdoor escape game.

The player should have photographed: "${step.photo_reference}"

Look at the provided image and determine:
1. Does the image show the described location or subject?
2. Is the player (or a clear indication of presence) visible or implied?
3. How confident are you?

Return ONLY valid JSON in this exact format:
{
  "validated": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "A short encouraging message in French explaining your decision (1-2 sentences max)"
}`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: contentType,
                data: imageBase64,
              },
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
      console.error("Gemini vision error:", errText);
      return NextResponse.json(
        { error: "Erreur lors de la validation de la photo" },
        { status: 502 }
      );
    }

    const geminiData = (await geminiRes.json()) as GeminiResponse;
    const rawText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let result: ValidationResult = {
      validated: false,
      confidence: 0,
      reason: "Impossible d'analyser la photo.",
    };

    try {
      const parsed = JSON.parse(rawText) as GeminiValidationJson;
      result = {
        validated: parsed.validated === true,
        confidence:
          typeof parsed.confidence === "number"
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0,
        reason:
          typeof parsed.reason === "string"
            ? parsed.reason
            : "Photo analysée.",
      };
    } catch {
      console.error("Failed to parse Gemini vision JSON:", rawText);
    }

    // 4. Update step_completions table
    await supabase
      .from("step_completions")
      .update({ photo_validated: result.validated })
      .eq("session_id", sessionId)
      .eq("step_order", stepOrder);

    // 5. Translate reason if needed
    if (playerLanguage && playerLanguage !== "fr") {
      result.reason = await translateReason(
        result.reason,
        playerLanguage,
        apiKey
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("validate-photo route error:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
