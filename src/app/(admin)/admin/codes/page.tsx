import { createClient } from "@/lib/supabase/server";
import { CodeGenerator } from "@/components/admin/CodeGenerator";
import { CodesTable } from "./CodesTable";

export default async function AdminCodesPage() {
  const supabase = await createClient();

  const [{ data: games }, { data: codes }] = await Promise.all([
    supabase
      .from("games")
      .select("*")
      .order("title"),
    supabase
      .from("activation_codes")
      .select("*, games(title)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const codesWithGame =
    codes?.map((c) => ({
      ...c,
      game_title: (c.games as unknown as { title: string })?.title ?? "Inconnu",
    })) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Codes d&apos;activation</h1>
        <p className="text-sm text-zinc-500">
          Generez et gerez les codes d&apos;acces aux jeux
        </p>
      </div>

      <CodeGenerator games={games ?? []} />

      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">
          Codes existants ({codesWithGame.length})
        </h2>
        <CodesTable codes={codesWithGame} />
      </div>
    </div>
  );
}
