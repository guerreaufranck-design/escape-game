import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePhotoWithAI } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { photoBase64, sessionId, stepOrder } = body as {
      photoBase64?: string;
      sessionId?: string;
      stepOrder?: number;
    };

    if (!photoBase64 || typeof photoBase64 !== "string") {
      return NextResponse.json(
        { error: "Le champ 'photoBase64' est requis" },
        { status: 400 }
      );
    }

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
      .select("id, game_id, status")
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

    // Recuperer l'etape avec la description attendue
    const { data: step, error: stepError } = await supabase
      .from("game_steps")
      .select("id, photo_reference, has_photo_challenge, step_order")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Etape introuvable" },
        { status: 404 }
      );
    }

    if (!step.has_photo_challenge || !step.photo_reference) {
      return NextResponse.json(
        { error: "Cette etape n'a pas de defi photo" },
        { status: 400 }
      );
    }

    // Valider la photo avec Gemini
    const result = await validatePhotoWithAI(
      photoBase64,
      step.photo_reference
    );

    // Si confiance > 0.7, marquer l'etape comme validee (photo)
    if (result.confidence > 0.7 && result.isValid) {
      await supabase
        .from("step_completions")
        .update({ photo_validated: true })
        .eq("session_id", sessionId)
        .eq("step_order", stepOrder);
    }

    return NextResponse.json({
      isValid: result.isValid,
      confidence: result.confidence,
      feedback: result.feedback,
    });
  } catch (err) {
    console.error("Erreur route ai/validate-photo:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
