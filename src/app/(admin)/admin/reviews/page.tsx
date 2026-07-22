/**
 * Back-office — gestion des avis joueurs.
 *   - « À traiter » : avis ≤3★ non encore traités (service recovery).
 *   - « Publics »   : avis 4-5★ affichés sur /avis/[slug] (dépublication possible).
 * Lecture via service-role (RLS activée sans policy publique) ; page protégée
 * par le middleware /admin.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewsAdmin, type AdminReview } from "@/components/admin/ReviewsAdmin";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("game_reviews")
    .select("id, rating, review_text, player_name, language, brand_key, is_public, status, created_at, games(title, city, slug)")
    .order("created_at", { ascending: false })
    .limit(300);

  const rows: AdminReview[] = (data ?? []).map((r) => {
    const g = (Array.isArray(r.games) ? r.games[0] : r.games) as
      | { title?: string; city?: string; slug?: string }
      | undefined;
    return {
      id: r.id,
      rating: r.rating,
      review_text: r.review_text,
      player_name: r.player_name,
      language: r.language,
      brand_key: r.brand_key,
      is_public: r.is_public,
      status: r.status,
      created_at: r.created_at,
      game_title: g?.title ?? "Inconnu",
      game_city: g?.city ?? null,
      game_slug: g?.slug ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Avis joueurs</h1>
        <p className="text-sm text-slate-500">
          Les 4-5★ apparaissent en public sur la page du jeu. Les ≤3★ restent privés — à rattraper.
        </p>
      </div>
      <ReviewsAdmin initial={rows} />
    </div>
  );
}
