/**
 * GET /api/admin/sessions/[id]/ar-events
 *
 * Retourne la timeline complète des événements AR d'une session.
 *
 * Réponse :
 *   {
 *     events: [
 *       { event_type, step_order, metadata, captured_at, received_at },
 *       ...
 *     ],
 *     summary: {
 *       opens_per_step: { 1: 2, 2: 5, ... },         // combien de fois l'AR ouvert
 *       lock_ons_per_step: { 1: 1, 2: 0, ... },      // combien de lock_on réussis
 *       facade_reveals_per_step: { 1: 1, 2: 0, ... },// magic word affiché ?
 *       auto_validates: number,
 *       manual_validates: number,
 *       camera_denied: number,
 *       compass_denied: number
 *     }
 *   }
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
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: events, error } = await supabase
    .from("ar_events")
    .select("event_type, step_order, metadata, captured_at, received_at")
    .eq("session_id", id)
    .order("captured_at");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  // Build summary
  const summary = {
    opens_per_step: {} as Record<number, number>,
    lock_ons_per_step: {} as Record<number, number>,
    facade_reveals_per_step: {} as Record<number, number>,
    auto_validates: 0,
    manual_validates: 0,
    camera_denied: 0,
    compass_denied: 0,
    total_events: events?.length ?? 0,
  };
  for (const e of events ?? []) {
    const step = e.step_order ?? 0;
    if (e.event_type === "ar_open") {
      summary.opens_per_step[step] = (summary.opens_per_step[step] ?? 0) + 1;
    } else if (e.event_type === "ar_lock_on") {
      summary.lock_ons_per_step[step] = (summary.lock_ons_per_step[step] ?? 0) + 1;
    } else if (e.event_type === "ar_facade_revealed") {
      summary.facade_reveals_per_step[step] = (summary.facade_reveals_per_step[step] ?? 0) + 1;
    } else if (e.event_type === "ar_auto_validated") {
      summary.auto_validates++;
    } else if (e.event_type === "ar_manual_validated") {
      summary.manual_validates++;
    } else if (e.event_type === "ar_camera_denied") {
      summary.camera_denied++;
    } else if (e.event_type === "ar_compass_denied") {
      summary.compass_denied++;
    }
  }

  return NextResponse.json({ events: events ?? [], summary });
}
