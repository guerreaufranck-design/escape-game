import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Trophy, Clock, Lightbulb, Share2, Star, Medal } from "lucide-react";
import { formatTime, formatScore } from "@/lib/scoring";
import type { GameResults } from "@/types/game";

interface ResultsCardProps {
  results: GameResults;
}

function getRankBadge(rank: number) {
  if (rank === 1) {
    return { label: "1er", className: "border-yellow-500 bg-yellow-950/50 text-yellow-400" };
  }
  if (rank === 2) {
    return { label: "2eme", className: "border-gray-400 bg-gray-900/50 text-gray-300" };
  }
  if (rank === 3) {
    return { label: "3eme", className: "border-amber-700 bg-amber-950/50 text-amber-500" };
  }
  return { label: `${rank}eme`, className: "border-gray-700 bg-gray-900/50 text-gray-400" };
}

export function ResultsCard({ results }: ResultsCardProps) {
  const rankBadge = getRankBadge(results.rank);

  function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({
        title: `${results.gameTitle} - Resultats`,
        text: `J'ai termine "${results.gameTitle}" avec un score de ${formatScore(results.finalScore)} ! Rang ${results.rank}/${results.totalPlayers}.`,
      });
    }
  }

  return (
    <Card className="border-emerald-900/50 bg-gray-950/80 shadow-2xl shadow-emerald-900/20 backdrop-blur-sm">
      <CardHeader className="space-y-4 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500/30 bg-emerald-950/50">
          {results.rank <= 3 ? (
            <Trophy
              className={`h-10 w-10 ${results.rank === 1 ? "text-yellow-400" : results.rank === 2 ? "text-gray-300" : "text-amber-500"}`}
            />
          ) : (
            <Medal className="h-10 w-10 text-emerald-400" />
          )}
        </div>

        <div className="space-y-1">
          <CardTitle className="text-2xl font-bold text-emerald-50">
            Felicitations {results.playerName} !
          </CardTitle>
          <p className="text-sm text-gray-400">{results.gameTitle}</p>
          {results.teamName && (
            <p className="text-sm text-emerald-600">
              Equipe : {results.teamName}
            </p>
          )}
        </div>

        {/* Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1">
            <Star className="h-5 w-5 text-emerald-400" />
            <span className="text-4xl font-black tabular-nums text-emerald-300">
              {formatScore(results.finalScore)}
            </span>
            <span className="self-end pb-1 text-sm text-gray-500">pts</span>
          </div>
          <Badge variant="outline" className={rankBadge.className}>
            {rankBadge.label} / {results.totalPlayers} joueur
            {results.totalPlayers > 1 ? "s" : ""}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <Separator className="bg-emerald-900/30" />

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <Clock className="mb-1 h-4 w-4 text-emerald-500" />
            <span className="font-mono text-sm font-bold text-emerald-100">
              {formatTime(results.totalTimeSeconds)}
            </span>
            <span className="text-[10px] text-gray-500">Temps total</span>
          </div>

          <div className="flex flex-col items-center rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <Lightbulb className="mb-1 h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-bold text-emerald-100">
              {results.totalHintsUsed}
            </span>
            <span className="text-[10px] text-gray-500">Indices</span>
          </div>

          <div className="flex flex-col items-center rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <Clock className="mb-1 h-4 w-4 text-red-400" />
            <span className="font-mono text-sm font-bold text-red-300">
              +{formatTime(results.totalPenaltySeconds)}
            </span>
            <span className="text-[10px] text-gray-500">Penalite</span>
          </div>
        </div>

        <Separator className="bg-emerald-900/30" />

        {/* Step breakdown */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400">
            Detail par etape
          </h3>
          <div className="space-y-1.5">
            {results.steps.map((step, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-800/50 bg-gray-900/30 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-900/50 text-[10px] font-bold text-emerald-400">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-300 truncate max-w-[150px]">
                    {step.title}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-gray-400">
                    {formatTime(step.timeSeconds)}
                  </span>
                  {step.hintsUsed > 0 && (
                    <span className="text-amber-500">
                      {step.hintsUsed} indice{step.hintsUsed > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Share button */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <>
            <Separator className="bg-emerald-900/30" />
            <Button
              onClick={handleShare}
              variant="outline"
              className="w-full border-emerald-800/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Partager mes resultats
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
