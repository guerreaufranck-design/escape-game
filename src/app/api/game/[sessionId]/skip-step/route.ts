import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, detectLocale } from "@/lib/i18n";
import { calculateScore } from "@/lib/scoring";

const SKIP_PENALTY_SECONDS = 2700; // 45 minutes

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const body = await request.json();
    const { stepOrder } = body;
    const supabase = createAdminClient();

    // Fetch session
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

    if (stepOrder !== session.current_step) {
      return NextResponse.json(
        { error: "Ce n'est pas l'étape en cours" },
        { status: 400 }
      );
    }

    // Fetch current step (to get answer and coordinates)
    const { data: step, error: stepError } = await supabase
      .from("game_steps")
      .select("*")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Étape introuvable" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    // Determine step start time
    const { data: lastCompletion } = await supabase
      .from("step_completions")
      .select("completed_at")
      .eq("session_id", sessionId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const stepStartedAt = lastCompletion?.completed_at || session.started_at;
    const timeSeconds = Math.round(
      (new Date(now).getTime() - new Date(stepStartedAt).getTime()) / 1000
    );

    // Create step completion (skipped)
    await supabase.from("step_completions").insert({
      session_id: sessionId,
      step_id: step.id,
      step_order: stepOrder,
      started_at: stepStartedAt,
      completed_at: now,
      time_seconds: timeSeconds,
      hints_used: 0,
      penalty_seconds: SKIP_PENALTY_SECONDS,
      latitude: step.latitude,
      longitude: step.longitude,
      distance_meters: 0,
    });

    // Update session penalty
    const newPenalty = session.total_penalty_seconds + SKIP_PENALTY_SECONDS;

    const isLastStep = stepOrder >= session.total_steps;

    if (isLastStep) {
      const totalTimeSeconds = Math.round(
        (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
      );

      const finalScore = calculateScore({
        totalTimeSeconds,
        totalPenaltySeconds: newPenalty,
        bonusPoints: 0,
      });

      await supabase
        .from("game_sessions")
        .update({
          status: "completed",
          current_step: stepOrder + 1,
          completed_at: now,
          total_time_seconds: totalTimeSeconds,
          total_penalty_seconds: newPenalty,
          final_score: finalScore,
        })
        .eq("id", sessionId);

      return NextResponse.json({
        success: true,
        skipped: true,
        completed: true,
        answer: t(step.answer_text, locale),
        penaltyAdded: SKIP_PENALTY_SECONDS,
      });
    }

    // Advance to next step
    await supabase
      .from("game_sessions")
      .update({
        current_step: stepOrder + 1,
        total_penalty_seconds: newPenalty,
      })
      .eq("id", sessionId);

    return NextResponse.json({
      success: true,
      skipped: true,
      completed: false,
      nextStep: stepOrder + 1,
      answer: t(step.answer_text, locale),
      penaltyAdded: SKIP_PENALTY_SECONDS,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
