"use client";

import { useEffect, useState } from "react";
import { X, Volume2, VolumeX } from "lucide-react";
import { useNarration } from "@/hooks/useNarration";
import {
  ALL_AR_CHARACTERS,
  getSpriteUrl,
  pickFallbackGuide,
} from "@/lib/ar-sprites";
import { tt } from "@/lib/translations";

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
  /**
   * Pre-generated ElevenLabs MP3 URL for this character's dialogue, in
   * the player's chosen language. When provided, plays the MP3 (immersive
   * narrator voice) instead of the browser's Web Speech API. Null = falls
   * back to Web Speech.
   */
  audioUrl?: string | null;
}

// Per-archetype visual style. Display names live in translations.ts under
// `character.*` keys so every locale gets a proper translation; we only
// store accent + aura here.
const CHARACTER_META: Record<
  string,
  { nameKey: string; accent: string; aura: string }
> = {
  knight: {
    nameKey: 'character.knight',
    accent: "border-slate-300",
    aura: "from-slate-400/40 via-slate-500/10 to-transparent",
  },
  witch: {
    nameKey: 'character.witch',
    accent: "border-violet-400",
    aura: "from-violet-500/40 via-purple-500/15 to-transparent",
  },
  monk: {
    nameKey: 'character.monk',
    accent: "border-amber-400",
    aura: "from-amber-500/40 via-orange-500/15 to-transparent",
  },
  sailor: {
    nameKey: 'character.sailor',
    accent: "border-sky-300",
    aura: "from-sky-500/40 via-cyan-500/15 to-transparent",
  },
  detective: {
    nameKey: 'character.detective',
    accent: "border-zinc-300",
    aura: "from-zinc-400/40 via-zinc-500/10 to-transparent",
  },
  ghost: {
    nameKey: 'character.ghost',
    accent: "border-slate-200",
    aura: "from-cyan-300/45 via-blue-400/15 to-transparent",
  },
  princess: {
    nameKey: 'character.princess',
    accent: "border-pink-300",
    aura: "from-pink-400/40 via-fuchsia-400/15 to-transparent",
  },
  peasant: {
    nameKey: 'character.peasant',
    accent: "border-amber-200",
    aura: "from-amber-600/35 via-yellow-700/15 to-transparent",
  },
  soldier: {
    nameKey: 'character.soldier',
    accent: "border-emerald-300",
    aura: "from-green-700/40 via-olive-700/15 to-transparent",
  },
  guide_male: {
    nameKey: 'character.guideMale',
    accent: "border-indigo-300",
    aura: "from-indigo-500/40 via-blue-500/15 to-transparent",
  },
  guide_female: {
    nameKey: 'character.guideFemale',
    accent: "border-rose-300",
    aura: "from-rose-500/40 via-pink-500/15 to-transparent",
  },
  default: {
    nameKey: 'character.guideMale',
    accent: "border-indigo-300",
    aura: "from-indigo-500/40 via-blue-500/15 to-transparent",
  },
};

function resolveCharacter(
  characterType: string,
  stepKey: string | null,
): { type: string; meta: (typeof CHARACTER_META)[string] } {
  if (ALL_AR_CHARACTERS.includes(characterType) && characterType !== "default") {
    return {
      type: characterType,
      meta: CHARACTER_META[characterType] || CHARACTER_META.default,
    };
  }
  const fallback = pickFallbackGuide(stepKey || "seed");
  return { type: fallback, meta: CHARACTER_META[fallback] };
}

/**
 * Cinematic AR character reveal. When the player locks on the target,
 * the assigned archetype materialises ON THE FULL SCREEN with a soft
 * radial aura, and the dialogue bubble appears below. The small avatar
 * thumbnail in the corner is gone — this is now THE moment.
 *
 * Layout:
 *   ┌─────────────────────┐
 *   │                     │
 *   │   [BIG CHARACTER]   │  ← centred, ~55% of screen height
 *   │       PNG           │
 *   │                     │
 *   │ ─────────────────── │
 *   │ "I have served..."  │  ← speech bubble below
 *   │                     │
 *   └─────────────────────┘
 *
 * Sprites pulled from the Supabase `ar-sprites` bucket. Pose toggles
 * idle ↔ talking based on TTS playback.
 */
export function ARCharacterSpeaker({
  lockedOn,
  characterType,
  dialogue,
  stepKey,
  locale = "fr",
  audioUrl = null,
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

  useEffect(() => {
    if (lockedOn && !mounted && !dismissed) {
      const t = setTimeout(() => setMounted(true), 800);
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
  const pose = speaking ? "talking" : "idle";
  const spriteUrl = getSpriteUrl(type, pose);
  const characterName = tt(meta.nameKey, locale);

  return (
    <>
      {/* Backdrop dim — focuses attention on the character */}
      <div
        className="pointer-events-none absolute inset-0 z-[14] bg-gradient-to-b from-black/60 via-black/30 to-black/80"
        style={{ animation: "ar-char-fade 600ms ease-out" }}
      />

      {/* Full-screen cinematic stage */}
      <div className="pointer-events-none absolute inset-0 z-[15] flex flex-col items-center justify-center px-4 pt-12 pb-6">
        {/* Character + aura */}
        <div
          className="relative pointer-events-auto"
          style={{ animation: "ar-char-in 700ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {/* Soft radial aura behind the sprite */}
          <div
            className={`pointer-events-none absolute inset-0 -m-12 rounded-full bg-gradient-radial ${meta.aura} blur-2xl`}
            style={{
              background: `radial-gradient(circle, ${meta.aura.includes("amber") ? "rgba(251,191,36,0.35)" : meta.aura.includes("violet") ? "rgba(167,139,250,0.35)" : meta.aura.includes("sky") ? "rgba(125,211,252,0.35)" : meta.aura.includes("rose") ? "rgba(251,113,133,0.35)" : meta.aura.includes("cyan") ? "rgba(103,232,249,0.35)" : "rgba(165,180,252,0.35)"} 0%, transparent 70%)`,
              animation: "ar-char-pulse 3s ease-in-out infinite",
            }}
          />

          {/* Character sprite — large, full-body */}
          <div
            className="relative flex items-end justify-center"
            style={{
              height: "min(58vh, 520px)",
              width: "min(58vh, 520px)",
              animation: "ar-char-float 4s ease-in-out infinite",
            }}
          >
            {!imageError ? (
              <img
                src={spriteUrl}
                alt={characterName}
                className="h-full w-full object-contain object-bottom select-none"
                style={{
                  filter:
                    "drop-shadow(0 6px 20px rgba(0,0,0,0.55)) drop-shadow(0 0 30px rgba(255,255,255,0.08))",
                }}
                onError={() => setImageError(true)}
                draggable={false}
              />
            ) : (
              <span
                className="text-[12rem]"
                style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.6))" }}
              >
                ✨
              </span>
            )}
          </div>

          {/* Name tag — sits at the character's feet */}
          <span
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-slate-950/95 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-100 shadow-lg ${meta.accent}`}
          >
            {characterName}
          </span>
        </div>

        {/* Speech bubble — below character, full-width on small screens */}
        <div
          className="pointer-events-auto relative mt-4 w-full max-w-md rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-slate-950/95 to-slate-900/95 p-4 pr-10 shadow-2xl backdrop-blur-md"
          style={{ animation: "ar-bubble-in 600ms 200ms backwards ease-out" }}
        >
          {/* Bubble tail pointing UP toward character */}
          <span
            className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l-2 border-t-2 border-amber-400/60 bg-slate-950/95"
            aria-hidden="true"
          />

          <button
            onClick={() => {
              setDismissed(true);
              setMounted(false);
            }}
            aria-label={tt('ar.dismissCharacter', locale)}
            className="absolute right-1.5 top-1.5 rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          {supported && (
            <button
              onClick={() =>
                speaking
                  ? stop()
                  : speak(dialogue, audioUrl ? { audioUrl } : undefined)
              }
              aria-label={speaking ? tt('ar.stopNarration', locale) : tt('ar.playNarration', locale)}
              className={`absolute right-1.5 top-9 rounded-full p-1 transition-colors ${
                speaking
                  ? "bg-amber-500/30 text-amber-200 animate-pulse"
                  : "text-amber-400/80 hover:bg-amber-500/20 hover:text-amber-200"
              }`}
            >
              {speaking ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
          )}

          <p
            className="text-base leading-relaxed text-amber-50"
            style={{ fontFamily: '"Crimson Text", "Georgia", serif' }}
          >
            <span className="text-amber-300/80">“</span>
            {dialogue}
            <span className="text-amber-300/80">”</span>
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes ar-char-fade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes ar-char-in {
          0% { opacity: 0; transform: translateY(60px) scale(0.85); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ar-bubble-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ar-char-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes ar-char-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>
    </>
  );
}
