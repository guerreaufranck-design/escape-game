"use client";

import { useRef, useEffect, useState } from "react";
import { Camera, RotateCcw, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCamera } from "@/hooks/useCamera";

interface PhotoCaptureProps {
  sessionId: string;
  stepOrder: number;
  onPhotoTaken: (photoUrl: string) => void;
}

export function PhotoCapture({
  sessionId,
  stepOrder,
  onPhotoTaken,
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    isActive,
    error: cameraError,
    photoBlob,
    photoUrl,
    startCamera,
    capturePhoto,
    stopCamera,
    resetPhoto,
  } = useCamera();

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  async function openCamera() {
    setIsCameraOpen(true);
    if (videoRef.current) {
      await startCamera(videoRef.current);
    }
  }

  function handleCapture() {
    capturePhoto();
  }

  function handleRetry() {
    resetPhoto();
  }

  function handleClose() {
    stopCamera();
    setIsCameraOpen(false);
  }

  async function handleConfirm() {
    if (!photoBlob) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("photo", photoBlob, "photo.jpg");
      formData.append("sessionId", sessionId);
      formData.append("stepOrder", String(stepOrder));

      const res = await fetch("/api/upload-photo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || "Erreur lors de l'envoi de la photo.");
        return;
      }

      onPhotoTaken(data.photoUrl);
      stopCamera();
      setIsCameraOpen(false);
    } catch {
      setUploadError("Erreur de connexion.");
    } finally {
      setIsUploading(false);
    }
  }

  // Not opened yet
  if (!isCameraOpen) {
    return (
      <Button
        onClick={openCamera}
        variant="outline"
        className="border-emerald-800/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50 hover:text-emerald-200"
      >
        <Camera className="mr-2 h-4 w-4" />
        Prendre une photo
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-emerald-900/50 bg-gray-950/80 p-4 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-emerald-300">
          <Camera className="mr-1.5 inline h-4 w-4" />
          Photo challenge
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-7 w-7 p-0 text-gray-500 hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {cameraError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {cameraError}
        </div>
      )}

      {/* Video preview / captured photo */}
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${photoUrl ? "hidden" : ""}`}
        />
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Photo capturee"
            className="h-full w-full object-cover"
          />
        )}
        {!isActive && !photoUrl && !cameraError && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {!photoUrl ? (
          <Button
            onClick={handleCapture}
            disabled={!isActive}
            className="bg-emerald-700 text-white hover:bg-emerald-600"
          >
            <Camera className="mr-2 h-4 w-4" />
            Capturer
          </Button>
        ) : (
          <>
            <Button
              onClick={handleRetry}
              variant="outline"
              disabled={isUploading}
              className="border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reprendre
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isUploading}
              className="bg-emerald-700 text-white hover:bg-emerald-600"
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Valider
            </Button>
          </>
        )}
      </div>

      {uploadError && (
        <p className="text-center text-sm text-red-400">{uploadError}</p>
      )}
    </div>
  );
}
