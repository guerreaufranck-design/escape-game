import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/admin/reports
 * Update the status and/or admin_notes of an error report.
 * Body: { reportId: string, status?: string, adminNotes?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { reportId, status, adminNotes } = body;

    if (!reportId) {
      return NextResponse.json({ error: "reportId requis" }, { status: 400 });
    }

    const validStatuses = ["new", "reviewed", "fixed", "dismissed"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (status) update.status = status;
    if (adminNotes !== undefined) update.admin_notes = adminNotes;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Rien a mettre a jour" }, { status: 400 });
    }

    const { error } = await supabase
      .from("error_reports")
      .update(update)
      .eq("id", reportId);

    if (error) {
      console.error("[admin/reports] Update error:", error);
      return NextResponse.json({ error: "Erreur mise a jour" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
