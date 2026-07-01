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
  /**
   * S9 (2026-05-18) — Mode du jeu :
   *   - "city_game" : escape game classique (énigmes, indices, code final)
   *   - "city_tour" : audioguide enrichi (narration encyclopédique,
   *     AR pour orientation, pas d'énigmes ni code final)
   * Default 'city_game' pour rétrocompatibilité (jeux existants).
   */
  mode: "city_game" | "city_tour";
  currentRiddle: {
    title: string;
    text: string;
    /**
     * Real-world landmark name (e.g. "Plaza Mayor", "Cathédrale Saint-Nazaire").
     * Exposed to the player as a navigational anchor so they ALWAYS know
     * which physical place they're heading to — even before opening AR.
     * Fixes the Cuenca refund where the poetic title ("Plaza of Desperate
     * Petitions") gave the player zero clue which actual square to find.
     * Null only for legacy games stored before the landmark_name column.
     */
    landmarkName: string | null;
    image: string | null;
    hasPhotoChallenge: boolean;
    /**
     * Where the answer lives: "physical" (real inscription on monument) or
     * "virtual_ar" (answer appears as AR overlay when locked on target).
     * Drives the riddle tone and the AR display behaviour.
     */
    answerSource: "physical" | "virtual_ar";
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
    /** Patrimoine-first (2026-05-16) — full landmark history voiced */
    landmarkHistory: string | null;
  } | null;
  /**
   * Audio for game-wide narrative blocks (step_order=0 in audio_cache).
   * Available throughout the game, not tied to the current step. Vision
   * 2026-05-16 — used by the intro page (before stop 1) and final puzzle
   * overlay (after last stop).
   */
  gameWideAudio?: {
    introSpeech: string | null;
    finalRiddle: string | null;
    finalExplanation: string | null;
    epilogue: string | null;
  } | null;
  /**
   * S9 (2026-05-19) — Tour-mode rich content. Populé UNIQUEMENT pour
   * les jeux mode='city_tour', via la table step_content. Null en mode
   * city_game (le contenu reste dans currentRiddle.text + audioMap).
   *
   * Le player UI tour mode rend ces 3 champs en cartes séparées :
   *   1. Narration principale (encyclopedicText, ~250 mots)
   *   2. "À observer" (architecturalFocus, ce qu'il faut regarder maintenant)
   *   3. "Au prochain stop..." (culturalConnection, tisse le parcours)
   */
  tourContent: {
    encyclopedicText: string;
    architecturalFocus: string | null;
    culturalConnection: string | null;
  } | null;
  /** Touristic POIs the player walks past on the way to this step.
   *  Surfaced as an expandable card "Sur le chemin, ne manque pas..."
   *  on the riddle screen. Empty array if none.
   *  Schema enriched 2026-05-17 with category + distance + GPS for
   *  UI categorisation and clickable navigation. Old games stored
   *  before this date have only {name, fact} — both schemas coexist. */
  routeAttractions: Array<{
    name: string;
    fact: string;
    category?: "heritage" | "viewpoint" | "quirky" | "food" | "nature";
    distance_m?: number;
    lat?: number;
    lon?: number;
  }>;
  approximateTarget: {
    latitude: number;
    longitude: number;
  } | null;
  validationRadius: number;
  navigationHint: string | null;
  hintsAvailable: number;
  hintsUsed: number;
  completedSteps: CompletedStepInfo[];
  /**
   * Discours du guide affiché en page d'intro avant stop 1 (vision client
   * 2026-05-16). Présentation, durée, philosophie, call-to-action.
   * Null pour les jeux générés avant la migration 027.
   */
  introSpeech: string | null;
  /**
   * Texte de l'énigme finale (le brief du guide pour la résolution).
   * Affiché quand la session passe en status="completed". Null si pas
   * d'énigme finale curée (legacy → concaténation des indices).
   */
  finalRiddleText: string | null;
  /**
   * État de résolution de l'énigme finale :
   *   - finalAttemptsUsed = 0/1/2
   *   - finalSucceeded = true (succès), false (2 échecs), null (pas encore tenté)
   */
  finalAttemptsUsed: number;
  finalSucceeded: boolean | null;
  /**
   * Explication de la bonne réponse (joué après succès OU après 2 échecs).
   * Null tant que la résolution n'est pas actée — exposé seulement quand
   * la session est passée en final_resolved_at.
   */
  finalAnswerExplanation: string | null;
  /**
   * OFFLINE pre-download (?step=N) uniquement : textes normalement renvoyés
   * par validate-step / hint, inclus ici pour que le client puisse rendre une
   * étape résolue sans réseau. Absents en jeu online normal.
   */
  offlineAnecdote?: string | null;
  offlineLandmarkHistory?: string | null;
  offlineHints?: string[];
  /** Réponse finale + explication, uniquement dans le pack offline (?step). */
  offlineFinalAnswer?: string | null;
  offlineFinalExplanation?: string | null;
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
  /** Ville du jeu, telle que stockée dans `games.city` ("Cambridge",
   *  "Aegina Island, Saronic Gulf"). Utilisée pour cibler les upsells
   *  post-game (GYG cross-sell). */
  city: string;
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
