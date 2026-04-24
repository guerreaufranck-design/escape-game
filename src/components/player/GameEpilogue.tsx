"use client";

/**
 * GameEpilogue — the narrative finale shown on the results page BEFORE the
 * score / stats / selfie. This is the "dessert of the meal" — the player's
 * real reward, where they learn the true story that ties the whole adventure
 * together.
 *
 * Design choices:
 *   - Paragraphs reveal progressively (soft fade-in, not character-by-character
 *     which would feel gimmicky on 500 words)
 *   - Serif typography to evoke a book / manuscript
 *   - Warm amber palette (parchment aesthetic)
 *   - Optional illustration at the top
 *   - Collapsible "Read the story" control so long epilogues don't wall off
 *     the rest of the results; auto-expanded on first visit.
 */

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

interface GameEpilogueProps {
  title: string;
  text: string;
  imageUrl?: string | null;
  /** Optional intro line shown above the title, e.g. "✓ Code final trouvé !" */
  overline?: string;
}

export function GameEpilogue({
  title,
  text,
  imageUrl = null,
  overline,
}: GameEpilogueProps) {
  // Split the text into paragraphs (on double newline, single newline fallback)
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Reveal paragraphs one by one so the story feels like it's being told
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= paragraphs.length) clearInterval(interval);
    }, 650);
    return () => clearInterval(interval);
  }, [text, paragraphs.length]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/80 via-slate-950 to-slate-950 shadow-2xl">
      {/* Decorative top accent */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.6), transparent)",
        }}
      />

      {imageUrl && (
        <div className="relative aspect-[21/9] w-full overflow-hidden border-b border-amber-500/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: "sepia(0.35) contrast(1.05) brightness(0.95)" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
        </div>
      )}

      <div className="space-y-5 p-6 sm:p-8">
        {overline && (
          <p className="text-center text-xs font-bold uppercase tracking-[0.3em] text-emerald-300/90">
            {overline}
          </p>
        )}

        <div className="flex items-center justify-center gap-2 text-amber-400">
          <BookOpen className="h-5 w-5" />
          <span className="text-xs uppercase tracking-[0.25em]">
            L&apos;Épilogue
          </span>
        </div>

        <h2
          className="text-center text-2xl font-bold leading-tight text-amber-100 sm:text-3xl"
          style={{
            fontFamily: '"Cinzel", "Trajan Pro", "Georgia", serif',
            letterSpacing: "0.03em",
            textShadow: "0 2px 18px rgba(251, 191, 36, 0.25)",
          }}
        >
          {title}
        </h2>

        <div className="mx-auto max-w-2xl space-y-4">
          {paragraphs.map((para, i) => (
            <p
              key={i}
              className={`text-base leading-relaxed text-amber-50/90 transition-all duration-700 sm:text-lg ${
                i < visibleCount
                  ? "translate-y-0 opacity-100"
                  : "translate-y-2 opacity-0"
              }`}
              style={{
                fontFamily: '"Crimson Text", "Georgia", serif',
                textAlign: i === 0 ? "center" : "justify",
                fontStyle: i === 0 ? "italic" : "normal",
              }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Bottom flourish */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <span className="h-px w-16 bg-amber-500/30" />
          <span className="text-amber-500/50">✦</span>
          <span className="h-px w-16 bg-amber-500/30" />
        </div>
      </div>
    </div>
  );
}
