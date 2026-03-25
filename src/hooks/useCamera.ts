"use client";

import { useState, useRef, useCallback } from "react";

interface CameraState {
  isActive: boolean;
  error: string | null;
  photoBlob: Blob | null;
  photoUrl: string | null;
}

export function useCamera() {
  const [state, setState] = useState<CameraState>({
    isActive: false,
    error: null,
    photoBlob: null,
    photoUrl: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async (videoElement: HTMLVideoElement) => {
    try {
      videoRef.current = videoElement;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      streamRef.current = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      setState((prev) => ({ ...prev, isActive: true, error: null }));
    } catch {
      setState((prev) => ({
        ...prev,
        error: "Impossible d'acceder a la camera",
        isActive: false,
      }));
    }
  }, []);

  const capturePhoto = useCallback((): Blob | null => {
    if (!videoRef.current) return null;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);

    let blob: Blob | null = null;
    canvas.toBlob(
      (b) => {
        blob = b;
        if (b) {
          const url = URL.createObjectURL(b);
          setState((prev) => ({
            ...prev,
            photoBlob: b,
            photoUrl: url,
          }));
        }
      },
      "image/jpeg",
      0.85
    );

    return blob;
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (state.photoUrl) {
      URL.revokeObjectURL(state.photoUrl);
    }
    setState({ isActive: false, error: null, photoBlob: null, photoUrl: null });
  }, [state.photoUrl]);

  const resetPhoto = useCallback(() => {
    if (state.photoUrl) {
      URL.revokeObjectURL(state.photoUrl);
    }
    setState((prev) => ({ ...prev, photoBlob: null, photoUrl: null }));
  }, [state.photoUrl]);

  return {
    ...state,
    startCamera,
    capturePhoto,
    stopCamera,
    resetPhoto,
  };
}
