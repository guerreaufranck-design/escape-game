/**
 * Context Engine — collects real-time signals to power contextual
 * suggestions (weather, time, location, tour stage).
 *
 * Uses Open-Meteo (free, no API key required, excellent uptime) for
 * weather data. Timezone is derived from the GPS + Open-Meteo response
 * to get accurate local hour.
 *
 * This module is DORMANT — nothing imports it yet. Safe to ship.
 */

export type WeatherCondition =
  | "clear"
  | "cloudy"
  | "rain"
  | "snow"
  | "storm"
  | "fog"
  | "unknown";

export interface ContextSnapshot {
  gps: { lat: number; lon: number };
  weather: {
    tempC: number;
    condition: WeatherCondition;
    windKph: number;
    /** True when context argues for taking a break (too cold / too hot / precipitation) */
    isUncomfortable: boolean;
  };
  /** ISO string in local timezone */
  localTime: string;
  /** 0-23 hour in local timezone */
  hourOfDay: number;
  /** True when it's a natural meal hour (~11h30-14h or 18h30-21h) */
  isMealHour: boolean;
  stage: "mid_tour" | "end_of_tour";
  language: string;
  city: string;
}

/** Map Open-Meteo WMO weather codes to our simpler taxonomy */
function mapWeatherCode(code: number): WeatherCondition {
  // https://open-meteo.com/en/docs
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain"; // drizzle + rain
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "unknown";
}

interface OpenMeteoResponse {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    time?: string;
  };
}

/**
 * Collect full context snapshot for the current player location.
 * Never throws — returns safe defaults if any external call fails.
 */
export async function getContextSnapshot(params: {
  lat: number;
  lon: number;
  city: string;
  language?: string;
  stage: "mid_tour" | "end_of_tour";
}): Promise<ContextSnapshot> {
  const language = params.language || "en";
  let tempC = 18;
  let condition: WeatherCondition = "unknown";
  let windKph = 0;
  let timezone = "UTC";
  let localTimeIso = new Date().toISOString();

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${params.lat}` +
      `&longitude=${params.lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m` +
      `&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as OpenMeteoResponse;
      tempC = data.current?.temperature_2m ?? tempC;
      condition = mapWeatherCode(data.current?.weather_code ?? 999);
      windKph = data.current?.wind_speed_10m ?? 0;
      timezone = data.timezone ?? "UTC";
      localTimeIso = data.current?.time ?? new Date().toISOString();
    }
  } catch (err) {
    console.warn(
      "[context-engine] Open-Meteo failed, using defaults:",
      err instanceof Error ? err.message : err,
    );
  }

  // Extract hour-of-day in local timezone
  const localDate = new Date(localTimeIso);
  const hourOfDay = localDate.getHours();

  // Meal windows: 11h30-14h and 18h30-21h
  const isMealHour =
    (hourOfDay === 11 && localDate.getMinutes() >= 30) ||
    hourOfDay === 12 ||
    hourOfDay === 13 ||
    (hourOfDay === 18 && localDate.getMinutes() >= 30) ||
    hourOfDay === 19 ||
    hourOfDay === 20;

  const isUncomfortable =
    tempC < 10 ||
    tempC > 30 ||
    condition === "rain" ||
    condition === "snow" ||
    condition === "storm" ||
    windKph > 40;

  return {
    gps: { lat: params.lat, lon: params.lon },
    weather: { tempC, condition, windKph, isUncomfortable },
    localTime: localTimeIso,
    hourOfDay,
    isMealHour,
    stage: params.stage,
    language,
    city: params.city,
  };
}
