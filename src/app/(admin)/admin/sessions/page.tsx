import { createClient } from "@/lib/supabase/server";
import { SessionsTable } from "@/components/admin/SessionsTable";

export default async function AdminSessionsPage() {
  const supabase = await createClient();

  const { data: sessions } = await supabase
    .from("game_sessions")
    .select(
      "id, player_name, team_name, game_id, status, current_step, total_steps, started_at, total_time_seconds, games(title)"
    )
    .order("started_at", { ascending: false })
    .limit(100);

  const rows =
    sessions?.map((s) => ({
      id: s.id,
      player_name: s.player_name,
      team_name: s.team_name,
      game_title: (s.games as unknown as { title: string })?.title ?? "Inconnu",
      status: s.status,
      current_step: s.current_step,
      total_steps: s.total_steps,
      started_at: s.started_at,
      total_time_seconds: s.total_time_seconds,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Sessions</h1>
        <p className="text-sm text-zinc-500">
          Suivez les parties en cours et terminees
        </p>
      </div>

      <SessionsTable sessions={rows} />
    </div>
  );
}
