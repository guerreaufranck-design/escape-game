/**
 * Admin endpoint: list the steps of a game (used by the review UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { gameId } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("game_steps")
    .select("id, step_order, title, riddle_text, answer_text, answer_source, hints, anecdote")
    .eq("game_id", gameId)
    .order("step_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ steps: data || [] });
}
