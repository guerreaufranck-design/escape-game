import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/reports/list
 * Fetch all error reports with related game/step data for the admin dashboard.
 */
export async function GET() {
  try {
    const supabase = await createClient();

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
