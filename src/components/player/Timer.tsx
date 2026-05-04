"use client";

import { useEffect } from "react";
import { Clock } from "lucide-react";
import { useTimer } from "@/hooks/useTimer";
import { formatTime } from "@/lib/scoring";

interface TimerProps {
  startedAt: string;
  // Kept on the props type for backwards compat with old callers, but
  // no longer displayed in-game — penalties are only revealed on the
  // results page so the player isn't punished visually mid-walk.
  penaltySeconds?: number;
}

export function Timer({ startedAt }: TimerProps) {
  const { elapsedSeconds, start } = useTimer(startedAt);

  useEffect(() => {
    start();
  }, [start]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-900/50 bg-gray-950/80 px-4 py-2.5 shadow-lg backdrop-blur-sm">
      <Clock className="h-5 w-5 text-emerald-400" />
      <span className="font-mono text-xl font-bold tabular-nums text-emerald-100">
        {formatTime(elapsedSeconds)}
      </span>
    </div>
  );
}
