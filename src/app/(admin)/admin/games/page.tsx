import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Plus, MapPin, Star, Eye, EyeOff, ChevronRight, ImageIcon } from "lucide-react";
import { t } from "@/lib/i18n";

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
            Gerez vos escape games
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
              <Link
                key={game.id}
                href={`/admin/games/${game.id}`}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                {game.cover_image ? (
                  <div className="relative w-full h-40 bg-zinc-800">
                    <Image
                      src={game.cover_image}
                      alt={t(game.title)}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  </div>
                ) : (
                  <div className="w-full h-28 bg-zinc-800/50 flex items-center justify-center">
                    <ImageIcon className="size-8 text-zinc-700" />
                  </div>
                )}
                <div className="p-5">
                <div className="mb-3 flex items-start justify-between">
                  <h3 className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition">
                    {t(game.title)}
                  </h3>
                  <span className="shrink-0">
                    {game.is_published ? (
                      <Eye className="size-4 text-emerald-500" />
                    ) : (
                      <EyeOff className="size-4 text-zinc-600" />
                    )}
                  </span>
                </div>
                {game.description && (
                  <p className="mb-3 line-clamp-2 text-sm text-zinc-500">
                    {t(game.description)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  {game.city && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {game.city}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Star className="size-3" />
                    {game.difficulty}/5
                  </span>
                  <span>{stepCount} etape{stepCount !== 1 ? "s" : ""}</span>
                  <ChevronRight className="ml-auto size-4 text-zinc-600 group-hover:text-zinc-400 transition" />
                </div>
                </div>
              </Link>
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
