"use client";

import { useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import type { SupportMessage } from "@/hooks/useSupportMessages";
import { tt } from "@/lib/translations";

interface Props {
  message: SupportMessage | null;
  sessionId: string | null | undefined;
  onDismiss: (id: string) => void;
  /** White-label : nom de la marque (défaut OddballTrip). */
  brandName?: string;
  /** Langue du JOUEUR : les libellés de l'overlay s'affichent dedans. */
  locale?: string;
}

/**
 * Overlay non-intrusif en haut de l'écran qui affiche un message envoyé par
 * le support OddballTrip. Le joueur peut :
 *   - Tapper "Compris" pour fermer (= marqué comme lu)
 *   - Tapper "Répondre" pour ouvrir un input et envoyer une réponse
 *
 * Contrainte (back-end) : le joueur ne peut envoyer une réponse QUE si
 * l'admin a déjà envoyé au moins un message dans la session. Ici, ce
 * composant ne s'affiche QUE quand on a un message admin → la contrainte
 * est naturellement respectée.
 */
export function SupportMessageOverlay({ message, sessionId, onDismiss, brandName = "OddballTrip", locale = "en" }: Props) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!message) return null;
  // Le hook filtre déjà : queue ne contient QUE des messages admin.
  if (!message.from_admin) return null;

  const sendReply = async () => {
    const t = replyText.trim();
    if (!t || !sessionId) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/game/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setSent(true);
      setReplyText("");
      // Auto-dismiss 2s après envoi réussi
      setTimeout(() => onDismiss(message.id), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur envoi");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[10000] pointer-events-auto animate-slide-down">
      <div className="mx-auto max-w-lg p-3">
        <div className="rounded-xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-950/95 via-amber-900/90 to-amber-950/95 shadow-2xl backdrop-blur-md p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <div className="rounded-full bg-amber-400/20 border border-amber-400/40 p-1.5">
                <MessageCircle className="h-4 w-4 text-amber-200" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200">
                {`${brandName} · ${tt('play.supportLabel', locale)}`}
              </p>
              <p className="mt-1 text-sm text-amber-50 leading-relaxed">
                {message.text}
              </p>
            </div>
            <button
              onClick={() => onDismiss(message.id)}
              aria-label={tt('play.closeBtn', locale)}
              className="flex-shrink-0 rounded-full p-1 hover:bg-amber-400/20 transition-colors"
            >
              <X className="h-4 w-4 text-amber-300" />
            </button>
          </div>

          {/* Reply input (toggleable) */}
          {showReply && (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={tt('play.replyPlaceholder', locale)}
                rows={2}
                maxLength={500}
                disabled={sending || sent}
                className="w-full rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-50 placeholder-amber-300/40 focus:outline-none focus:border-amber-300 disabled:opacity-50"
                autoFocus
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-amber-300/60">
                  {replyText.length}/500
                </span>
                <button
                  onClick={sendReply}
                  disabled={!replyText.trim() || sending || sent}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-950 hover:bg-amber-300 disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  {sent ? tt('play.sentBtn', locale) : sending ? tt('play.sendingBtn', locale) : tt('play.sendBtn', locale)}
                </button>
              </div>
              {err && <p className="text-xs text-red-300">{err}</p>}
            </div>
          )}

          {/* Action buttons */}
          {!sent && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {!showReply && (
                <button
                  onClick={() => setShowReply(true)}
                  className="rounded-lg bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-200 transition-colors"
                >
                  {tt('play.replyBtn', locale)}
                </button>
              )}
              <button
                onClick={() => onDismiss(message.id)}
                className={
                  showReply
                    ? "col-span-2 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 transition-colors"
                    : "rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 transition-colors"
                }
              >
                {tt('play.gotItThanks', locale)}
              </button>
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes slide-down {
          0% { transform: translateY(-100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-down {
          animation: slide-down 300ms ease-out;
        }
      `}</style>
    </div>
  );
}
