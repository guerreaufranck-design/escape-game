"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const LOCALE_TO_LANG: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
};

export function useNarration(locale: string) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const currentTextRef = useRef<string>("");

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      currentTextRef.current = "";
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text) return;

      // If same text is being read, toggle off
      if (speaking && currentTextRef.current === text) {
        stop();
        return;
      }

      // Stop any current speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = LOCALE_TO_LANG[locale] || "fr-FR";
      utterance.rate = 0.95;
      utterance.pitch = 1;

      // Try to find a matching voice
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = utterance.lang.split("-")[0];
      const matchingVoice = voices.find(
        (v) => v.lang === utterance.lang || v.lang.startsWith(langPrefix)
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
    [locale, speaking, stop, supported]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { speak, stop, speaking, supported };
}
