const BASE_SCORE = 10000;
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
