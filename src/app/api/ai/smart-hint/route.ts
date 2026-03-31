import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSmartHint } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, stepOrder, hintLevel, lang } = body as {
      sessionId?: string;
      stepOrder?: number;
      hintLevel?: number;
      lang?: string;
    };

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Le champ 'sessionId' est requis" },
        { status: 400 }
      );
    }

    if (typeof stepOrder !== "number" || stepOrder < 1) {
      return NextResponse.json(
        { error: "Le champ 'stepOrder' doit etre un entier positif" },
        { status: 400 }
      );
    }

    if (typeof hintLevel !== "number" || hintLevel < 1 || hintLevel > 3) {
      return NextResponse.json(
        { error: "Le champ 'hintLevel' doit etre entre 1 et 3" },
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

    const supabase = createAdminClient();

    // Recuperer la session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(hint_penalty_seconds)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    if (session.status !== "active") {
      return NextResponse.json(
        { error: "La session n'est pas active" },
        { status: 400 }
      );
    }

    if (stepOrder !== session.current_step) {
      return NextResponse.json(
        { error: "Ce n'est pas l'etape en cours" },
        { status: 400 }
      );
    }

    // Recuperer l'etape (enigme + reponse)
    const { data: step, error: stepError } = await supabase
      .from("game_steps")
      .select("riddle_text, answer_text")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Etape introuvable" },
        { status: 404 }
      );
    }

    // Extraire le texte de l'enigme et de la reponse (gestion multilingue JSONB)
    let riddleText = step.riddle_text;
    let answerText = step.answer_text;

    if (typeof riddleText === "object" && riddleText !== null) {
      riddleText =
        (riddleText as Record<string, string>)[lang] ||
        (riddleText as Record<string, string>)["fr"] ||
        JSON.stringify(riddleText);
    }

    if (typeof answerText === "object" && answerText !== null) {
      answerText =
        (answerText as Record<string, string>)[lang] ||
        (answerText as Record<string, string>)["fr"] ||
        JSON.stringify(answerText);
    }

    // Generer l'indice avec Gemini
    const hint = await generateSmartHint(
      riddleText as string,
      answerText as string,
      hintLevel,
      lang
    );

    // Appliquer la penalite de temps (meme logique que les indices classiques)
    const game = session.games as unknown as {
      hint_penalty_seconds: number;
    };
    const penaltySeconds = game.hint_penalty_seconds || 120;

    const { error: updateError } = await supabase
      .from("game_sessions")
      .update({
        total_hints_used: session.total_hints_used + 1,
        total_penalty_seconds:
          session.total_penalty_seconds + penaltySeconds,
      })
      .eq("id", sessionId);

    if (updateError) {
      console.error("Erreur mise a jour session:", updateError);
      return NextResponse.json(
        { error: "Erreur lors de la mise a jour de la session" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      hint,
      penaltySeconds,
    });
  } catch (err) {
    console.error("Erreur route ai/smart-hint:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
