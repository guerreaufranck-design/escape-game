export interface Hint {
  order: number;
  text: string;
  image?: string;
}

export interface PlayerPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export interface GameState {
  sessionId: string;
  gameId: string;
  gameTitle: string;
  gameDescription: string | null;
  introVideoUrl: string | null;
  estimatedDuration: string | null;
  playerName: string;
  currentStep: number;
  currentStepId: string | null;
  totalSteps: number;
  status: "pending" | "active" | "completed" | "abandoned";
  startedAt: string | null;
  currentRiddle: {
    title: string;
    text: string;
    image: string | null;
    hasPhotoChallenge: boolean;
  } | null;
  approximateTarget: {
    latitude: number;
    longitude: number;
  } | null;
  validationRadius: number;
  navigationHint: string | null;
  hintsAvailable: number;
  hintsUsed: number;
  completedSteps: CompletedStepInfo[];
}

export interface CompletedStepInfo {
  stepOrder: number;
  title: string;
  timeSeconds: number;
  hintsUsed: number;
}

export interface GameResults {
  sessionId: string;
  gameTitle: string;
  playerName: string;
  teamName: string | null;
  totalTimeSeconds: number;
  totalHintsUsed: number;
  totalPenaltySeconds: number;
  finalScore: number;
  rank: number;
  totalPlayers: number;
  steps: {
    title: string;
    timeSeconds: number;
    hintsUsed: number;
    penaltySeconds: number;
    answer: string | null;
    anecdote: string | null;
  }[];
}
