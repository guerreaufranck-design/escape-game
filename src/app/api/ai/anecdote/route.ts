import { NextRequest, NextResponse } from "next/server";
import { generateAnecdote } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { placeName, historicalContext, lang } = body as {
      placeName?: string;
      historicalContext?: string;
      lang?: string;
    };

    if (!placeName || typeof placeName !== "string") {
      return NextResponse.json(
        { error: "Le champ 'placeName' est requis" },
        { status: 400 }
      );
    }

    if (!historicalContext || typeof historicalContext !== "string") {
      return NextResponse.json(
        { error: "Le champ 'historicalContext' est requis" },
        { status: 400 }
      );
    }

    if (!lang || typeof lang !== "string") {
      return NextResponse.json(
        { error: "Le champ 'lang' est requis" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY non configuree" },
        { status: 500 }
      );
    }

    const anecdote = await generateAnecdote(placeName, historicalContext, lang);

    return NextResponse.json({ anecdote });
  } catch (err) {
    console.error("Erreur route ai/anecdote:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
