"use client";

import { useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { useTimer } from "@/hooks/useTimer";
import { formatTime } from "@/lib/scoring";

interface TimerProps {
  startedAt: string;
  penaltySeconds: number;
}

export function Timer({ startedAt, penaltySeconds }: TimerProps) {
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

      {penaltySeconds > 0 && (
        <div className="flex items-center gap-1 rounded-md border border-red-900/50 bg-red-950/30 px-2 py-0.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          <span className="font-mono text-sm font-medium text-red-400">
            +{formatTime(penaltySeconds)}
          </span>
        </div>
      )}
    </div>
  );
}
