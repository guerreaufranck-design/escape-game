"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface NarratorIntroProps {
  narratorName: string;
  narratorRole: string;
  narratorIntro: string;
  playerLanguage: string;
  onComplete: () => void;
}

// Map short language codes to BCP-47 locale tags for Web Speech API
const LANG_MAP: Record<string, string> = {
  fr: "fr-FR",
  en: "en-GB",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  ja: "ja-JP",
  zh: "zh-CN",
  ar: "ar-SA",
  ru: "ru-RU",
  ko: "ko-KR",
};

function getLang(playerLanguage: string): string {
  return LANG_MAP[playerLanguage.toLowerCase()] ?? "fr-FR";
}

// Split text into sentences for progressive display
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…»])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NarratorIntro({
  narratorName,
  narratorRole,
  narratorIntro,
  playerLanguage,
  onComplete,
}: NarratorIntroProps) {
  const [isSpeechAvailable, setIsSpeechAvailable] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [visibleSentenceIndex, setVisibleSentenceIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordListRef = useRef<string[]>([]);
  const sentences = splitSentences(narratorIntro);

  // Build flat word list with sentence boundary tracking
  const sentenceBoundaries = useRef<number[]>([]);

  useEffect(() => {
    // Build word list and sentence boundaries
    const words: string[] = [];
    const boundaries: number[] = [];
    sentences.forEach((sentence) => {
      const sentenceWords = sentence.split(/\s+/).filter(Boolean);
      boundaries.push(words.length); // first word index of this sentence
      words.push(...sentenceWords);
    });
    wordListRef.current = words;
    sentenceBoundaries.current = boundaries;
  }, [narratorIntro]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fade-in on mount
  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Check speech availability
  useEffect(() => {
    setIsSpeechAvailable(
      typeof window !== "undefined" && "speechSynthesis" in window
    );
  }, []);

  const handleSkip = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    onComplete();
  }, [onComplete]);

  const startNarration = useCallback(() => {
    if (!isSpeechAvailable) return;

    const synth = window.speechSynthesis;
    synth.cancel(); // reset any pending speech

    const utterance = new SpeechSynthesisUtterance(narratorIntro);
    utterance.lang = getLang(playerLanguage);
    utterance.rate = 0.9;
    utterance.pitch = 0.85;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setCurrentWordIndex(0);
    };

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === "word") {
        // Estimate word index from char position
        const charIndex = event.charIndex;
        const textBefore = narratorIntro.slice(0, charIndex);
        const wordIdx = textBefore.split(/\s+/).filter(Boolean).length;
        setCurrentWordIndex(wordIdx);

        // Update visible sentence: find which sentence this word belongs to
        const boundaries = sentenceBoundaries.current;
        let sentenceIdx = 0;
        for (let i = 0; i < boundaries.length; i++) {
          if (wordIdx >= boundaries[i]) {
            sentenceIdx = i;
          } else {
            break;
          }
        }
        setVisibleSentenceIndex(sentenceIdx);
      }
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setCurrentWordIndex(-1);
      completeTimerRef.current = setTimeout(onComplete, 1500);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    utteranceRef.current = utterance;

    // Chrome bug: voices may not be loaded immediately
    const speak = () => synth.speak(utterance);
    if (synth.getVoices().length === 0) {
      synth.addEventListener("voiceschanged", speak, { once: true });
    } else {
      speak();
    }
  }, [isSpeechAvailable, narratorIntro, playerLanguage, onComplete]);

  // Auto-start narration when component mounts and speech is available
  useEffect(() => {
    if (isSpeechAvailable) {
      // Small delay to let the fade-in animation start first
      const t = setTimeout(startNarration, 600);
      return () => {
        clearTimeout(t);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      };
    }
  }, [isSpeechAvailable, startNarration]);

  // Compute word indices for highlighted rendering
  const getWordGlobalIndex = (sentenceIdx: number, wordIdx: number): number => {
    return (sentenceBoundaries.current[sentenceIdx] ?? 0) + wordIdx;
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gray-950 transition-opacity duration-700 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Atmospheric background grain */}
      <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iLjY1IiBudW1PY3RhdmVzPSIzIiBzdGl0Y2hUaWxlcz0ic3RpdGNoIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiBmaWx0ZXI9InVybCgjYSkiIG9wYWNpdHk9IjEiLz48L3N2Zz4=')]" />

      <div className="relative z-10 max-w-2xl w-full mx-4">
        {/* Narrator card */}
        <div className="bg-gray-900 border border-amber-900/40 rounded-2xl shadow-2xl shadow-amber-900/10 overflow-hidden">
          {/* Header */}
          <div className="bg-gray-800/60 border-b border-amber-900/30 px-6 py-5 flex items-center gap-4">
            {/* Avatar + animated mic */}
            <div className="relative flex-shrink-0">
              <div className="text-4xl select-none">🕯️</div>
              {isSpeaking && (
                <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
              )}
            </div>

            <div>
              <p className="text-amber-400 font-semibold text-lg leading-tight tracking-wide">
                {narratorName}
              </p>
              <p className="text-amber-200/50 text-sm italic mt-0.5">
                {narratorRole}
              </p>
            </div>

            {/* Mic icon */}
            {isSpeaking && (
              <div className="ml-auto flex items-center gap-1.5 text-amber-500/70">
                <svg
                  className="w-4 h-4 animate-pulse"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9v-2a9 9 0 009-9h-2a7 7 0 01-14 0H3a9 9 0 009 9v2z" />
                </svg>
                <span className="text-xs uppercase tracking-widest">
                  narration
                </span>
              </div>
            )}
          </div>

          {/* Narration text */}
          <div className="px-6 py-6 min-h-[200px]">
            {isSpeechAvailable ? (
              <div className="space-y-3">
                {sentences.map((sentence, sIdx) => {
                  const isVisible =
                    sIdx <= visibleSentenceIndex || !isSpeaking;
                  const words = sentence.split(/\s+/).filter(Boolean);
                  return (
                    <p
                      key={sIdx}
                      className={`text-base leading-relaxed transition-opacity duration-500 ${
                        isVisible ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      {words.map((word, wIdx) => {
                        const globalIdx = getWordGlobalIndex(sIdx, wIdx);
                        const isCurrentWord =
                          isSpeaking && globalIdx === currentWordIndex;
                        return (
                          <span
                            key={wIdx}
                            className={`transition-colors duration-100 ${
                              isCurrentWord
                                ? "text-amber-400 font-semibold"
                                : "text-amber-50/90"
                            }`}
                          >
                            {word}
                            {wIdx < words.length - 1 ? " " : ""}
                          </span>
                        );
                      })}
                    </p>
                  );
                })}
              </div>
            ) : (
              // Fallback: speech not available — display full text
              <p className="text-amber-50/90 text-base leading-relaxed">
                {narratorIntro}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-amber-900/20 flex justify-between items-center bg-gray-900/60">
            {/* Decorative ornament */}
            <span className="text-amber-900/40 text-xs tracking-[0.3em] uppercase select-none">
              ✦ Escape Game ✦
            </span>

            {isSpeechAvailable ? (
              <button
                onClick={handleSkip}
                className="text-amber-200/50 hover:text-amber-200 text-sm transition-colors duration-200 underline underline-offset-2"
              >
                Passer →
              </button>
            ) : (
              <button
                onClick={onComplete}
                className="bg-amber-700 hover:bg-amber-600 text-amber-50 text-sm px-4 py-1.5 rounded-lg transition-colors duration-200"
              >
                Continuer →
              </button>
            )}
          </div>
        </div>

        {/* Subtle progress dots */}
        {isSpeaking && (
          <div className="flex justify-center gap-1.5 mt-4">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-amber-600/60 animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
