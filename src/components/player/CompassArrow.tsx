"use client";

interface CompassArrowProps {
  bearing: number;
  heading: number;
}

export function CompassArrow({ bearing, heading }: CompassArrowProps) {
  // Calculate the rotation: we want the arrow to point toward the target
  // relative to the device's heading
  const rotation = bearing - heading;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Compass rose background */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-2 border-emerald-900/50 bg-gray-950/80 shadow-inner" />

        {/* Cardinal directions */}
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-emerald-500">
          N
        </span>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-600">
          E
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-600">
          S
        </span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-600">
          O
        </span>

        {/* Tick marks */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="absolute h-full w-px"
            style={{
              transform: `rotate(${i * 30}deg)`,
              transformOrigin: "center",
            }}
          >
            <div
              className={`mx-auto h-2 w-px ${i % 3 === 0 ? "bg-emerald-700" : "bg-gray-800"}`}
            />
          </div>
        ))}

        {/* Arrow SVG */}
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          className="relative z-10 drop-shadow-lg"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: "transform 0.3s ease-out",
          }}
        >
          {/* Arrow pointing up (north) */}
          <polygon
            points="40,8 48,44 40,38 32,44"
            fill="#10b981"
            stroke="#064e3b"
            strokeWidth="1"
          />
          {/* Tail */}
          <polygon
            points="40,72 48,44 40,50 32,44"
            fill="#1f2937"
            stroke="#064e3b"
            strokeWidth="1"
          />
          {/* Center dot */}
          <circle cx="40" cy="40" r="4" fill="#064e3b" stroke="#10b981" strokeWidth="1.5" />
        </svg>
      </div>

      <span className="text-xs text-gray-500">Direction de l&apos;objectif</span>
    </div>
  );
}
