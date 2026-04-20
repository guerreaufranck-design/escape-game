"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Download, Share2, X, RotateCcw } from "lucide-react";

interface SelfieARScreenProps {
  gameTitle: string;
  city: string | null;
  playerName: string;
  onClose: () => void;
}

/**
 * End-of-game AR selfie: the player sees themselves on the front camera
 * with a themed mascotte pasted in the corner + a game-branded ribbon.
 * Tapping "Capture" takes a snapshot (video + overlays composited via
 * canvas) that can be downloaded or shared natively.
 *
 * No external assets — mascotte and ribbon are pure SVG/CSS. Zero 3D.
 */
export function SelfieARScreen({
  gameTitle,
  city,
  playerName,
  onClose,
}: SelfieARScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  // Attach the camera stream whenever facingMode changes.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCameraError("Camera access denied");
      }
    }
    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facingMode]);

  // Composite video + overlays into a canvas and produce a data URL
  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const W = video.videoWidth || 720;
    const H = video.videoHeight || 1280;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Video frame — mirror if selfie camera so letters read correctly
    ctx.save();
    if (facingMode === "user") {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    // Bottom ribbon with game info
    const ribbonH = Math.round(H * 0.18);
    const grad = ctx.createLinearGradient(0, H - ribbonH, 0, H);
    grad.addColorStop(0, "rgba(15, 23, 42, 0)");
    grad.addColorStop(0.4, "rgba(15, 23, 42, 0.85)");
    grad.addColorStop(1, "rgba(15, 23, 42, 0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - ribbonH, W, ribbonH);

    // Brand line
    ctx.fillStyle = "#fbbf24";
    ctx.font = `bold ${Math.round(W * 0.04)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("✨ OddballTrip", W / 2, H - ribbonH + Math.round(W * 0.06));

    // Game title + city
    ctx.fillStyle = "#f8fafc";
    ctx.font = `600 ${Math.round(W * 0.045)}px Georgia, serif`;
    const title = gameTitle.length > 40 ? gameTitle.slice(0, 38) + "…" : gameTitle;
    ctx.fillText(title, W / 2, H - ribbonH + Math.round(W * 0.12));

    if (city) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = `${Math.round(W * 0.032)}px system-ui, sans-serif`;
      ctx.fillText(`📍 ${city}`, W / 2, H - ribbonH + Math.round(W * 0.165));
    }

    // Mascotte in top-right corner (emoji ✨🧭 inside a badge)
    const badgeR = Math.round(W * 0.11);
    const bx = W - badgeR - Math.round(W * 0.04);
    const by = badgeR + Math.round(W * 0.04);
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    const badgeGrad = ctx.createRadialGradient(bx, by, 0, bx, by, badgeR);
    badgeGrad.addColorStop(0, "rgba(251, 191, 36, 0.95)");
    badgeGrad.addColorStop(1, "rgba(217, 119, 6, 0.9)");
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.lineWidth = Math.round(W * 0.008);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.stroke();
    ctx.font = `${Math.round(badgeR * 1.1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🧭", bx, by + Math.round(badgeR * 0.05));

    // Top-left winner badge
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${Math.round(W * 0.035)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(52, 211, 153, 0.95)";
    const badgeText = `🏆 ${playerName}`;
    const padding = Math.round(W * 0.025);
    const metrics = ctx.measureText(badgeText);
    const tagW = metrics.width + padding * 2;
    const tagH = Math.round(W * 0.06);
    ctx.fillStyle = "rgba(6, 78, 59, 0.9)";
    ctx.fillRect(padding, padding, tagW, tagH);
    ctx.fillStyle = "#bbf7d0";
    ctx.fillText(badgeText, padding * 2, padding + tagH * 0.7);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCaptured(dataUrl);
  }

  async function share() {
    if (!captured) return;
    // Convert data URL to blob
    const res = await fetch(captured);
    const blob = await res.blob();
    const file = new File([blob], `oddballtrip-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const shareData = {
      files: [file],
      title: `${gameTitle} · OddballTrip`,
      text: `J'ai terminé « ${gameTitle} » sur OddballTrip ! 🧭`,
    };
    if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user cancelled or not supported */
      }
    }
    // Fallback: trigger download
    download();
  }

  function download() {
    if (!captured) return;
    const link = document.createElement("a");
    link.href = captured;
    link.download = `oddballtrip-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-4">
        <div className="rounded-full border border-amber-400/40 bg-slate-950/80 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-300 backdrop-blur-sm">
          📸 Selfie Souvenir
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full border border-white/20 bg-slate-950/70 p-2 text-white backdrop-blur-sm hover:bg-slate-900"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Preview area */}
      <div className="relative flex-1 overflow-hidden">
        {cameraError ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <Camera className="mb-4 h-12 w-12 text-slate-400" />
            <p className="text-sm text-slate-300">{cameraError}</p>
          </div>
        ) : captured ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={captured}
              alt="Your selfie"
              className="h-full w-full object-contain"
            />
          </>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />
            {/* Preview overlays (visual only, actual composite in canvas) */}
            <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-emerald-950/80 px-3 py-1 text-xs font-bold text-emerald-200 shadow-lg">
              🏆 {playerName}
            </div>
            <div className="pointer-events-none absolute right-4 top-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/80 bg-gradient-to-br from-amber-400 to-amber-600 text-3xl shadow-2xl">
              🧭
            </div>
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent p-5 pb-8 text-center">
              <p className="text-sm font-bold text-amber-300">✨ OddballTrip</p>
              <p className="mt-1 font-serif text-base text-white">{gameTitle}</p>
              {city && <p className="text-xs text-slate-300">📍 {city}</p>}
            </div>
          </>
        )}
      </div>

      {/* Action bar */}
      <div
        className="z-10 flex items-center justify-center gap-4 bg-gradient-to-t from-slate-950 to-transparent p-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        {captured ? (
          <>
            <button
              onClick={() => setCaptured(null)}
              className="flex flex-col items-center gap-1 rounded-full bg-slate-800 px-5 py-3 text-xs font-bold text-slate-200 hover:bg-slate-700"
            >
              <RotateCcw className="h-5 w-5" />
              Reprendre
            </button>
            <button
              onClick={share}
              className="flex flex-col items-center gap-1 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 px-8 py-4 text-xs font-bold uppercase tracking-wider text-amber-950 shadow-xl hover:from-amber-400 hover:to-amber-500"
            >
              <Share2 className="h-6 w-6" />
              Partager
            </button>
            <button
              onClick={download}
              className="flex flex-col items-center gap-1 rounded-full bg-slate-800 px-5 py-3 text-xs font-bold text-slate-200 hover:bg-slate-700"
            >
              <Download className="h-5 w-5" />
              Enregistrer
            </button>
          </>
        ) : (
          <>
            {/* Capture */}
            <button
              onClick={capture}
              aria-label="Capture selfie"
              className="relative h-20 w-20 rounded-full border-4 border-white bg-amber-400 shadow-2xl transition-transform active:scale-95"
              style={{
                boxShadow:
                  "0 0 0 4px rgba(251, 191, 36, 0.4), 0 10px 40px rgba(0,0,0,0.5)",
              }}
            >
              <Camera className="mx-auto h-8 w-8 text-amber-950" />
            </button>
            {/* Flip camera */}
            <button
              onClick={() =>
                setFacingMode((m) => (m === "user" ? "environment" : "user"))
              }
              aria-label="Flip camera"
              className="absolute right-6 rounded-full border border-white/30 bg-slate-900/80 p-3 text-white backdrop-blur-sm hover:bg-slate-800"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Hidden canvas used for compositing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
