"use client";

/**
 * TruthReveal — shown on the results page ONLY when the player either gave
 * up on the final code or got it wrong. Reveals every step's correct answer
 * so the player can see where they tripped, plus the riddle title as context.
 *
 * Shown above the epilogue — the idea is: "You didn't get the final code?
 * That's OK — here's what the truth was. Now enjoy the story anyway."
 */

import { CheckCircle2, Eye } from "lucide-react";
import { tt } from "@/lib/translations";

interface TruthRevealProps {
  steps: {
    title: string;
    answer: string | null;
  }[];
  locale?: string;
}

export function TruthReveal({ steps, locale = "fr" }: TruthRevealProps) {
  return (
    <div className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-950/60 via-slate-950 to-slate-950 p-6 shadow-xl">
      <div className="flex items-center justify-center gap-2 text-rose-300">
        <Eye className="h-5 w-5" />
        <span className="text-xs uppercase tracking-[0.25em]">
          {tt('truth.heading', locale)}
        </span>
      </div>

      <p className="mt-3 text-center text-sm italic text-rose-100/80">
        {tt('truth.intro', locale)}
      </p>

      <ul className="mt-5 space-y-2">
        {steps.map((s, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-lg border border-rose-500/15 bg-slate-900/50 p-3"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs uppercase tracking-wider text-rose-300/60">
                {tt('truth.stepLabel', locale)} {i + 1} — {s.title}
              </p>
              <p className="mt-0.5 text-sm text-amber-200">
                {tt('truth.was', locale)}{" "}
                <span className="font-mono font-bold text-amber-100">
                  {s.answer ?? "—"}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
