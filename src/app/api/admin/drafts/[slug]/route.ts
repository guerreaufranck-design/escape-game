/**
 * GET /api/admin/drafts/[slug]      → détail d'un draft (avec stops + diagnostics)
 * DELETE /api/admin/drafts/[slug]   → supprime un draft (avant fulfillment)
 *
 * Auth : admin session OR EXTERNAL_API_SECRET Bearer.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: draft, error } = await supabase
    .from("game_drafts")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json({ draft });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("game_drafts")
    .delete()
    .eq("slug", slug);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: slug });
}
