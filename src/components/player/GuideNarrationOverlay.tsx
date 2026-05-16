"use client";

/**
 * Full-screen narration overlay (vision 2026-05-16).
 *
 * Quand le joueur déclenche une narration "guide" (intro, histoire du
 * lieu, énigme finale, explication finale), on lui affiche un overlay
 * plein écran avec le sprite du guide qui "parle" pendant que l'audio
 * joue. À la fin du dialogue, l'overlay se ferme automatiquement et le
 * joueur retourne sur la card texte.
 *
 * Utilisation :
 *   <GuideNarrationOverlay
 *     open={overlayState !== null}
 *     text={overlayState?.text ?? ""}
 *     speaking={narration.speaking}
 *     onClose={() => setOverlayState(null)}
 *   />
 *
 * Le parent gère l'état `open` et le déclenchement de la narration.
 * Cet overlay surveille `speaking` et se ferme tout seul quand l'audio
 * s'arrête (transition de true → false, avec un délai de 800ms pour
 * laisser le dernier mot finir + lui donner le temps de respirer).
 */

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pause, X } from "lucide-react";

interface GuideNarrationOverlayProps {
  open: boolean;
  /** The narration text being read. Shown as scrollable text below the guide. */
  text: string;
  /** Currently speaking — comes from narration.speaking. When transitions
   *  from true to false, the overlay auto-closes after a brief delay. */
  speaking: boolean;
  /** Called when the user dismisses manually OR when audio finishes. */
  onClose: () => void;
  /** Title shown above the text — e.g. "Votre guide", "L'histoire du lieu". */
  title?: string;
  /** Optional URL to a character sprite. Defaults to a generic narrator emoji. */
  characterSprite?: string;
  /** Locale for the close button label. */
  locale?: string;
}

const CLOSE_DELAY_MS = 1200; // let the last word breathe before auto-close

export function GuideNarrationOverlay({
  open,
  text,
  speaking,
  onClose,
  title,
  characterSprite,
  locale = "en",
}: GuideNarrationOverlayProps) {
  // Track if we've ever been speaking — used to detect the speaking →
  // not-speaking transition and trigger the auto-close. Without this
  // we'd auto-close immediately on mount (when speaking starts at false).
  const everSpokeRef = useRef(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Animated dots while speaking
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (speaking) {
      everSpokeRef.current = true;
      // Clear any pending close (user re-played audio)
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    } else if (everSpokeRef.current && open) {
      // Audio finished after having played — schedule auto-close
      closeTimerRef.current = setTimeout(() => {
        onClose();
        everSpokeRef.current = false;
      }, CLOSE_DELAY_MS);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [speaking, open, onClose]);

  // Animated speaking dots
  useEffect(() => {
    if (!speaking) {
      setDots(0);
      return;
    }
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, [speaking]);

  // Reset state when overlay closes
  useEffect(() => {
    if (!open) {
      everSpokeRef.current = false;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }
  }, [open]);

  if (!open) return null;

  const dismissLabel =
    locale === "fr" ? "Fermer" :
    locale === "es" ? "Cerrar" :
    locale === "de" ? "Schließen" :
    locale === "it" ? "Chiudi" :
    "Close";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950"
      style={{ animation: "fadeIn 250ms ease-out" }}
    >
      {/* Top bar with close — discreet, but accessible */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs uppercase tracking-widest text-amber-400/80 font-semibold">
          {title || "🎙️ Narration"}
        </span>
        <button
          onClick={onClose}
          aria-label={dismissLabel}
          className="rounded-full p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Character sprite — "talking head" */}
      <div className="flex justify-center pt-6">
        <div
          className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-amber-500/40 bg-gradient-to-b from-amber-500/20 to-slate-900"
          style={{
            animation: speaking ? "speakingPulse 1.4s ease-in-out infinite" : "none",
          }}
        >
          {characterSprite ? (
            <img
              src={characterSprite}
              alt="Guide"
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">
              🎙️
            </div>
          )}
          {/* Halo glow when speaking */}
          {speaking && (
            <div
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow: "0 0 40px 8px rgba(251, 191, 36, 0.4)",
                animation: "haloFlicker 1.4s ease-in-out infinite",
              }}
            />
          )}
        </div>
      </div>

      {/* Speaking indicator dots */}
      <div className="flex justify-center gap-1.5 pt-3 h-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-amber-400"
            style={{
              opacity: speaking && dots > i ? 1 : 0.25,
              transition: "opacity 0.2s",
            }}
          />
        ))}
      </div>

      {/* Narration text */}
      <div className="flex-1 px-6 pt-5 pb-4 overflow-y-auto">
        <Card className="bg-slate-900/70 border-amber-800/30 max-w-md mx-auto">
          <CardContent className="pt-5">
            <p className="text-slate-200 text-base leading-relaxed whitespace-pre-line text-center">
              {text}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom action — "Pause/Skip" while playing OR "Close" when finished */}
      <div className="px-6 pb-6">
        <Button
          variant="outline"
          size="lg"
          className="w-full border-amber-700/40 text-amber-200 hover:bg-amber-900/30"
          onClick={onClose}
        >
          {speaking ? (
            <>
              <Pause className="h-4 w-4 mr-2" />
              {locale === "fr" ? "Passer" : locale === "es" ? "Saltar" : locale === "de" ? "Überspringen" : "Skip"}
            </>
          ) : (
            <>{dismissLabel}</>
          )}
        </Button>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes speakingPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes haloFlicker {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
