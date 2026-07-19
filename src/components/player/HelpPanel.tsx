"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircle, X, ChevronDown, Send } from "lucide-react";
import { tt } from "@/lib/translations";

interface Props {
  sessionId: string;
  locale?: string;
  /** White-label : nom de la marque (défaut OddballTrip). */
  brandName?: string;
  /** Masqué quand un overlay plein écran est ouvert (ex. caméra AR). */
  hidden?: boolean;
}

/** FAQ statique — répond OFFLINE aux questions récurrentes (son, ticket, GPS,
 *  indices, pause). Chaque item pointe vers 2 clés i18n (question / réponse). */
const FAQ: Array<{ q: string; a: string }> = [
  { q: "play.faqAudioQ", a: "play.faqAudioA" },
  { q: "play.faqTicketQ", a: "play.faqTicketA" },
  { q: "play.faqGpsQ", a: "play.faqGpsA" },
  { q: "play.faqHintsQ", a: "play.faqHintsA" },
  { q: "play.faqPauseQ", a: "play.faqPauseA" },
];

type SendState = "idle" | "sending" | "sent" | "queued" | "error";

/**
 * Aide in-game (Phase 1). Bouton flottant « Besoin d'aide ? » toujours
 * accessible pendant la partie. Ouvre un panneau avec :
 *   - une FAQ qui marche SANS réseau (cause n°1 des remboursements = son + GPS),
 *   - un champ de contact qui met le message en file locale si offline et
 *     l'envoie automatiquement à la reconnexion (POST /api/game/[id]/help),
 *     ce qui déclenche aussi un mail d'escalade à l'admin.
 */
export function HelpPanel({ sessionId, locale = "en", brandName = "OddballTrip", hidden = false }: Props) {
  const [open, setOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<SendState>("idle");

  const queueKey = `help_queue_${sessionId}`;

  /** Poste un message d'aide ; retourne true si accepté par le serveur. */
  const postHelp = useCallback(
    async (t: string): Promise<boolean> => {
      const res = await fetch(`/api/game/${sessionId}/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      return res.ok;
    },
    [sessionId],
  );

  /** Vide la file offline (best-effort). Appelée au montage + event `online`. */
  const flushQueue = useCallback(async () => {
    if (typeof window === "undefined") return;
    let queued: string[];
    try {
      queued = JSON.parse(window.localStorage.getItem(queueKey) || "[]");
    } catch {
      queued = [];
    }
    if (!queued.length) return;
    const remaining: string[] = [];
    for (const t of queued) {
      try {
        const ok = await postHelp(t);
        if (!ok) remaining.push(t);
      } catch {
        remaining.push(t);
      }
    }
    try {
      if (remaining.length) window.localStorage.setItem(queueKey, JSON.stringify(remaining));
      else window.localStorage.removeItem(queueKey);
    } catch {
      /* ignore */
    }
  }, [postHelp, queueKey]);

  useEffect(() => {
    void flushQueue();
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  const queueLocally = useCallback(
    (t: string) => {
      try {
        const cur: string[] = JSON.parse(window.localStorage.getItem(queueKey) || "[]");
        cur.push(t);
        window.localStorage.setItem(queueKey, JSON.stringify(cur));
      } catch {
        /* ignore */
      }
    },
    [queueKey],
  );

  const submit = useCallback(async () => {
    const t = text.trim();
    if (!t || state === "sending") return;
    setState("sending");

    // Offline connu d'avance → file directe, pas d'attente réseau.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queueLocally(t);
      setState("queued");
      setText("");
      return;
    }
    try {
      const ok = await postHelp(t);
      if (ok) {
        setState("sent");
        setText("");
      } else {
        setState("error");
      }
    } catch {
      // Échec réseau → on met en file et on informe le joueur.
      queueLocally(t);
      setState("queued");
      setText("");
    }
  }, [text, state, postHelp, queueLocally]);

  if (hidden) return null;

  return (
    <>
      {/* Bouton flottant — discret, coin bas gauche, au-dessus de la safe area. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={tt("play.helpButton", locale)}
          className="fixed left-3 bottom-24 z-[9500] inline-flex items-center gap-1.5 rounded-full bg-slate-800/90 border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-100 shadow-lg backdrop-blur hover:bg-slate-700 active:scale-95 transition"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <HelpCircle className="h-4 w-4 text-emerald-300" />
          {tt("play.helpButton", locale)}
        </button>
      )}

      {/* Panneau plein écran (bottom-sheet). */}
      {open && (
        <div className="fixed inset-0 z-[9600] flex flex-col justify-end bg-black/50 backdrop-blur-sm">
          <div
            className="mx-auto w-full max-w-lg rounded-t-2xl border-t border-slate-700 bg-slate-900 max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Header */}
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">{brandName}</p>
                <h2 className="text-base font-bold text-white">{tt("play.helpTitle", locale)}</h2>
                <p className="text-xs text-slate-400">{tt("play.helpSubtitle", locale)}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label={tt("play.closeBtn", locale)}
                className="flex-shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-5">
              {/* FAQ offline */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {tt("play.helpFaqTitle", locale)}
                </h3>
                <div className="space-y-2">
                  {FAQ.map((item, i) => {
                    const isOpen = openFaq === i;
                    return (
                      <div key={item.q} className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
                        <button
                          onClick={() => setOpenFaq(isOpen ? null : i)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                        >
                          <span className="text-sm font-semibold text-slate-100">{tt(item.q, locale)}</span>
                          <ChevronDown
                            className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {isOpen && (
                          <p className="px-3 pb-3 text-sm leading-relaxed text-slate-300">{tt(item.a, locale)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Contact */}
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {tt("play.helpContactTitle", locale)}
                </h3>
                <p className="mb-2 text-xs text-slate-500">{tt("play.helpContactHint", locale)}</p>

                {state === "sent" || state === "queued" ? (
                  <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/40 px-3 py-3 text-sm text-emerald-200">
                    {tt(state === "queued" ? "play.helpQueuedOffline" : "play.helpSent", locale)}
                  </div>
                ) : (
                  <>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={tt("play.helpPlaceholder", locale)}
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500">{text.length}/500</span>
                      <button
                        onClick={() => void submit()}
                        disabled={!text.trim() || state === "sending"}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {tt(state === "sending" ? "play.helpSending" : "play.helpSend", locale)}
                      </button>
                    </div>
                    {state === "error" && (
                      <p className="mt-2 text-xs text-red-400">{tt("play.helpError", locale)}</p>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
