import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore } from "@/lib/scoring";
import { t, detectLocale } from "@/lib/i18n";
import type { GameResults } from "@/types/game";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();

    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(title)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    // Verify all steps are completed
    if (session.current_step <= session.total_steps) {
      return NextResponse.json(
        { error: "Toutes les étapes ne sont pas encore complétées" },
        { status: 400 }
      );
    }

    const game = session.games as unknown as { title: string };
    const now = new Date().toISOString();

    // Fetch all step completions
    const { data: completions } = await supabase
      .from("step_completions")
      .select("*, game_steps(title, bonus_time_seconds, answer_text, anecdote)")
      .eq("session_id", sessionId)
      .order("step_order", { ascending: true });

    const totalTimeSeconds = Math.round(
      (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
    );

    const totalPenalty = session.total_penalty_seconds;

    // Sum up bonus points from all steps
    const bonusPoints = (completions || []).reduce((sum, c) => {
      const stepData = c.game_steps as unknown as {
        bonus_time_seconds: number;
      } | null;
      return sum + (stepData?.bonus_time_seconds || 0);
    }, 0);

    const finalScore = calculateScore({
      totalTimeSeconds,
      totalPenaltySeconds: totalPenalty,
      bonusPoints,
    });

    // Update session to completed if not already
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

    // Fetch rank from leaderboard view
    const { data: leaderboardEntry } = await supabase
      .from("leaderboard")
      .select("rank")
      .eq("session_id", sessionId)
      .single();

    // Count total players for this game
    const { count: totalPlayers } = await supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("game_id", session.game_id);

    // Build step details with answers and anecdotes
    const steps = (completions || []).map((c) => {
      const stepData = c.game_steps as unknown as {
        title: string;
        answer_text: unknown;
        anecdote: unknown;
      } | null;
      return {
        title: t(stepData?.title, locale) || `Étape ${c.step_order}`,
        timeSeconds: c.time_seconds ?? 0,
        hintsUsed: c.hints_used,
        penaltySeconds: c.penalty_seconds,
        answer: stepData?.answer_text ? t(stepData.answer_text, locale) : null,
        anecdote: stepData?.anecdote ? t(stepData.anecdote, locale) : null,
      };
    });

    const results: GameResults = {
      sessionId: session.id,
      gameTitle: t(game.title, locale),
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
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
