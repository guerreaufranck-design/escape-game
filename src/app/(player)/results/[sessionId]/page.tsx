"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Trophy,
  Clock,
  Lightbulb,
  Star,
  ArrowRight,
  Share2,
  Home,
  Loader2,
  Medal,
  Camera,
} from "lucide-react";
import { formatTime, formatScore } from "@/lib/scoring";
import { useLocale } from "@/components/player/LocaleSelector";
import { ReportError } from "@/components/player/ReportError";
import { SelfieARScreen } from "@/components/player/SelfieARScreen";
import { GameEpilogue } from "@/components/player/GameEpilogue";
import { TruthReveal } from "@/components/player/TruthReveal";
import type { GameResults } from "@/types/game";

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;

  const [locale] = useLocale();
  const [results, setResults] = useState<GameResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selfieOpen, setSelfieOpen] = useState(false);

  // When the player gave up or got the final code wrong, the play page
  // redirects here with ?revealed=1 so we show the TruthReveal panel before
  // the epilogue. In all other cases, only the epilogue shows.
  const revealed = searchParams.get("revealed") === "1";

  useEffect(() => {
    async function fetchResults() {
      try {
        const res = await fetch(`/api/game/${sessionId}/complete?lang=${locale}`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json();
          // If already completed, try fetching game state
          if (data.results) {
            setResults(data.results);
            return;
          }
          throw new Error(data.error || "Erreur");
        }
        const data = await res.json();
        setResults(data);
      } catch (err) {
        // Fallback: fetch from leaderboard
        try {
          const res = await fetch(`/api/game/${sessionId}?lang=${locale}`);
          const data = await res.json();
          if (data.status === "completed") {
            setResults({
              sessionId,
              gameTitle: data.gameTitle,
              playerName: data.playerName || "Joueur",
              teamName: data.teamName || null,
              totalTimeSeconds: data.totalTimeSeconds || 0,
              totalHintsUsed: data.totalHintsUsed || 0,
              totalPenaltySeconds: data.totalPenaltySeconds || 0,
              finalScore: data.finalScore || 0,
              rank: data.rank || 0,
              totalPlayers: data.totalPlayers || 0,
              steps: data.completedSteps || [],
              epilogue: null,
            });
            return;
          }
        } catch {
          // ignore
        }
        setError(
          err instanceof Error ? err.message : "Impossible de charger les resultats"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [sessionId, locale]);

  const handleShare = async () => {
    if (!results) return;
    const text = `J'ai termine "${results.gameTitle}" avec un score de ${formatScore(results.finalScore)} points! (${formatTime(results.totalTimeSeconds)})`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Escape Game Outdoor",
          text,
        });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <Card className="bg-slate-900 border-red-500/30 max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-red-400 mb-4">{error || "Resultats indisponibles"}</p>
            <Button onClick={() => router.push("/")} variant="outline">
              Retour a l&apos;accueil
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rankColors: Record<number, string> = {
    1: "text-yellow-400",
    2: "text-slate-300",
    3: "text-amber-600",
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hero section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/10 to-transparent" />
        <div className="relative max-w-lg mx-auto px-4 pt-12 pb-8 text-center">
          {results.rank <= 3 ? (
            <Trophy
              className={`h-20 w-20 mx-auto mb-4 ${
                rankColors[results.rank] || "text-emerald-400"
              }`}
            />
          ) : (
            <Medal className="h-20 w-20 mx-auto mb-4 text-emerald-400" />
          )}

          <h1 className="text-3xl font-bold mb-2">Felicitations!</h1>
          <p className="text-slate-400 mb-1">{results.gameTitle}</p>
          <p className="text-emerald-400 font-semibold">
            {results.playerName}
            {results.teamName && (
              <span className="text-slate-500"> - {results.teamName}</span>
            )}
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 space-y-4 pb-8">
        {/* Truth reveal — shown first when the player gave up or got it wrong */}
        {revealed && results.steps && results.steps.length > 0 && (
          <TruthReveal
            steps={results.steps.map((s) => ({
              title: s.title,
              answer: s.answer,
            }))}
            locale={locale}
          />
        )}

        {/* Epilogue — the narrative reward, shown before everything else */}
        {results.epilogue && (
          <GameEpilogue
            title={results.epilogue.title}
            text={results.epilogue.text}
            overline={
              revealed
                ? undefined
                : locale === "en"
                  ? "✓ Final code unlocked"
                  : locale === "es"
                    ? "✓ Código final descifrado"
                    : locale === "de"
                      ? "✓ Code geknackt"
                      : locale === "it"
                        ? "✓ Codice finale svelato"
                        : "✓ Code final trouvé"
            }
          />
        )}

        {/* Score */}
        <Card className="bg-slate-900/80 border-emerald-500/30 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500/10 to-transparent p-6 text-center">
            <p className="text-sm text-slate-400 uppercase tracking-wider mb-1">
              Score final
            </p>
            <p className="text-5xl font-bold text-emerald-400 font-mono">
              {formatScore(results.finalScore)}
            </p>
            <p className="text-sm text-slate-500 mt-1">points</p>
          </div>
        </Card>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardContent className="py-4 text-center">
              <Clock className="h-5 w-5 text-blue-400 mx-auto mb-1" />
              <p className="text-lg font-bold font-mono">
                {formatTime(results.totalTimeSeconds)}
              </p>
              <p className="text-xs text-slate-500">Temps total</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/80 border-slate-800">
            <CardContent className="py-4 text-center">
              <Lightbulb className="h-5 w-5 text-yellow-400 mx-auto mb-1" />
              <p className="text-lg font-bold">{results.totalHintsUsed}</p>
              <p className="text-xs text-slate-500">Indices</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/80 border-slate-800">
            <CardContent className="py-4 text-center">
              <Star className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
              <p className="text-lg font-bold">
                #{results.rank}
                <span className="text-xs text-slate-500">
                  /{results.totalPlayers}
                </span>
              </p>
              <p className="text-xs text-slate-500">Classement</p>
            </CardContent>
          </Card>
        </div>

        {/* Penalty */}
        {results.totalPenaltySeconds > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-sm text-red-400 text-center">
            Penalite indices: +{formatTime(results.totalPenaltySeconds)}
          </div>
        )}

        {/* Step breakdown with corrections */}
        <Card className="bg-slate-900/80 border-slate-800">
          <CardHeader>
            <CardTitle className="text-base">Correction etape par etape</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.steps.map((step, i) => (
              <div key={i}>
                {i > 0 && <Separator className="mb-4 bg-slate-800" />}
                {/* Step header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">
                      {i + 1}
                    </div>
                    <p className="text-sm font-medium">{step.title}</p>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {formatTime(step.timeSeconds)}
                  </span>
                </div>

                {/* Answer */}
                {step.answer && (
                  <div className="ml-10 mb-2 px-3 py-2 bg-emerald-500/10 border border-emerald-800/30 rounded-lg">
                    <p className="text-xs text-emerald-500 mb-0.5">Reponse :</p>
                    <p className="text-sm font-bold text-emerald-300 font-mono">{step.answer}</p>
                  </div>
                )}

                {/* Anecdote */}
                {step.anecdote && (
                  <div className="ml-10 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <p className="text-xs text-slate-500 mb-0.5">Le saviez-vous ?</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{step.anecdote}</p>
                  </div>
                )}

                {/* Hints/penalty info */}
                {(step.hintsUsed > 0 || step.penaltySeconds > 0) && (
                  <div className="ml-10 mt-1.5 flex gap-3 text-xs">
                    {step.hintsUsed > 0 && (
                      <span className="text-yellow-500">
                        {step.hintsUsed} indice{step.hintsUsed > 1 ? "s" : ""}
                      </span>
                    )}
                    {step.penaltySeconds > 0 && (
                      <span className="text-red-400">
                        +{formatTime(step.penaltySeconds)} penalite
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Actions */}
        {/* Selfie souvenir — AR mascotte overlay */}
        <Button
          onClick={() => setSelfieOpen(true)}
          className="w-full bg-gradient-to-r from-amber-500 to-amber-600 py-6 text-base font-bold uppercase tracking-wider text-amber-950 shadow-lg hover:from-amber-400 hover:to-amber-500"
        >
          <Camera className="mr-2 h-5 w-5" />
          Photo souvenir
        </Button>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 border-slate-700"
            onClick={handleShare}
          >
            <Share2 className="h-4 w-4 mr-2" />
            Partager
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => router.push(`/leaderboard?gameId=${sessionId}`)}
          >
            <Trophy className="h-4 w-4 mr-2" />
            Classement
          </Button>
        </div>

        {/* Report error */}
        <div className="flex justify-center pt-2">
          <ReportError
            sessionId={sessionId}
            playerName={results.playerName}
            locale={locale}
          />
        </div>

        <Button
          variant="ghost"
          className="w-full text-slate-500"
          onClick={() => router.push("/")}
        >
          <Home className="h-4 w-4 mr-2" />
          Retour a l&apos;accueil
        </Button>
      </div>

      {/* Selfie AR overlay */}
      {selfieOpen && (
        <SelfieARScreen
          gameTitle={results.gameTitle}
          city={null}
          playerName={results.playerName}
          onClose={() => setSelfieOpen(false)}
        />
      )}
    </div>
  );
}
