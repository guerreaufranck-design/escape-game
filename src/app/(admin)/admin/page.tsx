import { createClient } from "@/lib/supabase/server";
import { StatsCards } from "@/components/admin/StatsCards";
import { SessionsTable } from "@/components/admin/SessionsTable";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // Fetch counts
  const [
    { count: totalGames },
    { count: totalSessions },
    { count: activeSessions },
    { count: completedSessions },
  ] = await Promise.all([
    supabase.from("games").select("*", { count: "exact", head: true }),
    supabase.from("game_sessions").select("*", { count: "exact", head: true }),
    supabase
      .from("game_sessions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("game_sessions")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed"),
  ]);

  // Average score and time for completed sessions
  const { data: completedData } = await supabase
    .from("game_sessions")
    .select("final_score, total_time_seconds")
    .eq("status", "completed");

  let averageScore = 0;
  let averageTime = 0;
  if (completedData && completedData.length > 0) {
    const scores = completedData.filter((s) => s.final_score != null);
    const times = completedData.filter((s) => s.total_time_seconds != null);
    averageScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.final_score ?? 0), 0) /
          scores.length
        : 0;
    averageTime =
      times.length > 0
        ? times.reduce((sum, s) => sum + (s.total_time_seconds ?? 0), 0) /
          times.length
        : 0;
  }

  const stats = {
    totalGames: totalGames ?? 0,
    totalSessions: totalSessions ?? 0,
    activeSessions: activeSessions ?? 0,
    completedSessions: completedSessions ?? 0,
    averageScore,
    averageTime,
  };

  // Recent sessions with game title
  const { data: recentSessions } = await supabase
    .from("game_sessions")
    .select("id, player_name, team_name, game_id, status, current_step, total_steps, started_at, total_time_seconds, games(title)")
    .order("started_at", { ascending: false })
    .limit(20);

  function extractText(val: unknown): string {
    if (!val) return "";
    if (typeof val === "number") return String(val);
    if (typeof val === "string") {
      // Handle double-encoded JSON strings like '{"fr": "...", "en": "..."}'
      if (val.startsWith("{") && val.includes('"fr"')) {
        try {
          const parsed = JSON.parse(val) as Record<string, string>;
          return parsed.fr || parsed.en || parsed.es || Object.values(parsed)[0] || val;
        } catch {
          return val;
        }
      }
      return val;
    }
    if (typeof val === "object" && val !== null) {
      const obj = val as Record<string, string>;
      return obj.fr || obj.en || obj.es || Object.values(obj)[0] || "";
    }
    return String(val);
  }

  const sessions =
    recentSessions?.map((s) => ({
      id: s.id,
      player_name: extractText(s.player_name) || "Anonyme",
      team_name: s.team_name ? extractText(s.team_name) : null,
      game_title: extractText((s.games as unknown as { title: unknown })?.title) || "Inconnu",
      status: s.status as "active" | "completed" | "abandoned",
      current_step: s.current_step,
      total_steps: s.total_steps,
      started_at: s.started_at,
      total_time_seconds: s.total_time_seconds,
    })) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500">Vue d&apos;ensemble de vos escape games</p>
      </div>

      <StatsCards stats={stats} />

      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">
          Sessions recentes
        </h2>
        <SessionsTable sessions={sessions} />
      </div>
    </div>
  );
}
