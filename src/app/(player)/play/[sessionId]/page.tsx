"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGpsTrace } from "@/hooks/useGpsTrace";
import { useArEventLogger } from "@/hooks/useArEventLogger";
import { useSupportMessages } from "@/hooks/useSupportMessages";
import { useTimer } from "@/hooks/useTimer";
import { useDistance } from "@/hooks/useDistance";
import { SupportMessageOverlay } from "@/components/player/SupportMessageOverlay";
import { useGameStore } from "@/stores/game-store";
import { useLocale } from "@/components/player/LocaleSelector";
import { formatTime } from "@/lib/scoring";
import { formatDistance } from "@/lib/geo";
import { tt } from "@/lib/translations";
import { matchAnswer, matchAnswerHash } from "@/lib/answer-match";
import { resolveCachedUrl } from "@/lib/offline-cache";
import {
  prefetchFullGame,
  loadFullPack,
  getOfflineStep,
  setOfflineStep,
  markCompletedOffline,
  queueStart,
  queueSkip,
  queueFinal,
  flushQueue,
} from "@/lib/offline-play";
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
import { GuideNarrationOverlay, arCharacterSpriteUrl } from "@/components/player/GuideNarrationOverlay";
import { StepTransitionOverlay } from "@/components/player/StepTransitionOverlay";
import { useUITranslations } from "@/components/player/UITranslationsProvider";
import { NarrationButton } from "@/components/player/NarrationButton";
import { ReportError } from "@/components/player/ReportError";
import { useConfirm } from "@/components/player/ConfirmDialog";
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
  // GPS tracking (2026-05-23) — capture la trajectoire du joueur pendant
  // la partie pour audit litiges + assistance live. Lié au session_id
  // pseudonymisé, conservé 30 jours puis auto-purgé. Disclosure dans le
  // briefing (intro_speech). Activé UNIQUEMENT pendant les sessions actives.
  useGpsTrace({
    sessionId,
    enabled: gameState?.status === "active",
    latitude: geo.latitude,
    longitude: geo.longitude,
    accuracy: geo.accuracy,
    heading: geo.heading,
    speed: geo.speed,
    currentStep: gameState?.currentStep ?? null,
  });
  // AR event logger — instrumente les moments clés de l'expérience AR
  // pour pouvoir reconstituer "le joueur a-t-il vu le magic word ?"
  // côté admin sans avoir à interroger le joueur.
  const logAr = useArEventLogger(sessionId);
  // Support messages — admin peut envoyer un message au joueur depuis
  // /admin/sessions/[id]. Le joueur le voit en overlay temps (réel-ish, polling 15s).
  const supportMessages = useSupportMessages(
    sessionId,
    gameState?.status === "active",
  );
  const timer = useTimer(gameState?.startedAt ?? null);
  const { distance } = useDistance({
    playerLat: geo.latitude,
    playerLon: geo.longitude,
    targetLat: gameState?.approximateTarget?.latitude ?? null,
    targetLon: gameState?.approximateTarget?.longitude ?? null,
  });

  const [locale] = useLocale();
  // Loads the dynamic UI pack for non-static locales (Asian langs etc.)
  // and forces a re-render when the freshly-translated strings land.
  useUITranslations(locale);
  const confirm = useConfirm();
  const [validating, setValidating] = useState(false);
  const [hints, setHints] = useState<Hint[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [stepSuccess, setStepSuccess] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [skipAnswer, setSkipAnswer] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [videoWatched, setVideoWatched] = useState(false);
  // Tutorial désactivé par défaut (2026-05-18, demande user).
  // Les 5 slides étaient redondantes avec le briefing + modal guide.
  // Si on veut le réactiver, repasser à useState(false).
  const [tutorialDone, setTutorialDone] = useState(true);
  void setTutorialDone; // keep setter for future re-enabling
  const [anecdote, setAnecdote] = useState<{ title: string; text: string } | null>(null);
  // landmark_history = histoire patrimoniale complète du lieu (vision client 2026-05-16).
  // Affichée APRÈS la trouvaille AR, AVANT l'anecdote thématique.
  // Permet la promesse "vous découvrez la ville, vous ne marchez pas pour rien".
  const [landmarkHistory, setLandmarkHistory] = useState<string | null>(null);
  // URLs audio précises POUR LE STEP TERMINÉ (anti-bug N+1 audio sur N texte).
  // Retournées par validate-step et skip-step explicitement, persistent
  // pendant que l'overlay stepSuccess / skip est visible, puis sont reset.
  const [completedStepAudios, setCompletedStepAudios] = useState<{
    landmarkHistory: string | null;
    anecdote: string | null;
  } | null>(null);
  // État de l'énigme finale (énigme combinant les indices, 2 essais max).
  const [finalResult, setFinalResult] = useState<{
    status: "success" | "failed" | "wrong";
    attemptsRemaining: number;
    correctAnswer?: string | null;
    explanation?: string | null;
  } | null>(null);
  const [finalSubmitting, setFinalSubmitting] = useState(false);
  // Overlay RA "guide" plein écran pendant les grandes narrations
  // (vision client 2026-05-16). null = caché, sinon { text, title }.
  const [guideOverlay, setGuideOverlay] = useState<{
    text: string;
    title?: string;
    /** Sprite AR à afficher dans l'overlay (guide_male/female/monk/…).
     *  Null = fallback emoji micro. */
    characterSprite?: string | null;
    /** URL de l'audio MP3 ElevenLabs prégénéré (null = Web Speech).
     *  Stocké pour permettre au bouton "Écouter" de re-déclencher la
     *  lecture en cas d'autoplay bloqué (iOS). */
    audioUrl?: string | null;
    /** True pour l'intro_speech (auto-open au briefing). Détermine
     *  si le bouton du bas s'affiche en "Démarrer" (intro) ou
     *  "Fermer/Passer" (autres overlays guide). */
    isIntro?: boolean;
  } | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [treasure, setTreasure] = useState<{
    text: string;
    object: "key" | "parchment" | "potion" | "sword" | "treasure_chest";
  } | null>(null);
  const [notebook, setNotebook] = useState<Record<number, string>>({});
  const [notebookInput, setNotebookInput] = useState("");
  // PUZZLE MODE — saisie de la réponse déduite + feedback "faux".
  const [puzzleGuess, setPuzzleGuess] = useState("");
  const [puzzleWrong, setPuzzleWrong] = useState(false);
  // Les mots-indices se découvrent en RA (façade). Ce flag les affiche aussi
  // dans le panneau une fois révélés en RA, ou via le bouton fallback sans pénalité.
  const [puzzleWordsRevealed, setPuzzleWordsRevealed] = useState(false);
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

  // Auto-open the AR camera once per virtual_ar step the moment the
  // player physically enters the validation radius. The previous design
  // hid AR behind a "Mode AR" button buried in a menu, so players who
  // never tapped it stayed stuck reading the riddle text — there was no
  // possible answer in the riddle, only in the AR overlay (Forest +
  // Philippat in Tournus burned 1h15 each before skipping). The
  // `autoOpenedArRef` latch makes this fire ONCE per step so the player
  // can still close the AR voluntarily without it bouncing back open.
  const autoOpenedArRef = useRef<string | null>(null);
  useEffect(() => {
    autoOpenedArRef.current = null;
  }, [gameState?.currentStepId]);

  // S4 (2026-05-18) — alerte vocale d'approche : déclaration du ref
  // ici. Le useEffect réel se trouve plus bas (après la déclaration
  // de `narration`, sinon TS error "used before declaration").
  const approachAlertedRef = useRef<string | null>(null);
  useEffect(() => {
    approachAlertedRef.current = null;
  }, [gameState?.currentStepId]);
  useEffect(() => {
    if (!gameState) return;
    if (gameState.currentRiddle?.answerSource !== "virtual_ar") return;
    if (distance === null) return;
    if (distance > gameState.validationRadius) return;
    if (arOpen) return;
    if (!tutorialDone) return;
    if (showIntro) return;
    if (stepSuccess) return;
    if (showFinalCode) return;
    if (autoOpenedArRef.current === gameState.currentStepId) return;
    autoOpenedArRef.current = gameState.currentStepId ?? "_";
    setArOpen(true);
    logAr("ar_open", {
      step: gameState.currentStep,
      meta: { trigger: "auto", distance, radius: gameState.validationRadius },
    });
  }, [
    distance,
    gameState,
    arOpen,
    tutorialDone,
    showIntro,
    stepSuccess,
    showFinalCode,
    logAr,
  ]);
  const [startingGame, setStartingGame] = useState(false);
  const [gpsTooFarDistance, setGpsTooFarDistance] = useState<number>(0);
  const narration = useNarration(locale);
  const [narrationText, setNarrationText] = useState("");
  const [lastAutoNarrated, setLastAutoNarrated] = useState("");
  const [navigationHint, setNavigationHint] = useState<string | null>(null);
  /**
   * Speak `text`. If `audioUrl` is provided AND points to a pre-generated
   * ElevenLabs MP3 in audio_cache, the hook plays the MP3 (immersive
   * voice). Otherwise it falls back to Web Speech (browser TTS — robotic).
   * Always pass an audioUrl when one is available from gameState.audioMap.
   */
  const handleSpeak = (text: string, audioUrl?: string | null) => {
    if (narration.speaking && narrationText === text) {
      narration.stop();
      setNarrationText("");
    } else {
      setNarrationText(text);
      narration.speak(text, audioUrl ? { audioUrl } : undefined);
    }
  };

  /**
   * Speak with the full-screen GuideNarrationOverlay (vision 2026-05-16).
   * Used for the major narrative blocks : intro_speech, landmark_history,
   * final_riddle, final_explanation. While the audio plays, the player
   * sees the guide sprite + the text on a focused screen. At the end of
   * the audio, the overlay auto-closes and returns to the card view.
   */
  const speakWithOverlay = (
    text: string,
    audioUrl?: string | null,
    title?: string,
    characterType?: string | null,
    isIntro: boolean = false,
  ) => {
    // Toggle off if user re-taps the same narration
    if (narration.speaking && narrationText === text) {
      narration.stop();
      setNarrationText("");
      setGuideOverlay(null);
      return;
    }
    const sprite = arCharacterSpriteUrl(characterType);
    setGuideOverlay({
      text,
      title,
      characterSprite: sprite,
      audioUrl: audioUrl ?? null,
      isIntro,
    });
    setNarrationText(text);
    narration.speak(text, audioUrl ? { audioUrl } : undefined);
    // OFFLINE : remplace l'URL du sprite par un blob depuis le cache (async,
    // sans bloquer l'audio ci-dessus → autoplay iOS préservé). En ligne,
    // resolveCachedUrl renvoie l'URL d'origine.
    if (sprite) {
      void resolveCachedUrl(sprite).then((resolved) => {
        if (resolved && resolved !== sprite) {
          setGuideOverlay((prev) =>
            prev ? { ...prev, characterSprite: resolved } : prev,
          );
        }
      });
    }
  };

  const dismissGuideOverlay = () => {
    if (narration.speaking) {
      narration.stop();
      setNarrationText("");
    }
    setGuideOverlay(null);
  };
  const autoSpeak = useCallback(
    (text: string, audioUrl?: string | null) => {
      if (!text || !narration.supported) return;
      // Avoid re-reading the same text
      if (text === lastAutoNarrated) return;
      setLastAutoNarrated(text);
      setNarrationText(text);
      narration.speak(text, audioUrl ? { audioUrl } : undefined);
    },
    [narration, lastAutoNarrated],
  );

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
      // Small delay to let the UI render first. We auto-narrate ONLY when
      // an ElevenLabs MP3 is available — otherwise we skip auto-play and
      // let the player tap "Listen" themselves. Falling back to Web Speech
      // here would shatter the immersion (robotic browser TTS instead of
      // the premium voice the customer paid for).
      const audioUrl = gameState?.audioMap?.riddle;
      if (!audioUrl) return;
      const t = setTimeout(
        () => autoSpeak(gameState.currentRiddle!.text, audioUrl),
        600,
      );
      return () => clearTimeout(t);
    }
  }, [
    gameState?.currentStep,
    gameState?.currentRiddle?.text,
    gameState?.audioMap?.riddle,
    showIntro,
    stepSuccess,
    skipAnswer,
    showFinalCode,
  ]);

  // Auto-narrate anecdote when it appears (uses ElevenLabs MP3 if available).
  // Conditions : anecdote visible ET (validation réussie OU skip déclenché).
  // Avant 2026-05-15 : seul stepSuccess déclenchait l'audio → en cas de
  // skip le joueur lisait l'anecdote en silence. Corrigé pour skipAnswer aussi.
  useEffect(() => {
    if (anecdote?.text && (stepSuccess || skipAnswer)) {
      const t = setTimeout(() => {
        setLastAutoNarrated(""); // Reset to allow anecdote after riddle
        autoSpeak(anecdote.text, gameState?.audioMap?.anecdote);
      }, 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anecdote?.text, stepSuccess, skipAnswer]);

  // S1 (2026-05-18) — Open GuideNarrationOverlay automatically on the
  // briefing screen with audio auto-playing. Replaces the previous
  // "auto-narrate gameDescription" effect which played audio without
  // visual context. Now the player arrives directly on the immersive
  // full-screen guide screen (sprite + halo + text + audio), not a
  // text-heavy card.
  //
  // Latch via guideOverlayAutoOpenedRef so this fires only ONCE per
  // session — re-opening the modal each time the briefing is shown
  // would be annoying (e.g. after closing video/tutorial).
  const guideOverlayAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (!showIntro || !gameState) return;
    if (gameState.currentStep !== 1 || gameState.completedSteps.length !== 0) return;
    // Bug fix 2026-05-19 : si le jeu n'a pas d'intro_video, l'écran
    // video est sauté direct → videoWatched reste FALSE → le guide
    // modal ne s'ouvrait JAMAIS. On considère "video ok" si pas
    // d'URL video à montrer (cas standard de la majorité des jeux).
    const videoStepDone = videoWatched || !gameState.introVideoUrl;
    if (!videoStepDone || !tutorialDone) return;
    if (guideOverlayAutoOpenedRef.current) return;

    const text = gameState.introSpeech || gameState.gameDescription;
    if (!text) return;
    const audioUrl = gameState.gameWideAudio?.introSpeech ?? null;
    guideOverlayAutoOpenedRef.current = true;
    const t = setTimeout(() => {
      speakWithOverlay(
        text,
        audioUrl,
        tt("play.yourGuide", locale) || "Votre guide",
        "guide_male",
        true, // isIntro = true → bouton "Démarrer l'aventure" en bas
      );
    }, 400);
    return () => clearTimeout(t);
    // speakWithOverlay is a stable closure (no deps from inside) — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIntro, gameState, videoWatched, tutorialDone, locale]);

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

  // S4 (2026-05-18) — Alerte vocale "vous approchez" quand le joueur
  // arrive à < 100m du target. Fires UNE FOIS par stop (latch
  // approachAlertedRef pour pas spam si GPS oscille). Reset sur change step.
  useEffect(() => {
    if (!gameState) return;
    if (distance === null) return;
    if (distance > 100) return; // pas encore assez proche
    if (distance <= gameState.validationRadius) return; // déjà arrivé, no alert
    if (!tutorialDone || showIntro) return;
    if (stepSuccess || skipAnswer || showFinalCode) return;
    if (approachAlertedRef.current === gameState.currentStepId) return;
    approachAlertedRef.current = gameState.currentStepId ?? "_";

    const message =
      tt("play.approachAlert", locale) ||
      "Attention, vous approchez du lieu. Ouvrez les yeux et levez la tête !";
    if (narration.supported) {
      narration.speak(message);
    }
    // narration ref-stable enough — omit from deps to avoid re-running
    // when speaking flag flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    distance,
    gameState,
    tutorialDone,
    showIntro,
    stepSuccess,
    skipAnswer,
    showFinalCode,
    locale,
  ]);

  // Sync finalResult from gameState — if the player reloads the page
  // after resolving the final puzzle, we restore the explanation card
  // instead of showing them a fresh input asking to re-answer.
  useEffect(() => {
    if (!gameState) return;
    if (finalResult) return; // already populated in-session
    if (gameState.finalSucceeded === true) {
      setFinalResult({
        status: "success",
        attemptsRemaining: 0,
        explanation: gameState.finalAnswerExplanation,
      });
    } else if (gameState.finalSucceeded === false) {
      setFinalResult({
        status: "failed",
        attemptsRemaining: 0,
        explanation: gameState.finalAnswerExplanation,
      });
    }
  }, [gameState, finalResult]);

  // Pré-download déclenché une seule fois par session.
  const prefetchedRef = useRef(false);
  // Vrai quand tout le jeu + audios sont en cache → jouable hors-ligne.
  const [offlineReady, setOfflineReady] = useState(false);

  // Fetch game state
  const fetchGameState = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/game/${sessionId}?lang=${locale}`);
      if (!res.ok) throw new Error(tt('play.error.loadFailed', locale));
      const data: GameState = await res.json();
      setGameState(data);
      // OFFLINE : on garde l'étape locale synchronisée sur le serveur, et on
      // pré-télécharge TOUT le jeu (une fois) pour pouvoir continuer sans réseau.
      setOfflineStep(sessionId, data.currentStep);
      if (!prefetchedRef.current && data.totalSteps > 0) {
        prefetchedRef.current = true;
        void prefetchFullGame(sessionId, locale, data.totalSteps)
          .then((r) => {
            if (r.steps >= data.totalSteps) setOfflineReady(true);
          })
          .catch(() => {});
      }
      // BUG A FIX (2026-05-18) : ne PAS rediriger automatiquement vers
      // /results si un overlay post-game est en cours (skip reveal,
      // step success, final code modal).
      if (
        data.status === "completed" &&
        !skipAnswer &&
        !stepSuccess &&
        !showFinalCode
      ) {
        router.push(`/results/${sessionId}`);
      }
    } catch (err) {
      // OFFLINE FALLBACK : pas de réseau → on rend l'étape courante depuis le
      // pack pré-téléchargé (progression suivie en local).
      try {
        const pack = await loadFullPack(sessionId);
        if (pack) {
          const step = getOfflineStep(sessionId, 1);
          const cached = pack.steps[step] || pack.steps[1];
          if (cached) {
            // Résout les URLs audio en blob depuis le cache → lecture offline
            // fiable, sans dépendre du contrôle du service worker.
            const am = cached.audioMap;
            const audioMap = am
              ? {
                  riddle: await resolveCachedUrl(am.riddle),
                  character: await resolveCachedUrl(am.character),
                  anecdote: await resolveCachedUrl(am.anecdote),
                  landmarkHistory: await resolveCachedUrl(am.landmarkHistory),
                }
              : null;
            setGameState({ ...cached, currentStep: step, status: "active", audioMap });
            return;
          }
        }
      } catch {
        /* pas de pack → erreur ci-dessous */
      }
      setError(
        err instanceof Error ? err.message : tt('play.error.fetchFailed', locale)
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId, setGameState, setLoading, setError, router, locale, skipAnswer, stepSuccess, showFinalCode]);

  useEffect(() => {
    fetchGameState();
  }, [fetchGameState]);

  // OFFLINE : au retour du réseau, on rejoue la file (start + complétions)
  // pour synchroniser le serveur, puis on rafraîchit l'état.
  useEffect(() => {
    const onReconnect = () => {
      void flushQueue(sessionId, locale).then((ok) => {
        if (ok) fetchGameState();
      });
    };
    window.addEventListener("online", onReconnect);
    return () => window.removeEventListener("online", onReconnect);
  }, [sessionId, locale, fetchGameState]);

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
      // popstate is synchronous — the browser already moved us back one
      // entry. Re-push immediately so the player stays put while we ask
      // them, then handle the (async) answer.
      try {
        window.history.pushState({ inGame: true }, "");
      } catch { /* ignore */ }
      void confirm({
        message: tt('play.exitConfirm', locale),
        locale,
        tone: "destructive",
      }).then((ok) => {
        if (ok) {
          // Programmatically navigate back. Pop the sentinel state we
          // just re-pushed, then go back one more to leave the page.
          window.history.go(-1);
        }
      });
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
    // confirm + locale are stable enough that we don't want to re-run
    // this effect on every locale change — the listener captures the
    // latest by closure refresh on next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.status, locale]);

  useEffect(() => {
    if (gameState?.startedAt) {
      timer.start();
    }
  }, [gameState?.startedAt, timer]);

  // Reset to riddle view when step changes
  useEffect(() => {
    setView("riddle");
  }, [gameState?.currentStep]);

  // Auto-fill RETIRÉ 2026-05-19 (bug rapport√© Montpellier).
  //
  // L'auto-fill pré-remplissait l'input final avec la concaténation
  // des indices (ex: "HERBA-CIRCULUS-1955-ASTRA-PACTUM-TENEBRAE").
  // Mais avec les jeux modernes finalRiddle, la vraie réponse est un
  // mot DÉRIVÉ des indices (anagramme, surnom du méchant, mot caché),
  // pas leur concaténation. Le pré-remplissage poussait le joueur à
  // valider le mauvais format, ou pire, à effacer manuellement avant
  // de pouvoir réfléchir.
  //
  // Plus juste : laisser l'input vide, les indices sont déjà visibles
  // en gros au-dessus, le joueur réfléchit lui-même à la combinaison.
  // Le placeholder de l'input rappelle le format attendu.

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
  const validateStep = async (explicitAnswer?: string): Promise<boolean> => {
    if (!gameState) return false;
    if (validating) return false; // re-entrancy guard for fast double-fires
    const submittedAnswer = (
      explicitAnswer ||
      notebookInput ||
      notebook[gameState.currentStep] ||
      ""
    ).trim();
    if (!submittedAnswer) {
      setError(tt('play.error.typeAnswerFirst', locale));
      setTimeout(() => setError(null), 3000);
      return false;
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
        // landmark_history (vision 2026-05-16) — histoire patrimoniale du lieu.
        // Affichée comme PREMIÈRE card après la trouvaille, avant l'anecdote.
        if (data.landmarkHistory) {
          setLandmarkHistory(data.landmarkHistory);
        }
        // URLs audio précises du step terminé — évite le bug N+1.
        setCompletedStepAudios({
          landmarkHistory: data.landmarkHistoryAudioUrl ?? null,
          anecdote: data.anecdoteAudioUrl ?? null,
        });
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
        //
        // BUG (2026-05-18) : si data.completed===true (dernier stop), on
        // ne fetch PAS pour les mêmes raisons que skipStep (cf. fix ci-dessus).
        if (!data.completed) {
          void fetchGameState();
        }
        return true;
      } else if (data.reason === "wrong_answer") {
        setError(tt('play.error.wrongAnswer', locale));
        setTimeout(() => setError(null), 3500);
        return false;
      } else if (data.error) {
        setError(data.error);
        setTimeout(() => setError(null), 3000);
        return false;
      } else {
        setError(tt('play.error.validationFailed', locale));
        setTimeout(() => setError(null), 3000);
        return false;
      }
    } catch {
      // OFFLINE : on valide localement. En mode PUZZLE, arFacadeText = les
      // mots-indices (pas la réponse) → on compare via le hash. Sinon
      // (legacy virtual_ar) arFacadeText = la réponse.
      const offlineOk = gameState.puzzleType
        ? await matchAnswerHash(submittedAnswer, gameState.answerHash)
        : matchAnswer(submittedAnswer, gameState.arFacadeText);
      if (offlineOk) {
        setStepSuccess(true);
        setNotebook((prev) => ({ ...prev, [gameState.currentStep]: submittedAnswer }));
        setHints([]);
        setGpsTooFar(false);
        setParticleBurst((n) => n + 1);
        const revealed = gameState.puzzleType
          ? gameState.offlineStepAnswer || submittedAnswer
          : gameState.arFacadeText;
        if (revealed) setCorrectAnswer(revealed);
        if (gameState.offlineAnecdote) {
          setAnecdote({
            title: gameState.currentRiddle?.title || "Le saviez-vous ?",
            text: gameState.offlineAnecdote,
          });
        }
        if (gameState.offlineLandmarkHistory) {
          setLandmarkHistory(gameState.offlineLandmarkHistory);
        }
        setCompletedStepAudios({
          landmarkHistory: gameState.audioMap?.landmarkHistory ?? null,
          anecdote: gameState.audioMap?.anecdote ?? null,
        });
        setTreasure(
          gameState.arTreasureReward
            ? { text: gameState.arTreasureReward, object: "treasure_chest" }
            : null,
        );
        const next = gameState.currentStep + 1;
        markCompletedOffline(sessionId, gameState.currentStep, submittedAnswer);
        setOfflineStep(sessionId, next);
        if (next <= gameState.totalSteps) {
          void fetchGameState(); // charge l'étape suivante depuis le pack
        }
        return true;
      } else {
        setError(tt('play.error.wrongAnswer', locale));
        setTimeout(() => setError(null), 3500);
        return false;
      }
    } finally {
      setValidating(false);
    }
  };

  // PUZZLE MODE — soumission depuis le popup : valide la réponse déduite.
  // Faux → feedback "réessaie" ; juste → validateStep enchaîne (success modal).
  const submitPuzzle = async () => {
    const g = puzzleGuess.trim();
    if (!g) return;
    setPuzzleWrong(false);
    const ok = await validateStep(g);
    if (ok) setPuzzleGuess("");
    else setPuzzleWrong(true);
  };

  // Reset de la saisie puzzle à chaque changement d'étape.
  useEffect(() => {
    setPuzzleGuess("");
    setPuzzleWrong(false);
    setPuzzleWordsRevealed(false);
  }, [gameState?.currentStepId]);

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
      // OFFLINE : l'indice est déjà dans le pack pré-téléchargé.
      const offline = gameState.offlineHints?.[hintIndex];
      if (offline) {
        setHints((prev) => [...prev, { order: hintIndex + 1, text: offline }]);
      } else {
        setError(tt('play.error.hintFailed', locale));
      }
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
        setSkipAnswer(data.answer || tt('play.error.answerNotAvailable', locale));
        setSkipCompleted(!!data.completed);
        setHints([]);

        // Afficher l'anecdote historique aussi en cas de skip — même
        // politique que la validation. Le joueur qui skip mérite de
        // découvrir le contenu pédagogique. (Bug fixé 2026-05-15 :
        // avant, anecdote affichée uniquement après validate.)
        if (data.anecdote) {
          setAnecdote({
            title: data.stepTitle || tt('play.didYouKnow', locale) || "Le saviez-vous ?",
            text: data.anecdote,
          });
        }
        // landmark_history aussi sur skip — la promesse "découvrir la ville"
        // s'applique même quand le joueur abandonne l'énigme.
        if (data.landmarkHistory) {
          setLandmarkHistory(data.landmarkHistory);
        }
        // URLs audio précises du step skippé — évite le bug N+1.
        setCompletedStepAudios({
          landmarkHistory: data.landmarkHistoryAudioUrl ?? null,
          anecdote: data.anecdoteAudioUrl ?? null,
        });

        // Pre-fetch next step (background) — same trick as validateStep
        // so the player isn't blocked on a 30-40s translation when they
        // tap "Continue" after the skip-reveal screen.
        //
        // BUG (2026-05-18) : si data.completed===true (dernier stop), on
        // ne fetch PAS — le serveur a déjà marqué status="completed",
        // donc fetchGameState verrait ce status et triggerait
        // router.push('/results') AVANT que le joueur clique "Continuer"
        // → on saute le final code modal. dismissSkip() prend la suite
        // avec setShowFinalCode(true) sans avoir besoin de fetch.
        if (!data.completed) {
          void fetchGameState();
        }
      }
    } catch {
      // OFFLINE : skip local — on révèle la réponse (arFacadeText), on montre
      // le contenu pédagogique, on avance, et on met le skip en file de sync.
      if (gameState) {
        // PUZZLE MODE : arFacadeText = mots-indices → on révèle la vraie
        // réponse depuis le pack offline (offlineStepAnswer).
        const revealOnSkip = gameState.puzzleType
          ? gameState.offlineStepAnswer
          : gameState.arFacadeText;
        setSkipAnswer(revealOnSkip || tt('play.error.answerNotAvailable', locale));
        const isLast = gameState.currentStep >= gameState.totalSteps;
        setSkipCompleted(isLast);
        setHints([]);
        if (gameState.offlineAnecdote) {
          setAnecdote({
            title:
              gameState.currentRiddle?.title ||
              tt('play.didYouKnow', locale) ||
              "Le saviez-vous ?",
            text: gameState.offlineAnecdote,
          });
        }
        if (gameState.offlineLandmarkHistory) {
          setLandmarkHistory(gameState.offlineLandmarkHistory);
        }
        setCompletedStepAudios({
          landmarkHistory: gameState.audioMap?.landmarkHistory ?? null,
          anecdote: gameState.audioMap?.anecdote ?? null,
        });
        queueSkip(sessionId, gameState.currentStep);
        setOfflineStep(sessionId, gameState.currentStep + 1);
        if (!isLast) void fetchGameState();
      } else {
        setError(tt('play.error.skipFailed', locale));
      }
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
    setAnecdote(null); // clear anecdote (était affichée dans le skip overlay)
    setLandmarkHistory(null); // clear landmark history aussi
    setCompletedStepAudios(null); // clear audio URLs précises du step skippé
    narration.stop();  // arrêter audio anecdote en cours si lecture
    if (skipCompleted) {
      // S9 (2026-05-18) : tour mode skips final code modal direct to
      // results. (Le skip button n'apparaît pas en tour mode, mais on
      // garde la garde pour cohérence si le serveur force completion.)
      if (gameState?.mode === "city_tour") {
        router.push(`/results/${sessionId}`);
      } else {
        setShowFinalCode(true);
      }
    } else {
      fetchGameState();
    }
    setSkipCompleted(false);
  };

  // Temperature indicator (proximity to target). Labels go through tt()
  // so they translate for non-static locales just like the rest of the UI.
  const getTemperature = (d: number | null) => {
    if (d === null) return { label: tt('play.temp.searching', locale), color: "text-slate-400", icon: Navigation };
    if (d < 30) return { label: tt('play.temp.burning', locale), color: "text-red-500", icon: Flame };
    if (d < 100) return { label: tt('play.temp.veryHot', locale), color: "text-orange-500", icon: Flame };
    if (d < 300) return { label: tt('play.temp.hot', locale), color: "text-yellow-500", icon: Thermometer };
    if (d < 1000) return { label: tt('play.temp.warm', locale), color: "text-emerald-400", icon: Thermometer };
    return { label: tt('play.temp.cold', locale), color: "text-blue-400", icon: Snowflake };
  };

  if (isLoading && !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-500 mx-auto" />
          <p className="text-slate-400">{tt('play.loading', locale)}</p>
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
              {tt('play.back', locale)}
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

          {/* Guide's intro speech card — RETIRÉ DE NOUVEAU 2026-05-19
              (suite test 2).
              La carte créait un doublon avec le GuideNarrationOverlay
              auto-open : le joueur voyait le même texte 2 fois (une
              fois en modal plein écran + une fois en carte sur la page).
              Le flow correct : modal seul en page 1, briefing map en
              page 2. Le modal s'auto-ouvre dès qu'on arrive sur la
              page briefing (cf. useEffect L344-366). Si iOS Safari
              bloque l'audio, le texte reste visible jusqu'au "Fermer". */}

          {/* Scenario / description (fallback when no intro_speech) */}
          {!gameState.introSpeech && gameState.gameDescription && (
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
                      variant="pill"
                      locale={locale}
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

          {/* AR mode teaser — refonte pédagogique 2026-05-23 post-Cuenca.
              Le client de Cuenca a refusé la RA parce qu'il ne savait pas
              ce que c'était ("there are no puzzles" + "GPS bug"). Personne
              ne sait ce qu'est la RA. Cette carte explique :
                1. CE QUE C'EST (1 phrase, vulgarisée)
                2. COMMENT FAIRE (3 étapes claires)
                3. QUOI ATTENDRE (la magie : un mot apparaît sur la façade)
              Pas de jargon "augmented reality" en gros, pas de promesse
              creuse. On dit "votre caméra fait apparaître la réponse sur
              le mur" — visuel, concret, démystifié. */}
          <Card className="bg-gradient-to-br from-fuchsia-950/60 to-slate-900/80 border-fuchsia-500/40 shadow-lg shadow-fuchsia-900/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/40">
                  <Camera className="h-5 w-5 text-fuchsia-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-bold text-fuchsia-200">
                      {tt('play.arEduTitle', locale) || 'Le mode caméra magique'}
                    </h3>
                    <Badge className="bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40 text-[9px] font-bold uppercase tracking-wider">
                      {tt('play.arIntroBadge', locale)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {tt('play.arEduDesc', locale) ||
                      'Sur chaque lieu, un mot caché apparaît sur le mur quand vous pointez la caméra de votre téléphone vers la façade. Pas besoin d\'app à installer — c\'est directement dans le jeu.'}
                  </p>
                </div>
              </div>
              {/* 3-step pictogram guide */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-fuchsia-900/40">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 mb-1.5">
                    <span className="text-base font-bold text-fuchsia-300">1</span>
                  </div>
                  <p className="text-[10px] text-fuchsia-100/80 leading-tight">
                    {tt('play.arStep1', locale) || 'Marchez jusqu\'au lieu indiqué'}
                  </p>
                </div>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 mb-1.5">
                    <span className="text-base font-bold text-fuchsia-300">2</span>
                  </div>
                  <p className="text-[10px] text-fuchsia-100/80 leading-tight">
                    {tt('play.arStep2', locale) || 'Touchez le bouton violet'}
                  </p>
                </div>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 mb-1.5">
                    <span className="text-base font-bold text-fuchsia-300">3</span>
                  </div>
                  <p className="text-[10px] text-fuchsia-100/80 leading-tight">
                    {tt('play.arStep3', locale) || 'Pointez la caméra vers le mur'}
                  </p>
                </div>
              </div>
              {/* Reassurance — explicit about permissions ask */}
              <p className="text-[10px] text-slate-400 italic leading-relaxed pt-1">
                {tt('play.arPermissionHint', locale) ||
                  'Votre téléphone vous demandera l\'autorisation d\'utiliser la caméra et la boussole. Acceptez les deux pour profiter du jeu — rien n\'est enregistré, tout reste sur votre appareil.'}
              </p>
            </CardContent>
          </Card>

          {/* RGPD GPS tracking disclosure (2026-05-23 — post-Bibinouze).
              On informe le joueur que sa position GPS est enregistrée
              pendant la partie pour pouvoir :
                1. l'aider en direct s'il est perdu (assistance live)
                2. analyser les difficultés pour améliorer le jeu
                3. répondre objectivement en cas de litige
              Auto-purge 30 jours. Aucune donnée perso liée. Conforme
              RGPD Art. 6.1.f (intérêt légitime + amélioration service). */}
          <details className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-200 transition-colors">
              📍 {tt('play.gpsTrackingTitle', locale) || "Suivi GPS du parcours — confidentialité"}
            </summary>
            <p className="mt-2 leading-relaxed text-slate-400/90">
              {tt('play.gpsTrackingDesc', locale) ||
                "Pour vous aider en direct si vous êtes perdu et améliorer le jeu, votre position GPS est enregistrée pendant la partie (toutes les 30 sec). Les données sont liées uniquement à votre session anonyme (aucun nom, aucun email), conservées 30 jours puis automatiquement supprimées. Conforme RGPD."}
            </p>
          </details>

          {/* Statut de téléchargement hors-ligne */}
          <div className="w-full text-center text-xs mb-2">
            {offlineReady ? (
              <span className="text-emerald-400">✓ Jeu téléchargé — jouable hors-ligne</span>
            ) : (
              <span className="text-slate-500 inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Téléchargement du jeu (hors-ligne)…
              </span>
            )}
          </div>

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
                // OFFLINE : si le jeu est pré-téléchargé, on démarre quand même
                // (progression locale) et on met le start en file de sync.
                const pack = await loadFullPack(sessionId).catch(() => null);
                if (pack) {
                  queueStart(sessionId);
                  setOfflineStep(sessionId, getOfflineStep(sessionId, 1));
                  await fetchGameState();
                  setShowIntro(false);
                } else {
                  setError(tt('play.error.startFailed', locale));
                }
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
      {/* Support message overlay (post-Bibinouze, 2026-05-23) — affiché
          au-dessus de TOUT le reste (AR cam, modals, etc.) parce que
          c'est un message en temps réel de l'admin pour aider le joueur
          perdu. Polling 15s côté hook. Le joueur tape "Compris" pour
          l'acquitter (POST read endpoint). Si queue > 1, on affiche le
          plus ancien — les suivants prennent le relais au dismiss. */}
      <SupportMessageOverlay
        message={supportMessages.queue[0] ?? null}
        sessionId={sessionId}
        onDismiss={supportMessages.dismiss}
      />

      {/* Guide narration overlay — plein écran pendant les blocs majeurs
          (intro_speech, landmark_history, final_riddle). Affiche le
          guide + le texte pendant que l'audio joue, se ferme tout seul
          quand l'audio s'arrête. Vision client 2026-05-16. */}
      <GuideNarrationOverlay
        open={guideOverlay !== null}
        text={guideOverlay?.text ?? ""}
        title={guideOverlay?.title}
        characterSprite={guideOverlay?.characterSprite ?? undefined}
        speaking={narration.speaking}
        onClose={dismissGuideOverlay}
        locale={locale}
        onPlayAudio={() => {
          if (!guideOverlay?.text) return;
          // Si déjà en train de jouer, on stoppe puis relance (replay).
          // Sinon on lance la lecture. Le geste utilisateur autorise
          // ElevenLabs/Web Speech à jouer sur iOS Safari (autoplay
          // bypass via user-gesture).
          narration.stop();
          setNarrationText(guideOverlay.text);
          narration.speak(
            guideOverlay.text,
            guideOverlay.audioUrl ? { audioUrl: guideOverlay.audioUrl } : undefined,
          );
        }}
        onStart={guideOverlay?.isIntro ? async () => {
          // Bouton "Démarrer l'aventure" : ferme le modal, stoppe l'audio,
          // et lance la session via /start (même path que le bouton
          // "C'est parti !" du briefing). Le briefing map est sauté
          // entièrement — le guide a déjà tout dit, on enchaîne sur la
          // 1re énigme. Le joueur peut toujours revenir sur la map
          // via le bouton "AR" sur l'écran riddle.
          narration.stop();
          setNarrationText("");
          setGuideOverlay(null);
          try {
            setStartingGame(true);
            const res = await fetch(`/api/game/${sessionId}/start`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
              await fetchGameState();
              setShowIntro(false);
            }
          } catch {
            setError(tt('play.error.startFailed', locale));
          } finally {
            setStartingGame(false);
          }
        } : undefined}
      />

      {/* Step success overlay — S3 (2026-05-18) : 5 cards séparées
          condensées en 1 SEULE carte scrollable. Sections internes :
          header (Bravo+answer+treasure inline) → histoire → anecdote
          → sur le chemin → bouton Continuer. 1 seul bouton "Écouter"
          en haut qui joue history + anecdote en séquence. */}
      {stepSuccess && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-start justify-center p-4 pt-6 sm:pt-12 overflow-y-auto">
          <div className="max-w-md w-full">
            <Card className="bg-slate-900 border-emerald-500/40 shadow-2xl shadow-emerald-900/40 overflow-hidden">
              {/* ── Header : Bravo + Answer + Treasure inline ──
                  S9 (2026-05-18) : pour mode city_tour, pas d'énigme à
                  trouver donc pas de "Bravo, indice trouvé" ni d'answer
                  reveal. On affiche juste "Lieu découvert" et on passe
                  directement à l'histoire encyclopédique. */}
              <CardContent className="pt-6 pb-4 text-center bg-gradient-to-b from-emerald-950/40 to-transparent">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 animate-bounce mb-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-emerald-300 mb-1">
                  {gameState.mode === "city_tour"
                    ? (tt('play.tourLocationFound', locale) || "Lieu découvert !")
                    : (tt('play.guideCongrats', locale) || "Bravo, vous avez trouvé l'indice !")}
                </p>
                {gameState.mode === "city_game" && correctAnswer && (
                  <>
                    <p className="text-xs text-slate-400">
                      {tt('play.correctAnswerLabel', locale)}
                    </p>
                    <p className="text-3xl font-bold text-emerald-400 my-1">
                      {correctAnswer}
                    </p>
                  </>
                )}
                {gameState.mode === "city_game" && (
                  <p className="text-[11px] text-slate-400 italic mt-1">
                    📓 {tt('play.guideNotebookAdded', locale) || "Ajouté à votre carnet pour l'énigme finale."}
                  </p>
                )}

                {/* Treasure inline — petite version compacte (h-16 au lieu de h-32),
                    pas de carte séparée. */}
                {treasure && (
                  <div className="mt-3 inline-flex items-center gap-2 bg-amber-950/30 border border-amber-500/30 rounded-full px-3 py-1.5">
                    <img
                      src={`https://sijpbarxxcdkodhfrdyx.supabase.co/storage/v1/object/public/ar-sprites/${treasure.object}.png`}
                      alt=""
                      className="h-8 w-8 object-contain"
                      draggable={false}
                    />
                    <span className="text-[11px] text-amber-200/90 italic max-w-[200px] text-left leading-snug">
                      {treasure.text}
                    </span>
                  </div>
                )}
              </CardContent>

              {/* ── Histoire du lieu + audio button unique ── */}
              {landmarkHistory && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🏛️</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                          {tt('play.theStory', locale) || "L'histoire du lieu"}
                        </span>
                      </div>
                      {narration.supported && (
                        <NarrationButton
                          // Joue history + anecdote concaténés. 1 seul tap pour
                          // tout entendre, pas 2 boutons séparés à manipuler.
                          text={[landmarkHistory, anecdote?.text].filter(Boolean).join("\n\n")}
                          speaking={narration.speaking}
                          currentText={narrationText}
                          onSpeak={(t) => handleSpeak(t, completedStepAudios?.landmarkHistory)}
                          variant="pill"
                          locale={locale}
                        />
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                      {landmarkHistory}
                    </p>
                  </CardContent>
                </>
              )}

              {/* ── Anecdote (sans audio button — partagé avec history) ── */}
              {anecdote && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📖</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        {tt('play.didYouKnow', locale)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {anecdote.text}
                    </p>
                  </CardContent>
                </>
              )}

              {/* ── Sur le chemin ── */}
              {gameState?.routeAttractions && gameState.routeAttractions.length > 0 && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📍</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                        {tt('play.onYourWay', locale) || "Sur le chemin"}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {gameState.routeAttractions.map((attr, i) => (
                        <li key={i} className="border-l-2 border-cyan-500/40 pl-3">
                          <p className="text-xs font-semibold text-cyan-200">{attr.name}</p>
                          <p className="text-[11px] text-slate-400 leading-snug">{attr.fact}</p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </>
              )}

              {/* ── Continue button ── */}
              <CardContent className="pt-2 pb-4">
                <Button
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl"
                  onClick={() => {
                    setNotebookInput("");
                    setStepSuccess(false);
                    setAnecdote(null);
                    setLandmarkHistory(null);
                    setCompletedStepAudios(null);
                    setCorrectAnswer(null);
                    setTreasure(null);
                    narration.stop();
                    setNarrationText("");

                    const isLastStep = gameState.currentStep >= gameState.totalSteps;
                    if (isLastStep) {
                      // S9 (2026-05-18) : en mode city_tour, pas d'énigme
                      // finale — on saute le finalCode modal et on file
                      // direct à l'épilogue / results.
                      if (gameState.mode === "city_tour") {
                        router.push(`/results/${sessionId}`);
                      } else {
                        setShowFinalCode(true);
                      }
                    } else {
                      fetchGameState();
                    }
                  }}
                >
                  {gameState.currentStep >= gameState.totalSteps
                    ? (gameState.mode === "city_tour"
                        ? (tt('play.tourFinish', locale) || "Voir l'épilogue")
                        : tt('play.finalCode', locale))
                    : tt('play.nextStep', locale)}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Skip answer overlay — S3 (2026-05-18) : compression 5→1 carte
          comme pour success. Variante orange (non félicitations). */}
      {skipAnswer && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-start justify-center p-4 pt-6 sm:pt-12 overflow-y-auto">
          <div className="max-w-md w-full">
            <Card className="bg-slate-900 border-orange-500/40 shadow-2xl shadow-orange-900/40 overflow-hidden">
              {/* ── Header : Guide message + Answer ── */}
              <CardContent className="pt-6 pb-4 text-center bg-gradient-to-b from-orange-950/40 to-transparent">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/15 mb-3">
                  <span className="text-3xl">🎙️</span>
                </div>
                <p className="text-sm font-medium text-orange-300 mb-1">
                  {tt('play.guideNotFound', locale) || "Vous n'avez pas trouvé — c'est pas grave"}
                </p>
                <p className="text-xs text-slate-400">
                  {tt('play.guideAnswerReveal', locale) || "La réponse était :"}
                </p>
                <p className="text-3xl font-bold text-orange-400 my-1">
                  {skipAnswer}
                </p>
                <p className="text-[11px] text-slate-400 italic mt-1">
                  📓 {tt('play.guideNotebookSaved', locale) || "Je l'ai ajoutée à votre carnet."}
                </p>
              </CardContent>

              {/* ── Histoire + audio button unique (joue history + anecdote) ── */}
              {landmarkHistory && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🏛️</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                          {tt('play.theStory', locale) || "L'histoire du lieu"}
                        </span>
                      </div>
                      {narration.supported && (
                        <NarrationButton
                          text={[landmarkHistory, anecdote?.text].filter(Boolean).join("\n\n")}
                          speaking={narration.speaking}
                          currentText={narrationText}
                          onSpeak={(t) => speakWithOverlay(
                            t,
                            completedStepAudios?.landmarkHistory,
                            tt('play.theStory', locale) || "L'histoire du lieu",
                            gameState?.arCharacter?.type ?? "guide_male"
                          )}
                          variant="pill"
                          locale={locale}
                        />
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                      {landmarkHistory}
                    </p>
                  </CardContent>
                </>
              )}

              {/* ── Anecdote ── */}
              {anecdote && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📖</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-orange-300">
                        {tt('play.didYouKnow', locale)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {anecdote.text}
                    </p>
                  </CardContent>
                </>
              )}

              {/* ── Sur le chemin ── */}
              {gameState?.routeAttractions && gameState.routeAttractions.length > 0 && (
                <>
                  <div className="border-t border-slate-800" />
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📍</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                        {tt('play.onYourWay', locale) || "Sur le chemin"}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {gameState.routeAttractions.map((attr, i) => (
                        <li key={i} className="border-l-2 border-cyan-500/40 pl-3">
                          <p className="text-xs font-semibold text-cyan-200">{attr.name}</p>
                          <p className="text-[11px] text-slate-400 leading-snug">{attr.fact}</p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </>
              )}

              {/* ── Continue button ── */}
              <CardContent className="pt-2 pb-4">
                <Button
                  size="lg"
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 rounded-xl"
                  onClick={dismissSkip}
                >
                  {skipCompleted ? tt('play.finalCode', locale) : tt('play.nextStep', locale)}
                </Button>
              </CardContent>
            </Card>
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
              {/* S6 (2026-05-18) — Hamburger menu retiré. Les actions
                  Hint + Skip sont déjà dispo dans la RA (overlay AR
                  buttons). Le carnet reste accessible direct via ce
                  bouton 📓 unique. Beaucoup plus simple visuellement. */}
              <button
                onClick={() => setShowNotebook(true)}
                className="relative p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                aria-label={tt('play.notebookTitle', locale)}
              >
                <BookOpen className="h-5 w-5" />
                {Object.keys(notebook).length > 0 && (
                  <span className="text-xs font-bold text-emerald-200">
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
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
                    <MapPin className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h2 className="text-xl font-bold text-emerald-300">
                    {gameState.currentRiddle.title}
                  </h2>
                </div>

                {/* ── Proximity card (réinjecté 2026-05-23 post-Cuenca) ──
                    La vue map avait été retirée le 2026-05-18 (S2) au
                    profit de l'AR 100% pour le guidage. Field test Cuenca
                    (Bibinouze, 30 min stuck Plaza Mayor) a montré le bug :
                    sans map ni nom de lieu réel, le joueur naviguait à
                    l'aveugle, devait absolument ouvrir l'AR + grant le
                    motion-permission iOS pour avoir une direction. Si
                    l'un des deux échoue, c'est game-over.
                    Cette carte affiche TOUJOURS : nom réel du lieu,
                    distance, cardinale, ETA marche, + une mini-map
                    visuelle, + un fallback Google Maps en lien externe
                    en dernier recours. Pas besoin d'ouvrir l'AR pour
                    savoir où aller. */}
                {gameState.approximateTarget && (
                  <Card className="mb-6 bg-slate-900/80 border-emerald-900/40">
                    <CardContent className="pt-4 pb-3 space-y-3">
                      {gameState.currentRiddle.landmarkName && (
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                              {tt('play.heading', locale) || 'Direction'}
                            </p>
                            <p className="text-base font-bold text-white leading-tight truncate">
                              {gameState.currentRiddle.landmarkName}
                            </p>
                          </div>
                        </div>
                      )}
                      <GameMap
                        playerLat={geo.latitude}
                        playerLon={geo.longitude}
                        targetLat={gameState.approximateTarget.latitude}
                        targetLon={gameState.approximateTarget.longitude}
                        validationRadius={gameState.validationRadius}
                        locale={locale}
                      />
                      <NavigationGuide
                        playerLat={geo.latitude}
                        playerLon={geo.longitude}
                        targetLat={gameState.approximateTarget.latitude}
                        targetLon={gameState.approximateTarget.longitude}
                        distance={distance}
                        label={tt('play.distanceToTarget', locale) || 'Distance jusqu\'au lieu'}
                        locale={locale}
                        navigationHint={navigationHint}
                      />
                      {/* Lien de secours Google Maps — pour les cas où
                          GPS in-app dérive (canyons urbains type Cuenca,
                          vieille ville Béziers, etc.). Le joueur peut
                          ouvrir Maps natif qui a son propre GPS + données
                          de trafic, et revenir dans le jeu une fois sur
                          place. Coup zéro côté UX, énorme filet de
                          sécurité. */}
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${gameState.approximateTarget.latitude},${gameState.approximateTarget.longitude}&travelmode=walking`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-emerald-700/40 bg-emerald-950/40 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 transition-colors"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        {tt('play.openInMaps', locale) || 'Ouvrir dans Maps'}
                      </a>
                    </CardContent>
                  </Card>
                )}

                {/* AR-required banner. S9 (2026-05-18) : skip pour
                    mode city_tour — pas d'énigme à résoudre, l'AR sert
                    juste de guidage. */}
                {gameState.mode === "city_game" &&
                  !gameState.puzzleType &&
                  gameState.currentRiddle.answerSource === "virtual_ar" && (
                  <div className="mb-6 rounded-xl border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-transparent p-4 shadow-lg shadow-fuchsia-900/20 animate-pulse-slow">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-fuchsia-300 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                          {tt('play.arRequiredBadge', locale)}
                        </p>
                        <p className="mt-1 text-sm text-fuchsia-50/90 leading-relaxed">
                          {tt('play.arRequiredHint', locale)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Riddle text - immersive.
                    Bug fix UX 2026-05-19 : bouton "Écouter" REMONTÉ
                    en HAUT du texte (avant le contenu). Avant, il
                    était sous le texte → le joueur lisait l'énigme
                    en entier puis découvrait l'option audio en bas,
                    trop tard. Maintenant, dès qu'il arrive sur la
                    page il voit "▶ Écouter" et peut choisir avant
                    de lire : écoute OR lecture, pas les deux par
                    accident. */}
                <div className="relative mb-6">
                  <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500/50 via-emerald-500/20 to-transparent" />
                  {narration.supported && (
                    <div className="mb-3 pl-3">
                      <NarrationButton
                        text={gameState.currentRiddle.text}
                        speaking={narration.speaking}
                        currentText={narrationText}
                        onSpeak={(t) => handleSpeak(t, gameState.audioMap?.riddle)}
                        variant="pill"
                        locale={locale}
                      />
                    </div>
                  )}
                  <p className="text-slate-200 leading-relaxed text-[15px] pl-3 whitespace-pre-wrap">
                    {gameState.currentRiddle.text}
                  </p>
                </div>

                {/* PUZZLE MODE — popup de déchiffrage : mots-indices révélés par
                    l'RA, saisie de la réponse déduite, indices + passer (pénalisés). */}
                {gameState.mode === "city_game" && gameState.puzzleType && !stepSuccess && (
                  <div className="mb-6 rounded-2xl border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-950/50 via-violet-950/30 to-slate-900/60 p-5 shadow-lg shadow-fuchsia-900/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-5 w-5 text-fuchsia-300" />
                      <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                        {tt('play.decipher', locale) || "Déchiffre l'énigme"}
                      </p>
                    </div>
                    {/* Les mots se découvrent en RA (façade). Une fois révélés
                        (via l'RA ou le bouton fallback), on les affiche ici pour
                        que le joueur puisse taper sans tenir le téléphone en l'air. */}
                    {gameState.revealWords && gameState.revealWords.length > 0 && (
                      puzzleWordsRevealed ? (
                        <>
                          <p className="text-[11px] uppercase tracking-wider text-fuchsia-300/70 mb-2">
                            {tt('play.arRevealed', locale) || "L'RA a dévoilé"}
                          </p>
                          <div className="flex flex-wrap gap-2 mb-4">
                            {gameState.revealWords.map((w, i) => (
                              <span key={i} className="px-3 py-1.5 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/30 text-fuchsia-100 font-semibold text-sm">
                                {w}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="mb-4">
                          <p className="text-sm text-fuchsia-100/80 mb-2">
                            📱 {tt('play.arScanPrompt', locale) || "Pointe ton téléphone vers la façade pour révéler les mots."}
                          </p>
                          <button
                            onClick={() => setPuzzleWordsRevealed(true)}
                            className="text-xs text-fuchsia-300/60 underline underline-offset-2 hover:text-fuchsia-200"
                          >
                            {tt('play.cantSeeWords', locale) || "Je ne vois pas les mots"}
                          </button>
                        </div>
                      )
                    )}
                    <input
                      value={puzzleGuess}
                      onChange={(e) => { setPuzzleGuess(e.target.value); setPuzzleWrong(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") void submitPuzzle(); }}
                      placeholder={tt('play.yourAnswer', locale) || "Ta réponse…"}
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-fuchsia-500/30 text-white placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-400"
                    />
                    {puzzleWrong && (
                      <p className="text-sm text-red-300 mt-2">
                        {tt('play.puzzleWrong', locale) || "Ce n'est pas la bonne réponse — réessayez, ou prenez un indice."}
                      </p>
                    )}
                    <Button
                      onClick={() => void submitPuzzle()}
                      disabled={validating || !puzzleGuess.trim()}
                      className="w-full mt-3 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold h-12 rounded-xl"
                    >
                      {validating ? "…" : (tt('play.validate', locale) || "Valider")}
                    </Button>
                    {hints.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {hints.map((h, i) => (
                          <p key={i} className="text-sm text-amber-200/90">💡 {h.text}</p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      {hints.length < gameState.hintsAvailable && (
                        <button
                          onClick={() => requestHint(hints.length)}
                          disabled={hintLoading}
                          className="flex-1 px-3 py-2 rounded-lg border border-amber-600/40 bg-amber-950/30 text-xs font-medium text-amber-300 hover:bg-amber-900/30 transition-colors disabled:opacity-50"
                        >
                          {tt('play.hintPenalty', locale) || "Indice (pénalité)"}
                        </button>
                      )}
                      <button
                        onClick={() => void skipStep()}
                        disabled={skipping}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-600/40 bg-slate-800/40 text-xs font-medium text-slate-300 hover:bg-slate-700/40 transition-colors disabled:opacity-50"
                      >
                        {tt('play.skipPenalty', locale) || "Passer l'énigme (pénalité)"}
                      </button>
                    </div>
                  </div>
                )}

                {gameState.currentRiddle.image && (
                  <img
                    src={gameState.currentRiddle.image}
                    alt="Indice visuel"
                    className="rounded-xl w-full max-h-48 object-cover mb-6"
                  />
                )}

                {/* S9 (2026-05-19) — Tour-specific cards.
                    Affichées UNIQUEMENT en mode city_tour, en complément
                    de l'encyclopedic_text (qui rend dans la carte
                    principale ci-dessus via currentRiddle.text). */}
                {gameState.mode === "city_tour" && gameState.tourContent?.architecturalFocus && (
                  <div className="mb-4 rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-amber-900/20 to-transparent p-4 shadow-lg shadow-amber-900/20">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">👀</span>
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-1">
                          {tt('play.observeNow', locale) || "À observer maintenant"}
                        </p>
                        <p className="text-sm text-amber-50/95 leading-relaxed">
                          {gameState.tourContent.architecturalFocus}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {gameState.mode === "city_tour" && gameState.tourContent?.culturalConnection && (
                  <div className="mb-6 rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/40 via-cyan-900/20 to-transparent p-4 shadow-lg shadow-cyan-900/20">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">🔗</span>
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-cyan-300 mb-1">
                          {tt('play.tourThread', locale) || "Le fil du parcours"}
                        </p>
                        <p className="text-sm text-cyan-50/95 leading-relaxed">
                          {gameState.tourContent.culturalConnection}
                        </p>
                      </div>
                    </div>
                  </div>
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
              {/* Main CTA: open AR directly. La vue Navigation (avec map)
                  est retirée du flow utilisateur (S2 partiel 2026-05-18).
                  L'AR sert maintenant à la fois de guidage (radar +
                  flèches + distance + horizon) ET de scan. Plus de map
                  par stop — seule la map du starting point est conservée
                  dans le briefing initial. */}
              <Button
                size="lg"
                className="w-full bg-gradient-to-br from-fuchsia-600 to-violet-700 hover:from-fuchsia-500 hover:to-violet-600 text-white font-bold h-14 rounded-xl text-base shadow-lg shadow-fuchsia-900/40"
                onClick={() => {
                  setArOpen(true);
                  logAr("ar_open", {
                    step: gameState.currentStep,
                    meta: { trigger: "manual_button", distance },
                  });
                }}
              >
                <Sparkles className="h-5 w-5 mr-2" />
                {tt('play.arMode', locale) || 'Mode AR'}
              </Button>
              {/* Secondary actions — S9 (2026-05-18) : skip pour le
                  mode city_tour (pas d'énigme à résoudre = pas d'indices
                  ni de skip). En mode tour, le joueur valide juste qu'il
                  est passé via le bouton AR. */}
              {gameState.mode === "city_game" && (
              <div className="flex justify-center gap-4">
                <button
                  className="inline-flex items-center gap-1.5 text-xs text-yellow-500 hover:text-yellow-400 disabled:opacity-50"
                  disabled={hintLoading || hints.length >= gameState.hintsAvailable}
                  onClick={() => requestHint(hints.length)}
                >
                  {hintLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {tt('play.hint', locale)} ({hints.length}/{gameState.hintsAvailable})
                </button>
                <button
                  className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                  disabled={skipping}
                  onClick={() => skipStep()}
                >
                  {skipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4" />}
                  {tt('play.skip', locale)}
                </button>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: NAVIGATION + Action menu drawer RETIRÉS 2026-05-18 (S2).
          La navigation est désormais 100% basée sur l'AR (radar +
          flèches + distance + horizon + alerte vocale à 100m).
          La map starting point reste dans le briefing initial.
          Le menu hamburger remplacé par le bouton 📓 carnet seul. */}

      {/* Notebook panel (slide down) */}
      {showNotebook && (
        <div className="fixed top-[44px] left-0 right-0 z-[1000] bg-slate-900 border-b border-emerald-800/30 shadow-2xl">
          <div className="max-w-lg mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">{tt('play.notebook.title', locale)}</span>
              </div>
              <button onClick={() => setShowNotebook(false)} className="text-slate-500 text-xs hover:text-white">
                {tt('play.notebook.close', locale)}
              </button>
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: gameState.totalSteps }, (_, i) => i + 1).map((step) => {
                // A step is "locked" (answer saved + step done) when the
                // game has advanced past it. Previously we locked on the
                // mere presence of notebook[step], which meant typing the
                // first letter would freeze the row at one character —
                // exactly the field-test bug Forest hit.
                const isPast = step < gameState.currentStep;
                const isCurrent = step === gameState.currentStep;
                const draft = notebook[step] || "";
                return (
                  <div
                    key={step}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                      step <= gameState.currentStep
                        ? "bg-slate-800/80 border border-slate-700"
                        : "bg-slate-800/30 border border-slate-800/50"
                    }`}
                  >
                    <span className="text-xs text-slate-500 w-14 shrink-0">{tt('play.step', locale)} {step}</span>
                    {isPast ? (
                      <span className="flex-1 text-sm font-mono font-bold text-emerald-400">
                        {draft || "—"} <span className="text-emerald-600 text-[10px]">🔒</span>
                      </span>
                    ) : isCurrent ? (
                      <>
                        <input
                          type="text"
                          value={draft}
                          onChange={(e) =>
                            setNotebook((prev) => ({ ...prev, [step]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && draft.trim()) {
                              e.preventDefault();
                              void validateStep(draft.trim());
                            }
                          }}
                          placeholder={tt('play.answerPlaceholder', locale)}
                          className="flex-1 bg-transparent border-none text-sm font-mono font-bold text-emerald-400 placeholder-slate-600 focus:outline-none"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        <button
                          onClick={() => {
                            if (draft.trim()) void validateStep(draft.trim());
                          }}
                          disabled={!draft.trim() || validating}
                          className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {tt('play.verify', locale)}
                        </button>
                      </>
                    ) : (
                      <span className="text-slate-600 italic text-xs">{tt('play.upcoming', locale)}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-600 text-center mt-2">
              {tt('play.notebookHint', locale)}
            </p>
          </div>
        </div>
      )}

      {/* Final code screen */}
      {showFinalCode && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur flex items-start justify-center p-4 pt-6 sm:pt-12 overflow-y-auto">
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

            {/* Final riddle brief from the guide (vision 2026-05-16).
                Shown TOUJOURS pour que le joueur sache ce qu'on attend
                de lui avant de taper. Si le pipeline n'a pas généré un
                finalRiddleText spécifique (rare mais possible), on
                montre un fallback générique qui reste utile. Bug fix
                2026-05-19 (Montpellier) : avant, sans finalRiddleText
                on n'affichait QUE l'input → le joueur tapait à l'aveugle
                la concaténation, perdait, puis voyait l'explication
                après validation. Frustrant et bug d'attente. */}
            {(gameState.finalRiddleText || true) && (
              <Card className="bg-slate-900/95 border-amber-700/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🎙️</span>
                      <CardTitle className="text-sm text-amber-300">
                        {tt('play.theGuideSays', locale) || "Le guide vous parle"}
                      </CardTitle>
                    </div>
                    {narration.supported && gameState.finalRiddleText && (
                      <NarrationButton
                        text={gameState.finalRiddleText}
                        speaking={narration.speaking}
                        currentText={narrationText}
                        onSpeak={(t) => speakWithOverlay(
                          t,
                          gameState.gameWideAudio?.finalRiddle,
                          tt('play.theGuideSays', locale) || "Le guide vous parle",
                          "guide_male"
                        )}
                        variant="pill"
                        locale={locale}
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                    {gameState.finalRiddleText || (
                      tt('play.finalRiddleFallback', locale) ||
                      "Tous vos indices pointent vers une même réponse cachée. Ce n'est PAS leur simple concaténation — c'est un mot, un nom, ou une idée qu'ils évoquent tous ensemble. Réfléchissez à ce qui les unit, puis tapez votre réponse ci-dessous."
                    )}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Attempts counter (max 2). Hidden when already resolved. */}
            {finalResult?.status !== "success" && finalResult?.status !== "failed" && (
              <p className="text-center text-xs text-slate-400">
                {tt('play.attemptsRemaining', locale) || "Essais restants"} :{" "}
                <span className="font-bold text-amber-400">
                  {finalResult?.attemptsRemaining ?? (2 - (gameState.finalAttemptsUsed ?? 0))} / 2
                </span>
              </p>
            )}

            {/* Resolution card — explanation + selfie suggestion */}
            {(finalResult?.status === "success" || finalResult?.status === "failed") && (
              <Card className={`bg-slate-900/95 ${finalResult.status === "success" ? "border-emerald-500" : "border-amber-500"}`}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{finalResult.status === "success" ? "🎉" : "💡"}</span>
                    <h3 className={`text-lg font-bold ${finalResult.status === "success" ? "text-emerald-400" : "text-amber-400"}`}>
                      {finalResult.status === "success"
                        ? (tt('play.finalSuccess', locale) || "Bravo, vous avez trouvé !")
                        : (tt('play.finalRevealed', locale) || "La réponse était...")}
                    </h3>
                  </div>
                  {finalResult.correctAnswer && (
                    <p className="text-center text-xl font-mono font-bold text-emerald-400">
                      {finalResult.correctAnswer}
                    </p>
                  )}
                  {finalResult.explanation && (
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                      {finalResult.explanation}
                    </p>
                  )}
                  <p className="text-xs text-amber-300/80 italic text-center pt-2">
                    📸 {tt('play.selfieSuggestion', locale) || "Et si vous immortalisiez votre aventure avec un selfie devant le dernier lieu ?"}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* S7 (2026-05-18) — Recap indices + input UNIFIÉS dans la
                MÊME carte pour que le lien visuel soit évident. Les
                indices du carnet sont affichés en gros, alignés, avec
                des chevrons entre eux pour signaler la combinaison. */}
            <Card className={`bg-slate-900/95 ${codeResult?.valid ? 'border-emerald-500' : 'border-emerald-500/40'}`}>
              <CardContent className="pt-4 pb-4 space-y-4">
                {/* Recap : les indices du carnet en gros, en ligne */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 text-center">
                    {tt('play.yourClues', locale) || "Vos indices collectés"}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-base font-mono font-bold">
                    {Array.from({ length: gameState.totalSteps }, (_, i) => i + 1).map((step, idx) => (
                      <span key={step} className="flex items-center gap-1.5">
                        {idx > 0 && <span className="text-slate-600 text-xs">›</span>}
                        <span className={`px-2 py-1 rounded-lg border ${
                          notebook[step]
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-800 border-slate-700 text-slate-500'
                        }`}>
                          {notebook[step] || "?"}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800" />

                {/* Input */}
                <div>
                  <p className="text-sm text-slate-300 mb-2 text-center">
                    {tt('play.assembleHint', locale) || "Combinez ces indices pour former la réponse finale (les espaces/tirets sont ignorés)"}
                  </p>
                  <input
                    type="text"
                    value={finalCodeInput}
                    onChange={(e) => { setFinalCodeInput(e.target.value); setCodeResult(null); }}
                    placeholder={Array.from({ length: gameState.totalSteps }, (_, i) => notebook[i + 1] || "?").join("")}
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
                </div>
              </CardContent>
            </Card>

            {(finalResult?.status === "success" || finalResult?.status === "failed") ? (
              <Button
                size="lg"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl"
                onClick={() => {
                  setShowFinalCode(false);
                  router.push(`/results/${sessionId}${finalResult.status === "failed" ? "?revealed=1" : ""}`);
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
                    disabled={!finalCodeInput.trim() || finalSubmitting}
                    onClick={async () => {
                      setFinalSubmitting(true);
                      try {
                        // Patrimoine-first UX endpoint : tracks 2 attempts,
                        // returns explanation on resolution (success or 2 fails).
                        const res = await fetch(`/api/game/${sessionId}/final-answer?lang=${locale}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ answer: finalCodeInput.trim() }),
                        });
                        const data = await res.json();
                        if (data.result === "success") {
                          setFinalResult({
                            status: "success",
                            attemptsRemaining: 0,
                            correctAnswer: data.correctAnswer,
                            explanation: data.explanation,
                          });
                          setParticleBurst((n) => n + 1);
                          setCodeResult({ valid: true, message: tt('play.finalSuccess', locale) || "Bravo !" });
                        } else if (data.result === "failed") {
                          setFinalResult({
                            status: "failed",
                            attemptsRemaining: 0,
                            correctAnswer: data.correctAnswer,
                            explanation: data.explanation,
                          });
                          setCodeResult({ valid: false, message: tt('play.finalRevealed', locale) || "La bonne réponse était révélée." });
                        } else {
                          setFinalResult({
                            status: "wrong",
                            attemptsRemaining: data.attemptsRemaining ?? 1,
                          });
                          setCodeResult({ valid: false, message: data.message || (tt('play.tryAgain', locale) || "Pas tout à fait — il vous reste un essai") });
                        }
                      } catch {
                        // OFFLINE : on valide le code final localement (la
                        // réponse + l'explication sont dans le pack) et on met
                        // la soumission en file de sync.
                        const submitted = finalCodeInput.trim();
                        if (
                          gameState.offlineFinalAnswer &&
                          matchAnswer(submitted, gameState.offlineFinalAnswer)
                        ) {
                          queueFinal(sessionId, submitted);
                          setFinalResult({
                            status: "success",
                            attemptsRemaining: 0,
                            correctAnswer: gameState.offlineFinalAnswer,
                            explanation: gameState.offlineFinalExplanation ?? null,
                          });
                          setParticleBurst((n) => n + 1);
                          setCodeResult({
                            valid: true,
                            message: tt('play.finalSuccess', locale) || "Bravo !",
                          });
                        } else {
                          setCodeResult({
                            valid: false,
                            message:
                              tt('play.tryAgain', locale) ||
                              "Pas tout à fait — réessayez",
                          });
                        }
                      } finally {
                        setFinalSubmitting(false);
                      }
                    }}
                  >
                    {finalSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {tt('play.verify', locale)}
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
                    {tt('play.revealStory', locale)}
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
          onClose={() => {
            setArOpen(false);
            logAr("ar_close", { step: gameState.currentStep });
          }}
          onCameraReady={() => logAr("ar_camera_ready", { step: gameState.currentStep })}
          onCameraDenied={() => logAr("ar_camera_denied", { step: gameState.currentStep })}
          onCompassGranted={() => logAr("ar_compass_granted", { step: gameState.currentStep })}
          onCompassDenied={() => logAr("ar_compass_denied", { step: gameState.currentStep })}
          onLockOn={(meta) => logAr("ar_lock_on", { step: gameState.currentStep, meta })}
          onFacadeRevealed={() => {
            // PUZZLE MODE : le joueur a trouvé les mots en RA → on les affiche
            // aussi dans le panneau pour qu'il déchiffre sans tenir le téléphone.
            if (gameState.puzzleType) setPuzzleWordsRevealed(true);
            logAr("ar_facade_revealed", { step: gameState.currentStep });
          }}
          onCharacterSpeak={() => logAr("ar_character_speak", { step: gameState.currentStep })}
          facadeText={gameState.arFacadeText ?? null}
          facadeTextIsAnswer={!gameState.puzzleType && gameState.currentRiddle?.answerSource === "virtual_ar"}
          treasureReward={gameState.arTreasureReward ?? null}
          stepKey={gameState.currentStepId}
          onChestOpen={() => setParticleBurst((n) => n + 1)}
          character={gameState.arCharacter ?? null}
          characterAudioUrl={gameState.audioMap?.character ?? null}
          hintsUsed={hints.length}
          hintsAvailable={gameState.hintsAvailable}
          hintLoading={hintLoading}
          onRequestHint={
            hints.length < gameState.hintsAvailable
              ? () => requestHint(hints.length)
              : undefined
          }
          latestHint={hints[hints.length - 1]?.text || null}
          onAutoValidate={(source) => {
            // PUZZLE MODE : la façade dévoile des MOTS-INDICES, pas la réponse.
            // On NE valide donc PAS automatiquement — le joueur doit déduire et
            // taper sa réponse dans le popup. On ferme juste l'RA.
            if (gameState.puzzleType) {
              setArOpen(false);
              return;
            }
            // The AR overlay confirms the player has been on-site
            // long enough to read the magical letters. Validate
            // server-side using the EXACT answer Claude generated
            // (the facade text uppercase = answer_text uppercase).
            const knownAnswer =
              gameState.arFacadeText ||
              gameState.currentRiddle?.text ||
              "";
            // Log avant de fermer (l'overlay nous dit si c'est auto-1.5s
            // ou clic manuel "Valider quand même")
            logAr(source === "manual" ? "ar_manual_validated" : "ar_auto_validated", {
              step: gameState.currentStep,
              meta: { distance },
            });
            // Close AR before opening the success modal so the
            // celebration takes over the screen.
            setArOpen(false);
            void validateStep(knownAnswer);
          }}
          skipLoading={skipping}
          onSkipStep={() => {
            setArOpen(false);
            skipStep();
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

      {/* Fullscreen reassurance overlay for the long-running transitions:
          - Skip step (API + next-step Gemini translation, can be 5-30s)
          - Step transition fetch when player has just reached/validated a step
          The thin top bar above is too discreet — players reported "app
          crashed" during the wait. This overlay rotates messages so the
          screen never looks frozen. */}
      <StepTransitionOverlay
        active={skipping || (isLoading && !!gameState && tutorialDone && !showIntro && !skipAnswer && !stepSuccess)}
        locale={locale}
      />
    </div>
  );
}
