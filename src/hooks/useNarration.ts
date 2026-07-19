"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const LOCALE_TO_LANG: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
};

interface SpeakOptions {
  /**
   * If provided, the hook plays this MP3 URL instead of using the
   * browser's Web Speech API. Used to play ElevenLabs-generated audio
   * stored in `audio_cache`. Falls back to Web Speech if the audio
   * fails to load (network error, expired URL, etc.).
   */
  audioUrl?: string | null;
}

/**
 * Web Audio partagé — CRUCIAL pour iPhone : un élément <audio> classique est
 * COUPÉ par l'interrupteur silencieux de l'iPhone (bug qui a causé le
 * remboursement de Tori : "no sound"). Le Web Audio (AudioContext), lui, joue
 * MÊME en mode silencieux, à condition d'avoir été déverrouillé par un geste
 * utilisateur (prime()). On garde <audio> en repli si le Web Audio échoue.
 */
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

export function useNarration(locale: string) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const currentTextRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  /**
   * Déverrouille l'audio — à appeler sur un GESTE utilisateur (ex. "C'est
   * parti"). Reprend le contexte + joue un buffer silencieux : sur iOS, ça
   * autorise ensuite la lecture Web Audio même en mode silencieux ET sans
   * nouveau geste (auto-play à l'arrivée).
   */
  const prime = useCallback(() => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        /* déjà arrêté */
      }
      sourceRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    setSpeaking(false);
    currentTextRef.current = "";
  }, []);

  /** Repli : lecture via un élément <audio> (coupé par le silencieux iOS). */
  const playViaElement = useCallback((audioUrl: string, identifier: string) => {
    try {
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      currentAudioRef.current = audio;
      setSpeaking(true);
      currentTextRef.current = identifier;
      audio.addEventListener("ended", () => {
        setSpeaking(false);
        currentTextRef.current = "";
        currentAudioRef.current = null;
      });
      audio.addEventListener("error", () => {
        setSpeaking(false);
        currentTextRef.current = "";
        currentAudioRef.current = null;
      });
      audio.play().catch(() => {
        setSpeaking(false);
        currentTextRef.current = "";
      });
    } catch {
      setSpeaking(false);
      currentTextRef.current = "";
    }
  }, []);

  /**
   * Joue un MP3 pré-généré (ElevenLabs). Web Audio en priorité (son en mode
   * silencieux iPhone), repli <audio> si le décodage échoue. On ne retombe
   * JAMAIS sur la voix navigateur quand un MP3 est fourni.
   */
  const playMp3 = useCallback(
    (audioUrl: string, identifier: string) => {
      setSpeaking(true);
      currentTextRef.current = identifier;

      const ctx = getAudioCtx();
      if (!ctx) {
        playViaElement(audioUrl, identifier);
        return;
      }
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});

      fetch(audioUrl, { mode: "cors" })
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buffer) => {
          // Une lecture plus récente a pris la main entre-temps → on abandonne.
          if (currentTextRef.current !== identifier) return;
          if (sourceRef.current) {
            try {
              sourceRef.current.onended = null;
              sourceRef.current.stop();
            } catch {
              /* ignore */
            }
          }
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.onended = () => {
            if (currentTextRef.current === identifier) {
              setSpeaking(false);
              currentTextRef.current = "";
              sourceRef.current = null;
            }
          };
          sourceRef.current = src;
          src.start(0);
        })
        .catch(() => {
          // Web Audio indisponible (décodage/CORS) → repli <audio>.
          playViaElement(audioUrl, identifier);
        });
    },
    [playViaElement],
  );

  /** Internal: speak via the browser's TTS engine. */
  const speakWithTts = useCallback(
    (text: string) => {
      if (!supported || !text) return;
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = LOCALE_TO_LANG[locale] || "fr-FR";
      utterance.rate = 1.0;
      utterance.pitch = 1;

      const voices = window.speechSynthesis.getVoices();
      const langPrefix = utterance.lang.split("-")[0];
      const matchingVoice = voices.find(
        (v) => v.lang === utterance.lang || v.lang.startsWith(langPrefix),
      );
      if (matchingVoice) {
        utterance.voice = matchingVoice;
      }

      utterance.onstart = () => {
        setSpeaking(true);
        currentTextRef.current = text;
      };
      utterance.onend = () => {
        setSpeaking(false);
        currentTextRef.current = "";
      };
      utterance.onerror = () => {
        setSpeaking(false);
        currentTextRef.current = "";
      };

      window.speechSynthesis.speak(utterance);
    },
    [locale, supported],
  );

  const speak = useCallback(
    (text: string, options?: SpeakOptions) => {
      if (!text) return;

      // Toggle off if same content is being read
      if (speaking && currentTextRef.current === text) {
        stop();
        return;
      }

      // Stop any current speech / audio
      stop();

      // If an ElevenLabs MP3 URL is provided, play it. We do NOT fall
      // back to Web Speech when the URL is present.
      if (options?.audioUrl) {
        playMp3(options.audioUrl, text);
        return;
      }

      // No MP3 available — use Web Speech as the only narration option.
      speakWithTts(text);
    },
    [speaking, stop, playMp3, speakWithTts],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          /* ignore */
        }
        sourceRef.current = null;
      }
    };
  }, []);

  return { speak, stop, speaking, supported, prime };
}
