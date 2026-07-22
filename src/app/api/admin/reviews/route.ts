/**
 * PATCH /api/admin/reviews
 *   Body : { id: string, status?: 'new'|'handled'|'archived', is_public?: boolean }
 *
 * Gestion interne des avis : marquer un avis bas comme traité/archivé, ou
 * dépublier manuellement un avis public. Auth : admin session OU Bearer secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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

export async function PATCH(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      id?: string;
      status?: string;
      is_public?: boolean;
      admin_notes?: string;
    };
    if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status && ["new", "handled", "archived"].includes(body.status)) update.status = body.status;
    if (typeof body.is_public === "boolean") update.is_public = body.is_public;
    if (typeof body.admin_notes === "string") update.admin_notes = body.admin_notes;

    const admin = createAdminClient();
    const { error } = await admin.from("game_reviews").update(update).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
