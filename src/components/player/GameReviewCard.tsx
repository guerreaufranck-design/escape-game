"use client";

import { useState } from "react";
import { Star, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { tt } from "@/lib/translations";

interface Props {
  sessionId: string;
  locale?: string;
  brandName?: string;
}

type State = "idle" | "sending" | "done" | "error";

/**
 * Carte d'avis de fin de partie. Le joueur note 1-5★ + laisse un texte.
 *   - 4-5★ → l'avis pourra apparaître en public (page /avis/[slug]).
 *   - ≤3★  → reste privé, remonté en interne (alerte email admin).
 * Le serveur applique la règle ; ici on affiche juste le remerciement adapté.
 */
export function GameReviewCard({ sessionId, locale = "en", brandName = "OddballTrip" }: Props) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<{ isPublic: boolean; slug: string | null }>({ isPublic: false, slug: null });

  const submit = async () => {
    if (rating < 1 || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch(`/api/game/${sessionId}/review?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, text: text.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { isPublic?: boolean; slug?: string | null };
      setResult({ isPublic: !!data.isPublic, slug: data.slug ?? null });
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-5 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
        <p className="text-sm font-semibold text-emerald-100">
          {tt(result.isPublic ? "results.reviewThanksPublic" : "results.reviewThanks", locale)}
        </p>
        {result.isPublic && result.slug && (
          <a
            href={`/avis/${result.slug}`}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 underline hover:text-emerald-200"
          >
            {tt("results.reviewSeePublic", locale)}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
      <p className="text-center text-base font-bold text-white">{tt("results.reviewTitle", locale)}</p>
      <p className="mt-0.5 mb-3 text-center text-xs text-slate-400">{tt("results.reviewSubtitle", locale)}</p>

      {/* Étoiles */}
      <div className="mb-3 flex items-center justify-center gap-1.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n}/5`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="p-1 transition-transform active:scale-90"
          >
            <Star
              className={`h-8 w-8 ${n <= shown ? "fill-amber-400 text-amber-400" : "text-slate-600"}`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={tt("results.reviewPlaceholder", locale)}
        rows={3}
        maxLength={2000}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
      />

      <button
        onClick={submit}
        disabled={rating < 1 || state === "sending"}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {tt(rating < 1 ? "results.reviewPickStars" : "results.reviewSubmit", locale)}
      </button>
      {state === "error" && (
        <p className="mt-2 text-center text-xs text-red-400">{tt("results.reviewError", locale)}</p>
      )}
      <p className="mt-2 text-center text-[10px] text-slate-600">{brandName}</p>
    </div>
  );
}
