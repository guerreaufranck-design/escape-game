import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    const status = searchParams.get("status");

    let query = supabase
      .from("game_sessions")
      .select("*, games(title, city)")
      .order("created_at", { ascending: false });

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data: sessions, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la récupération des sessions" },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessions: sessions || [] });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
