"use client";

import { useEffect, useState } from "react";
import { X, Volume2, VolumeX } from "lucide-react";
import { useNarration } from "@/hooks/useNarration";

interface ARCharacterSpeakerProps {
  /** True when the player is locked on target (close + aligned) */
  lockedOn: boolean;
  /** Character visual style */
  characterType: "monk" | "knight" | "pirate" | "wizard" | "scholar" | "merchant" | string;
  /** Speech bubble text */
  dialogue: string;
  /** Step key — dismissal resets when step changes */
  stepKey: string | null;
  /** Player's UI locale, used to pick the right TTS voice */
  locale?: string;
}

// ▸ Character visual by type — emoji + accent colour gradient.
//   Pure CSS for zero-asset MVP. Can be upgraded to 3D GLB later.
const CHARACTERS: Record<
  string,
  { emoji: string; bg: string; accent: string; name: string }
> = {
  monk: { emoji: "🧙", bg: "from-amber-800 to-amber-950", accent: "border-amber-400", name: "Le Moine" },
  knight: { emoji: "🛡️", bg: "from-slate-700 to-slate-900", accent: "border-slate-300", name: "Le Chevalier" },
  pirate: { emoji: "🏴‍☠️", bg: "from-rose-900 to-slate-950", accent: "border-rose-400", name: "Le Pirate" },
  wizard: { emoji: "🔮", bg: "from-purple-800 to-indigo-950", accent: "border-violet-400", name: "Le Mage" },
  scholar: { emoji: "📜", bg: "from-sky-800 to-slate-950", accent: "border-sky-300", name: "L'Érudit" },
  merchant: { emoji: "💰", bg: "from-emerald-800 to-slate-950", accent: "border-emerald-300", name: "Le Marchand" },
  ghost: { emoji: "👻", bg: "from-slate-600 to-slate-900", accent: "border-slate-200", name: "Le Fantôme" },
  default: { emoji: "✨", bg: "from-indigo-800 to-slate-950", accent: "border-indigo-300", name: "Le Gardien" },
};

/**
 * A whimsical character bursts in when the player is locked on the target.
 * A serif speech bubble delivers a short atmospheric clue (or custom
 * dialogue set via admin). The player can dismiss the bubble, which hides
 * the character until the next step.
 */
export function ARCharacterSpeaker({
  lockedOn,
  characterType,
  dialogue,
  stepKey,
  locale = "fr",
}: ARCharacterSpeakerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { speak, stop, speaking, supported } = useNarration(locale);

  // Reset the dismissed state when the player moves to a new step
  useEffect(() => {
    setDismissed(false);
    setMounted(false);
    stop(); // stop any running narration when switching steps
  }, [stepKey, stop]);

  // Show the character only once per step, after a small delay so the
  // player sees the chest first, then the character appears.
  useEffect(() => {
    if (lockedOn && !mounted && !dismissed) {
      const t = setTimeout(() => setMounted(true), 1400);
      return () => clearTimeout(t);
    }
    if (!lockedOn) {
      setMounted(false);
    }
  }, [lockedOn, mounted, dismissed]);

  // Stop any narration when the bubble is dismissed
  useEffect(() => {
    if (dismissed) stop();
  }, [dismissed, stop]);

  if (!dialogue || dismissed || !mounted) return null;

  const char = CHARACTERS[characterType] || CHARACTERS.default;

  return (
    <>
      <div
        className="pointer-events-auto absolute bottom-36 left-4 right-4 z-[15] mx-auto flex max-w-md items-end gap-3"
        style={{ animation: "ar-char-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        {/* Character avatar */}
        <div
          className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 bg-gradient-to-br ${char.bg} ${char.accent} shadow-2xl`}
          style={{
            animation: "ar-char-float 3s ease-in-out infinite",
            filter: "drop-shadow(0 0 16px rgba(99, 102, 241, 0.4))",
          }}
        >
          <span
            className="text-4xl"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
          >
            {char.emoji}
          </span>
          {/* Name tag */}
          <span
            className={`absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-slate-950/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-100 ${char.accent}`}
          >
            {char.name}
          </span>
        </div>

        {/* Speech bubble */}
        <div className="relative flex-1 rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-slate-950/95 to-slate-900/95 p-3 pr-8 shadow-xl backdrop-blur-md">
          {/* Bubble tail */}
          <span
            className="absolute -left-2 bottom-6 h-4 w-4 rotate-45 border-b-2 border-l-2 border-amber-400/60 bg-slate-950/95"
            aria-hidden="true"
          />
          <button
            onClick={() => {
              setDismissed(true);
              setMounted(false);
            }}
            aria-label="Dismiss"
            className="absolute right-1 top-1 rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {/* Play/Stop narration — uses browser's native TTS (free, robotic
              voice for now; ElevenLabs upgrade comes later). Only shown when
              the platform supports speech synthesis. */}
          {supported && (
            <button
              onClick={() => speak(dialogue)}
              aria-label={speaking ? "Stop narration" : "Play narration"}
              className={`absolute right-1 top-7 rounded-full p-1 transition-colors ${
                speaking
                  ? "bg-amber-500/30 text-amber-200 animate-pulse"
                  : "text-amber-400/70 hover:bg-amber-500/20 hover:text-amber-200"
              }`}
            >
              {speaking ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          <p
            className="text-sm italic leading-snug text-amber-50"
            style={{ fontFamily: '"Crimson Text", "Georgia", serif' }}
          >
            “{dialogue}”
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes ar-char-in {
          0% { opacity: 0; transform: translateY(40px) scale(0.7); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ar-char-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
}
