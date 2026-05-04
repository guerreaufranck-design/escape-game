import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { GameCard } from "./GameCard";

export const dynamic = "force-dynamic";

export default async function AdminGamesPage() {
  const supabase = await createClient();

  const { data: games } = await supabase
    .from("games")
    .select("*, game_steps(id)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Jeux</h1>
          <p className="text-sm text-zinc-500">
            Gerez vos escape games. Chaque carte affiche un indicateur de
            santé et un bouton pour forcer une mise à jour (régénération
            des indices manquants + remise à jour des traductions et
            audios des langues déjà packagées).
          </p>
        </div>
        <Link href="/admin/games/new">
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="size-4" />
            Nouveau jeu
          </Button>
        </Link>
      </div>

      {games && games.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => {
            const stepCount = Array.isArray(game.game_steps)
              ? game.game_steps.length
              : 0;
            return (
              <GameCard
                key={game.id}
                gameId={game.id}
                title={t(game.title)}
                description={game.description ? t(game.description) : null}
                city={game.city ?? null}
                difficulty={game.difficulty}
                isPublished={game.is_published}
                coverImage={game.cover_image ?? null}
                stepCount={stepCount}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="text-sm text-zinc-500">
            Aucun jeu. Creez votre premier escape game.
          </p>
        </div>
      )}
    </div>
  );
}
