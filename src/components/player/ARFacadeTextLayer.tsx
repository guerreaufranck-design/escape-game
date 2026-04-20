"use client";

interface ARFacadeTextLayerProps {
  /** Short cryptic phrase to "paint" on the monument */
  text: string;
  /** True when the player is centered on the target (close + aligned) */
  lockedOn: boolean;
  /** Horizontal angle in degrees (used to tilt the text in perspective) */
  horizontalAngle: number;
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
}: ARFacadeTextLayerProps) {
  if (!text) return null;

  // Scale / tilt the text according to the horizontal angle so it feels
  // painted on the wall rather than floating on the screen.
  const tiltY = Math.max(-25, Math.min(25, horizontalAngle * 0.6));

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 transition-all duration-700"
      style={{
        opacity: lockedOn ? 1 : 0,
        transform: `translate(-50%, -50%) perspective(600px) rotateY(${tiltY}deg) scale(${lockedOn ? 1 : 0.9})`,
      }}
    >
      <p
        className="max-w-[80vw] text-center font-serif italic"
        style={{
          fontFamily: '"Cinzel", "Trajan Pro", "Georgia", serif',
          fontSize: "clamp(1.2rem, 4.5vw, 2.2rem)",
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "#fde68a",
          textShadow:
            "0 0 16px rgba(251, 191, 36, 0.6), 0 0 4px rgba(120, 53, 15, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.8)",
          mixBlendMode: "screen",
        }}
      >
        « {text} »
      </p>
    </div>
  );
}
