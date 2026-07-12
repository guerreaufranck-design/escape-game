/**
 * Types partagés pipeline v2 (Perplexity-first).
 *
 * Philosophie : objets typés à chaque étape du flow, jamais d'inférence
 * implicite. Si un champ peut être absent, il est `| undefined` explicite.
 */

/** Input minimal pour démarrer la pipeline v2.
 *  C'est le payload OddballTrip, validé et normalisé. */
export interface PipelineInput {
  slug: string;
  city: string;
  country?: string;
  theme: string;
  /** Description du thème (brief court du buyer). */
  themeDescription?: string;
  /** Description rich product page (role-play, landmarks promis...). */
  productDescription?: string;
  /** Narration custom du buyer (utilisée comme prior si fournie). */
  narrative?: string;
  /** Stops suggérés par le buyer (avec landmarkName si disponible). */
  buyerStops?: Array<{
    name?: string;
    landmarkName?: string;
    description?: string;
  }>;
  /** Point de départ — OBLIGATOIRE en v5 (validateStartPoint() throw sinon). */
  startPoint: { lat: number; lon: number };
  startPointText?: string;
  /** Langue cible ISO 639-1 (fr, en, de, es, it...). */
  language: string;
  /** Mode de transport — toujours résolu (default walking). */
  transportMode: "walking" | "driving" | "mixed";
  /** Rayon en km — toujours résolu (depuis payload OU config defaults). */
  radiusKm: number;
  /** Genre narratif. */
  genre?: string;
  /** Type de produit. */
  mode: "city_game" | "city_tour";
  /** Durée cible en minutes. */
  estimatedDurationMin: number;
  /** Difficulté 1-5. */
  difficulty: number;
  /** Identifiants OddballTrip pour callback. */
  buyerEmail?: string;
  orderId?: string;
  callbackUrl?: string;
  callbackSecret?: string;
  /** Payload complet pour persistance (audit + diagnostic). */
  originalPayload: Record<string, unknown>;
}

/** Landmark extrait du markdown Perplexity, AVANT géocodage. */
export interface DiscoveredLandmark {
  /** Ordre proposé par Perplexity (1-N). */
  order: number;
  /** Nom du landmark tel que Perplexity l'a écrit. */
  name: string;
  /** Titre narratif court qui relie au thème. */
  narrativeTitle?: string;
  /** Énigme observable depuis l'extérieur. */
  riddle: string;
  /** Réponse attendue. */
  answer: string;
  /** Indice si bloqué. */
  hint: string;
  /** 1-2 phrases d'anecdote historique. */
  anecdote: string;
  /** Notes ou liens depuis Perplexity. */
  sources?: string[];
}

/** Résultat complet de la phase Discovery. */
export interface DiscoveryResult {
  landmarks: DiscoveredLandmark[];
  /** Narration d'intro (3-5 phrases). */
  intro: string;
  /** Narration d'épilogue (3-5 phrases). */
  epilogue: string;
  /** Avertissement éditorial si thème délicat / inexact. */
  warning?: string;
  /** Citations Perplexity (URLs sources). */
  citations: string[];
  /** Markdown brut renvoyé par Perplexity (pour audit). */
  rawMarkdown: string;
}

/** Landmark après géocodage Google Places — coords vérifiées. */
export interface GeocodedLandmark extends DiscoveredLandmark {
  lat: number;
  lon: number;
  placeId: string;
  formattedAddress: string;
  placeTypes: string[];
  /** Nom canonique tel que Google le connaît (peut différer de name). */
  googleName: string;
  /** Distance en mètres du point de départ. */
  distanceFromStartM: number;
}

/** Résultat du geocoding pour toute la liste. */
export interface GeocodeResult {
  /** Landmarks géocodés avec succès. */
  geocoded: GeocodedLandmark[];
  /** Landmarks qui n'ont pas pu être résolus (à signaler ou exclure). */
  failed: Array<{ landmark: DiscoveredLandmark; reason: string }>;
  /** Point de départ final (résolu si pas dans input). */
  startPoint: { lat: number; lon: number; source: "input" | "geocoded" | "first_landmark" };
}

/** Représentation structurée d'un stop, prête pour DB. */
export interface StructuredStop {
  step_order: number;
  /** Titre narratif affiché au joueur. */
  title: string;
  /** Nom du landmark canonique (champ landmark_name en DB). */
  landmarkName: string;
  /** GPS verified. */
  latitude: number;
  longitude: number;
  /** Place ID Google. */
  placeId: string;
  /** Énigme principale (riddle_text). */
  riddle: string;
  /** Réponse à valider (answer_text). */
  answer: string;
  /** Indices en JSONB. */
  hints: Array<{ text: string; order: number }>;
  /** Anecdote historique (anecdote column). */
  anecdote: string;
  /** Type de personnage AR (guide_male, guide_female, scholar, monk, soldier...). */
  arCharacterType: string;
  /** Dialogue du personnage AR. */
  arCharacterDialogue: string;
  /** Texte AR de la façade (le mot qui apparaît en superposition). */
  arFacadeText: string;
  /** Récompense après scan AR. */
  arTreasureReward: string;
  /** Histoire du landmark, multilang. */
  landmarkHistory: Record<string, string>; // { fr: "...", en: "...", ... }
  /** Rayon de validation GPS en mètres (30 par défaut). */
  validationRadiusMeters: number;
  /** Bonus de temps en secondes après validation. */
  bonusTimeSeconds: number;
  /**
   * POIs "sur le chemin" — lieux que le joueur croise en marchant depuis le
   * stop précédent (carte "Sur le chemin, ne manque pas..."). Aide les
   * visiteurs qui ne connaissent pas la ville. Base EN, traduit à la volée
   * côté joueur. Vide si rien de notable en route.
   */
  routeAttractions: Array<{
    name: string;
    fact: string;
    category: string;
    distance_m?: number;
  }>;
}

/** Résultat du structuring Claude — le game complet prêt à insérer. */
export interface StructuredGame {
  /** Métadonnées du jeu. */
  meta: {
    title: string;
    description: string;
    intro: string;
    epilogue: string;
    epilogueTitle: string;
    finalRiddleText: string;
    finalAnswer: string;
    finalAnswerExplanation: string;
    /**
     * 3 indices progressifs pour la méta-énigme finale (2026-05-31).
     * Garantie anti-blocage : le joueur peut toujours finir.
     *   [0] LIGHT  : catégorie + 1ère lettre
     *   [1] MEDIUM : 3 premières lettres + contexte
     *   [2] STRONG : réponse avec 1 lettre cachée
     */
    finalRiddleHints?: string[];
  };
  /** Stops dans l'ordre. */
  stops: StructuredStop[];
  /** Langue source du contenu produit (toujours FR en v2 par convention). */
  sourceLanguage: string;
}

/** Résultat des traductions pour les langues cibles. */
export interface TranslationResult {
  /** Langue cible (en, de, es, it...). */
  language: string;
  /** Meta traduits. */
  meta: StructuredGame["meta"];
  /** Stops avec champs traduits (mêmes step_order). */
  stops: Array<Pick<StructuredStop, "step_order" | "title" | "landmarkName" | "riddle" | "anecdote" | "arCharacterDialogue" | "arTreasureReward"> & { hint: string }>;
}

/** Résultat audio pour une langue donnée. */
export interface AudioResult {
  language: string;
  files: Array<{
    stepOrder: number;
    slot: "intro" | "epilogue" | "riddle" | "character" | "anecdote";
    storagePath: string;
    publicUrl: string;
    duration: number;
  }>;
}

/** Résultat global du pipeline v2 pour persistance. */
export interface PipelineV2Output {
  input: PipelineInput;
  discovery: DiscoveryResult;
  geocode: GeocodeResult;
  structure: StructuredGame;
  translations: TranslationResult[];
  audios: AudioResult[];
  qualityFlags: QualityFlag[];
  needsReview: boolean;
  reviewReason?: string;
}

/** Un signal de qualité levé pendant le pipeline. */
export interface QualityFlag {
  phase: "discovery" | "geocode" | "structure" | "translate" | "audio";
  severity: "info" | "warning" | "critical";
  message: string;
}
