import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/reports/list
 * Fetch all error reports with related game/step data for the admin dashboard.
 *
 * Uses the service-role admin client to bypass RLS — the player-facing
 * report-error endpoint writes to error_reports via service-role too,
 * but the cookie-context server client doesn't have a SELECT RLS policy
 * for that table, so reports were silently invisible in the admin page.
 * Service-role read is safe here: this route lives behind the /admin
 * layout which is itself gated.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data: reports, error } = await supabase
      .from("error_reports")
      .select(`
        *,
        games(title, city),
        game_steps(step_order, title, riddle_text, answer_text)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[admin/reports/list] DB error:", error);
      return NextResponse.json({ error: "Erreur DB" }, { status: 500 });
    }

    return NextResponse.json({ reports: reports || [] });
  } catch {
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
