"use client";

import { MessageCircle, X } from "lucide-react";
import type { SupportMessage } from "@/hooks/useSupportMessages";

interface Props {
  message: SupportMessage | null;
  onDismiss: (id: string) => void;
}

/**
 * Overlay non-intrusif en haut de l'écran (au-dessus de tout le reste,
 * AR caméra incluse) qui affiche un message envoyé par le support
 * OddballTrip. Le joueur tape "Compris" pour le faire disparaître et
 * marquer comme lu.
 *
 * Design intentionnel : pas de modal bloquant — le joueur peut continuer
 * à jouer. Le message reste affiché jusqu'au dismiss. Si l'admin en
 * envoie un autre, le hook les met en queue et on en affiche un à la
 * fois (le suivant remplace le précédent une fois dismissé).
 */
export function SupportMessageOverlay({ message, onDismiss }: Props) {
  if (!message) return null;
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
                Message du support OddballTrip
              </p>
              <p className="mt-1 text-sm text-amber-50 leading-relaxed">
                {message.text}
              </p>
            </div>
            <button
              onClick={() => onDismiss(message.id)}
              aria-label="Fermer"
              className="flex-shrink-0 rounded-full p-1 hover:bg-amber-400/20 transition-colors"
            >
              <X className="h-4 w-4 text-amber-300" />
            </button>
          </div>
          <button
            onClick={() => onDismiss(message.id)}
            className="mt-3 w-full rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 transition-colors"
          >
            Compris, merci
          </button>
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
