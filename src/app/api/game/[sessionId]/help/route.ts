/**
 * POST /api/game/[sessionId]/help
 *   Body : { text: string }
 *
 * Canal de contact JOUEUR-INITIÉ (SOS). Contrairement à
 * /messages (qui exige qu'un admin ait écrit en premier, 403 sinon),
 * cet endpoint EST le point d'entrée du joueur : il n'a aucune contrainte.
 *
 * Effets :
 *   1. insère le message dans le MÊME fil `support_messages` (from_admin=false)
 *      → il apparaît dans la session live du back-office ; l'admin répond depuis
 *      là (from_admin=true), ce qui débloque ensuite l'overlay de réponse côté
 *      joueur (SupportMessageOverlay + /messages).
 *   2. envoie un mail d'escalade à l'admin (best-effort, ne bloque jamais).
 *
 * Auth : aucune (player UI sans login). Validation sessionId.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPlayerHelpRequest } from "@/lib/email";

export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 500;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as { text?: string };
    const text = (body?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `text too long (max ${MAX_TEXT_LENGTH})` },
        { status: 413 },
      );
    }

    const supabase = createAdminClient();

    // Session + contexte jeu pour l'email d'escalade.
    const { data: session } = await supabase
      .from("game_sessions")
      .select("id, player_name, current_step, total_steps, game_id, games(city, title)")
      .eq("id", sessionId)
      .single();
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Insert dans le fil support commun (from_admin=false).
    const { data: inserted, error } = await supabase
      .from("support_messages")
      .insert({ session_id: sessionId, from_admin: false, text })
      .select("id, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Escalade email — best-effort. On ne fait JAMAIS échouer l'envoi joueur
    // si le mail plante (le message est déjà en DB et visible au back-office).
    const game = (session as { games?: { city?: string; title?: string } | { city?: string; title?: string }[] }).games;
    const g = Array.isArray(game) ? game[0] : game;
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      new URL(request.url).origin;
    void sendPlayerHelpRequest({
      sessionId,
      gameCity: g?.city ?? "—",
      gameTitle: g?.title ?? null,
      playerName: session.player_name ?? null,
      currentStep: session.current_step ?? null,
      totalSteps: session.total_steps ?? null,
      question: text,
      adminUrl: `${baseUrl}/admin/sessions/${sessionId}`,
    });

    return NextResponse.json({ ok: true, message: inserted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
