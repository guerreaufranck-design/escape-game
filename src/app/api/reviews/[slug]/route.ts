/**
 * GET /api/reviews/[slug]
 *
 * Avis PUBLICS (4-5★) d'un jeu, pour la page white-label /avis/[slug].
 * On NE renvoie PAS de note moyenne chiffrée (choix conformité : témoignages
 * curatés OK, moyenne gonflée non). Auth : aucune (page publique).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandFromSlug } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const supabase = createAdminClient();

    const { data: game } = await supabase
      .from("games")
      .select("id, slug, title, city")
      .eq("slug", slug)
      .single();

    const brand = brandFromSlug(slug);
    if (!game) {
      return NextResponse.json({ brand, game: null, reviews: [] }, { status: 404 });
    }

    const { data: reviews } = await supabase
      .from("game_reviews")
      .select("rating, review_text, player_name, language, created_at")
      .eq("game_id", game.id)
      .eq("is_public", true)
      .not("review_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);

    return NextResponse.json({
      brand,
      game: { title: game.title, city: game.city },
      // Nombre d'avis affichés (compteur factuel de témoignages, pas une moyenne).
      count: reviews?.length ?? 0,
      reviews: reviews ?? [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
