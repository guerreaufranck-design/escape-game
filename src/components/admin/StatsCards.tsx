"use client";

import {
  Gamepad2,
  Users,
  Clock,
  Trophy,
  BarChart3,
  MapPin,
} from "lucide-react";

interface StatsProps {
  stats: {
    totalGames: number;
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    averageScore: number;
    averageTime: number;
  };
}

const statConfig = [
  {
    key: "totalGames" as const,
    label: "Jeux",
    icon: Gamepad2,
    format: (v: number) => v.toString(),
  },
  {
    key: "totalSessions" as const,
    label: "Sessions totales",
    icon: Users,
    format: (v: number) => v.toString(),
  },
  {
    key: "activeSessions" as const,
    label: "Sessions actives",
    icon: MapPin,
    format: (v: number) => v.toString(),
  },
  {
    key: "completedSessions" as const,
    label: "Completees",
    icon: Trophy,
    format: (v: number) => v.toString(),
  },
  {
    key: "averageScore" as const,
    label: "Score moyen",
    icon: BarChart3,
    format: (v: number) => v.toFixed(0),
  },
  {
    key: "averageTime" as const,
    label: "Temps moyen",
    icon: Clock,
    format: (v: number) => {
      const min = Math.floor(v / 60);
      const sec = Math.floor(v % 60);
      return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    },
  },
];

export function StatsCards({ stats }: StatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {statConfig.map(({ key, label, icon: Icon, format }) => (
        <div
          key={key}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur"
        >
          <div className="mb-2 flex items-center gap-2 text-zinc-400">
            <Icon className="size-4 text-emerald-500" />
            <span className="text-xs font-medium uppercase tracking-wider">
              {label}
            </span>
          </div>
          <p className="text-2xl font-bold text-zinc-100">
            {format(stats[key])}
          </p>
        </div>
      ))}
    </div>
  );
}
