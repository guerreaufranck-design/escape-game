"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles, X } from "lucide-react";

interface ARTreasureChestProps {
  /** True when the player is pointing at + close to the target */
  lockedOn: boolean;
  /** Optional custom reward text shown when the chest is opened */
  rewardText?: string | null;
  /** Step identifier — chest resets (closes again) when this changes */
  stepKey: string | null;
  /** Called when the player opens the chest — used to fire particles */
  onOpen?: () => void;
  locale?: string;
}

// ▸ Default reward text per locale (used when rewardText is not provided).
const DEFAULT_REWARD: Record<string, string> = {
  fr: "Tu as trouvé un trésor caché ! Ton œil est aiguisé, chasseur d'énigmes.",
  en: "You found a hidden treasure! A sharp eye you have, riddle-hunter.",
  es: "¡Has encontrado un tesoro oculto! Tienes buen ojo, cazador de enigmas.",
  de: "Du hast einen versteckten Schatz entdeckt! Scharfes Auge, Rätseljäger.",
  it: "Hai trovato un tesoro nascosto! Occhio affilato, cacciatore di enigmi.",
};

/**
 * A tappable 3D-looking treasure chest that hovers in the AR view when
 * the player is locked on the target. Gives the "Pokémon GO" surprise
 * feel: the chest *appears* in the real world, the player taps it, it
 * opens with a gold explosion and reveals a short congratulatory message.
 *
 * Pure CSS/SVG — zero external assets, no 3D engine, works on every phone.
 * Per step the chest can be opened only once.
 */
export function ARTreasureChest({
  lockedOn,
  rewardText,
  stepKey,
  onOpen,
  locale = "fr",
}: ARTreasureChestProps) {
  const [opened, setOpened] = useState(false);
  const [showReward, setShowReward] = useState(false);

  // Reset when the player moves to a new step
  useEffect(() => {
    setOpened(false);
    setShowReward(false);
  }, [stepKey]);

  // Only materialise the chest once the player is really locked on
  if (!lockedOn && !showReward) return null;

  const defaultMsg = DEFAULT_REWARD[locale] || DEFAULT_REWARD.en;
  const message = rewardText || defaultMsg;

  const handleOpen = () => {
    if (opened) return;
    setOpened(true);
    setShowReward(true);
    onOpen?.();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.([50, 30, 100]);
      } catch {
        /* vibration can fail silently */
      }
    }
  };

  return (
    <>
      {/* Chest — appears above the waypoint marker */}
      {!showReward && (
        <button
          onClick={handleOpen}
          aria-label="Open treasure chest"
          className="pointer-events-auto absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
          style={{
            animation: "ar-chest-bob 2.2s ease-in-out infinite",
          }}
        >
          {/* Glow halo */}
          <span
            className="absolute inset-0 -z-10 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(251,191,36,0.6) 0%, rgba(251,191,36,0) 70%)",
              filter: "blur(12px)",
              transform: "scale(2.2)",
              animation: "ar-chest-glow 2.2s ease-in-out infinite",
            }}
          />
          {/* Chest itself */}
          <div
            className="relative flex h-24 w-28 items-center justify-center"
            style={{
              filter:
                "drop-shadow(0 8px 16px rgba(120, 53, 15, 0.6)) drop-shadow(0 0 20px rgba(251, 191, 36, 0.4))",
            }}
          >
            {/* Body */}
            <div
              className="absolute bottom-0 h-16 w-24 rounded-b-lg"
              style={{
                background:
                  "linear-gradient(180deg, #92400e 0%, #78350f 40%, #451a03 100%)",
                boxShadow:
                  "inset 0 -6px 0 rgba(0,0,0,0.4), inset 0 2px 0 rgba(251,191,36,0.3)",
              }}
            />
            {/* Metal bands */}
            <div
              className="absolute bottom-2 h-1 w-24"
              style={{
                background: "linear-gradient(180deg, #fbbf24, #b45309)",
              }}
            />
            <div
              className="absolute bottom-12 h-1 w-24"
              style={{
                background: "linear-gradient(180deg, #fbbf24, #b45309)",
              }}
            />
            {/* Lid */}
            <div
              className="absolute top-1 h-10 w-24 rounded-t-2xl"
              style={{
                background:
                  "linear-gradient(180deg, #b45309 0%, #92400e 100%)",
                boxShadow:
                  "inset 0 2px 0 rgba(251,191,36,0.5), inset 0 -4px 0 rgba(0,0,0,0.3)",
              }}
            />
            {/* Lock */}
            <div
              className="absolute left-1/2 top-7 flex h-6 w-5 -translate-x-1/2 items-center justify-center rounded-sm"
              style={{
                background: "linear-gradient(180deg, #fde68a, #d97706)",
                border: "1px solid #78350f",
              }}
            >
              <div className="h-2 w-1 rounded-full bg-amber-900" />
            </div>
            {/* Sparkles */}
            <Sparkles
              className="absolute -right-2 -top-2 h-5 w-5 text-amber-200"
              style={{ animation: "ar-chest-sparkle 1.5s ease-in-out infinite" }}
            />
            <Sparkles
              className="absolute -left-3 top-4 h-4 w-4 text-amber-100"
              style={{
                animation: "ar-chest-sparkle 1.5s ease-in-out infinite",
                animationDelay: "0.4s",
              }}
            />
          </div>

          <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-amber-200"
             style={{ textShadow: "0 0 8px rgba(0,0,0,0.9)" }}>
            Tap!
          </p>
        </button>
      )}

      {/* Reward card — slides in after opening */}
      {showReward && (
        <div
          className="pointer-events-auto absolute left-1/2 top-1/2 z-20 w-[85vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-950/95 to-slate-950/95 p-6 shadow-2xl backdrop-blur-md"
          style={{ animation: "ar-chest-reward-in 450ms ease-out" }}
        >
          <button
            onClick={() => setShowReward(false)}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-full p-1 text-amber-200 hover:bg-amber-950"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center text-center">
            <div
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                background: "linear-gradient(180deg, #fbbf24, #d97706)",
                boxShadow: "0 0 24px rgba(251, 191, 36, 0.6)",
              }}
            >
              <Gift className="h-8 w-8 text-amber-950" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              Trésor découvert
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-50">
              {message}
            </p>
          </div>
        </div>
      )}

      {/* Inline keyframes — easier than editing global css */}
      <style jsx>{`
        @keyframes ar-chest-bob {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        @keyframes ar-chest-glow {
          0%, 100% { opacity: 0.7; transform: scale(2.2); }
          50% { opacity: 1; transform: scale(2.5); }
        }
        @keyframes ar-chest-sparkle {
          0%, 100% { opacity: 0.5; transform: scale(0.8) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.2) rotate(20deg); }
        }
        @keyframes ar-chest-reward-in {
          0% { opacity: 0; transform: translate(-50%, -40%) scale(0.7); }
          60% { opacity: 1; transform: translate(-50%, -52%) scale(1.05); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  );
}
