// V2 (2026-05-23) — augmenté de 10000 à 50000 pour corriger le bug
// où tout jeu > 83 min affichait score = 0 (10000/2 = 5000 sec = 83 min).
// Les jeux annoncés "1h30-3h30" ont besoin d'un BASE qui supporte 3h30.
// Avec 50000 + rate=2 : 100 min = 38000, 3h30 = 24800. Récompense
// claire de la rapidité (48800 en 10 min vs 24800 en 3h30 = 2× écart).
// Cas Aigues-Mortes "Les stars" 100 min : 0 → 38000.
const BASE_SCORE = 50000;
const TIME_PENALTY_RATE = 2; // points lost per second

export interface ScoreInput {
  totalTimeSeconds: number;
  totalPenaltySeconds: number;
  bonusPoints: number;
}

/**
 * Calculate final score for a completed game session.
 */
export function calculateScore(input: ScoreInput): number {
  const timePenalty = input.totalTimeSeconds * TIME_PENALTY_RATE;
  const hintPenalty = input.totalPenaltySeconds * TIME_PENALTY_RATE;

  return Math.max(0, BASE_SCORE - timePenalty - hintPenalty + input.bonusPoints);
}

/**
 * Format seconds to HH:MM:SS display.
 */
export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Format score with thousands separator.
 */
export function formatScore(score: number): string {
  return score.toLocaleString("fr-FR");
}
