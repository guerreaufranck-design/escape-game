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

  /**
   * Play a pre-generated MP3 (e.g. ElevenLabs). Optimistic — assumes
   * playback will succeed and updates the speaking state immediately.
   * If the audio actually errors (true 404 / CORS), the error handler
   * resets the state. We deliberately don't await play() because iOS
   * Safari rejects play() on the FIRST user gesture sometimes (audio
   * context still locked) even though the audio CAN play after — and
   * falling back to Web Speech in that case produced exactly the bug
   * the user just reported (Samantha robot voice on first tap).
   */
  const playMp3 = useCallback((audioUrl: string, identifier: string) => {
    try {
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      currentAudioRef.current = audio;

      // Optimistically mark as speaking so the UI updates instantly.
      setSpeaking(true);
      currentTextRef.current = identifier;

      audio.addEventListener("playing", () => {
        // Already optimistic-set above; this just confirms.
        setSpeaking(true);
        currentTextRef.current = identifier;
      });
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
        // play() rejection (autoplay policy on first interaction) is a
        // soft failure — the audio is loaded and will play on the next
        // tap. Do NOT fall back to Web Speech: hearing Samantha when
        // the customer paid for ElevenLabs is the WORST outcome. Just
        // reset the speaking state so the user can tap again.
        setSpeaking(false);
        currentTextRef.current = "";
      });
    } catch {
      setSpeaking(false);
      currentTextRef.current = "";
    }
  }, []);

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
      // back to Web Speech when the URL is present — falling back would
      // mean the customer hears the robot voice they paid not to hear.
      // The MP3 element handles its own errors silently.
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
    };
  }, []);

  return { speak, stop, speaking, supported };
}
