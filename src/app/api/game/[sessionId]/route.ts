import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { obfuscateCoordinates } from "@/lib/geo";
import { t, detectLocale } from "@/lib/i18n";
import type { GameState, CompletedStepInfo, Hint } from "@/types/game";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();

    // Fetch session with game data
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(*)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    const game = session.games as unknown as {
      id: string;
      title: string;
      description: string | null;
      intro_videos: Record<string, string> | null;
      estimated_duration_min: number | null;
      max_hints_per_step: number;
    };

    // Fetch current step data if game is active
    let currentRiddle: GameState["currentRiddle"] = null;
    let approximateTarget: GameState["approximateTarget"] = null;
    let validationRadius = 30;
    let hintsAvailable = 0;

    if (session.status === "active" && session.current_step <= session.total_steps) {
      const { data: step } = await supabase
        .from("game_steps")
        .select("*")
        .eq("game_id", session.game_id)
        .eq("step_order", session.current_step)
        .single();

      if (step) {
        currentRiddle = {
          title: t(step.title, locale),
          text: t(step.riddle_text, locale),
          image: step.riddle_image,
          hasPhotoChallenge: step.has_photo_challenge,
        };

        approximateTarget = obfuscateCoordinates(step.latitude, step.longitude);
        validationRadius = step.validation_radius_meters;

        const hints = (step.hints as unknown as Hint[]) || [];
        hintsAvailable = hints.length; // All hints available (with progressive penalty)
      }
    }

    // Fetch completed steps
    const { data: completions } = await supabase
      .from("step_completions")
      .select("step_order, time_seconds, hints_used")
      .eq("session_id", sessionId)
      .order("step_order", { ascending: true });

    // Get step titles for completed steps
    const completedSteps: CompletedStepInfo[] = [];
    if (completions && completions.length > 0) {
      const { data: steps } = await supabase
        .from("game_steps")
        .select("step_order, title")
        .eq("game_id", session.game_id)
        .in(
          "step_order",
          completions.map((c) => c.step_order)
        );

      const stepTitleMap = new Map(
        (steps || []).map((s) => [s.step_order, s.title])
      );

      for (const completion of completions) {
        completedSteps.push({
          stepOrder: completion.step_order,
          title: t(stepTitleMap.get(completion.step_order), locale) || `Etape ${completion.step_order}`,
          timeSeconds: completion.time_seconds ?? 0,
          hintsUsed: completion.hints_used,
        });
      }
    }

    // Count hints used on current step
    const hintsUsedOnCurrent = completions
      ? 0
      : 0;

    // Get intro video URL for the current locale (fallback: fr → en → first)
    let introVideoUrl: string | null = null;
    if (game.intro_videos) {
      introVideoUrl = game.intro_videos[locale] || game.intro_videos.fr || game.intro_videos.en || Object.values(game.intro_videos)[0] || null;
    }

    const gameState: GameState = {
      sessionId: session.id,
      gameTitle: t(game.title, locale),
      gameDescription: t(game.description, locale),
      introVideoUrl,
      estimatedDuration: game.estimated_duration_min ? `${Math.floor(game.estimated_duration_min / 60)}h${String(game.estimated_duration_min % 60).padStart(2, "0")}` : null,
      currentStep: session.current_step,
      totalSteps: session.total_steps,
      status: session.status,
      startedAt: session.started_at,
      currentRiddle,
      approximateTarget,
      validationRadius,
      hintsAvailable,
      hintsUsed: session.total_hints_used,
      completedSteps,
    };

    return NextResponse.json(gameState);
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
