"use client";

/**
 * End-of-tour restaurant suggestion panel — DORMANT.
 * Not imported anywhere yet. Shows 3 "local favorite" restaurants in a
 * warm, celebratory card stack when the player has just completed the tour.
 */

import { Star, MapPin, UtensilsCrossed } from "lucide-react";
import type { Suggestion } from "@/lib/suggestion-generator";

interface EndOfTourSuggestionsProps {
  suggestion: Suggestion;
  onRestaurantClick?: (restaurantId: string) => void;
}

export function EndOfTourSuggestions({
  suggestion,
  onRestaurantClick,
}: EndOfTourSuggestionsProps) {
  if (suggestion.restaurants.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-950/95 via-slate-950/95 to-slate-950/95 p-4 shadow-2xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
          <UtensilsCrossed className="h-5 w-5 text-amber-300" />
        </div>
        <div className="flex-1">
          <p className="text-sm leading-relaxed text-amber-50">
            {suggestion.message}
          </p>
        </div>
      </div>

      {/* Restaurant cards */}
      <div className="space-y-2">
        {suggestion.restaurants.map((r) => (
          <a
            key={r.id}
            href={r.bookingUrl || "#"}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => onRestaurantClick?.(r.id)}
            className="block rounded-xl border border-amber-500/20 bg-slate-900/80 p-3 transition hover:border-amber-400/60 hover:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-amber-50">
                  {r.name}
                </p>
                {r.cuisine && (
                  <p className="truncate text-xs text-amber-200/70">
                    {r.cuisine}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-amber-200/60">
                  <span className="inline-flex items-center gap-0.5">
                    <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                    {r.rating.toFixed(1)}
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-2.5 w-2.5" />
                    {r.distanceMeters < 1000
                      ? `${r.distanceMeters}m`
                      : `${(r.distanceMeters / 1000).toFixed(1)}km`}
                  </span>
                  {r.priceLevel !== null && r.priceLevel !== undefined && r.priceLevel > 0 && (
                    <>
                      <span>•</span>
                      <span>{"€".repeat(r.priceLevel)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {r.discountPercent > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    −{r.discountPercent}%
                  </span>
                )}
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  {suggestion.cta} →
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* Partner disclosure */}
      <p className="text-right text-[9px] uppercase tracking-wider text-amber-200/40">
        {suggestion.disclaimerLabel}
      </p>
    </div>
  );
}
