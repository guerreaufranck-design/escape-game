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

export function useNarration(locale: string) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const currentTextRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    setSpeaking(false);
    currentTextRef.current = "";
  }, []);

  /** Play a pre-generated MP3 (e.g. ElevenLabs). Returns true on success. */
  const playMp3 = useCallback(
    (audioUrl: string, identifier: string) =>
      new Promise<boolean>((resolve) => {
        try {
          const audio = new Audio(audioUrl);
          audio.preload = "auto";
          currentAudioRef.current = audio;

          let resolved = false;
          const settle = (value: boolean) => {
            if (!resolved) {
              resolved = true;
              resolve(value);
            }
          };

          audio.addEventListener("playing", () => {
            setSpeaking(true);
            currentTextRef.current = identifier;
            settle(true);
          });
          audio.addEventListener("ended", () => {
            setSpeaking(false);
            currentTextRef.current = "";
            currentAudioRef.current = null;
          });
          audio.addEventListener("error", () => {
            setSpeaking(false);
            currentAudioRef.current = null;
            settle(false);
          });

          audio.play().catch(() => {
            // play() may reject if user hasn't interacted yet (autoplay
            // policy) or if the URL 404s. Either way, fall back to TTS.
            settle(false);
          });
        } catch {
          resolve(false);
        }
      }),
    [],
  );

  /** Internal: speak via the browser's TTS engine. */
  const speakWithTts = useCallback(
    (text: string) => {
      if (!supported || !text) return;
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = LOCALE_TO_LANG[locale] || "fr-FR";
      utterance.rate = 0.95;
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
    async (text: string, options?: SpeakOptions) => {
      if (!text) return;

      // Toggle off if same content is being read
      if (speaking && currentTextRef.current === text) {
        stop();
        return;
      }

      // Stop any current speech / audio
      stop();

      // Try the pre-generated MP3 first if provided. If it fails (404,
      // network, autoplay policy), fall back transparently to TTS so the
      // player never gets silence.
      if (options?.audioUrl) {
        const ok = await playMp3(options.audioUrl, text);
        if (ok) return;
      }

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
    };
  }, []);

  return { speak, stop, speaking, supported };
}
