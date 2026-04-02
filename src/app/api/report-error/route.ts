import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/report-error
 * Allow players to report riddle errors directly from the game.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, stepId, sessionId, playerName, stepOrder, message } = body;

    if (!message || typeof message !== "string" || message.trim().length < 3) {
      return NextResponse.json(
        { error: "Le message doit contenir au moins 3 caracteres" },
        { status: 400 }
      );
    }

    if (message.trim().length > 1000) {
      return NextResponse.json(
        { error: "Le message est trop long (1000 caracteres max)" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase.from("error_reports").insert({
      game_id: gameId || null,
      step_id: stepId || null,
      session_id: sessionId || null,
      player_name: playerName?.slice(0, 50) || null,
      step_order: stepOrder || null,
      message: message.trim(),
    });

    if (error) {
      console.error("[report-error] DB error:", error);
      return NextResponse.json(
        { error: "Erreur lors de l'envoi du signalement" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
