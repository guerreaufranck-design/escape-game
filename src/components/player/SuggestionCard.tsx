"use client";

/**
 * Mid-tour restaurant suggestion card — DORMANT.
 * Not imported anywhere yet. Will be wired into the play page once the
 * Fork affiliate program is validated or Google Places is confirmed working.
 */

import { useState } from "react";
import { X, Star, MapPin } from "lucide-react";
import type { Suggestion } from "@/lib/suggestion-generator";

interface SuggestionCardProps {
  suggestion: Suggestion;
  onClick?: () => void;
  onDismiss?: () => void;
}

export function SuggestionCard({
  suggestion,
  onClick,
  onDismiss,
}: SuggestionCardProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const r = suggestion.restaurants[0];
  if (!r) return null;

  return (
    <div
      className="pointer-events-auto relative animate-in slide-in-from-bottom-4 fade-in duration-500 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/95 via-slate-950/95 to-slate-950/95 p-4 shadow-2xl backdrop-blur-md"
    >
      {/* Dismiss */}
      <button
        onClick={() => {
          setDismissed(true);
          onDismiss?.();
        }}
        aria-label="Dismiss suggestion"
        className="absolute right-2 top-2 rounded-full p-1 text-amber-400/60 hover:bg-amber-900/40 hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Main content */}
      <div className="flex items-start gap-3 pr-6">
        <div className="text-2xl">☕</div>
        <div className="flex-1 space-y-2">
          <p className="text-sm leading-relaxed text-amber-50">
            {suggestion.message}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-amber-200/70">
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {r.rating.toFixed(1)}
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {r.distanceMeters < 1000
                  ? `${r.distanceMeters}m`
                  : `${(r.distanceMeters / 1000).toFixed(1)}km`}
              </span>
              {r.discountPercent > 0 && (
                <>
                  <span>•</span>
                  <span className="font-bold text-emerald-300">
                    −{r.discountPercent}%
                  </span>
                </>
              )}
            </div>
            {r.bookingUrl && (
              <a
                href={r.bookingUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={onClick}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-amber-950 transition hover:bg-amber-400"
              >
                {suggestion.cta}
                <span>→</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Partner disclosure — required for transparency */}
      <p className="mt-2 text-right text-[9px] uppercase tracking-wider text-amber-200/40">
        {suggestion.disclaimerLabel}
      </p>
    </div>
  );
}
