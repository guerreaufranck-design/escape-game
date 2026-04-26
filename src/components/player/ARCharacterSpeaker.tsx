"use client";

import { useEffect, useState } from "react";
import { X, Volume2, VolumeX } from "lucide-react";
import { useNarration } from "@/hooks/useNarration";
import {
  ALL_AR_CHARACTERS,
  getSpriteUrl,
  pickFallbackGuide,
} from "@/lib/ar-sprites";

interface ARCharacterSpeakerProps {
  /** True when the player is locked on target (close + aligned) */
  lockedOn: boolean;
  /** Character archetype — should match a key in AR_CHARACTERS or "default" */
  characterType: string;
  /** Speech bubble text */
  dialogue: string;
  /** Step key — dismissal resets when step changes */
  stepKey: string | null;
  /** Player's UI locale, used to pick the right TTS voice */
  locale?: string;
}

// Friendly display names + accent colour per archetype.
// Only used for the on-screen name tag and gradient backdrop.
const CHARACTER_META: Record<
  string,
  { name: string; bg: string; accent: string }
> = {
  knight: {
    name: "Le Chevalier",
    bg: "from-slate-700 to-slate-950",
    accent: "border-slate-300",
  },
  witch: {
    name: "La Sorcière",
    bg: "from-purple-900 to-slate-950",
    accent: "border-violet-400",
  },
  monk: {
    name: "Le Moine",
    bg: "from-amber-900 to-amber-950",
    accent: "border-amber-400",
  },
  sailor: {
    name: "Le Marin",
    bg: "from-sky-800 to-slate-950",
    accent: "border-sky-300",
  },
  detective: {
    name: "Le Détective",
    bg: "from-zinc-800 to-zinc-950",
    accent: "border-zinc-300",
  },
  ghost: {
    name: "Le Fantôme",
    bg: "from-slate-600 to-slate-900",
    accent: "border-slate-200",
  },
  guide_male: {
    name: "Le Guide",
    bg: "from-indigo-800 to-slate-950",
    accent: "border-indigo-300",
  },
  guide_female: {
    name: "La Guide",
    bg: "from-rose-800 to-slate-950",
    accent: "border-rose-300",
  },
  default: {
    name: "Le Guide",
    bg: "from-indigo-800 to-slate-950",
    accent: "border-indigo-300",
  },
};

/**
 * Resolve the actual character to render:
 *  - if the type is a known sprite, use it
 *  - if it's "default" or unknown, deterministically pick a guide_male/female
 *    based on stepKey so the same step always shows the same fallback
 */
function resolveCharacter(
  characterType: string,
  stepKey: string | null,
): { type: string; meta: (typeof CHARACTER_META)[string] } {
  if (ALL_AR_CHARACTERS.includes(characterType) && characterType !== "default") {
    return { type: characterType, meta: CHARACTER_META[characterType] || CHARACTER_META.default };
  }
  const fallback = pickFallbackGuide(stepKey || "seed");
  return { type: fallback, meta: CHARACTER_META[fallback] };
}

/**
 * A whimsical character bursts in when the player is locked on the target.
 * A serif speech bubble delivers a short atmospheric clue (or custom
 * dialogue set via admin). The player can dismiss the bubble, which hides
 * the character until the next step.
 *
 * Sprites are pulled from the Supabase `ar-sprites` public bucket. If a
 * sprite fails to load we fall back to a CSS-only gradient + emoji.
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
  const [imageError, setImageError] = useState(false);
  const { speak, stop, speaking, supported } = useNarration(locale);

  // Reset on step change
  useEffect(() => {
    setDismissed(false);
    setMounted(false);
    setImageError(false);
    stop();
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

  useEffect(() => {
    if (dismissed) stop();
  }, [dismissed, stop]);

  if (!dialogue || dismissed || !mounted) return null;

  const { type, meta } = resolveCharacter(characterType, stepKey);
  // Toggle pose between talking (TTS active) and idle (silent) so the
  // character feels alive without any animation library.
  const pose = speaking ? "talking" : "idle";
  const spriteUrl = getSpriteUrl(type, pose);

  return (
    <>
      <div
        className="pointer-events-auto absolute bottom-36 left-4 right-4 z-[15] mx-auto flex max-w-md items-end gap-3"
        style={{ animation: "ar-char-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        {/* Character avatar — full-body sprite over a soft gradient plate */}
        <div
          className={`relative flex h-28 w-24 shrink-0 items-end justify-center overflow-hidden rounded-2xl border-2 bg-gradient-to-br ${meta.bg} ${meta.accent} shadow-2xl`}
          style={{
            animation: "ar-char-float 3s ease-in-out infinite",
            filter: "drop-shadow(0 0 16px rgba(99, 102, 241, 0.4))",
          }}
        >
          {!imageError ? (
            <img
              src={spriteUrl}
              alt={meta.name}
              className="h-full w-full object-contain object-bottom"
              style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))" }}
              onError={() => setImageError(true)}
              draggable={false}
            />
          ) : (
            <span
              className="pb-2 text-5xl"
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
            >
              ✨
            </span>
          )}
          {/* Name tag */}
          <span
            className={`absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-slate-950/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-100 ${meta.accent}`}
          >
            {meta.name}
          </span>
        </div>

        {/* Speech bubble */}
        <div className="relative flex-1 rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-slate-950/95 to-slate-900/95 p-3 pr-8 shadow-xl backdrop-blur-md">
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

          {supported && (
            <button
              onClick={() => (speaking ? stop() : speak(dialogue))}
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
