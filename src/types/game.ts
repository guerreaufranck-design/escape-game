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
    /**
     * Where the answer lives: "physical" (real inscription on monument) or
     * "virtual_ar" (answer appears as AR overlay when locked on target).
     * Drives the riddle tone and the AR display behaviour.
     */
    answerSource: "physical" | "virtual_ar";
  } | null;
  /** Historical photo of the current location, shown as an AR overlay */
  arHistoricalPhoto: {
    url: string;
    credit: string | null;
  } | null;
  /** Optional short phrase "painted" on the facade when locked on in AR */
  arFacadeText: string | null;
  /** Optional custom reward message revealed by tapping the AR chest */
  arTreasureReward: string | null;
  /** Optional AR character (monk/knight/pirate…) that speaks when locked on */
  arCharacter: {
    type: string;
    dialogue: string;
  } | null;
  /**
   * Pre-generated narration MP3 URLs for the current step, served from
   * Supabase Storage. The frontend plays these via <audio> for an
   * immersive ElevenLabs voice; falls back to Web Speech (browser TTS)
   * when an URL is null. Audio is generated at purchase time when the
   * customer picks their language on the merchant site.
   */
  audioMap: {
    /** Riddle text — auto-narrated on step entry */
    riddle: string | null;
    /** AR character dialogue voiced in the player's language */
    character: string | null;
    /** Step anecdote (historical fact after validation) */
    anecdote: string | null;
  } | null;
  /** Touristic POIs the player walks past on the way to this step.
   *  Surfaced as an expandable card "Sur le chemin, ne manque pas..."
   *  on the riddle screen. Empty array if none. */
  routeAttractions: Array<{ name: string; fact: string }>;
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
  /**
   * Narrative epilogue shown before the score: reveals the "true story"
   * behind the quest, weaving all step anecdotes into one cohesive arc.
   * Null for older games generated before the epilogue feature.
   */
  epilogue: {
    title: string;
    text: string;
    /** Pre-generated MP3 URL for the epilogue narration, if available. */
    audioUrl?: string | null;
  } | null;
}
