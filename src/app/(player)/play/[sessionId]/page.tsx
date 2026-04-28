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
  Sparkles,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { NavigationGuide } from "@/components/player/NavigationGuide";
import { ARCameraOverlay } from "@/components/player/ARCameraOverlay";
import { ValidationParticles } from "@/components/player/ValidationParticles";
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
  const [treasure, setTreasure] = useState<{
    text: string;
    object: "key" | "parchment" | "potion" | "sword" | "treasure_chest";
  } | null>(null);
  const [notebook, setNotebook] = useState<Record<number, string>>({});
  const [notebookInput, setNotebookInput] = useState("");
  const [showNotebook, setShowNotebook] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
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
  const [arOpen, setArOpen] = useState(false);
  const [particleBurst, setParticleBurst] = useState(0);
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

  // -------------------------------------------------------------------
  // Persist hints + notebook across reloads / accidental nav.
  // The session API only knows the COUNT of hints used (for scoring); the
  // hint TEXT lives client-side. Without this, a swipe-back wiped the
  // player's notebook clean even though they had paid the time penalty.
  // -------------------------------------------------------------------
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`game:${sessionId}:hints`);
      if (raw) setHints(JSON.parse(raw));
      const nb = sessionStorage.getItem(`game:${sessionId}:notebook`);
      if (nb) setNotebook(JSON.parse(nb));
    } catch {
      /* ignore corrupt storage */
    }
  }, [sessionId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(`game:${sessionId}:hints`, JSON.stringify(hints));
    } catch { /* quota or private mode — ignore */ }
  }, [hints, sessionId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(`game:${sessionId}:notebook`, JSON.stringify(notebook));
    } catch { /* ignore */ }
  }, [notebook, sessionId]);

  // -------------------------------------------------------------------
  // Block accidental exits (swipe-back gesture, browser back button,
  // tab close). Mobile Safari and Chrome both fire popstate when the
  // user swipes from the screen edge — we counter-push the same state
  // so the player stays in the game unless they explicitly confirm.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!gameState || gameState.status !== "active") return;

    // Push a sentinel state so the FIRST popstate doesn't take us off the page.
    try {
      window.history.pushState({ inGame: true }, "");
    } catch { /* ignore */ }

    const onPopState = () => {
      const ok = window.confirm(
        "Quitter la partie ? Tes indices et ta progression sont sauvegardes, mais le chrono continue.",
      );
      if (!ok) {
        // Re-push to keep the player on the page.
        try {
          window.history.pushState({ inGame: true }, "");
        } catch { /* ignore */ }
      } else {
        // Allow native back to take effect.
        window.history.back();
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [gameState?.status]);

  useEffect(() => {
    if (gameState?.startedAt) {
      timer.start();
    }
  }, [gameState?.startedAt, timer]);

  // Reset to riddle view when step changes
  useEffect(() => {
    setView("riddle");
  }, [gameState?.currentStep]);

  // Auto-fill the FINAL CODE input from the notebook the moment the
  // final-code screen opens. The player has been collecting answers
  // step by step; making them retype the concatenation is busywork
  // and a source of typos. We pre-fill with `notebook[1]-notebook[2]-…`
  // so the player just has to confirm. They can still edit it if they
  // want to challenge the order or the format.
  useEffect(() => {
    if (showFinalCode && gameState && !finalCodeInput.trim()) {
      const parts: string[] = [];
      for (let i = 1; i <= gameState.totalSteps; i++) {
        const v = (notebook[i] || "").trim();
        if (v) parts.push(v);
      }
      if (parts.length > 0) setFinalCodeInput(parts.join("-"));
    }
  }, [showFinalCode, gameState, notebook, finalCodeInput]);

  // Validate step. AR-first model:
  //   - Auto-fire from ARCameraOverlay onAutoValidate after the player
  //     has been locked on for ~3.5s (the answer materialised on the
  //     facade and they read it). The host calls this with the
  //     EXPLICIT answer pulled from gameState.arFacadeText.
  //   - Manual fallback: the function still works without an arg, in
  //     which case it reads from notebookInput / notebook (legacy
  //     manual flow).
  // The server-side check matches against the stored expected answer
  // (case-insensitive + accent-folded), so passing the AR-revealed
  // facade text always succeeds.
  const validateStep = async (explicitAnswer?: string) => {
    if (!gameState) return;
    if (validating) return; // re-entrancy guard for fast double-fires
    const submittedAnswer = (
      explicitAnswer ||
      notebookInput ||
      notebook[gameState.currentStep] ||
      ""
    ).trim();
    if (!submittedAnswer) {
      setError("Tape la reponse decouverte en RA avant de valider");
      setTimeout(() => setError(null), 3000);
      return;
    }

    setValidating(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/validate-step?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Coords stay optional for analytics — never used as a gate.
          latitude: geo.latitude ?? undefined,
          longitude: geo.longitude ?? undefined,
          stepOrder: gameState.currentStep,
          answer: submittedAnswer,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStepSuccess(true);
        // Persist the typed answer in the notebook for the final code recap.
        setNotebook((prev) => ({ ...prev, [gameState.currentStep]: submittedAnswer }));
        setHints([]);
        setGpsTooFar(false);
        setParticleBurst((n) => n + 1);
        if (data.answerText) setCorrectAnswer(data.answerText);
        if (data.anecdote) {
          setAnecdote({ title: data.stepTitle || "Le saviez-vous ?", text: data.anecdote });
        }
        if (data.treasureReward && data.treasureObject) {
          setTreasure({ text: data.treasureReward, object: data.treasureObject });
        } else {
          setTreasure(null);
        }

        // PRE-FETCH next step's translated content in the background.
        // The server-side advances current_step on validate-step, so the
        // upcoming /api/game call returns step N+1. Player is reading the
        // success modal anyway → use those seconds to translate. By the
        // time they tap "Continue", gameState is hot and the transition
        // feels instant instead of a 30-40s blocking wait.
        void fetchGameState();
      } else if (data.reason === "wrong_answer") {
        setError("Reponse incorrecte. Verifie ce que tu as decouvert en RA.");
        setTimeout(() => setError(null), 3500);
      } else if (data.error) {
        setError(data.error);
        setTimeout(() => setError(null), 3000);
      } else {
        setError("Validation echouee. Reessaie.");
        setTimeout(() => setError(null), 3000);
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

  // Photo challenge has been retired in the AR-first flow. The function is
  // gone; calls from older UI branches no-op via the wrapper below.
  const validateByPhoto = async (_mode: "photo" | "location" = "photo") => {
    void _mode;
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

        // Pre-fetch next step (background) — same trick as validateStep
        // so the player isn't blocked on a 30-40s translation when they
        // tap "Continue" after the skip-reveal screen.
        void fetchGameState();
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

          {/* DIVAN mode teaser — always-on map enhancement */}
          <Card className="bg-gradient-to-br from-emerald-950/60 to-slate-900/80 border-emerald-500/30">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40">
                  <Navigation className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold text-emerald-300">
                      {tt('play.divanIntroTitle', locale)}
                    </h3>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider">
                      {tt('play.arIntroBadge', locale)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {tt('play.divanIntroDesc', locale)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AR mode teaser — prominent feature announcement */}
          <Card className="bg-gradient-to-br from-emerald-950/60 to-slate-900/80 border-emerald-500/30">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40">
                  <Sparkles className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold text-emerald-300">
                      {tt('play.arIntroTitle', locale)}
                    </h3>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider">
                      {tt('play.arIntroBadge', locale)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {tt('play.arIntroDesc', locale)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

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

            {/* Treasure reveal — decorative AR object that "drops" for the
                player when they solve the step. The sprite is picked
                server-side from the EN treasure description (key, sword,
                potion, parchment, treasure_chest). Pure flavour, no
                gameplay impact. */}
            {treasure && (
              <Card className="bg-gradient-to-br from-amber-950/80 to-slate-900/95 border-amber-500/40 overflow-hidden">
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400/90">
                      {tt('play.treasureRevealed', locale)}
                    </p>
                    <div
                      className="relative h-32 w-32"
                      style={{ animation: "treasure-pop 700ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                    >
                      {/* Soft golden aura behind the sprite */}
                      <div
                        className="absolute inset-0 rounded-full blur-2xl"
                        style={{
                          background:
                            "radial-gradient(circle, rgba(251,191,36,0.45) 0%, transparent 70%)",
                          animation: "treasure-pulse 2.4s ease-in-out infinite",
                        }}
                      />
                      <img
                        src={`https://sijpbarxxcdkodhfrdyx.supabase.co/storage/v1/object/public/ar-sprites/${treasure.object}.png`}
                        alt={treasure.text}
                        className="relative h-full w-full object-contain select-none"
                        style={{
                          filter:
                            "drop-shadow(0 4px 14px rgba(0,0,0,0.6)) drop-shadow(0 0 20px rgba(251,191,36,0.35))",
                        }}
                        draggable={false}
                      />
                    </div>
                    <p className="text-center text-sm text-amber-100/95 leading-snug italic px-2">
                      {treasure.text}
                    </p>
                  </div>
                </CardContent>
                <style jsx>{`
                  @keyframes treasure-pop {
                    0% { opacity: 0; transform: translateY(40px) scale(0.5) rotate(-10deg); }
                    60% { opacity: 1; transform: translateY(-6px) scale(1.05) rotate(2deg); }
                    100% { opacity: 1; transform: translateY(0) scale(1) rotate(0deg); }
                  }
                  @keyframes treasure-pulse {
                    0%, 100% { opacity: 0.6; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.12); }
                  }
                `}</style>
              </Card>
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
                setTreasure(null);
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
              <div className="flex items-center gap-1 text-sm">
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <span className="font-mono text-slate-300 text-xs">
                  {formatTime(timer.elapsedSeconds)}
                </span>
              </div>
              <button
                onClick={() => setShowActionMenu(true)}
                className="relative p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                aria-label={tt('play.menu', locale)}
              >
                <Menu className="h-5 w-5" />
                {Object.keys(notebook).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                    {Object.keys(notebook).length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ VIEW: RIDDLE ============ */}
      {view === "riddle" && (
        <div className="flex flex-col min-h-[calc(100dvh-44px)]">
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

                {/* Route POIs — expandable card the player can open
                    to see real heritage points to spot ON THE WAY.
                    Pure tour-guide flavour, doesn't impact gameplay. */}
                {gameState.routeAttractions && gameState.routeAttractions.length > 0 && (
                  <details className="mb-6 group rounded-xl border border-amber-700/40 bg-gradient-to-br from-amber-950/40 to-slate-900/60 overflow-hidden">
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-amber-900/20 transition-colors">
                      <span className="text-xl">📍</span>
                      <span className="flex-1 text-sm font-bold text-amber-200 uppercase tracking-wider">
                        {tt('play.routeAttractions', locale) || "Sur le chemin, ne manque pas"}
                      </span>
                      <ChevronRight className="h-4 w-4 text-amber-300/70 transition-transform group-open:rotate-90" />
                    </summary>
                    <ul className="divide-y divide-amber-800/30">
                      {gameState.routeAttractions.map((a, i) => (
                        <li key={i} className="px-4 py-3">
                          <p className="text-sm font-bold text-amber-100">{a.name}</p>
                          <p className="text-xs text-amber-100/75 leading-relaxed mt-1 italic">{a.fact}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
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
        <div className="flex flex-col h-[calc(100dvh-44px)] overflow-y-auto">
          {/* Back to riddle button */}
          <button
            onClick={() => setView("riddle")}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs text-emerald-400 hover:text-emerald-300 bg-slate-900/50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {tt('play.reviewRiddle', locale)}
          </button>

          {/* Map — takes most of the space; needs fixed flex height for Leaflet to render */}
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

          {/* Photo challenge + GPS-too-far photo fallback removed — the
              AR-first flow validates by typed answer, no photo needed. */}

          {/* Error message */}
          {error && (
            <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Bottom action bar — AR is the ONLY action.
              The manual "Valider la reponse" button is gone: validation
              is now automatic when the AR has shown the answer for
              ~3.5s. The skip button lives inside the AR overlay if the
              player gets stuck. */}
          <div className="sticky bottom-0 z-20 mt-auto bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
            <div className="max-w-lg mx-auto">
              <Button
                size="lg"
                className="w-full bg-gradient-to-br from-fuchsia-600 to-violet-700 hover:from-fuchsia-500 hover:to-violet-600 text-white font-bold h-14 rounded-xl text-base shadow-lg shadow-fuchsia-900/40 animate-pulse-slow"
                onClick={() => setArOpen(true)}
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Ouvrir la Realite Augmentee
              </Button>
              <p className="mt-2 text-center text-[11px] text-slate-500">
                {tt('play.arAutoValidate', locale) || "Une fois en RA, l'etape se valide quand l'indice s'affiche."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action menu drawer (slide from right) */}
      {showActionMenu && (
        <>
          <div
            className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowActionMenu(false)}
          />
          <div
            className="fixed top-0 right-0 bottom-0 z-[1101] w-[88%] max-w-sm bg-slate-950 border-l border-emerald-500/20 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Menu className="h-5 w-5 text-emerald-400" />
                <span className="text-base font-bold text-white">{tt('play.menuActions', locale)}</span>
              </div>
              <button
                onClick={() => setShowActionMenu(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Notebook */}
              <button
                onClick={() => {
                  setShowActionMenu(false);
                  setShowNotebook(true);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors text-left"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center relative">
                  <BookOpen className="h-6 w-6 text-emerald-300" />
                  {Object.keys(notebook).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                      {Object.keys(notebook).length}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{tt('play.notebookTitle', locale)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{tt('play.notebookDesc', locale)}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
              </button>

              {/* AR Mode */}
              <button
                onClick={() => {
                  setShowActionMenu(false);
                  setArOpen(true);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-fuchsia-500/10 to-emerald-500/10 border border-fuchsia-500/30 hover:from-fuchsia-500/20 hover:to-emerald-500/20 transition-colors text-left"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-emerald-500/30 border border-fuchsia-400/40 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-fuchsia-200" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white">{tt('play.arMode', locale)}</p>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/30 text-fuchsia-200 border border-fuchsia-400/40">NEW</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{tt('play.arModeDesc', locale)}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
              </button>

              {/* Hint */}
              <button
                disabled={hintLoading || hints.length >= gameState.hintsAvailable}
                onClick={() => {
                  const penalty = hints.length < 3 ? "2 minutes" : "10 minutes";
                  if (confirm(tt('play.askHint', locale).replace('{n}', String(hints.length + 1)).replace('{total}', String(gameState.hintsAvailable)).replace('{penalty}', penalty))) {
                    setShowActionMenu(false);
                    requestHint(hints.length);
                  }
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center">
                  {hintLoading ? <Loader2 className="h-6 w-6 text-yellow-300 animate-spin" /> : <Lightbulb className="h-6 w-6 text-yellow-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white">{tt('play.hintAction', locale)}</p>
                    <span className="text-[10px] font-mono font-bold text-yellow-400 bg-yellow-500/20 px-1.5 py-0.5 rounded">{hints.length}/{gameState.hintsAvailable}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{tt('play.hintActionDesc', locale)}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
              </button>

              {/* Photo validate removed — AR-first flow uses typed answer */}

              {/* Skip step */}
              <button
                disabled={skipping}
                onClick={() => {
                  if (confirm(tt('play.skipConfirm', locale))) {
                    setShowActionMenu(false);
                    skipStep();
                  }
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-orange-500/20 border border-orange-500/40 flex items-center justify-center">
                  {skipping ? <Loader2 className="h-6 w-6 text-orange-300 animate-spin" /> : <SkipForward className="h-6 w-6 text-orange-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{tt('play.skipAction', locale)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{tt('play.skipActionDesc', locale)}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
              </button>
            </div>
          </div>
        </>
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
              <>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1 border-slate-700"
                    onClick={() => {
                      // "I give up" / "skip" — player sees the truth + the narrative anyway
                      setShowFinalCode(false);
                      router.push(`/results/${sessionId}?revealed=1`);
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
                        if (data.valid) setParticleBurst((n) => n + 1);
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

                {/* When a code has been tried and it's wrong, offer the reveal */}
                {codeResult && !codeResult.valid && (
                  <Button
                    variant="ghost"
                    className="w-full mt-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                    onClick={() => {
                      setShowFinalCode(false);
                      router.push(`/results/${sessionId}?revealed=1`);
                    }}
                  >
                    {locale === "en" ? "Reveal the story and the truth" :
                     locale === "es" ? "Revelar la historia y la verdad" :
                     locale === "de" ? "Die Geschichte und Wahrheit enthüllen" :
                     locale === "it" ? "Rivelare la storia e la verità" :
                     "Découvrir l'histoire et la vérité"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* AR camera overlay (fullscreen) */}
      {arOpen && (
        <ARCameraOverlay
          playerLat={geo.latitude}
          playerLon={geo.longitude}
          targetLat={gameState.approximateTarget?.latitude ?? null}
          targetLon={gameState.approximateTarget?.longitude ?? null}
          distance={distance}
          locale={locale}
          onClose={() => setArOpen(false)}
          historicalPhotoUrl={gameState.arHistoricalPhoto?.url ?? null}
          historicalPhotoCredit={gameState.arHistoricalPhoto?.credit ?? null}
          facadeText={gameState.arFacadeText ?? null}
          facadeTextIsAnswer={gameState.currentRiddle?.answerSource === "virtual_ar"}
          treasureReward={gameState.arTreasureReward ?? null}
          stepKey={gameState.currentStepId}
          onChestOpen={() => setParticleBurst((n) => n + 1)}
          character={gameState.arCharacter ?? null}
          hintsUsed={hints.length}
          hintsAvailable={gameState.hintsAvailable}
          hintLoading={hintLoading}
          onRequestHint={
            hints.length < gameState.hintsAvailable
              ? () => requestHint(hints.length)
              : undefined
          }
          latestHint={hints[hints.length - 1]?.text || null}
          onAutoValidate={() => {
            // The AR overlay confirms the player has been on-site
            // long enough to read the magical letters. Validate
            // server-side using the EXACT answer Claude generated
            // (the facade text uppercase = answer_text uppercase).
            const knownAnswer =
              gameState.arFacadeText ||
              gameState.currentRiddle?.text ||
              "";
            // Close AR before opening the success modal so the
            // celebration takes over the screen.
            setArOpen(false);
            void validateStep(knownAnswer);
          }}
          skipLoading={skipping}
          onSkipStep={() => {
            if (confirm(tt('play.skipConfirm', locale))) {
              setArOpen(false);
              skipStep();
            }
          }}
        />
      )}

      {/* Celebratory particles on validation success */}
      <ValidationParticles trigger={particleBurst} theme="gold" />

      {/* ─────────────────────────────────────────────────────────────
          Long-action loading overlay
          Field-test feedback: when the player taps "Hint" or "Skip",
          there's a 2-6s wait while Gemini translates. The button-level
          spinner was too subtle — players thought nothing happened
          and tapped again. This centred overlay makes the wait
          visible and intentional.
          ───────────────────────────────────────────────────────────── */}
      {(hintLoading || skipping) && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm pointer-events-auto">
          <div className="rounded-2xl border-2 border-emerald-500/40 bg-slate-900/95 px-6 py-5 shadow-2xl flex flex-col items-center gap-3">
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
              <div className="absolute inset-0 rounded-full bg-emerald-400/20 blur-xl animate-pulse" />
            </div>
            <p className="text-sm font-semibold text-emerald-200">
              {hintLoading
                ? tt('play.preparingHint', locale) || "Preparation de l'indice..."
                : tt('play.preparingSkip', locale) || "Revelation de la reponse..."}
            </p>
            <p className="text-[11px] text-slate-400 italic">
              {tt('play.translationNote', locale) || "Traduction en cours, quelques secondes..."}
            </p>
          </div>
        </div>
      )}

      {/* Step-transition progress bar — slides across when the player
          validates, asks for a hint, or skips. Gives a visible cue
          during the 5-30s wait while the next step's content is
          translated server-side. */}
      {(validating || skipping || hintLoading || isLoading) && (
        <div
          className="fixed top-0 left-0 right-0 z-[1300] h-1.5 bg-slate-900/40 pointer-events-none overflow-hidden"
        >
          <div
            className="h-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]"
            style={{
              animation: "step-progress-slide 2s linear infinite",
              backgroundSize: "200% 100%",
            }}
          />
          <style jsx>{`
            @keyframes step-progress-slide {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
