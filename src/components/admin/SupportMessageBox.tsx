"use client";

import { useEffect, useState } from "react";
import { Send, MessageCircle, Check, Clock } from "lucide-react";

interface SupportMessage {
  id: string;
  from_admin: boolean;
  text: string;
  read_at: string | null;
  created_at: string;
}

interface Props {
  sessionId: string;
  /** Si la session est terminée, on désactive l'envoi mais on garde l'historique. */
  sessionActive: boolean;
}

const TEMPLATES = [
  "Tu n'es pas tout à fait au bon endroit, regarde la carte sur ton écran.",
  "Le lieu est plus à l'Est — prends la prochaine rue à gauche.",
  "Ouvre le Mode AR (bouton violet) pour voir la réponse sur le mur.",
  "Pense à accepter la permission caméra ET boussole dans le navigateur.",
  "Si tu rencontres un souci technique, contacte-nous : support@oddballtrip.com",
];

export function SupportMessageBox({ sessionId, sessionActive }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<SupportMessage[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/message`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.messages ?? []);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    fetchHistory();
    // Refresh history toutes les 15s pour voir si le joueur a lu
    const iv = setInterval(fetchHistory, 15_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = async (msgText?: string) => {
    const t = (msgText ?? text).trim();
    if (!t) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setText("");
      await fetchHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur envoi");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-700/40 bg-gradient-to-br from-amber-950/30 to-zinc-950 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-amber-300" />
        <h2 className="text-sm font-bold text-amber-200">
          Envoyer un message au joueur
        </h2>
        {!sessionActive && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">
            session terminée — historique seulement
          </span>
        )}
      </div>

      {sessionActive && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex : tu es à 80m au Nord, prends la rue à droite vers la Cathédrale."
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500">{text.length}/500</span>
            <button
              disabled={!text.trim() || sending}
              onClick={() => send()}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Clock className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Envoyer
            </button>
          </div>
          {err && (
            <p className="text-xs text-red-400">{err}</p>
          )}

          {/* Quick templates */}
          <div className="space-y-1.5 pt-1">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              Modèles rapides
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tpl, i) => (
                <button
                  key={i}
                  onClick={() => send(tpl)}
                  disabled={sending}
                  className="text-left rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-400 hover:border-amber-700/60 hover:text-amber-200 hover:bg-amber-900/20 disabled:opacity-50"
                  title={tpl}
                >
                  {tpl.length > 50 ? tpl.slice(0, 47) + "…" : tpl}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-800">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">
            Historique ({history.length})
          </p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {history.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-zinc-200 flex-1">{m.text}</p>
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                    {new Date(m.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 text-[10px]">
                  {m.read_at ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <Check className="h-2.5 w-2.5" /> lu{" "}
                      {new Date(m.read_at).toLocaleTimeString()}
                    </span>
                  ) : (
                    <span className="text-zinc-500">non lu</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
