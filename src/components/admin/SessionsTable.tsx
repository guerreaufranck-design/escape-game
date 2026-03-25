"use client";

import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionRow {
  id: string;
  player_name: string;
  team_name: string | null;
  game_title: string;
  status: "active" | "completed" | "abandoned";
  current_step: number;
  total_steps: number;
  started_at: string;
  total_time_seconds: number | null;
}

interface SessionsTableProps {
  sessions: SessionRow[];
}

const statusConfig = {
  active: { label: "En cours", className: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50" },
  completed: { label: "Termine", className: "bg-blue-900/40 text-blue-400 border-blue-800/50" },
  abandoned: { label: "Abandonne", className: "bg-red-900/40 text-red-400 border-red-800/50" },
} as const;

function formatTime(seconds: number | null): string {
  if (seconds == null) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SessionsTable({ sessions }: SessionsTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let result = [...sessions];
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }
    result.sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
    return result;
  }, [sessions, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-zinc-400" />
        <span className="text-sm text-zinc-400">Filtrer :</span>
        {["all", "active", "completed", "abandoned"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setStatusFilter(s)}
          >
            {s === "all"
              ? "Tous"
              : statusConfig[s as keyof typeof statusConfig].label}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-400">Joueur</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Jeu</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Statut</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Etape</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Debut</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Temps</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {filtered.map((session) => (
              <tr
                key={session.id}
                className="transition hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3">
                  <div>
                    <span className="font-medium text-zinc-200">
                      {session.player_name}
                    </span>
                    {session.team_name && (
                      <span className="ml-1 text-xs text-zinc-500">
                        ({session.team_name})
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {session.game_title}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                      statusConfig[session.status].className
                    }`}
                  >
                    {statusConfig[session.status].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {session.current_step}/{session.total_steps}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {formatDistanceToNow(new Date(session.started_at), {
                    addSuffix: true,
                    locale: fr,
                  })}
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {formatTime(session.total_time_seconds)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-zinc-500"
                >
                  Aucune session trouvee
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
