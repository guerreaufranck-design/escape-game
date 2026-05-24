/**
 * GET /api/game/[sessionId]/messages?since_id=<lastSeenId>
 *
 * Le joueur poll cet endpoint toutes les 15 sec pour récupérer les
 * messages support reçus depuis le dernier vu. Auto-marquage NON fait
 * ici — le joueur acknowledge explicitement via POST /messages/[id]/read
 * pour qu'on sache qu'il l'a effectivement vu (vs juste téléchargé).
 *
 * Auth : aucune (player UI sans login). On valide juste que le
 * sessionId existe.
 *
 * Réponse : { messages: [{ id, from_admin, text, read_at, created_at }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const url = new URL(request.url);
    const sinceId = url.searchParams.get("since_id");

    const supabase = createAdminClient();
    const { data: session } = await supabase
      .from("game_sessions")
      .select("id")
      .eq("id", sessionId)
      .single();
    if (!session) {
      return NextResponse.json({ messages: [] });
    }

    let query = supabase
      .from("support_messages")
      .select("id, from_admin, text, read_at, created_at")
      .eq("session_id", sessionId)
      .eq("from_admin", true) // V1 : joueur reçoit uniquement les messages admin
      .order("created_at");

    if (sinceId) {
      // Get the created_at of the since_id message, fetch > that timestamp
      const { data: ref } = await supabase
        .from("support_messages")
        .select("created_at")
        .eq("id", sinceId)
        .maybeSingle();
      if (ref?.created_at) {
        query = query.gt("created_at", ref.created_at);
      }
    }

    const { data: messages, error } = await query.limit(20);
    if (error) {
      console.error(`[messages/${sessionId}] fetch failed: ${error.message}`);
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({ messages: messages ?? [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}
