export const APP_NAME = "Escape Game Outdoor";
export const APP_DESCRIPTION = "Vivez des aventures d'escape game en plein air";

export const MAP_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const DEFAULT_MAP_CENTER = { lat: 48.8566, lng: 2.3522 }; // Paris
export const DEFAULT_MAP_ZOOM = 15;

export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 10000,
};

export const MAX_VALIDATION_RATE_MS = 5000; // 5 seconds between validation attempts
