"use client";

interface ARFacadeTextLayerProps {
  /** Short cryptic phrase to "paint" on the monument */
  text: string;
  /** True when the player is centered on the target (close + aligned) */
  lockedOn: boolean;
  /** Horizontal angle in degrees (used to tilt the text in perspective) */
  horizontalAngle: number;
  /**
   * When true, the text IS the answer (virtual_ar stops). Rendered larger
   * and with a stronger glow so the player can clearly read/capture it.
   * When false, it's a hint guiding the player to look elsewhere.
   */
  isAnswer?: boolean;
}

/**
 * Renders a short phrase as if it were carved / painted on the monument
 * wall. Only appears when the player is locked on the target. Uses a
 * medieval-style serif font, a warm ochre colour and a gentle tilt /
 * perspective transform to feel anchored to the wall rather than to the
 * screen. A subtle glow and fade-in bring the "magical revelation" feel.
 */
export function ARFacadeTextLayer({
  text,
  lockedOn,
  horizontalAngle,
  isAnswer = false,
}: ARFacadeTextLayerProps) {
  if (!text) return null;

  // Scale / tilt the text according to the horizontal angle so it feels
  // painted on the wall rather than floating on the screen.
  const tiltY = Math.max(-25, Math.min(25, horizontalAngle * 0.6));

  // Answer mode: larger, stronger glow, no guillemets, uppercase, because
  // this IS what the player has to read and memorise. Hint mode: smaller,
  // italic, with guillemets, because it's just a whisper.
  const fontSize = isAnswer
    ? "clamp(2rem, 8vw, 4rem)"
    : "clamp(1.2rem, 4.5vw, 2.2rem)";
  const letterSpacing = isAnswer ? "0.18em" : "0.08em";
  const textShadow = isAnswer
    ? "0 0 28px rgba(251, 191, 36, 0.95), 0 0 12px rgba(251, 191, 36, 0.6), 0 0 4px rgba(120, 53, 15, 1), 2px 2px 4px rgba(0, 0, 0, 0.9)"
    : "0 0 16px rgba(251, 191, 36, 0.6), 0 0 4px rgba(120, 53, 15, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.8)";
  const displayText = isAnswer ? text.toUpperCase() : `« ${text} »`;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 transition-all duration-700"
      style={{
        opacity: lockedOn ? 1 : 0,
        transform: `translate(-50%, -50%) perspective(600px) rotateY(${tiltY}deg) scale(${lockedOn ? 1 : 0.9})`,
      }}
    >
      {isAnswer && (
        // A tiny label above the answer telling the player this is THE answer.
        // Keeps the magical feel but removes any ambiguity about what to do.
        <p
          className="mb-2 text-center text-[10px] uppercase tracking-[0.3em] text-amber-300/70"
          style={{ textShadow: "0 0 8px rgba(0,0,0,0.8)" }}
        >
          ✨ Réponse révélée
        </p>
      )}
      <p
        className={`max-w-[90vw] text-center font-serif ${isAnswer ? "font-black" : "italic"}`}
        style={{
          fontFamily: '"Cinzel", "Trajan Pro", "Georgia", serif',
          fontSize,
          fontWeight: isAnswer ? 900 : 700,
          letterSpacing,
          color: isAnswer ? "#fef3c7" : "#fde68a",
          textShadow,
          mixBlendMode: "screen",
        }}
      >
        {displayText}
      </p>
    </div>
  );
}
