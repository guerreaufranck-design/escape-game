import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/game/[sessionId]/start
 * Starts the game timer. Transitions session from 'pending' to 'active'.
 * Called when the player clicks "Let's go!" after reading the briefing.
 *
 * Translations are NOT pre-fetched here — that approach burned tokens at
 * scale (every unique game × every locale × every brand new session).
 * Instead, runtime translation is hardened (timeout + retry + cache) so
 * the on-demand path stays fast and reliable.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const supabase = createAdminClient();

    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("id, status, started_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    // Already started — return current started_at (idempotent)
    if (session.started_at) {
      return NextResponse.json({
        success: true,
        startedAt: session.started_at,
      });
    }

    // Only pending sessions can be started
    if (session.status !== "pending") {
      return NextResponse.json(
        { error: "La session ne peut pas etre demarree" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("game_sessions")
      .update({
        status: "active",
        started_at: now,
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json(
        { error: "Erreur lors du demarrage" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      startedAt: now,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
