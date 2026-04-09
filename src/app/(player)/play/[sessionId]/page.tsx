"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useTimer } from "@/hooks/useTimer";
import { useDistance } from "@/hooks/useDistance";
import { useGameStore } from "@/stores/game-store";
import { useLocale } from "@/components/player/LocaleSelector";
import { formatTime } from "@/lib/scoring";
import { formatDistance } from "@/lib/geo";
import { tt } from "@/lib/translations";
import type { GameState, Hint } from "@/types/game";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MapPin,
  Clock,
  Lightbulb,
  CheckCircle2,
  Navigation,
  Camera,
  Loader2,
  Trophy,
  Flame,
  Snowflake,
  Thermometer,
  SkipForward,
  BookOpen,
  Send,
  ChevronLeft,
} from "lucide-react";
import { NavigationGuide } from "@/components/player/NavigationGuide";
import { Tutorial } from "@/components/player/Tutorial";
import { NarrationButton } from "@/components/player/NarrationButton";
import { ReportError } from "@/components/player/ReportError";
import { useNarration } from "@/hooks/useNarration";
import dynamic from "next/dynamic";

const GameMap = dynamic(
  () => import("@/components/player/GameMap").then((mod) => mod.GameMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] bg-slate-800 rounded-xl animate-pulse flex items-center justify-center">
        <MapPin className="h-8 w-8 text-slate-600" />
      </div>
    ),
  }
);

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const { gameState, setGameState, setLoading, isLoading, error, setError } =
    useGameStore();
  const geo = useGeolocation(true);
  const timer = useTimer(gameState?.startedAt ?? null);
  const { distance } = useDistance({
    playerLat: geo.latitude,
    playerLon: geo.longitude,
    targetLat: gameState?.approximateTarget?.latitude ?? null,
    targetLon: gameState?.approximateTarget?.longitude ?? null,
  });

  const [locale] = useLocale();
  const [validating, setValidating] = useState(false);
  const [hints, setHints] = useState<Hint[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [stepSuccess, setStepSuccess] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [skipAnswer, setSkipAnswer] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [videoWatched, setVideoWatched] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(false);
  const [anecdote, setAnecdote] = useState<{ title: string; text: string } | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [notebook, setNotebook] = useState<Record<number, string>>({});
  const [notebookInput, setNotebookInput] = useState("");
  const [showNotebook, setShowNotebook] = useState(false);
  const [showFinalCode, setShowFinalCode] = useState(false);
  const [finalCodeInput, setFinalCodeInput] = useState("");
  const [codeResult, setCodeResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [validatingCode, setValidatingCode] = useState(false);
  const [photoValidating, setPhotoValidating] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<{
    message: string;
    recognizedObject?: string;
    anecdote?: string;
    proximityHint?: string;
  } | null>(null);
  // Per-session cap: after this many rich recognitions we fall back to
  // the plain feedback to preserve the surprise effect and avoid turning
  // the game into an AI tour guide.
  const MAX_PHOTO_RECOGNITIONS = 2;
  const [photoRecognitionCount, setPhotoRecognitionCount] = useState(0);
  const [gpsTooFar, setGpsTooFar] = useState(false);
  const [view, setView] = useState<"riddle" | "navigation">("riddle");
  const [startingGame, setStartingGame] = useState(false);
  const [gpsTooFarDistance, setGpsTooFarDistance] = useState<number>(0);
  const narration = useNarration(locale);
  const [narrationText, setNarrationText] = useState("");
  const [lastAutoNarrated, setLastAutoNarrated] = useState("");
  const [navigationHint, setNavigationHint] = useState<string | null>(null);
  const handleSpeak = (text: string) => {
    if (narration.speaking && narrationText === text) {
      narration.stop();
      setNarrationText("");
    } else {
      setNarrationText(text);
      narration.speak(text);
    }
  };
  const autoSpeak = useCallback((text: string) => {
    if (!text || !narration.supported) return;
    // Avoid re-reading the same text
    if (text === lastAutoNarrated) return;
    setLastAutoNarrated(text);
    setNarrationText(text);
    narration.speak(text);
  }, [narration, lastAutoNarrated]);

  // Lazy-load walking directions for current step
  useEffect(() => {
    if (!gameState || gameState.currentStep <= 1 || gameState.status !== "active") {
      setNavigationHint(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/game/${sessionId}/directions?lang=${locale}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.directions) setNavigationHint(data.directions);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameState?.currentStep, sessionId, locale, gameState?.status]);

  // Auto-narrate riddle when step changes
  useEffect(() => {
    if (gameState?.currentRiddle?.text && !showIntro && !stepSuccess && !skipAnswer && !showFinalCode) {
      // Small delay to let the UI render first
      const t = setTimeout(() => autoSpeak(gameState.currentRiddle!.text), 600);
      return () => clearTimeout(t);
    }
  }, [gameState?.currentStep, gameState?.currentRiddle?.text, showIntro, stepSuccess, skipAnswer, showFinalCode]);

  // Auto-narrate anecdote when it appears
  useEffect(() => {
    if (anecdote?.text && stepSuccess) {
      const t = setTimeout(() => {
        setLastAutoNarrated(""); // Reset to allow anecdote after riddle
        autoSpeak(anecdote.text);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [anecdote?.text, stepSuccess]);

  // Auto-narrate scenario on briefing screen
  useEffect(() => {
    if (showIntro && gameState?.gameDescription && gameState.currentStep === 1 && gameState.completedSteps.length === 0 && videoWatched && tutorialDone) {
      const t = setTimeout(() => autoSpeak(gameState.gameDescription!), 800);
      return () => clearTimeout(t);
    }
  }, [showIntro, gameState?.gameDescription, videoWatched, tutorialDone]);

  // Auto-narrate new hints
  useEffect(() => {
    if (hints.length > 0) {
      const lastHint = hints[hints.length - 1];
      if (lastHint?.text) {
        setLastAutoNarrated(""); // Reset to allow hint
        const t = setTimeout(() => autoSpeak(lastHint.text), 300);
        return () => clearTimeout(t);
      }
    }
  }, [hints.length]);

  // Fetch game state
  const fetchGameState = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/game/${sessionId}?lang=${locale}`);
      if (!res.ok) throw new Error("Impossible de charger la partie");
      const data: GameState = await res.json();
      setGameState(data);
      if (data.status === "completed") {
        router.push(`/results/${sessionId}`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur de chargement"
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, setGameState, setLoading, setError, router, locale]);

  useEffect(() => {
    fetchGameState();
  }, [fetchGameState]);

  useEffect(() => {
    if (gameState?.startedAt) {
      timer.start();
    }
  }, [gameState?.startedAt, timer]);

  // Reset to riddle view when step changes
  useEffect(() => {
    setView("riddle");
  }, [gameState?.currentStep]);

  // Validate step
  const validateStep = async () => {
    if (!geo.latitude || !geo.longitude || !gameState) return;

    setValidating(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/validate-step?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: geo.latitude,
          longitude: geo.longitude,
          stepOrder: gameState.currentStep,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStepSuccess(true);
        setHints([]);
        setGpsTooFar(false);
        if (data.answerText) setCorrectAnswer(data.answerText);
        if (data.anecdote) {
          setAnecdote({ title: data.stepTitle || "Le saviez-vous ?", text: data.anecdote });
        }
      } else if (data.error) {
        setError(data.error);
        setTimeout(() => setError(null), 3000);
      } else if (data.success === false) {
        // GPS too far — show distance and offer photo validation
        setGpsTooFar(true);
        setGpsTooFarDistance(data.distance || 0);
        setTimeout(() => setGpsTooFar(false), 10000);
      }
    } catch {
      setError("Erreur de validation");
    } finally {
      setValidating(false);
    }
  };

  // Request hint
  const requestHint = async (hintIndex: number) => {
    if (!gameState) return;

    setHintLoading(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/hint?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepOrder: gameState.currentStep,
          hintIndex,
        }),
      });

      const data = await res.json();
      if (data.hint) {
        setHints((prev) => [...prev, data.hint]);
        fetchGameState();
      }
    } catch {
      setError("Erreur lors de la demande d'indice");
    } finally {
      setHintLoading(false);
    }
  };

  // Validate by photo (AI) - supports both photo challenge and GPS fallback
  const validateByPhoto = async (mode: "photo" | "location" = "photo") => {
    if (!gameState) return;

    // Create a file input and trigger it
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment"; // Use rear camera on mobile

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setPhotoValidating(true);
      setPhotoFeedback(null);

      try {
        // Convert to base64
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        const res = await fetch(`/api/ai/validate-photo?lang=${locale}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoBase64: base64,
            sessionId,
            stepOrder: gameState.currentStep,
            mode: mode === "location" ? "location" : undefined,
          }),
        });

        const data = await res.json();

        if (data.stepValidated || data.isValid) {
          setStepSuccess(true);
          setHints([]);
          setGpsTooFar(false);
          if (data.answerText) setCorrectAnswer(data.answerText);
          if (data.anecdote) {
            setAnecdote({ title: data.stepTitle || "Le saviez-vous ?", text: data.anecdote });
          }
          setPhotoFeedback(null);
        } else {
          const hasRichData = !!(data.recognizedObject || data.anecdote);
          const canShowRich = photoRecognitionCount < MAX_PHOTO_RECOGNITIONS;

          if (hasRichData && canShowRich) {
            setPhotoRecognitionCount((c) => c + 1);
            setPhotoFeedback({
              message: data.feedback || "Ce n'est pas le bon lieu. Reessayez !",
              recognizedObject: data.recognizedObject || undefined,
              anecdote: data.anecdote || undefined,
              proximityHint: data.proximityHint || undefined,
            });
          } else {
            // Over limit or no rich identification — show plain feedback only
            setPhotoFeedback({
              message: data.feedback || "Ce n'est pas le bon lieu. Reessayez !",
              proximityHint: data.proximityHint || undefined,
            });
          }
        }
      } catch {
        setPhotoFeedback({ message: "Erreur lors de la validation photo" });
      } finally {
        setPhotoValidating(false);
      }
    };

    input.click();
  };

  // Skip step
  const [skipCompleted, setSkipCompleted] = useState(false);
  const skipStep = async () => {
    if (!gameState) return;
    setSkipping(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/skip-step?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepOrder: gameState.currentStep }),
      });
      const data = await res.json();
      if (data.success) {
        setSkipAnswer(data.answer || "Reponse non disponible");
        setSkipCompleted(!!data.completed);
        setHints([]);
      }
    } catch {
      setError("Erreur lors du passage de l'etape");
    } finally {
      setSkipping(false);
    }
  };

  const dismissSkip = () => {
    // Auto-save the skip answer to notebook
    if (skipAnswer && gameState) {
      setNotebook((prev) => ({ ...prev, [gameState.currentStep]: skipAnswer }));
    }
    setSkipAnswer(null);
    if (skipCompleted) {
      setShowFinalCode(true);
    } else {
      fetchGameState();
    }
    setSkipCompleted(false);
  };

  // Temperature indicator
  const getTemperature = (d: number | null) => {
    if (d === null) return { label: "Recherche...", color: "text-slate-400", icon: Navigation };
    if (d < 30) return { label: "Brulant!", color: "text-red-500", icon: Flame };
    if (d < 100) return { label: "Tres chaud", color: "text-orange-500", icon: Flame };
    if (d < 300) return { label: "Chaud", color: "text-yellow-500", icon: Thermometer };
    if (d < 1000) return { label: "Tiede", color: "text-emerald-400", icon: Thermometer };
    return { label: "Froid", color: "text-blue-400", icon: Snowflake };
  };

  if (isLoading && !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-500 mx-auto" />
          <p className="text-slate-400">Chargement de la partie...</p>
        </div>
      </div>
    );
  }

  if (error && !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <Card className="bg-slate-900 border-red-500/30 max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <Button onClick={() => router.push("/")} variant="outline">
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!gameState) return null;

  // Tutorial screen (before everything else)
  if (!tutorialDone && gameState.currentStep === 1 && gameState.completedSteps.length === 0) {
    return (
      <Tutorial
        locale={locale}
        gameTitle={gameState.gameTitle}
        totalSteps={gameState.totalSteps}
        estimatedDuration={gameState.estimatedDuration ?? undefined}
        onComplete={() => setTutorialDone(true)}
      />
    );
  }

  // Video intro screen (before briefing)
  if (!videoWatched && gameState.introVideoUrl && gameState.currentStep === 1 && gameState.completedSteps.length === 0) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <div className="w-full max-w-lg relative">
          <video
            src={gameState.introVideoUrl}
            className="w-full rounded-xl"
            autoPlay
            playsInline
            controls={false}
            onEnded={() => setVideoWatched(true)}
            onClick={(e) => {
              const video = e.currentTarget;
              if (video.paused) video.play();
              else video.pause();
            }}
          />
          {/* Skip video button */}
          <button
            onClick={() => setVideoWatched(true)}
            className="absolute top-4 right-4 px-3 py-1.5 bg-black/60 backdrop-blur border border-zinc-700 rounded-full text-xs text-zinc-400 hover:text-white transition-colors"
          >
            {tt('play.skipVideo', locale)} &rarr;
          </button>
        </div>
      </div>
    );
  }

  // Intro / briefing screen with starting point (show for pending sessions or first visit)
  if ((showIntro || gameState.status === "pending") && gameState.currentStep === 1 && gameState.completedSteps.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          {/* Game title */}
          <div className="text-center space-y-2 pt-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-2">
              <MapPin className="h-8 w-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-emerald-400">
              {gameState.gameTitle}
            </h1>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
              <Badge variant="outline" className="text-xs">
                {gameState.totalSteps} {tt('play.steps', locale)}
              </Badge>
            </div>
          </div>

          {/* Scenario / description */}
          {gameState.gameDescription && (
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-slate-400 uppercase tracking-wider">
                    {tt('play.scenario', locale)}
                  </CardTitle>
                  {narration.supported && gameState.gameDescription && (
                    <NarrationButton
                      text={gameState.gameDescription}
                      speaking={narration.speaking}
                      currentText={narrationText}
                      onSpeak={handleSpeak}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-slate-300 leading-relaxed text-sm">
                  {gameState.gameDescription}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Starting point map */}
          {gameState.approximateTarget && (
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Navigation className="h-4 w-4 text-emerald-400" />
                  <CardTitle className="text-sm text-emerald-300">
                    {tt('play.startingPoint', locale)}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <p className="text-xs text-slate-400 mb-3">
                  {tt('play.startingPointDesc', locale)}
                </p>
                <GameMap
                  playerLat={geo.latitude}
                  playerLon={geo.longitude}
                  targetLat={gameState.approximateTarget.latitude}
                  targetLon={gameState.approximateTarget.longitude}
                  validationRadius={gameState.validationRadius}
                  locale={locale}
                />
                <div className="mt-3">
                  <NavigationGuide
                    playerLat={geo.latitude}
                    playerLon={geo.longitude}
                    targetLat={gameState.approximateTarget.latitude}
                    targetLon={gameState.approximateTarget.longitude}
                    distance={distance}
                    label={tt('play.startingPointDirection', locale)}
                    locale={locale}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* GPS status */}
          {!geo.latitude && (
            <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tt('play.gpsActivating', locale)}
            </div>
          )}

          {/* Start button — starts the timer via API */}
          <Button
            size="lg"
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-lg h-14 rounded-xl"
            disabled={startingGame}
            onClick={async () => {
              setStartingGame(true);
              try {
                const res = await fetch(`/api/game/${sessionId}/start`, { method: "POST" });
                const data = await res.json();
                if (data.success) {
                  await fetchGameState();
                  setShowIntro(false);
                }
              } catch {
                setError("Erreur lors du demarrage");
              } finally {
                setStartingGame(false);
              }
            }}
          >
            {startingGame ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <Flame className="h-5 w-5 mr-2" />
            )}
            {tt('play.letsGo', locale)}
          </Button>
        </div>
      </div>
    );
  }

  const temp = getTemperature(distance);
  const TempIcon = temp.icon;
  const progressPercent =
    ((gameState.currentStep - 1) / gameState.totalSteps) * 100;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Step success overlay with anecdote */}
      {stepSuccess && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-md w-full space-y-4">
            {/* Success badge */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 mb-3 animate-bounce">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-emerald-300">
                {tt('play.stepValidated', locale)}
              </p>
            </div>

            {/* Correct answer */}
            {correctAnswer && (
              <div className="text-center space-y-1">
                <p className="text-sm text-slate-400">{tt('play.correctAnswerLabel', locale)}</p>
                <p className="text-2xl font-bold text-emerald-400">{correctAnswer}</p>
              </div>
            )}

            {/* Anecdote card */}
            {anecdote && (
              <Card className="bg-slate-900/95 border-emerald-800/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📖</span>
                      <CardTitle className="text-sm text-emerald-400">{tt('play.didYouKnow', locale)}</CardTitle>
                    </div>
                    {narration.supported && (
                      <NarrationButton
                        text={anecdote.text}
                        speaking={narration.speaking}
                        currentText={narrationText}
                        onSpeak={handleSpeak}
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {anecdote.text}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Notebook input - note your answer */}
            <Card className="bg-slate-900/95 border-emerald-800/50">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">📝</span>
                  <p className="text-sm font-medium text-emerald-400">{tt('play.noteAnswer', locale)}</p>
                </div>
                <p className="text-xs text-orange-400/80 mb-2">
                  {tt('play.answerLocked', locale)}
                </p>
                <input
                  type="text"
                  value={notebookInput}
                  onChange={(e) => setNotebookInput(e.target.value)}
                  placeholder={tt('play.answerPlaceholder', locale)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-center text-lg font-mono focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              </CardContent>
            </Card>

            {/* Continue button — disabled until notebook entry is filled */}
            {!notebookInput.trim() && (
              <p className="text-center text-xs text-orange-400 animate-pulse">
                {tt('play.mustNoteAnswer', locale)}
              </p>
            )}
            <Button
              size="lg"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!notebookInput.trim()}
              onClick={() => {
                setNotebook((prev) => ({ ...prev, [gameState.currentStep]: notebookInput.trim() }));
                setNotebookInput("");
                setStepSuccess(false);
                setAnecdote(null);
                setCorrectAnswer(null);
                narration.stop();
                setNarrationText("");

                const isLastStep = gameState.currentStep >= gameState.totalSteps;
                if (isLastStep) {
                  setShowFinalCode(true);
                } else {
                  fetchGameState();
                }
              }}
            >
              {gameState.currentStep >= gameState.totalSteps
                ? tt('play.finalCode', locale)
                : tt('play.nextStep', locale)
              }
            </Button>
          </div>
        </div>
      )}

      {/* Skip answer overlay */}
      {skipAnswer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full space-y-4">
            <Card className="bg-slate-900 border-orange-500/30">
              <CardContent className="pt-6 text-center space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10">
                  <Trophy className="h-8 w-8 text-orange-400" />
                </div>
                <p className="text-sm text-orange-300">{tt('play.stepSkipped', locale)}</p>
                <p className="text-lg font-bold text-white">{tt('play.answerWas', locale)}</p>
                <p className="text-2xl font-bold text-orange-400">{skipAnswer}</p>
              </CardContent>
            </Card>
            <Button
              size="lg"
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 rounded-xl"
              onClick={dismissSkip}
            >
              {tt('play.nextStep', locale)}
            </Button>
          </div>
        </div>
      )}

      {/* Compact header */}
      <div className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-xs font-medium text-emerald-400">
                {tt('play.step', locale)} {gameState.currentStep}/{gameState.totalSteps}
              </p>
              <Progress value={progressPercent} className="w-20 h-1.5" />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNotebook(!showNotebook)}
                className={`relative p-1.5 rounded-lg transition-colors ${
                  showNotebook ? "bg-emerald-500/20 text-emerald-400" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <BookOpen className="h-4 w-4" />
                {Object.keys(notebook).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                    {Object.keys(notebook).length}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1 text-sm">
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <span className="font-mono text-slate-300 text-xs">
                  {formatTime(timer.elapsedSeconds)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ VIEW: RIDDLE ============ */}
      {view === "riddle" && (
        <div className="flex flex-col min-h-[calc(100vh-44px)]">
          <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full px-6 py-8">
            {/* Step title */}
            {gameState.currentRiddle && (
              <>
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
                    <MapPin className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h2 className="text-xl font-bold text-emerald-300">
                    {gameState.currentRiddle.title}
                  </h2>
                </div>

                {/* Riddle text - immersive */}
                <div className="relative mb-6">
                  <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500/50 via-emerald-500/20 to-transparent" />
                  <p className="text-slate-200 leading-relaxed text-[15px] pl-3 whitespace-pre-wrap">
                    {gameState.currentRiddle.text}
                  </p>
                  {narration.supported && (
                    <div className="mt-3 pl-3">
                      <NarrationButton
                        text={gameState.currentRiddle.text}
                        speaking={narration.speaking}
                        currentText={narrationText}
                        onSpeak={handleSpeak}
                      />
                    </div>
                  )}
                </div>

                {gameState.currentRiddle.image && (
                  <img
                    src={gameState.currentRiddle.image}
                    alt="Indice visuel"
                    className="rounded-xl w-full max-h-48 object-cover mb-6"
                  />
                )}
              </>
            )}

            {/* Hints */}
            {hints.length > 0 && (
              <div className="space-y-2 mb-6">
                {hints.map((hint, i) => (
                  <div key={i} className="flex items-start gap-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                    <Lightbulb className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-yellow-200 flex-1">{hint.text}</p>
                    {narration.supported && (
                      <NarrationButton
                        text={hint.text}
                        speaking={narration.speaking}
                        currentText={narrationText}
                        onSpeak={handleSpeak}
                        size="sm"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Report error - discreet */}
            {gameState.currentRiddle && (
              <div className="flex justify-center mb-4">
                <ReportError
                  gameId={gameState.gameId}
                  stepId={gameState.currentStepId ?? undefined}
                  sessionId={sessionId}
                  playerName={gameState.playerName}
                  stepOrder={gameState.currentStep}
                  locale={locale}
                />
              </div>
            )}
          </div>

          {/* Bottom actions for riddle view */}
          <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 p-4">
            <div className="max-w-lg mx-auto space-y-3">
              {/* Main CTA: go to navigation */}
              <Button
                size="lg"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-14 rounded-xl text-base"
                onClick={() => setView("navigation")}
              >
                <Navigation className="h-5 w-5 mr-2" />
                {tt('play.understood', locale)}
              </Button>
              {/* Secondary actions */}
              <div className="flex justify-center gap-4">
                <button
                  className="inline-flex items-center gap-1.5 text-xs text-yellow-500 hover:text-yellow-400 disabled:opacity-50"
                  disabled={hintLoading || hints.length >= gameState.hintsAvailable}
                  onClick={() => {
                    const penalty = hints.length < 3 ? "2 minutes" : "10 minutes";
                    if (confirm(tt('play.askHint', locale).replace('{n}', String(hints.length + 1)).replace('{total}', String(gameState.hintsAvailable)).replace('{penalty}', penalty))) {
                      requestHint(hints.length);
                    }
                  }}
                >
                  {hintLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {tt('play.hint', locale)} ({hints.length}/{gameState.hintsAvailable})
                </button>
                <button
                  className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                  disabled={skipping}
                  onClick={() => {
                    if (confirm(tt('play.skipConfirm', locale))) {
                      skipStep();
                    }
                  }}
                >
                  {skipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4" />}
                  {tt('play.skip', locale)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ VIEW: NAVIGATION ============ */}
      {view === "navigation" && (
        <div className="flex flex-col h-[calc(100vh-44px)]">
          {/* Back to riddle button */}
          <button
            onClick={() => setView("riddle")}
            className="flex items-center gap-1.5 px-4 py-2 text-xs text-emerald-400 hover:text-emerald-300 bg-slate-900/50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {tt('play.reviewRiddle', locale)}
          </button>

          {/* Map — takes most of the space */}
          <div className="flex-1 relative min-h-0 z-0">
            <GameMap
              playerLat={geo.latitude}
              playerLon={geo.longitude}
              targetLat={gameState.approximateTarget?.latitude ?? null}
              targetLon={gameState.approximateTarget?.longitude ?? null}
              validationRadius={gameState.validationRadius}
              locale={locale}
              fullHeight
            />
            {/* Temperature badge overlay on map */}
            <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-sm border border-slate-700 ${temp.color}`}>
              <TempIcon className="h-4 w-4" />
              <span className="text-xs font-medium">{temp.label}</span>
            </div>
          </div>

          {/* Navigation guide */}
          <div className="bg-slate-900/95 border-t border-slate-800">
            <div className="max-w-lg mx-auto px-4 py-3">
              <NavigationGuide
                playerLat={geo.latitude}
                playerLon={geo.longitude}
                targetLat={gameState.approximateTarget?.latitude ?? null}
                targetLon={gameState.approximateTarget?.longitude ?? null}
                distance={distance}
                label={tt('play.targetDirection', locale)}
                locale={locale}
                navigationHint={navigationHint}
              />
            </div>
          </div>

          {/* GPS error */}
          {geo.error && (
            <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
              <p className="text-xs text-red-400">{geo.error}</p>
              <Button size="sm" variant="outline" className="mt-1 h-7 text-xs" onClick={geo.startTracking}>
                {tt('play.reactivateGps', locale)}
              </Button>
            </div>
          )}

          {/* GPS too far — photo fallback */}
          {gpsTooFar && (
            <div className="px-4 py-3 bg-orange-500/10 border-t border-orange-500/40">
              <p className="text-sm font-medium text-orange-300 mb-2">
                {tt('play.tooFar', locale).replace('{distance}', formatDistance(gpsTooFarDistance))}
              </p>
              <Button
                size="sm"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={photoValidating}
                onClick={() => validateByPhoto("location")}
              >
                {photoValidating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                {tt('play.validatePhoto', locale)}
              </Button>
            </div>
          )}

          {/* Photo feedback */}
          {photoFeedback && (
            <div className="px-4 py-3 bg-gradient-to-b from-blue-500/10 to-purple-500/10 border-t border-blue-500/30">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  {photoFeedback.recognizedObject ? (
                    <>
                      <p className="text-xs uppercase tracking-wider text-blue-400 font-semibold mb-1">
                        {tt('play.notTheTarget', locale)}
                      </p>
                      <p className="text-sm text-white font-medium">
                        {tt('play.youPhotographed', locale)}{" "}
                        <span className="text-blue-300 font-bold">{photoFeedback.recognizedObject}</span>
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-blue-300">{photoFeedback.message}</p>
                  )}
                </div>
                <button
                  onClick={() => setPhotoFeedback(null)}
                  className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>
              {photoFeedback.anecdote && (
                <div className="mt-2 p-3 bg-slate-900/60 border border-blue-500/20 rounded-lg">
                  <p className="text-xs uppercase tracking-wider text-amber-400 font-semibold mb-1">
                    {tt('play.didYouKnow', locale)}
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed italic">
                    {photoFeedback.anecdote}
                  </p>
                </div>
              )}
              {(photoFeedback.recognizedObject || photoFeedback.anecdote) && (
                <p className="mt-2 text-[10px] text-slate-500 italic text-right">
                  {tt('play.aiDisclaimer', locale)}
                </p>
              )}
              {photoFeedback.proximityHint && (
                <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1.5">
                  <Navigation className="h-3 w-3 shrink-0" />
                  {photoFeedback.proximityHint}
                </p>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Bottom action bar */}
          <div className="bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 p-4">
            <div className="max-w-lg mx-auto flex gap-3">
              {/* Hint */}
              <button
                className="inline-flex items-center justify-center rounded-xl border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-12 px-4 disabled:opacity-50"
                disabled={hintLoading || hints.length >= gameState.hintsAvailable}
                onClick={() => {
                  const penalty = hints.length < 3 ? "2 minutes" : "10 minutes";
                  if (confirm(tt('play.askHint', locale).replace('{n}', String(hints.length + 1)).replace('{total}', String(gameState.hintsAvailable)).replace('{penalty}', penalty))) {
                    requestHint(hints.length);
                  }
                }}
              >
                {hintLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lightbulb className="h-5 w-5" />}
                <span className="ml-1.5 text-xs">{hints.length}/{gameState.hintsAvailable}</span>
              </button>

              {/* Validate GPS */}
              <Button
                size="lg"
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl"
                disabled={!geo.latitude || !geo.longitude || validating}
                onClick={validateStep}
              >
                {validating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <MapPin className="h-5 w-5 mr-2" />}
                {tt('play.validateGps', locale)}
              </Button>

              {/* Photo validate */}
              <button
                className="inline-flex items-center justify-center rounded-xl border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-12 px-4 disabled:opacity-50"
                disabled={photoValidating}
                onClick={() => validateByPhoto("location")}
              >
                {photoValidating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              </button>

              {/* Skip */}
              <button
                className="inline-flex items-center justify-center rounded-xl border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 h-12 px-4 disabled:opacity-50"
                disabled={skipping}
                onClick={() => {
                  if (confirm(tt('play.skipConfirm', locale))) {
                    skipStep();
                  }
                }}
              >
                {skipping ? <Loader2 className="h-5 w-5 animate-spin" /> : <SkipForward className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notebook panel (slide down) */}
      {showNotebook && (
        <div className="fixed top-[44px] left-0 right-0 z-[1000] bg-slate-900 border-b border-emerald-800/30 shadow-2xl">
          <div className="max-w-lg mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Mon carnet</span>
              </div>
              <button onClick={() => setShowNotebook(false)} className="text-slate-500 text-xs hover:text-white">
                Fermer
              </button>
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: gameState.totalSteps }, (_, i) => i + 1).map((step) => (
                <div
                  key={step}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                    step <= gameState.currentStep
                      ? "bg-slate-800/80 border border-slate-700"
                      : "bg-slate-800/30 border border-slate-800/50"
                  }`}
                >
                  <span className="text-xs text-slate-500 w-14 shrink-0">{tt('play.step', locale)} {step}</span>
                  {notebook[step] ? (
                    <span className="flex-1 text-sm font-mono font-bold text-emerald-400">
                      {notebook[step]} <span className="text-emerald-600 text-[10px]">🔒</span>
                    </span>
                  ) : step <= gameState.currentStep ? (
                    <input
                      type="text"
                      value=""
                      onChange={(e) => setNotebook((prev) => ({ ...prev, [step]: e.target.value }))}
                      placeholder={tt('play.answerPlaceholder', locale)}
                      className="flex-1 bg-transparent border-none text-sm font-mono font-bold text-emerald-400 placeholder-slate-600 focus:outline-none"
                    />
                  ) : (
                    <span className="text-slate-600 italic text-xs">{tt('play.upcoming', locale)}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 text-center mt-2">
              {tt('play.notebookHint', locale)}
            </p>
          </div>
        </div>
      )}

      {/* Final code screen */}
      {showFinalCode && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-md w-full space-y-4">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 mb-3">
                <Trophy className="h-10 w-10 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-emerald-400">{tt('play.finalCode', locale)}</h2>
              <p className="text-sm text-slate-400 mt-1">
                {tt('play.assembleAnswers', locale)}
              </p>
            </div>

            {/* Notebook recap */}
            <Card className="bg-slate-900/95 border-slate-800">
              <CardContent className="pt-4">
                <p className="text-xs text-slate-500 mb-2">Vos reponses :</p>
                <div className="space-y-1">
                  {Array.from({ length: gameState.totalSteps }, (_, i) => i + 1).map((step) => (
                    <div key={step} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 w-16 shrink-0">{tt('play.step', locale)} {step}</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {notebook[step] || "???"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Final code input */}
            <Card className={`bg-slate-900/95 ${codeResult?.valid ? 'border-emerald-500' : 'border-emerald-500/30'}`}>
              <CardContent className="pt-4">
                <p className="text-sm text-slate-300 mb-2 text-center">
                  {tt('play.assembleDashes', locale)}
                </p>
                <p className="text-xs text-slate-500 mb-3 text-center font-mono">
                  ex: {Array.from({ length: gameState.totalSteps }, (_, i) => notebook[i + 1] || "?").join("-")}
                </p>
                <input
                  type="text"
                  value={finalCodeInput}
                  onChange={(e) => { setFinalCodeInput(e.target.value); setCodeResult(null); }}
                  placeholder="1990-3-1934-428-4-1502"
                  className={`w-full px-4 py-3 bg-slate-800 border-2 rounded-xl text-white text-center text-xl font-mono font-bold tracking-wider focus:outline-none placeholder-slate-600 ${
                    codeResult === null ? 'border-emerald-700/50 focus:border-emerald-500' :
                    codeResult.valid ? 'border-emerald-500' : 'border-red-500'
                  }`}
                  autoFocus
                />
                {codeResult && (
                  <p className={`text-sm text-center mt-2 font-medium ${codeResult.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {codeResult.message}
                  </p>
                )}
              </CardContent>
            </Card>

            {codeResult?.valid ? (
              <Button
                size="lg"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl"
                onClick={() => {
                  setShowFinalCode(false);
                  router.push(`/results/${sessionId}`);
                }}
              >
                <Trophy className="h-5 w-5 mr-2" />
                {tt('play.seeResults', locale)}
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 border-slate-700"
                  onClick={() => {
                    setShowFinalCode(false);
                    router.push(`/results/${sessionId}`);
                  }}
                >
                  {tt('play.skip', locale)}
                </Button>
                <Button
                  size="lg"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  disabled={!finalCodeInput.trim() || validatingCode}
                  onClick={async () => {
                    setValidatingCode(true);
                    try {
                      const res = await fetch(`/api/game/${sessionId}/validate-code?lang=${locale}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: finalCodeInput.trim() }),
                      });
                      const data = await res.json();
                      setCodeResult({ valid: data.valid, message: data.message });
                    } catch {
                      setCodeResult({ valid: false, message: "Erreur de verification" });
                    } finally {
                      setValidatingCode(false);
                    }
                  }}
                >
                  {validatingCode ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Verifier
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
