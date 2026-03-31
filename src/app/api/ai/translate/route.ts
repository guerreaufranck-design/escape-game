import { NextRequest, NextResponse } from "next/server";
import { translateText } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, targetLang } = body as {
      text?: string;
      targetLang?: string;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Le champ 'text' est requis" },
        { status: 400 }
      );
    }

    if (!targetLang || typeof targetLang !== "string") {
      return NextResponse.json(
        { error: "Le champ 'targetLang' est requis" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configuree" },
        { status: 500 }
      );
    }

    const translated = await translateText(text, targetLang);

    return NextResponse.json({ translated });
  } catch (err) {
    console.error("Erreur route ai/translate:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
