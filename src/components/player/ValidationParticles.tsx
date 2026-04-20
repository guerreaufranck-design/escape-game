"use client";

import { useEffect, useRef } from "react";

interface ValidationParticlesProps {
  /** Increment this number to trigger a new burst */
  trigger: number;
  /** Optional color theme */
  theme?: "gold" | "emerald";
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vr: number;
  life: number;
  maxLife: number;
  shape: "circle" | "star" | "square";
}

const GOLD_PALETTE = ["#fbbf24", "#f59e0b", "#fde68a", "#facc15", "#ffffff"];
const EMERALD_PALETTE = ["#34d399", "#10b981", "#a7f3d0", "#6ee7b7", "#ffffff"];

function makeParticle(centerX: number, centerY: number, palette: string[]): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 180 + Math.random() * 320;
  const life = 1.2 + Math.random() * 0.8;
  const shapes: Particle["shape"][] = ["circle", "star", "square"];
  return {
    x: centerX,
    y: centerY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 150, // bias upward
    size: 4 + Math.random() * 8,
    color: palette[Math.floor(Math.random() * palette.length)],
    rotation: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 6,
    life,
    maxLife: life,
    shape: shapes[Math.floor(Math.random() * shapes.length)],
  };
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  const spikes = 5;
  const outer = size;
  const inner = size / 2.2;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Full-screen canvas that emits a burst of gold/emerald particles (circles,
 * stars and squares) each time `trigger` increments. Used to celebrate step
 * validations, photo success, etc. Auto-runs for ~2 seconds per burst.
 */
export function ValidationParticles({
  trigger,
  theme = "gold",
}: ValidationParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  // Launch a new burst whenever `trigger` changes
  useEffect(() => {
    if (trigger === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Fit canvas to viewport
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    const palette = theme === "emerald" ? EMERALD_PALETTE : GOLD_PALETTE;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const count = 70;
    const batch: Particle[] = [];
    for (let i = 0; i < count; i++) batch.push(makeParticle(cx, cy, palette));
    particlesRef.current.push(...batch);

    if (rafRef.current) return; // already animating — new particles join the loop

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    lastFrameRef.current = performance.now();

    function frame(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const dprLocal = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dprLocal, canvas.height / dprLocal);

      const gravity = 620; // px/s²
      const drag = 0.985;
      const list = particlesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.vy += gravity * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.vr * dt;
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        const alpha = Math.min(1, p.life / p.maxLife * 1.5);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x / dprLocal, p.y / dprLocal);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "star") {
          drawStar(ctx, 0, 0, p.size);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        }
        ctx.restore();
      }

      if (list.length > 0) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [trigger, theme]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[200]"
      aria-hidden="true"
    />
  );
}
