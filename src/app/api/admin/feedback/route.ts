/**
 * Admin step-feedback API.
 *
 * GET  /api/admin/feedback?gameId=...         List feedback for one game
 * POST /api/admin/feedback                    Upsert one feedback record
 *
 * Auth via Supabase admin client (server-side only).
 * Used by the admin review page at /admin/games/[gameId]/review.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gameId = new URL(request.url).searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("step_feedback")
    .select("*")
    .eq("game_id", gameId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ feedback: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { stepId, gameId, rating, comment, city, theme, answerType, answerSource } = body;

  if (!stepId || !gameId) {
    return NextResponse.json(
      { error: "stepId and gameId are required" },
      { status: 400 },
    );
  }

  const ratingNum = Number(rating);
  if (![-1, 0, 1].includes(ratingNum)) {
    return NextResponse.json(
      { error: "rating must be -1, 0, or 1" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const reviewer = user.email || "admin";

  const { error } = await admin
    .from("step_feedback")
    .upsert(
      {
        step_id: stepId,
        game_id: gameId,
        rating: ratingNum,
        comment: comment || null,
        city: city || null,
        theme: theme || null,
        answer_type: answerType || null,
        answer_source: answerSource || null,
        reviewer,
      },
      { onConflict: "step_id,reviewer" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
