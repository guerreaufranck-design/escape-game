import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateStepSchema } from "@/lib/validators";
import { haversineDistance } from "@/lib/geo";
import { calculateScore } from "@/lib/scoring";
import { t, detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateStepFields } from "@/lib/translate-service";
import { MAX_VALIDATION_RATE_MS } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const body = await request.json();
    const parsed = validateStepSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { latitude, longitude, stepOrder } = parsed.data;
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

    // Rate limit: check last validation attempt
    const { data: lastCompletion } = await supabase
      .from("step_completions")
      .select("completed_at")
      .eq("session_id", sessionId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCompletion) {
      const lastTime = new Date(lastCompletion.completed_at).getTime();
      const now = Date.now();
      if (now - lastTime < MAX_VALIDATION_RATE_MS) {
        return NextResponse.json(
          { error: "Veuillez patienter quelques secondes entre chaque tentative" },
          { status: 429 }
        );
      }
    }

    // Fetch step with exact coordinates
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

    // Calculate distance
    const distance = haversineDistance(
      latitude,
      longitude,
      step.latitude,
      step.longitude
    );

    const isValid = distance <= step.validation_radius_meters;

    if (!isValid) {
      return NextResponse.json({
        success: false,
        distance: Math.round(distance),
      });
    }

    // Step is valid - calculate time for this step
    const now = new Date().toISOString();

    // Determine step start time: either last completion's completed_at or session started_at
    let stepStartedAt = session.started_at;
    if (lastCompletion) {
      stepStartedAt = lastCompletion.completed_at;
    }

    const timeSeconds = Math.round(
      (new Date(now).getTime() - new Date(stepStartedAt).getTime()) / 1000
    );

    // Count hints used on this step (based on difference)
    const { count: previousHints } = await supabase
      .from("step_completions")
      .select("hints_used", { count: "exact", head: true })
      .eq("session_id", sessionId);

    const stepHintsUsed = 0; // Hints are tracked via session total, individual step hints via hint endpoint

    // Create step completion
    const { error: completionError } = await supabase
      .from("step_completions")
      .insert({
        session_id: sessionId,
        step_id: step.id,
        step_order: stepOrder,
        started_at: stepStartedAt,
        completed_at: now,
        time_seconds: timeSeconds,
        hints_used: stepHintsUsed,
        penalty_seconds: 0,
        latitude,
        longitude,
        distance_meters: Math.round(distance),
      });

    if (completionError) {
      return NextResponse.json(
        { error: "Erreur lors de l'enregistrement" },
        { status: 500 }
      );
    }

    const isLastStep = stepOrder >= session.total_steps;

    if (isLastStep) {
      // Auto-complete the game
      const totalTimeSeconds = Math.round(
        (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
      );

      // Fetch all completions for bonus calculation
      const { data: allCompletions } = await supabase
        .from("step_completions")
        .select("step_id")
        .eq("session_id", sessionId);

      // Fetch all steps for bonus points
      const { data: allSteps } = await supabase
        .from("game_steps")
        .select("id, bonus_time_seconds")
        .eq("game_id", session.game_id);

      const bonusPoints = (allSteps || []).reduce(
        (sum, s) => sum + s.bonus_time_seconds,
        0
      );

      const finalScore = calculateScore({
        totalTimeSeconds,
        totalPenaltySeconds: session.total_penalty_seconds,
        bonusPoints,
      });

      await supabase
        .from("game_sessions")
        .update({
          status: "completed",
          current_step: stepOrder + 1,
          completed_at: now,
          total_time_seconds: totalTimeSeconds,
          final_score: finalScore,
        })
        .eq("id", sessionId);

      // Translate anecdote + title if needed
      let anecdoteText = step.anecdote ? t(step.anecdote, locale) : null;
      let stepTitleText = t(step.title, locale);

      if (!isStaticLocale(locale)) {
        const enFields: Record<string, string> = {};
        const enAnecdote = step.anecdote ? (typeof step.anecdote === "object" ? ((step.anecdote as Record<string,string>).en || (step.anecdote as Record<string,string>).fr || Object.values(step.anecdote as Record<string,string>)[0] || "") : String(step.anecdote)) : "";
        const enTitle = typeof step.title === "object" ? ((step.title as Record<string,string>).en || (step.title as Record<string,string>).fr || Object.values(step.title as Record<string,string>)[0] || "") : String(step.title);
        if (enAnecdote) enFields.anecdote = enAnecdote;
        if (enTitle) enFields.title = enTitle;
        if (Object.keys(enFields).length > 0) {
          try {
            const translated = await translateStepFields(step.id, enFields, locale);
            if (translated.anecdote) anecdoteText = translated.anecdote;
            if (translated.title) stepTitleText = translated.title;
          } catch { /* keep fallback */ }
        }
      }

      // Extract answer text
      const answerText = step.answer_text
        ? (typeof step.answer_text === "object"
            ? ((step.answer_text as Record<string,string>).en || (step.answer_text as Record<string,string>).fr || Object.values(step.answer_text as Record<string,string>)[0] || "")
            : String(step.answer_text))
        : null;

      return NextResponse.json({
        success: true,
        distance: Math.round(distance),
        completed: true,
        anecdote: anecdoteText,
        stepTitle: stepTitleText,
        answerText,
      });
    }

    // Advance to next step
    await supabase
      .from("game_sessions")
      .update({ current_step: stepOrder + 1 })
      .eq("id", sessionId);

    // Translate anecdote + title if needed
    let anecdoteText = step.anecdote ? t(step.anecdote, locale) : null;
    let stepTitleText = t(step.title, locale);

    if (!isStaticLocale(locale)) {
      const enFields: Record<string, string> = {};
      const enAnecdote = step.anecdote ? (typeof step.anecdote === "object" ? ((step.anecdote as Record<string,string>).en || (step.anecdote as Record<string,string>).fr || Object.values(step.anecdote as Record<string,string>)[0] || "") : String(step.anecdote)) : "";
      const enTitle = typeof step.title === "object" ? ((step.title as Record<string,string>).en || (step.title as Record<string,string>).fr || Object.values(step.title as Record<string,string>)[0] || "") : String(step.title);
      if (enAnecdote) enFields.anecdote = enAnecdote;
      if (enTitle) enFields.title = enTitle;
      if (Object.keys(enFields).length > 0) {
        try {
          const translated = await translateStepFields(step.id, enFields, locale);
          if (translated.anecdote) anecdoteText = translated.anecdote;
          if (translated.title) stepTitleText = translated.title;
        } catch { /* keep fallback */ }
      }
    }

    // Extract answer text
    const answerText = step.answer_text
      ? (typeof step.answer_text === "object"
          ? ((step.answer_text as Record<string,string>).en || (step.answer_text as Record<string,string>).fr || Object.values(step.answer_text as Record<string,string>)[0] || "")
          : String(step.answer_text))
      : null;

    return NextResponse.json({
      success: true,
      distance: Math.round(distance),
      nextStep: stepOrder + 1,
      completed: false,
      anecdote: anecdoteText,
      stepTitle: stepTitleText,
      answerText,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
