import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest-client";

/**
 * POST /api/report-error
 * Allow players to report riddle errors directly from the game.
 *
 * (Sprint 6.1, 2026-05-21) — After INSERT, we emit
 * `player/error-report.submitted` to trigger the LLM classifier +
 * auto-rectifier pipeline. Fire-and-forget : if Inngest send fails,
 * the report is still stored — admin can still see it manually.
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

    const { data: insertedReport, error } = await supabase
      .from("error_reports")
      .insert({
        game_id: gameId || null,
        step_id: stepId || null,
        session_id: sessionId || null,
        player_name: playerName?.slice(0, 50) || null,
        step_order: stepOrder || null,
        message: message.trim(),
      })
      .select("id")
      .single();

    if (error || !insertedReport) {
      console.error("[report-error] DB error:", error);
      return NextResponse.json(
        { error: "Erreur lors de l'envoi du signalement" },
        { status: 500 }
      );
    }

    // Fire Inngest event for async classification + auto-rectification.
    // Don't await the result — the player gets the success ack immediately,
    // classification + rectification run in the background.
    try {
      await inngest.send({
        name: "player/error-report.submitted",
        data: {
          reportId: insertedReport.id,
          gameId: gameId || undefined,
          stepId: stepId || undefined,
          stepOrder: stepOrder ?? undefined,
        },
      });
    } catch (sendErr) {
      // Non-fatal : report is in DB, admin queue will pick it up even
      // without async classification. Log loudly for ops visibility.
      console.error(
        "[report-error] Inngest.send failed (report still stored):",
        sendErr instanceof Error ? sendErr.message : sendErr,
      );
    }

    return NextResponse.json({ success: true, reportId: insertedReport.id });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
