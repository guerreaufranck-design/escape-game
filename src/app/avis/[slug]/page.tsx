/**
 * Page PUBLIQUE d'avis d'un jeu — white-label (logo + nom du revendeur selon
 * le préfixe du slug). Affiche les témoignages 4-5★ (texte + étoiles), SANS
 * note moyenne chiffrée (conformité plateformes / FTC-UE). Les avis ≤3★ ne
 * sont jamais affichés ici. Aucune auth.
 */
import Image from "next/image";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandFromSlug, brandPageLang } from "@/lib/brand";
import { tt } from "@/lib/translations";

export const dynamic = "force-dynamic";

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n}/5`} className="text-amber-400">
      {"★".repeat(n)}
      <span className="text-slate-600">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default async function GameReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = brandFromSlug(slug);
  const lang = brandPageLang(brand);

  const supabase = createAdminClient();
  const { data: game } = await supabase
    .from("games")
    .select("id, title, city")
    .eq("slug", slug)
    .single();
  if (!game) notFound();

  const { data: reviews } = await supabase
    .from("game_reviews")
    .select("rating, review_text, player_name, language, created_at")
    .eq("game_id", game.id)
    .eq("is_public", true)
    .not("review_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const list = reviews ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* En-tête white-label */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src={brand.logo}
            alt={brand.name}
            width={160}
            height={48}
            className="mb-4 h-12 w-auto object-contain"
            unoptimized
          />
          <h1 className="text-2xl font-bold">{game.title}</h1>
          {game.city && <p className="text-sm text-slate-400">{game.city}</p>}
          <p className="mt-3 text-lg font-semibold text-amber-300">{tt("reviews.pageTitle", lang)}</p>
          {list.length > 0 && (
            <p className="text-xs text-slate-500">
              {list.length} {tt("reviews.count", lang)}
            </p>
          )}
        </div>

        {/* Liste de témoignages */}
        {list.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
            {tt("reviews.empty", lang)}
          </p>
        ) : (
          <div className="space-y-3">
            {list.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <Stars n={r.rating} />
                  <span className="text-xs text-slate-500">
                    {r.player_name || tt("reviews.anonymous", lang)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-200">{r.review_text}</p>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-600">
          {brand.name} · {tt("reviews.footer", lang)}
        </p>
      </div>
    </div>
  );
}
