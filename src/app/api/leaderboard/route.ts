import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, detectLocale } from "@/lib/i18n";

export async function GET(request: NextRequest) {
  try {
    const locale = detectLocale(request);
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const supabase = createAdminClient();

    let query = supabase
      .from("leaderboard")
      .select("*")
      .order("rank", { ascending: true })
      .range(offset, offset + limit - 1);

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    const { data: entries, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la récupération du classement" },
        { status: 500 }
      );
    }

    const localizedEntries = (entries || []).map((entry) => ({
      ...entry,
      game_title: t(entry.game_title, locale),
    }));

    return NextResponse.json({
      entries: localizedEntries,
      limit,
      offset,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
