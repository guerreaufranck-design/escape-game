"use client";

import { Trophy, Clock, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTime, formatScore } from "@/lib/scoring";
import type { LeaderboardEntry } from "@/types/database";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  currentSessionId?: string;
}

function getRankDisplay(rank: number) {
  if (rank === 1) {
    return {
      icon: <Trophy className="h-4 w-4 text-yellow-400" />,
      className: "bg-yellow-950/30 border-yellow-800/50 text-yellow-400",
    };
  }
  if (rank === 2) {
    return {
      icon: <Trophy className="h-4 w-4 text-gray-300" />,
      className: "bg-gray-800/30 border-gray-600/50 text-gray-300",
    };
  }
  if (rank === 3) {
    return {
      icon: <Trophy className="h-4 w-4 text-amber-500" />,
      className: "bg-amber-950/30 border-amber-800/50 text-amber-500",
    };
  }
  return {
    icon: null,
    className: "bg-gray-900/30 border-gray-800/50 text-gray-400",
  };
}

export function LeaderboardTable({
  entries,
  currentSessionId,
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <Card className="border-emerald-900/50 bg-gray-950/80">
        <CardContent className="py-8 text-center text-gray-500">
          Aucun resultat pour le moment.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-900/50 bg-gray-950/80 shadow-xl backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-emerald-50">
          <Trophy className="h-5 w-5 text-emerald-400" />
          Classement
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {/* Desktop table */}
        <div className="hidden sm:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Joueur</th>
                <th className="px-4 py-2 text-left font-medium">Equipe</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 text-right font-medium">Temps</th>
                <th className="px-4 py-2 text-right font-medium">Indices</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isCurrentPlayer =
                  currentSessionId && entry.session_id === currentSessionId;
                const rankDisplay = getRankDisplay(entry.rank);

                return (
                  <tr
                    key={entry.session_id}
                    className={`border-b border-gray-800/50 transition-colors ${
                      isCurrentPlayer
                        ? "bg-emerald-950/20"
                        : "hover:bg-gray-900/30"
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={`${rankDisplay.className} text-xs`}
                      >
                        {rankDisplay.icon}
                        <span className="ml-1">{entry.rank}</span>
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-sm font-medium ${isCurrentPlayer ? "text-emerald-300" : "text-gray-200"}`}
                      >
                        {entry.player_name}
                        {isCurrentPlayer && (
                          <span className="ml-1.5 text-xs text-emerald-500">
                            (vous)
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500">
                      {entry.team_name || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-mono text-sm font-bold text-emerald-300">
                        {entry.final_score != null
                          ? formatScore(entry.final_score)
                          : "-"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-mono text-sm text-gray-400">
                        {entry.total_time_seconds != null
                          ? formatTime(entry.total_time_seconds)
                          : "-"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm text-gray-400">
                      {entry.total_hints_used}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="space-y-1 px-3 pb-3 sm:hidden">
          {entries.map((entry) => {
            const isCurrentPlayer =
              currentSessionId && entry.session_id === currentSessionId;
            const rankDisplay = getRankDisplay(entry.rank);

            return (
              <div
                key={entry.session_id}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  isCurrentPlayer
                    ? "border-emerald-800/50 bg-emerald-950/20"
                    : "border-gray-800/50 bg-gray-900/20"
                }`}
              >
                <Badge
                  variant="outline"
                  className={`${rankDisplay.className} flex-shrink-0 text-xs`}
                >
                  {rankDisplay.icon}
                  <span className="ml-1">{entry.rank}</span>
                </Badge>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span
                      className={`truncate text-sm font-medium ${isCurrentPlayer ? "text-emerald-300" : "text-gray-200"}`}
                    >
                      {entry.player_name}
                    </span>
                    {isCurrentPlayer && (
                      <span className="flex-shrink-0 text-xs text-emerald-500">
                        (vous)
                      </span>
                    )}
                  </div>
                  {entry.team_name && (
                    <span className="text-xs text-gray-600">
                      {entry.team_name}
                    </span>
                  )}
                </div>

                <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                  <span className="font-mono text-sm font-bold text-emerald-300">
                    {entry.final_score != null
                      ? formatScore(entry.final_score)
                      : "-"}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {entry.total_time_seconds != null
                        ? formatTime(entry.total_time_seconds)
                        : "-"}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Lightbulb className="h-2.5 w-2.5" />
                      {entry.total_hints_used}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
