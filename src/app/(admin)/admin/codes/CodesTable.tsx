"use client";

import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CodeRow {
  id: string;
  code: string;
  game_title: string;
  is_single_use: boolean;
  max_uses: number;
  current_uses: number;
  team_name: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CodesTableProps {
  codes: CodeRow[];
}

export function CodesTable({ codes }: CodesTableProps) {
  const [filter, setFilter] = useState<"all" | "available" | "used" | "expired">("all");

  const filtered = useMemo(() => {
    const now = new Date();
    return codes.filter((c) => {
      if (filter === "all") return true;
      if (filter === "expired")
        return c.expires_at && new Date(c.expires_at) < now;
      if (filter === "used") return c.current_uses >= c.max_uses;
      if (filter === "available")
        return (
          c.current_uses < c.max_uses &&
          (!c.expires_at || new Date(c.expires_at) >= now)
        );
      return true;
    });
  }, [codes, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-zinc-400" />
        {(["all", "available", "used", "expired"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setFilter(f)}
          >
            {f === "all"
              ? "Tous"
              : f === "available"
              ? "Disponibles"
              : f === "used"
              ? "Utilises"
              : "Expires"}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-400">Code</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Jeu</th>
              <th className="px-4 py-3 font-medium text-zinc-400">Equipe</th>
              <th className="px-4 py-3 font-medium text-zinc-400">
                Utilisations
              </th>
              <th className="px-4 py-3 font-medium text-zinc-400">Cree</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {filtered.map((code) => (
              <tr
                key={code.id}
                className="transition hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3">
                  <code className="font-mono text-sm text-emerald-400">
                    {code.code}
                  </code>
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {code.game_title}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {code.team_name ?? "-"}
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {code.current_uses}/{code.max_uses}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {formatDistanceToNow(new Date(code.created_at), {
                    addSuffix: true,
                    locale: fr,
                  })}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Aucun code trouve
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
