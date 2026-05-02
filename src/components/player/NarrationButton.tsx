"use client";

import { Volume2, VolumeX } from "lucide-react";
import { tt } from "@/lib/translations";

interface NarrationButtonProps {
  text: string;
  speaking: boolean;
  currentText: string;
  onSpeak: (text: string) => void;
  /**
   * Visual variant:
   *   - "icon" (default): small speaker icon, inline next to a heading.
   *     Use this when the audio is secondary to a label nearby.
   *   - "pill": prominent pill button with icon + label "Listen / Stop"
   *     translated to the player's locale. Use this on cards where the
   *     audio is the main affordance (riddle, anecdote, briefing) so
   *     players don't miss it.
   */
  variant?: "icon" | "pill";
  /** Used only by the pill variant to translate "Listen" / "Stop". */
  locale?: string;
  size?: "sm" | "md";
}

export function NarrationButton({
  text,
  speaking,
  currentText,
  onSpeak,
  variant = "icon",
  locale = "fr",
  size = "sm",
}: NarrationButtonProps) {
  const isPlaying = speaking && currentText === text;

  if (variant === "pill") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSpeak(text);
        }}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all ${
          isPlaying
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-[0_0_14px_rgba(52,211,153,0.35)] animate-pulse"
            : "bg-emerald-500/15 text-emerald-200 border border-emerald-500/35 hover:bg-emerald-500/25 hover:border-emerald-400/60"
        }`}
        title={isPlaying ? tt("play.audio.stop", locale) : tt("play.audio.listen", locale)}
      >
        {isPlaying ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
        <span>
          {isPlaying ? tt("play.audio.stop", locale) : tt("play.audio.listen", locale)}
        </span>
      </button>
    );
  }

  // Default icon variant — small, inline
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const padding = size === "sm" ? "p-1.5" : "p-2";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSpeak(text);
      }}
      className={`${padding} rounded-lg transition-colors shrink-0 ${
        isPlaying
          ? "bg-emerald-500/20 text-emerald-400 animate-pulse"
          : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
      }`}
      title={isPlaying ? tt("play.audio.stop", locale) : tt("play.audio.listen", locale)}
    >
      {isPlaying ? (
        <VolumeX className={iconSize} />
      ) : (
        <Volume2 className={iconSize} />
      )}
    </button>
  );
}
