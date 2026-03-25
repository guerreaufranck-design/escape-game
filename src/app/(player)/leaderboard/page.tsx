"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  Medal,
  Clock,
  Lightbulb,
  ArrowLeft,
  Loader2,
  Crown,
} from "lucide-react";
import { formatTime, formatScore } from "@/lib/scoring";
import { useLocale } from "@/components/player/LocaleSelector";
import type { LeaderboardEntry } from "@/types/database";

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>}>
      <LeaderboardContent />
    </Suspense>
  );
}

function LeaderboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const gameId = searchParams.get("gameId");

  const [locale] = useLocale();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const params = new URLSearchParams();
        if (gameId) params.set("gameId", gameId);
        params.set("limit", "50");
        params.set("lang", locale);

        const res = await fetch(`/api/leaderboard?${params}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setEntries(data.entries || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
  }, [gameId, locale]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="h-5 w-5 text-yellow-400" />;
      case 2:
        return <Medal className="h-5 w-5 text-slate-300" />;
      case 3:
        return <Medal className="h-5 w-5 text-amber-600" />;
      default:
        return (
          <span className="text-sm font-bold text-slate-500 w-5 text-center">
            {rank}
          </span>
        );
    }
  };

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-yellow-500/5 border-yellow-500/20";
      case 2:
        return "bg-slate-400/5 border-slate-400/20";
      case 3:
        return "bg-amber-600/5 border-amber-600/20";
      default:
        return "bg-slate-900/50 border-slate-800";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="text-slate-400"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-emerald-400" />
              Classement
            </h1>
            {entries.length > 0 && entries[0].game_title && (
              <p className="text-sm text-slate-500">{entries[0].game_title}</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mx-auto" />
          </div>
        ) : entries.length === 0 ? (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardContent className="py-12 text-center">
              <Trophy className="h-12 w-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500">
                Aucun resultat pour le moment.
              </p>
              <p className="text-sm text-slate-600 mt-1">
                Soyez le premier a terminer!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <Card
                key={entry.session_id}
                className={`border ${getRankBg(entry.rank)}`}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">{getRankIcon(entry.rank)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate">
                          {entry.player_name}
                        </p>
                        {entry.team_name && (
                          <Badge
                            variant="outline"
                            className="text-xs text-slate-500 shrink-0"
                          >
                            {entry.team_name}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {entry.total_time_seconds
                            ? formatTime(entry.total_time_seconds)
                            : "--"}
                        </span>
                        {entry.total_hints_used > 0 && (
                          <span className="flex items-center gap-1 text-yellow-600">
                            <Lightbulb className="h-3 w-3" />
                            {entry.total_hints_used}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-emerald-400 font-mono">
                        {entry.final_score !== null
                          ? formatScore(entry.final_score)
                          : "--"}
                      </p>
                      <p className="text-xs text-slate-600">pts</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
