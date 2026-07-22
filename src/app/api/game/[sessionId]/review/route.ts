/**
 * POST /api/game/[sessionId]/review
 *   Body : { rating: 1..5, text?: string }
 *
 * Avis de fin de partie. Règle produit :
 *   - rating >= 4 → is_public = true  → témoignage sur /avis/[slug]
 *   - rating <= 3 → is_public = false → interne + email d'alerte (service recovery)
 *
 * Un seul avis par session (ré-note = mise à jour). Auth : aucune (player UI).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandFromSlug } from "@/lib/brand";
import { sendLowReviewAlert } from "@/lib/email";

export const dynamic = "force-dynamic";

const MAX_TEXT = 2000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as { rating?: number; text?: string };
    const rating = Math.round(Number(body?.rating));
    const text = (body?.text ?? "").trim().slice(0, MAX_TEXT) || null;

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating must be 1..5" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: session } = await supabase
      .from("game_sessions")
      .select("id, player_name, game_id, games(slug, title, city)")
      .eq("id", sessionId)
      .single();
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const gameRaw = (session as { games?: unknown }).games;
    const game = (Array.isArray(gameRaw) ? gameRaw[0] : gameRaw) as
      | { slug?: string; title?: string; city?: string }
      | undefined;
    const brand = brandFromSlug(game?.slug);
    const isPublic = rating >= 4;

    const url = new URL(request.url);
    const language = url.searchParams.get("lang") || null;

    const record = {
      game_id: session.game_id,
      session_id: sessionId,
      rating,
      review_text: text,
      player_name: session.player_name ?? null,
      language,
      brand_key: brand.key,
      is_public: isPublic,
      updated_at: new Date().toISOString(),
    };

    // Un avis par session : update si existant, sinon insert.
    const { data: existing } = await supabase
      .from("game_reviews")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("game_reviews").update(record).eq("id", existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase.from("game_reviews").insert(record);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Avis bas → alerte email pour rappeler le client. Best-effort.
    if (!isPublic) {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        url.origin;
      void sendLowReviewAlert({
        gameCity: game?.city ?? "—",
        gameTitle: game?.title ?? null,
        playerName: session.player_name ?? null,
        rating,
        text,
        brandName: brand.name,
        adminUrl: `${baseUrl}/admin/reviews`,
      });
    }

    return NextResponse.json({ ok: true, isPublic, slug: game?.slug ?? null, brandName: brand.name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
