const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate distance between two GPS coordinates using the Haversine formula.
 * Returns distance in meters.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate bearing between two GPS coordinates.
 * Returns bearing in degrees (0-360, 0 = North).
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.cos(dLon);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}

/**
 * "Obfuscate" GPS coordinates by light rounding (~1.1 m precision).
 *
 * Historiquement on roundait à 2 décimales (~1 km) avec l'intention
 * "ne pas exposer le pin exact au client pour éviter la triche". Sauf
 * que pour un jeu de scan AR de façade, le joueur DOIT être pile à la
 * bonne adresse pour que la caméra cible le bon mur — un écart de
 * 1 km rend le radar et la boussole AR contradictoires avec la validation
 * serveur (rayon 30 m sur les vraies coordonnées).
 *
 * 2026-05-16 — passé à 5 décimales (≈ 1.1 m de précision = fonctionnellement
 * équivalent à coords réelles). L'anti-cheat est déjà couvert par le
 * validation_radius_meters serveur et par la nécessité physique de
 * scanner la façade en AR.
 *
 * Fonction conservée pour rétrocompat et pour pouvoir réactiver une
 * obfuscation forte si on en a un jour le besoin.
 */
export function obfuscateCoordinates(
  lat: number,
  lon: number
): { latitude: number; longitude: number } {
  return {
    latitude: Math.round(lat * 100000) / 100000,
    longitude: Math.round(lon * 100000) / 100000,
  };
}

/**
 * Format distance for display.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
