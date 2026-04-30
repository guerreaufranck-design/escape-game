"use client";

import { useEffect, useState } from "react";
import { Loader2, Languages } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { tt } from "@/lib/translations";

/**
 * Fullscreen transitional loader shown when the player skips a step OR when
 * the next-step content is being fetched (and translated by Gemini for
 * dynamic locales). Without this, players assume the app crashed during
 * the 5-30s wait — see customer report 2026-04-30.
 *
 * The message rotates over time so the user keeps seeing fresh feedback.
 */
interface Props {
  active: boolean;
  locale: Locale;
}

export function StepTransitionOverlay({ active, locale }: Props) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!active) {
      setStage(0);
      return;
    }
    // Rotate reassurance copy as time elapses, so the screen never looks
    // frozen even when the underlying network call is slow.
    const t1 = setTimeout(() => setStage(1), 4000);
    const t2 = setTimeout(() => setStage(2), 12000);
    const t3 = setTimeout(() => setStage(3), 22000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [active]);

  if (!active) return null;

  const stageKey =
    stage === 0
      ? "play.transition.translating"
      : stage === 1
        ? "play.transition.preparingMap"
        : stage === 2
          ? "play.transition.almostThere"
          : "play.transition.notCrashed";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[1500] bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center px-6"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-2xl animate-pulse" />
        <Loader2 className="relative h-16 w-16 text-emerald-400 animate-spin" />
      </div>

      <h2 className="mt-8 text-xl font-bold text-white text-center">
        {tt("play.transition.title", locale)}
      </h2>

      <p className="mt-3 text-sm text-slate-400 text-center max-w-sm">
        {tt("play.transition.subtitle", locale)}
      </p>

      <div className="mt-8 flex items-center gap-2 text-emerald-300 text-sm">
        <Languages className="h-4 w-4 animate-pulse" />
        <span className="transition-opacity duration-500">{tt(stageKey, locale)}</span>
      </div>

      {/* Indeterminate progress bar — communicates "still working" */}
      <div className="mt-10 w-full max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-400"
          style={{
            animation: "transition-progress-slide 1.8s linear infinite",
            backgroundSize: "200% 100%",
          }}
        />
      </div>
      <style jsx>{`
        @keyframes transition-progress-slide {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
