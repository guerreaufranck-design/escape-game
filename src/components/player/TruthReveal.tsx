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

interface TruthRevealProps {
  steps: {
    title: string;
    answer: string | null;
  }[];
  locale?: string;
}

const LABELS: Record<string, { heading: string; intro: string; stepLabel: string; truth: string }> = {
  fr: {
    heading: "La Vérité Révélée",
    intro:
      "Tu n'as pas trouvé le code final, mais chaque énigme a sa clé. Voici ce que les pierres murmuraient pour chacun des lieux que tu as visités.",
    stepLabel: "Étape",
    truth: "était",
  },
  en: {
    heading: "The Truth Revealed",
    intro:
      "You didn't crack the final code, but every riddle has its key. Here is what the stones whispered at each place you visited.",
    stepLabel: "Step",
    truth: "was",
  },
  es: {
    heading: "La Verdad Revelada",
    intro:
      "No descifraste el código final, pero cada enigma tiene su clave. Esto es lo que las piedras susurraban en cada lugar que visitaste.",
    stepLabel: "Etapa",
    truth: "era",
  },
  de: {
    heading: "Die Enthüllte Wahrheit",
    intro:
      "Du hast den finalen Code nicht geknackt, aber jedes Rätsel hat seinen Schlüssel. Dies ist, was die Steine an jedem besuchten Ort flüsterten.",
    stepLabel: "Etappe",
    truth: "war",
  },
  it: {
    heading: "La Verità Rivelata",
    intro:
      "Non hai decifrato il codice finale, ma ogni enigma ha la sua chiave. Ecco cosa sussurravano le pietre in ogni luogo che hai visitato.",
    stepLabel: "Tappa",
    truth: "era",
  },
};

export function TruthReveal({ steps, locale = "fr" }: TruthRevealProps) {
  const labels = LABELS[locale] || LABELS.en;

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-950/60 via-slate-950 to-slate-950 p-6 shadow-xl">
      <div className="flex items-center justify-center gap-2 text-rose-300">
        <Eye className="h-5 w-5" />
        <span className="text-xs uppercase tracking-[0.25em]">
          {labels.heading}
        </span>
      </div>

      <p className="mt-3 text-center text-sm italic text-rose-100/80">
        {labels.intro}
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
                {labels.stepLabel} {i + 1} — {s.title}
              </p>
              <p className="mt-0.5 text-sm text-amber-200">
                {labels.truth}{" "}
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
