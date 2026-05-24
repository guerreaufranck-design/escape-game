/**
 * POST /api/game/[sessionId]/messages/[msgId]/read
 *
 * Le joueur acknowledge un message (tape "Compris" sur l'overlay).
 * Set read_at=NOW().
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; msgId: string }> },
) {
  try {
    const { sessionId, msgId } = await params;
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("support_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("id", msgId)
      .eq("session_id", sessionId)
      .is("read_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
