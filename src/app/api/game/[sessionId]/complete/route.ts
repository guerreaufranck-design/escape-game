import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore } from "@/lib/scoring";
import { t, detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateStepFields, translateGameField } from "@/lib/translate-service";
import type { GameResults } from "@/types/game";

function getEnglishBase(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, string>;
    return obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();
    const needsTranslation = !isStaticLocale(locale);

    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(title)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    if (session.current_step <= session.total_steps) {
      return NextResponse.json({ error: "Game not yet completed" }, { status: 400 });
    }

    const game = session.games as unknown as { title: string };
    const now = new Date().toISOString();

    const { data: completions } = await supabase
      .from("step_completions")
      .select("*, game_steps(id, title, bonus_time_seconds, answer_text, anecdote)")
      .eq("session_id", sessionId)
      .order("step_order", { ascending: true });

    const totalTimeSeconds = Math.round(
      (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
    );

    const totalPenalty = session.total_penalty_seconds;

    const bonusPoints = (completions || []).reduce((sum, c) => {
      const stepData = c.game_steps as unknown as { bonus_time_seconds: number } | null;
      return sum + (stepData?.bonus_time_seconds || 0);
    }, 0);

    const finalScore = calculateScore({
      totalTimeSeconds,
      totalPenaltySeconds: totalPenalty,
      bonusPoints,
    });

    if (session.status !== "completed") {
      await supabase
        .from("game_sessions")
        .update({
          status: "completed",
          completed_at: now,
          total_time_seconds: totalTimeSeconds,
          final_score: finalScore,
        })
        .eq("id", sessionId);
    }

    const { data: leaderboardEntry } = await supabase
      .from("leaderboard")
      .select("rank")
      .eq("session_id", sessionId)
      .single();

    const { count: totalPlayers } = await supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("game_id", session.game_id);

    // Build step details with translations
    const steps = [];
    for (const c of completions || []) {
      const stepData = c.game_steps as unknown as {
        id: string;
        title: string;
        answer_text: unknown;
        anecdote: unknown;
      } | null;

      let title = t(stepData?.title, locale) || `Step ${c.step_order}`;
      let answer = stepData?.answer_text ? t(stepData.answer_text, locale) : null;
      let anecdote = stepData?.anecdote ? t(stepData.anecdote, locale) : null;

      if (needsTranslation && stepData?.id) {
        const enFields: Record<string, string> = {};
        const enTitle = getEnglishBase(stepData.title);
        const enAnswer = getEnglishBase(stepData.answer_text);
        const enAnecdote = getEnglishBase(stepData.anecdote);
        if (enTitle) enFields.title = enTitle;
        if (enAnswer) enFields.answer_text = enAnswer;
        if (enAnecdote) enFields.anecdote = enAnecdote;

        if (Object.keys(enFields).length > 0) {
          try {
            const translated = await translateStepFields(stepData.id, enFields, locale);
            if (translated.title) title = translated.title;
            if (translated.answer_text) answer = translated.answer_text;
            if (translated.anecdote) anecdote = translated.anecdote;
          } catch { /* keep fallback */ }
        }
      }

      steps.push({
        title,
        timeSeconds: c.time_seconds ?? 0,
        hintsUsed: c.hints_used,
        penaltySeconds: c.penalty_seconds,
        answer,
        anecdote,
      });
    }

    // Translate game title
    let gameTitle = t(game.title, locale);
    if (needsTranslation) {
      const enTitle = getEnglishBase(game.title);
      if (enTitle) {
        try {
          gameTitle = await translateGameField(session.game_id, "games", "title", enTitle, locale);
        } catch { /* keep fallback */ }
      }
    }

    const results: GameResults = {
      sessionId: session.id,
      gameTitle,
      playerName: session.player_name,
      teamName: session.team_name,
      totalTimeSeconds,
      totalHintsUsed: session.total_hints_used,
      totalPenaltySeconds: totalPenalty,
      finalScore,
      rank: leaderboardEntry?.rank ?? 0,
      totalPlayers: totalPlayers ?? 0,
      steps,
    };

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
