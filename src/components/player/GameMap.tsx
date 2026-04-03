"use client";

import dynamic from "next/dynamic";

interface GameMapProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  validationRadius: number;
  zoom?: number;
  locale?: string;
}

const GameMapInner = dynamic(() => import("./GameMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full items-center justify-center rounded-xl border border-emerald-900/50 bg-gray-900/50">
      <div className="flex flex-col items-center gap-2 text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="text-sm">Chargement de la carte...</span>
      </div>
    </div>
  ),
});

export function GameMap(props: GameMapProps) {
  return <GameMapInner {...props} />;
}
