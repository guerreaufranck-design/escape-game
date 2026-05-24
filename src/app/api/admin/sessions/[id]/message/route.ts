/**
 * POST /api/admin/sessions/[id]/message
 *
 * Admin envoie un message au joueur en cours de session. Le joueur le
 * verra apparaître via polling (overlay in-app, vibration douce).
 *
 * Body : { text: string }
 *
 * Auth : admin session OR EXTERNAL_API_SECRET Bearer.
 *
 * GET /api/admin/sessions/[id]/message
 *   → Liste l'historique des messages (admin + joueur) pour cette session.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(adminRow);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 500;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
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
  const { data: session } = await supabase
    .from("game_sessions")
    .select("id, status")
    .eq("id", id)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: inserted, error } = await supabase
    .from("support_messages")
    .insert({
      session_id: id,
      from_admin: true,
      text,
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: inserted });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: messages, error } = await supabase
    .from("support_messages")
    .select("id, from_admin, text, read_at, created_at")
    .eq("session_id", id)
    .order("created_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: messages ?? [] });
}
