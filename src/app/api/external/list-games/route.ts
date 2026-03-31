import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey, corsHeaders } from "@/lib/external-auth";

/**
 * OPTIONS /api/external/list-games
 * Handle CORS preflight requests.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/external/list-games
 * Fetch all published games for oddballtrip to display.
 *
 * Headers:
 *   Authorization: Bearer {EXTERNAL_API_SECRET}
 *
 * Returns:
 *   { games: Array<{ id, title, city, difficulty, estimatedDuration, description }> }
 */
export async function GET(request: NextRequest) {
  try {
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Clé API invalide ou manquante" },
        { status: 401, headers: corsHeaders }
      );
    }

    const supabase = createAdminClient();

    const { data: games, error } = await supabase
      .from("games")
      .select("id, title, city, difficulty, estimated_duration, description")
      .eq("is_published", true)
      .order("city", { ascending: true });

    if (error) {
      console.error("[external/list-games] Erreur DB:", error);
      return NextResponse.json(
        { error: "Impossible de récupérer la liste des jeux" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Map snake_case to camelCase for the external API
    const formatted = (games || []).map((g) => ({
      id: g.id,
      title: g.title,
      city: g.city,
      difficulty: g.difficulty,
      estimatedDuration: g.estimated_duration,
      description: g.description,
    }));

    return NextResponse.json({ games: formatted }, { headers: corsHeaders });
  } catch (err) {
    console.error("[external/list-games] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500, headers: corsHeaders }
    );
  }
}
