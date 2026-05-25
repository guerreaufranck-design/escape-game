/**
 * GET /api/game/[sessionId]/messages?since_id=<lastSeenId>
 *
 * Le joueur poll cet endpoint toutes les 15 sec pour récupérer les messages
 * support — BOTH directions (admin → joueur ET joueur → admin) pour qu'il
 * voie le fil complet de la conversation.
 *
 * POST /api/game/[sessionId]/messages
 *   Body : { text: string }
 *   Le joueur RÉPOND à un message admin. CONSTRAINT STRICTE :
 *     - au moins UN message from_admin doit exister dans cette session
 *     - sinon 403 (le joueur ne peut pas initier le contact, seulement répondre)
 *
 * Auth : aucune (player UI sans login). Validation sessionId.
 *
 * Réponse GET : { messages: [{ id, from_admin, text, read_at, created_at }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 500;

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

    // 2026-05-25 — retourne BOTH directions (admin + joueur). Le joueur voit
    // ses propres réponses dans le fil + les nouveaux messages admin.
    let query = supabase
      .from("support_messages")
      .select("id, from_admin, text, read_at, created_at")
      .eq("session_id", sessionId)
      .order("created_at");

    if (sinceId) {
      const { data: ref } = await supabase
        .from("support_messages")
        .select("created_at")
        .eq("id", sinceId)
        .maybeSingle();
      if (ref?.created_at) {
        query = query.gt("created_at", ref.created_at);
      }
    }

    const { data: messages, error } = await query.limit(50);
    if (error) {
      console.error(`[messages/${sessionId}] fetch failed: ${error.message}`);
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({ messages: messages ?? [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

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

    // Validate session exists
    const { data: session } = await supabase
      .from("game_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .single();
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // CRITICAL : enforce admin-must-initiate. Player can reply ONLY if at least
    // one admin message exists in this session.
    const { count: adminMessagesCount } = await supabase
      .from("support_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("from_admin", true);

    if (!adminMessagesCount || adminMessagesCount === 0) {
      return NextResponse.json(
        {
          error:
            "Player cannot initiate contact. An admin must send a message first before player can reply.",
        },
        { status: 403 },
      );
    }

    // Insert player reply
    const { data: inserted, error } = await supabase
      .from("support_messages")
      .insert({
        session_id: sessionId,
        from_admin: false,
        text,
      })
      .select("id, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: inserted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
