import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePhotoWithAI } from "@/lib/gemini";
import { calculateScore } from "@/lib/scoring";
import { t, detectLocale } from "@/lib/i18n";

export async function POST(request: NextRequest) {
  try {
    const locale = detectLocale(request);
    const body = await request.json();
    const { photoBase64, sessionId, stepOrder, mode } = body as {
      photoBase64?: string;
      sessionId?: string;
      stepOrder?: number;
      mode?: string; // "location" = GPS fallback, validates the player is at the right place
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
      .select("*")
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
      .select("*")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Etape introuvable" },
        { status: 404 }
      );
    }

    // Determine what description to use for validation
    let referenceDescription: string;

    if (mode === "location") {
      // GPS fallback mode: use step title as location reference
      const titleText = typeof step.title === "object" ? (step.title as Record<string, string>).fr || Object.values(step.title as Record<string, string>)[0] : String(step.title);
      referenceDescription = titleText;
    } else {
      // Classic photo challenge mode
      if (!step.has_photo_challenge || !step.photo_reference) {
        return NextResponse.json(
          { error: "Cette etape n'a pas de defi photo" },
          { status: 400 }
        );
      }
      referenceDescription = step.photo_reference;
    }

    // Strip base64 prefix if present (data:image/jpeg;base64,...)
    const base64Data = photoBase64.includes(",")
      ? photoBase64.split(",")[1]
      : photoBase64;

    // Valider la photo avec Gemini (avec identification + anecdote en cas d'echec)
    const result = await validatePhotoWithAI(base64Data, referenceDescription, locale);

    if (mode === "location" && result.confidence > 0.6 && result.isValid) {
      // Photo validates location — treat as step completion (same as GPS validation)
      const now = new Date().toISOString();

      // Determine step start time
      const { data: lastCompletion } = await supabase
        .from("step_completions")
        .select("completed_at")
        .eq("session_id", sessionId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let stepStartedAt = session.started_at;
      if (lastCompletion) {
        stepStartedAt = lastCompletion.completed_at;
      }

      const timeSeconds = Math.round(
        (new Date(now).getTime() - new Date(stepStartedAt).getTime()) / 1000
      );

      // Create step completion
      await supabase.from("step_completions").insert({
        session_id: sessionId,
        step_id: step.id,
        step_order: stepOrder,
        started_at: stepStartedAt,
        completed_at: now,
        time_seconds: timeSeconds,
        hints_used: 0,
        penalty_seconds: 0,
        photo_validated: true,
        latitude: step.latitude,
        longitude: step.longitude,
        distance_meters: 0,
      });

      const isLastStep = stepOrder >= session.total_steps;

      if (isLastStep) {
        const totalTimeSeconds = Math.round(
          (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
        );
        const { data: allSteps } = await supabase
          .from("game_steps")
          .select("id, bonus_time_seconds")
          .eq("game_id", session.game_id);
        const bonusPoints = (allSteps || []).reduce((sum, s) => sum + s.bonus_time_seconds, 0);
        const finalScore = calculateScore({ totalTimeSeconds, totalPenaltySeconds: session.total_penalty_seconds, bonusPoints });

        await supabase
          .from("game_sessions")
          .update({ status: "completed", current_step: stepOrder + 1, completed_at: now, total_time_seconds: totalTimeSeconds, final_score: finalScore })
          .eq("id", sessionId);

        return NextResponse.json({
          isValid: true,
          confidence: result.confidence,
          feedback: result.feedback,
          stepValidated: true,
          completed: true,
          anecdote: step.anecdote ? t(step.anecdote, locale) : null,
          stepTitle: t(step.title, locale),
        });
      }

      // Advance to next step
      await supabase
        .from("game_sessions")
        .update({ current_step: stepOrder + 1 })
        .eq("id", sessionId);

      return NextResponse.json({
        isValid: true,
        confidence: result.confidence,
        feedback: result.feedback,
        stepValidated: true,
        completed: false,
        nextStep: stepOrder + 1,
        anecdote: step.anecdote ? t(step.anecdote, locale) : null,
        stepTitle: t(step.title, locale),
      });
    }

    // Standard photo challenge: mark photo as validated
    if (!mode && result.confidence > 0.7 && result.isValid) {
      await supabase
        .from("step_completions")
        .update({ photo_validated: true })
        .eq("session_id", sessionId)
        .eq("step_order", stepOrder);
    }

    // Confidence threshold: only expose recognizedObject/anecdote if Gemini
    // is highly confident it identified the right thing. Otherwise keep it
    // vague to avoid hallucinations being shown to the player.
    const RECOGNITION_THRESHOLD = 0.7;
    const highConfidence =
      typeof result.recognitionConfidence === "number" &&
      result.recognitionConfidence >= RECOGNITION_THRESHOLD;

    return NextResponse.json({
      isValid: result.isValid,
      confidence: result.confidence,
      feedback: result.feedback,
      recognizedObject: highConfidence ? result.recognizedObject : undefined,
      anecdote: highConfidence ? result.anecdote : undefined,
      proximityHint: result.proximityHint,
    });
  } catch (err) {
    console.error("Erreur route ai/validate-photo:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
