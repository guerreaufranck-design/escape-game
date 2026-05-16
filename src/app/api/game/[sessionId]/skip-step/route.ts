import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, detectLocale } from "@/lib/i18n";
import { translateStepFields } from "@/lib/translate-service";
import { calculateScore } from "@/lib/scoring";

/**
 * Helper : extrait l'anecdote + le titre traduits du step pour la locale
 * joueur. Mirror exact de la logique dans /validate-step/route.ts pour
 * que le SKIP affiche la MÊME anecdote que le VALIDATE.
 *
 * Bug fixé 2026-05-15 (incident Julien Alba) : avant ce commit le skip
 * ne renvoyait que `answer`, le client perdait l'anecdote historique.
 * Le joueur qui skip continue de mériter le contenu pédagogique — c'est
 * exactement l'esprit "skip = filet de sécurité, pas punition".
 */
async function resolveAnecdoteAndTitle(
  step: {
    id: string;
    anecdote: unknown;
    title: unknown;
    landmark_history?: unknown;
  },
  locale: string,
): Promise<{
  anecdoteText: string | null;
  stepTitleText: string;
  landmarkHistoryText: string | null;
}> {
  let anecdoteText = step.anecdote ? t(step.anecdote, locale) : null;
  let stepTitleText = t(step.title, locale);
  let landmarkHistoryText = step.landmark_history
    ? t(step.landmark_history, locale)
    : null;

  // 2026-05-16 — bug texte EN sur audio ES sur les langues statiques.
  // Avant on bypassait pour fr/es/de/it (isStaticLocale). Maintenant on
  // traduit pour TOUT locale != en — translateStepFields cache donc
  // appel Gemini = 1 fois par stop par langue.
  if (locale !== "en") {
    const pickEN = (val: unknown): string => {
      if (!val) return "";
      if (typeof val === "object" && val !== null) {
        const r = val as Record<string, string>;
        return r.en || r.fr || Object.values(r)[0] || "";
      }
      return String(val);
    };
    const enFields: Record<string, string> = {};
    const enAnecdote = pickEN(step.anecdote);
    const enTitle = pickEN(step.title);
    const enLandmark = pickEN(step.landmark_history);
    if (enAnecdote) enFields.anecdote = enAnecdote;
    if (enTitle) enFields.title = enTitle;
    if (enLandmark) enFields.landmark_history = enLandmark;
    if (Object.keys(enFields).length > 0) {
      try {
        const translated = await translateStepFields(
          step.id,
          enFields,
          locale,
        );
        if (translated.anecdote) anecdoteText = translated.anecdote;
        if (translated.title) stepTitleText = translated.title;
        if (translated.landmark_history)
          landmarkHistoryText = translated.landmark_history;
      } catch {
        /* keep fallback */
      }
    }
  }
  return { anecdoteText, stepTitleText, landmarkHistoryText };
}

// Skip is no longer a punishment — it's a safety net so a player who
// can't crack a step still gets to learn the answer and continue the
// adventure. Five minutes is enough to keep the leaderboard meaningful
// (a player who skips every step still finishes well behind one who
// solved them) without being a screen-of-shame.
const SKIP_PENALTY_SECONDS = 300; // 5 minutes

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

      // Résoudre + traduire l'anecdote ET le titre pour le client
      // (même politique que validate-step — skip ne doit pas priver
      // le joueur du contenu pédagogique).
      const { anecdoteText, stepTitleText, landmarkHistoryText } =
        await resolveAnecdoteAndTitle(step, locale);

      return NextResponse.json({
        success: true,
        skipped: true,
        completed: true,
        answer: t(step.answer_text, locale),
        anecdote: anecdoteText,
        landmarkHistory: landmarkHistoryText,
        stepTitle: stepTitleText,
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

    // Résoudre + traduire l'anecdote + landmark_history pour le client.
    const { anecdoteText, stepTitleText, landmarkHistoryText } =
      await resolveAnecdoteAndTitle(step, locale);

    return NextResponse.json({
      success: true,
      skipped: true,
      completed: false,
      nextStep: stepOrder + 1,
      answer: t(step.answer_text, locale),
      anecdote: anecdoteText,
      landmarkHistory: landmarkHistoryText,
      stepTitle: stepTitleText,
      penaltyAdded: SKIP_PENALTY_SECONDS,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
