"use client";

import { Volume2, VolumeX } from "lucide-react";

interface NarrationButtonProps {
  text: string;
  speaking: boolean;
  currentText: string;
  onSpeak: (text: string) => void;
  size?: "sm" | "md";
}

export function NarrationButton({
  text,
  speaking,
  currentText,
  onSpeak,
  size = "sm",
}: NarrationButtonProps) {
  const isPlaying = speaking && currentText === text;
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
      title={isPlaying ? "Arreter la narration" : "Ecouter"}
    >
      {isPlaying ? (
        <VolumeX className={iconSize} />
      ) : (
        <Volume2 className={iconSize} />
      )}
    </button>
  );
}
