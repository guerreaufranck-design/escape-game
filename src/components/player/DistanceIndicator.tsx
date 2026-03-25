import { Flame, Thermometer, Snowflake } from "lucide-react";
import { formatDistance } from "@/lib/geo";

interface DistanceIndicatorProps {
  distance: number | null;
  isInRange: boolean;
}

function getTemperature(distance: number | null) {
  if (distance === null) {
    return {
      label: "Localisation...",
      color: "text-gray-400",
      bgColor: "bg-gray-900/50 border-gray-700/50",
      pulseColor: "",
      icon: Thermometer,
      pulse: false,
    };
  }

  if (distance < 30) {
    return {
      label: "Brulant !",
      color: "text-red-400",
      bgColor: "bg-red-950/40 border-red-800/50",
      pulseColor: "shadow-red-500/30",
      icon: Flame,
      pulse: true,
    };
  }
  if (distance < 100) {
    return {
      label: "Tres chaud",
      color: "text-orange-400",
      bgColor: "bg-orange-950/30 border-orange-800/50",
      pulseColor: "shadow-orange-500/20",
      icon: Flame,
      pulse: true,
    };
  }
  if (distance < 300) {
    return {
      label: "Chaud",
      color: "text-yellow-400",
      bgColor: "bg-yellow-950/20 border-yellow-800/50",
      pulseColor: "",
      icon: Thermometer,
      pulse: false,
    };
  }
  if (distance < 1000) {
    return {
      label: "Tiede",
      color: "text-emerald-400",
      bgColor: "bg-emerald-950/20 border-emerald-800/50",
      pulseColor: "",
      icon: Thermometer,
      pulse: false,
    };
  }

  return {
    label: "Froid",
    color: "text-blue-400",
    bgColor: "bg-blue-950/20 border-blue-800/50",
    pulseColor: "",
    icon: Snowflake,
    pulse: false,
  };
}

export function DistanceIndicator({ distance, isInRange }: DistanceIndicatorProps) {
  const temp = getTemperature(distance);
  const Icon = temp.icon;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all ${temp.bgColor} ${temp.pulse ? `animate-pulse shadow-lg ${temp.pulseColor}` : ""}`}
    >
      <Icon className={`h-6 w-6 ${temp.color}`} />

      <div className="flex flex-col">
        <span className={`text-lg font-bold ${temp.color}`}>
          {temp.label}
        </span>
        {distance !== null && (
          <span className="text-xs text-gray-400">
            {formatDistance(distance)}
            {isInRange && (
              <span className="ml-2 font-medium text-emerald-400">
                - Vous y etes !
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
