/**
 * Game Generation Pipeline — INTENT-FIRST CANONICAL FLOW
 *
 * Single-flow architecture (no branches sur les stops opérateur) :
 *   discoverParcours (Perplexity + Google Places + walkability)
 *     → adaptNarrative (Claude)
 *     → generateGameSteps (Claude #1, énigmes)
 *     → validateGeneratedSteps + regenerateStep si bloquant
 *     → fetchPhotosForSteps (Wikipedia, parallèle)
 *     → generateEpilogue (Claude, parallèle)
 *     → insertGameIntoDatabase
 *
 * L'opérateur (oddballtrip) transmet UNIQUEMENT l'intention :
 *   { city, country, theme, themeDescription, narrative, startPoint, stopCount }
 *
 * Le champ legacy `template.stops[]` est silencieusement ignoré.
 */

import {
  type PredefinedStop,
  type ResearchedLocation,
} from "./perplexity";
import {
  generateGameSteps,
  generateTourSteps,
  type GeneratedTourStep,
  generateEpilogue,
  generateIntroSpeech,
  generateFinalRiddle,
  validateGeneratedSteps,
  regenerateStep,
  adaptNarrativeForReplacedStops,
  type GeneratedEpilogue,
  type GeneratedStep,
} from "./anthropic";
import { createAdminClient } from "./supabase/admin";
import {
  geocodeLocation,
  haversineMeters,
  discoverNearbyLandmarks,
  type NearbyCandidate,
} from "./geocode";

/**
 * Sélectionne le meilleur landmark d'une ville pour servir de startPoint.
 * Critère : rating × log(reviews) + bonus pour types prestigieux (cathedral,
 * castle, monument, etc.). Le meilleur landmark devient le point de départ
 * du jeu — précision Google Places sub-10m.
 *
 * Utilisé en fallback quand OddballTrip n'a pas fourni de `startPointText`
 * géocodable. Garantit qu'on a TOUJOURS un point de départ précis et
 * touristiquement pertinent, jamais juste un "city center" flou.
 */
function pickTopLandmarkForStartPoint(
  candidates: NearbyCandidate[],
): NearbyCandidate {
  const PRESTIGE_TYPES: Record<string, number> = {
    cathedral: 5.0,
    castle: 4.5,
    fort: 4.0,
    palace: 4.5,
    monument: 4.0,
    historical_landmark: 4.0,
    tourist_attraction: 3.0,
    museum: 2.5,
    church: 2.0,
    city_hall: 2.0,
    place_of_worship: 1.5,
  };
  const scored = candidates.map((c) => {
    const rating = c.rating ?? 3.5;
    const reviews = c.userRatingsTotal ?? 1;
    const ratingScore = (rating - 3) * Math.log10(reviews + 1);
    let typeBonus = 0;
    for (const t of c.types ?? []) {
      typeBonus += PRESTIGE_TYPES[t] ?? 0;
    }
    return { candidate: c, score: ratingScore + typeBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].candidate;
}
import {
  discoverParcours,
  type DiscoveredStop,
} from "./parcours-discovery";
import {
  deepResearchTheme,
  type VerifiedThemeContext,
} from "./perplexity";
// prepareGamePackage + validateFinalGame + attemptAutoRepair moved to
// Lambda 2 (pipeline-finalize.ts + /api/internal/finalize-game route)
// for proper Vercel maxDuration handling. Cf. CHAINED PIPELINE block below.
import { pickFallbackGuide, AR_CHARACTERS } from "./ar-sprites";
import { type GameGenre, DEFAULT_GENRE } from "./game-genres";
import { v4 as uuidv4 } from "uuid";

export interface GameTemplate {
  slug: string;
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
  /**
   * (Sprint 6.2ter, 2026-05-22) Rich product page description sent by
   * OddballTrip (commit bedef90). The ~700-1000 char paragraph that
   * names the SPECIFIC landmarks, role-play angle, and AR mechanics
   * promised to the customer on the product page.
   *
   * Used as the canonical grounding text across every downstream
   * prompt :
   *   - Phase 1a Perplexity DR  — factual research anchored on the
   *     landmarks the product description NAMES
   *   - Phase 1b discovery       — Claude scoring boosts candidates
   *     whose name appears in productDescription
   *   - Phase 2a narration       — Claude reproduces the role-play
   *     and AR mechanics promised (e.g. "émissaire Catherine de Médicis")
   *   - Thematic-fit judge       — judge calibrates on this richer
   *     reference instead of the short themeDescription
   *   - Validator                — checks promised landmarks present
   *
   * Optional / empty acceptable : when missing, pipeline falls back to
   * themeDescription + narrative as before.
   */
  productDescription?: string;
  difficulty: number; // 1-5
  estimatedDurationMin: number;
  coverImage?: string;
  /**
   * Point de départ du parcours, transmis par oddballtrip. C'est LE
   * point de référence du jeu — pas le centre-ville officiel.
   *
   * Pourquoi c'est critique : un parcours peut tenir dans un quartier
   * (Montmartre à Paris, Trastevere à Rome, le centre historique de
   * Tournus dans une grande agglomération) qui est lui-même à
   * plusieurs km du "centre-ville" géocodé. Si on filtrait les stops
   * sur leur distance au centre-ville, tous les landmarks Montmartre
   * seraient rejetés à Paris alors qu'ils forment un parcours
   * parfaitement cohérent à pied.
   *
   * Comportement quand absent :
   *   1. coords du PREMIER stop opérateur géocodé → c'est le stop où
   *      le joueur démarre, donc le start naturel du parcours.
   *   2. en dernier recours (si 0 stop géocode), on retombe sur le
   *      centre-ville géocodé pour pouvoir au moins déclencher
   *      l'auto-discovery sur la zone.
   *
   * Recommandation forte côté oddballtrip : transmettre startPoint
   * explicitement. C'est le contrat le plus fiable pour les grandes
   * villes où le parcours ne couvre qu'un quartier.
   */
  startPoint?: { lat: number; lon: number };
  /**
   * Description textuelle PRÉCISE du point de rendez-vous transmise
   * par oddballtrip — ce que le client lit sur la fiche produit
   * ("Départ sur le parvis de Notre-Dame de Paris", "Devant le phare
   * de Saint-Mathieu", "Plaza del Charco, devant la fontaine").
   *
   * Quand fourni, le pipeline le géocode via Google Places et l'utilise
   * comme SOURCE D'AUTORITÉ pour le startPoint réel — beaucoup plus
   * précis que body.city (qui géocode au centre admin générique) ou
   * body.startPoint (qui peut être corrompu post-refonte).
   *
   * Si le géocode du texte réussit ET diverge de body.startPoint de
   * plus de 20km, on override body.startPoint par le texte géocodé.
   * Le jeu publie au bon endroit (au mètre près du checkpoint réel).
   */
  startPointText?: string;
  /**
   * S9 (2026-05-18) — Mode du jeu :
   *   - "city_game" (default) : escape game classique avec énigmes,
   *     indices, code final, mécanique M3 sur final_answer.
   *   - "city_tour" : audioguide enrichi (narration encyclopédique
   *     longue par stop, AR orientation conservée, personnages
   *     parlants, PAS d'énigmes ni code final).
   *
   * Phase 1 (cette commit) : juste le champ propagé en DB.
   *   - Pipeline tour ALT (prompts encyclopédiques) : TODO
   *   - Page de choix à l'activation : TODO
   *   - Player UI conditionnelle : TODO
   *
   * Pour la Phase 1, mode="city_tour" est inserté en DB mais la pipeline
   * de génération produit le MÊME contenu qu'un city_game. Permet de
   * tester le flag avant de brancher la logique alt.
   */
  mode?: "city_game" | "city_tour";
  /** Combien de stops au final dans le jeu (défaut 8). Dans le modèle
   *  intent-first, c'est ce nombre que Perplexity essaie de produire,
   *  filtré ensuite par géocodage et walkability. Plancher dur = 6 ;
   *  en dessous le pipeline rejette. */
  stopCount?: number;
  /**
   * Langue de l'acheteur (code ISO 2 lettres : "fr", "en", "de"...).
   *
   * Quand fournie, le pipeline lance EN AUTOMATIQUE
   * `prepareGamePackage(gameId, language)` après l'insert DB :
   * traduction de tous les textes (riddle/anecdote/dialogue/hints) +
   * génération de tous les audios (8 stops × 3 slots = 24 MP3) via
   * ElevenLabs, stockés en Supabase Storage. Résultat : zéro latence
   * pour le joueur quand il démarre la session.
   *
   * Ajoute ~30-60 sec à la génération mais évite ~60 sec de latence
   * cumulés en cours de session. Si absent, on log un warning et le
   * jeu publie quand même (audios générés lazy à la demande, mais
   * latence pénible pour le joueur).
   */
  language?: string;
  /**
   * Genre narratif du jeu. Détermine la tonalité, le style des mots
   * magiques, le biais AR character et le cadrage de l'épilogue, sans
   * toucher aux stops réels. Mêmes POIs Aegina jouables `historical`,
   * `mystery`, `fantasy`...
   *
   * MVP : transmis par oddballtrip dans le body API, propagé en mémoire
   * dans le pipeline UNIQUEMENT — pas de col DB. Si l'expérience tient,
   * Phase 2 = migration. Si elle casse, `git revert` propre.
   *
   * Fallback : `historical` (cf. DEFAULT_GENRE in game-genres.ts).
   */
  genre?: GameGenre;
  /** [LEGACY] Stops fournis par oddballtrip. Dans le modèle intent-first
   *  ce champ est SILENCIEUSEMENT IGNORÉ — Perplexity découvre les
   *  landmarks à partir du theme + startPoint. Conservé dans le type
   *  uniquement pour rétrocompat avec les anciens appels API. */
  stops?: PredefinedStop[];
  /**
   * Mode d'accessibilité du parcours :
   *
   *   - `any` (défaut)  : pas de contrainte — la pipeline pioche dans
   *                       tous les types Google Places (musées, galeries,
   *                       monuments inclus). Le joueur peut tomber sur un
   *                       stop ticketé et payer son entrée si nécessaire.
   *   - `free`          : la pipeline EXCLUT les POIs payants connus
   *                       (museum, art_gallery) du nearbysearch ET passe
   *                       une directive Claude pour rejeter tout candidat
   *                       potentiellement ticketé. Le joueur termine le
   *                       parcours 100% depuis la voie publique sans
   *                       jamais avoir à payer.
   *
   * Cas d'usage : fiches "balade gratuite Klook", marché price-sensitive,
   * tour scolaire, scénario marche urbaine. Les POIs payants exclus
   * peuvent être surfacés séparément en upsell GYG cross-sell post-jeu.
   */
  accessibility?: "free" | "any";
  /**
   * Mode de transport du parcours. Détermine la zone de discovery,
   * la distance MAX entre stops, le rayon de validation GPS et le
   * TTL du code activation.
   *
   *   - `walking` (default) : 1.5 km radius, 1.4 km max-hop, 30-50m
   *                            validation, code valide 24h
   *   - `driving`           : voiture entre TOUS les sites, jusqu'à
   *                            50 km radius, 30 km max-hop, 200-500m
   *                            validation, code valide jusqu'à
   *                            (recommendedDaysMax + 7) × 24 heures
   *   - `mixed`             : voiture entre les sites + à pied SUR
   *                            chaque site (centres historiques,
   *                            parcs archéo, médinas). Mêmes
   *                            paramètres que `driving` côté radius.
   *
   * Cf. contrat OddballTrip 2026-05-10. `walking` est strictement
   * rétrocompat avec le comportement historique.
   */
  transportMode?: "walking" | "driving" | "mixed";
  /**
   * Rayon de discovery autour du startPoint, en kilomètres. Si absent :
   *   • walking → 1.5 km (existant, comportement inchangé)
   *   • driving / mixed → 30 km (default contrat OddballTrip)
   *
   * OddballTrip teste actuellement jusqu'à 50 km (diamètre 100 km).
   * La pipeline accepte jusqu'à 60 km hard cap pour éviter les payloads
   * cassés (rayon > 60 km → couvre une région entière, narratif
   * impossible à tenir).
   */
  radiusKm?: number;
  /**
   * Durée recommandée du roadtrip, en jours. Affichée en intro player :
   *   "Ce roadtrip se joue sur X à Y jours, à votre rythme."
   *
   * Sert également à calculer code_validity_hours :
   *   code_validity_hours = (recommendedDaysMax + 7) × 24
   *   ex: 4 jours max → 264h
   *       6 jours max → 312h
   */
  recommendedDaysMin?: number;
  recommendedDaysMax?: number;
  /**
   * Sites pré-curatés par OddballTrip via Perplexity Deep Research
   * (1ère passe). SUGGESTIONS, pas contraintes : la pipeline peut les
   * utiliser comme priorité, les compléter, ou en substituer si la
   * discovery trouve mieux.
   *
   * Le champ `access` est important pour le ratio "free access" :
   *   - `libre`  : énigme posée dessus, 100% extérieur
   *   - `payant` : mentionné dans la narration mais énigme depuis
   *                 l'extérieur (façade, parvis, vue)
   *   - `mixte`  : entrée payante mais partie libre exploitable
   *
   * Critère qualité OddballTrip : ≥50% des stops finaux doivent être
   * en accès libre, sinon needs_review='free_access_ratio_low'.
   */
  roadtripSeedSites?: Array<{
    name: string;
    access: "libre" | "payant" | "mixte";
    lat?: number;
    lon?: number;
    note?: string;
  }>;
  /**
   * GPS-FIRST MODE — operator clicks N pins on a satellite map and
   * provides their exact coords + landmark names. When this field is
   * set, the research + geocoding phases are SKIPPED entirely; the
   * pins are taken at face value as the ground-truth coordinates of
   * the game. This is the only mode that guarantees < 10 m precision
   * (LLMs hallucinate coords by 50-2 800 m on average).
   *
   * Each waypoint's `lat`/`lon` is stored verbatim in
   * `game_steps.latitude/longitude`. Each `landmarkName` is stored in
   * `game_steps.landmark_name` (hidden from players, used by audit /
   * re-geocoding tools). Claude only writes the poetic title + riddle
   * + AR answer, never touches the coord.
   */
  waypoints?: GameWaypoint[];
}

export interface GameWaypoint {
  /** Latitude as clicked by the operator on the satellite map. */
  lat: number;
  /** Longitude as clicked by the operator on the satellite map. */
  lon: number;
  /** The real landmark name ("Abbaye Saint-Philibert"). Stored in DB
   *  as `landmark_name` for audit. NEVER shown to players. */
  landmarkName: string;
  /** Optional context to help Claude write the riddle (e.g.
   *  "the carved pediment above the main door", "8th-c. crypt"). */
  context?: string;
}

/**
 * Machine-parseable error code attached to a PipelineResult when
 * `success === false`. Lets the caller (oddballtrip) react in a
 * structured way — surface a precise message to the operator,
 * highlight which stops to fix, route to a recovery flow.
 */
export type PipelineErrorCode =
  | "GEOCODING_FAILED"
  | "DISCOVERY_FAILED"
  | "TOO_FEW_LANDMARKS"
  | "PARCOURS_TOO_DISPERSED"
  | "GENERATION_FAILED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export interface FailedLandmark {
  stopName: string;
  /** All names the geocoder was tried with. Usually 1 (landmarkName)
   *  or 2 (landmarkName then name as fallback). */
  tried: string[];
}

/**
 * Description d'un stop remplacé par auto-discovery. Permet à oddballtrip
 * (et à l'opérateur via le mail d'alerte) de savoir que la fiche produit
 * doit être ajustée : la narration a été régénérée pour matcher les
 * nouveaux POIs, donc le pitch / le titre des étapes affichés sur la
 * page de vente ne correspondent plus aux ressources fournies au départ.
 */
export interface ReplacedStop {
  /** Nom du stop tel qu'envoyé par oddballtrip (le poétique). */
  original: string;
  /** Nom Google du POI auto-découvert qui le remplace. */
  replacement: string;
  /** place_id Google — utile si oddballtrip veut afficher une fiche POI. */
  replacementPlaceId?: string;
  /** Coordonnées définitives du nouveau stop. */
  lat: number;
  lon: number;
}

/**
 * Bloc renvoyé à oddballtrip quand la narration a été régénérée par
 * Claude après des remplacements de stops. La fiche produit doit être
 * mise à jour pour refléter ce nouveau contenu (sinon le client
 * achète X et joue Y).
 */
export interface AdaptedNarrativePayload {
  themeDescription: string;
  narrative: string;
  /** Nom poétique des stops dans l'ordre du parcours final. */
  stopNames: string[];
}

/**
 * Item exposé dans la réponse `landmarks[]` du callback de succès. Permet
 * à oddballtrip de rafraîchir sa fiche produit avec les vrais POIs
 * découverts par le pipeline + leurs photos historiques.
 */
export interface PublishedLandmark {
  /** Nom poétique côté joueur ("The Command Post"), réécrit par Claude. */
  name: string;
  /** Nom géocodable du POI réel ("Château de Clervaux, Clervaux"). */
  landmarkName: string;
  lat: number;
  lon: number;
  /** URL Wikipedia/heritage de la photo historique si trouvée. */
  /** Champ retiré (Wikipedia photos drop le 2026-05-05). Toujours null. */
  photoUrl?: null;
  /** Lien thématique documenté (issu de Perplexity). */
  themeLink?: string;
  /** URL source citée par Perplexity (audit). */
  source?: string;
}

export interface PipelineResult {
  success: boolean;
  gameId?: string;
  error?: string;
  /** Structured failure category for callers to switch on. */
  errorCode?: PipelineErrorCode;
  /**
   * TRUE quand la sanity-check post-discovery a détecté une anomalie
   * (typiquement centroïde des stops > 5 km du body.startPoint = signal
   * "label SEO pris pour zone-jeu" type Brest centre vs. Pointe Saint-
   * Mathieu). Le jeu est tout de même publié, mais oddballtrip DOIT
   * tenir l'envoi du code activation au client jusqu'à inspection.
   */
  needsReview?: boolean;
  /** Message human-readable expliquant pourquoi `needsReview=true`. */
  reviewReason?: string;
  /** When errorCode === "GEOCODING_FAILED" / "DISCOVERY_FAILED": the
   *  list of landmark names the pipeline could not use. Useful for
   *  audit / debugging — not actionable by oddballtrip in the
   *  intent-first model. */
  failedLandmarks?: FailedLandmark[];
  /** Liste canonique des landmarks publiés. Toujours présent sur
   *  succès dans le modèle intent-first. oddballtrip s'en sert pour
   *  rafraîchir sa fiche produit. */
  landmarks?: PublishedLandmark[];
  /**
   * Quelle source a alimenté la discovery — propagé depuis
   * DiscoverParcoursResult pour observabilité admin. Permet de
   * détecter en prod si un jeu est tombé sur le fallback Google
   * Places legacy au lieu de Gemini Pro thématique.
   */
  discoverySource?: "gemini_thematic" | "google_places";
  /** Candidats Perplexity rejetés au géocodage ou par le filtre
   *  walkability. Loggés pour audit, non bloquants si on a réussi
   *  à publier le jeu. */
  droppedStops?: FailedLandmark[];
  /** [LEGACY] Mapping ancien nom poétique → nouveau POI quand des
   *  stops opérateur étaient remplacés. Dans le modèle intent-first
   *  ce champ n'a plus d'utilité directe (TOUS les landmarks sont
   *  découverts), mais reste exposé pour rétrocompat avec les
   *  callers qui le consomment. */
  replacedStops?: ReplacedStop[];
  /** Scénario réécrit par Claude pour coller aux landmarks finaux.
   *  oddballtrip DOIT l'utiliser pour rafraîchir la fiche produit
   *  côté commerce, sinon le client achète X et joue Y. */
  adaptedNarrative?: AdaptedNarrativePayload;
  durationMs?: number;
  steps?: number;
  researchDurationMs?: number;
  creationDurationMs?: number;
}

/**
 * Minimum number of geocoded stops required to publish a game. Below
 * this threshold, the parcours is too short to deliver the promised
 * experience and the pipeline rejects rather than ship a stunted
 * game. 6 chosen as the floor: 8 expected − up to 2 drops tolerated.
 */
const MIN_STOPS_TO_PUBLISH = 6;

/**
 * Validation Roman numerals — détecte les hallucinations Claude type
 * MCCXXXI (=1231) au lieu de MCCLXXXI (=1281). Utilisé en post-process
 * generateGameSteps pour flagger needs_review si écart > 100 ans entre
 * la valeur décodée et l'année probable mentionnée dans le riddle/anecdote.
 *
 * Cas observé prod 2026-05-07 (Hakata) : answer_text="MCCXXXI" alors que
 * riddle parlait clairement de 1281 (Mongol invasion). Bug récurrent
 * Claude sur les conversions int → Roman manuelles.
 */
function isRomanNumeral(s: string): boolean {
  // Strict pattern : que des caractères Roman, longueur 1-15
  return /^[MDCLXVI]+$/.test(s) && s.length <= 15;
}

function decodeRoman(s: string): number | null {
  const values: Record<string, number> = {
    M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1,
  };
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = values[s[i]];
    if (!v) return null;
    total += v < prev ? -v : v;
    prev = v;
  }
  return total;
}

function encodeRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const lookup: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  let remainder = n;
  for (const [value, symbol] of lookup) {
    while (remainder >= value) {
      result += symbol;
      remainder -= value;
    }
  }
  return result;
}

/**
 * Distance maximale autorisée entre deux stops consécutifs après le greedy
 * nearest-neighbor reorder, en mètres. Au-delà, le parcours impose une
 * marche absurde au joueur (ex. Saint-Joseph Clervaux à 2 200 m du stop
 * précédent — invalidé par cette règle).
 *
 * Pourquoi 1 000 m : un escape game cumule typiquement 4 km de marche
 * sur 8 stops, soit ~500 m moyens entre stops. Le double (1 km) est
 * tolérable comme cas limite, au-delà la régularité du parcours casse.
 */
const MAX_INTER_STOP_M = 1_000;

/**
 * Phase 1 output — JSON-sérialisable bundle passé du step Inngest 1 au step 2.
 *
 * Pourquoi un type explicite : la fonction `generateGameFromTemplate` est
 * splittée en 2 phases (discovery + narrative/insert) pour passer le timeout
 * Vercel 800s par step Inngest (vision 2026-05-20, post-incident roadtrips
 * radius 60km qui timeoutaient à 800030ms exactement).
 *
 * Cette structure DOIT être 100% JSON-sérialisable (pas de Map, Set, Date
 * object, ni de classes). Inngest sérialise/désérialise le payload entre
 * step.run() calls.
 *
 * Variant `success: false` propage les codes d'erreur structurés vers le
 * wrapper, qui peut alors retourner un `PipelineResult` cohérent.
 */
export type Phase1Result =
  | {
      success: true;
      /** ResearchedLocation[] adapté pour Claude downstream (Phase 2). */
      verifiedLocations: ResearchedLocation[];
      /** Landmarks bruts issus de la discovery — utilisés en Phase 2 pour :
       *  (a) adapter la narration via `adaptNarrativeForReplacedStops`,
       *  (b) construire le payload `landmarks[]` final retourné à OddballTrip. */
      discoveryLandmarks: DiscoveredStop[];
      /** Contexte Perplexity passé à generateGameSteps / generateTourSteps
       *  comme anchors factuels. Optionnel — vide si Perplexity HS. */
      discoveryVerifiedContext: VerifiedThemeContext | undefined;
      /** Candidats Perplexity rejetés (audit, exposé dans droppedStops). */
      discoveryRejected: Array<{ name: string; reason: string }>;
      /** Source du pool de candidats : Gemini thématique ou Google Places fallback. */
      discoverySource: "gemini_thematic" | "google_places" | undefined;
      /** Si la discovery a auto-escaladé walking → mixed/driving (densité POI
       *  insuffisante), on porte la nouvelle valeur ici pour l'INSERT DB. */
      escalatedTransportMode: "walking" | "mixed" | "driving" | undefined;
      /** Difficulté effective après auto-bump widening (peut différer de
       *  template.difficulty si widening 2.5x triggered). */
      effectiveDifficulty: number;
      /** Flag sanity-check (cluster centroid drift, free access ratio,
       *  widening 2.5x). Non-bloquant : le jeu publie quand même mais
       *  OddballTrip retient le code activation jusqu'à inspection. */
      needsReview: boolean;
      reviewReason: string | undefined;
      /** Mode du stop indexé par step_order-1 : "radar" (POI Google indexé,
       *  validation 30m) ou "narrative" (sub-monument non-indexé, validation
       *  80m, hint navigation prepended au riddle). */
      stopModes: Array<"radar" | "narrative">;
      /** Hints de navigation pour les stops "narrative". `null` au lieu
       *  d'`undefined` pour rester JSON-safe. */
      navigationHints: Array<string | null>;
      /** Durée de la phase recherche en ms — propagée au PipelineResult final. */
      researchDurationMs: number;
      /** Plancher/plafond commercial appliqué (6 ≤ stopCount ≤ 9 ou 15
       *  selon mode). Utile pour les logs en Phase 2. */
      resolvedStopCount: number;
      /** (2026-05-21) StartPoint résolu par STEP 0 (geocodage du
       *  startPointText OddballTrip, ou top-landmark Google, ou
       *  city-center fallback). Persisté en DB pour debug post-facto
       *  + affichage admin/player. */
      resolvedStartPoint: { lat: number; lon: number };
      resolvedStartPointText: string;
      resolvedStartPointSource:
        | "startPointText-geocoded"
        | "top-landmark-google-places"
        | "city-center-fallback";
      /**
       * (Sprint 6.2quater, 2026-05-22) — Full Google Places candidate
       * pool exposed by Phase 1b discovery, for thematic auto-repair
       * (Phase 1b5). The selected stops are in `discoveryLandmarks` ;
       * `allCandidates` carries the 53+ non-selected POIs that may
       * better fit the theme. JSON-serializable for Inngest.
       */
      allCandidates: Array<{
        name: string;
        lat: number;
        lon: number;
        placeId: string;
        types: string[];
        address?: string;
        rating?: number;
        userRatingsTotal?: number;
        distanceM: number;
      }>;
    }
  | {
      success: false;
      error: string;
      errorCode: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
      researchDurationMs: number;
    };

/**
 * Phase 2a output — narration + stops finalisés (STEP 3 → 5.5).
 *
 * JSON-sérialisable (passé via Inngest step.run()). Re-propage les variables
 * Phase 1 qui ont été MUTÉES en Phase 2a (verifiedLocations[i].name +
 * .whatToObserve sont écrasés par adaptNarrativeForReplacedStops). Le flag
 * needsReview/reviewReason peut aussi muter (Roman drift ambigu, etc.).
 *
 * Variant `success: false` propage l'erreur structurée vers Phase 2c (skip)
 * et vers le wrapper sync.
 */
export type Phase2aResult =
  | {
      success: true;
      steps: GeneratedStep[];
      tourSteps: GeneratedTourStep[];
      adaptedNarrative: AdaptedNarrativePayload | undefined;
      effectiveNarrative: string;
      effectiveThemeDescription: string;
      /** verifiedLocations APRÈS mutation par STEP 3 (adaptNarrativeForReplacedStops).
       *  Phase 2c utilise ces noms poétiques en DB. */
      verifiedLocationsAfterAdapt: ResearchedLocation[];
      needsReview: boolean;
      reviewReason: string | undefined;
      creationDurationMs: number;
    }
  | {
      success: false;
      error: string;
      errorCode: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
      durationMs: number;
    };

/**
 * Phase 2b output — blocs game-wide (épilogue + intro + final riddle).
 *
 * Tous nullable : aucune génération n'est bloquante côté pipeline (le jeu
 * publie même si Claude refuse l'épilogue ou l'énigme finale). Phase 2b
 * peut donc safely "succeed" même si les 3 résultats sont null.
 *
 * Pas de variant `success: false` : les erreurs internes sont catchées
 * et matérialisées comme valeurs `null`. Si la phase elle-même throw (cas
 * extrême), c'est remonté au caller — non bloquant côté Inngest car
 * le retry function va re-tenter.
 */
export interface Phase2bResult {
  success: true;
  epilogue: GeneratedEpilogue | null;
  introSpeech: { text: string } | null;
  finalRiddle: { riddle: string; answer: string; explanation: string } | null;
  durationMs: number;
}

/**
 * Generate a complete game from a template
 * This is the main pipeline entry point
 */
/**
 * Generate a complete game from a template — INTENT-FIRST CANONICAL PIPELINE.
 *
 * Modèle :
 *   1. Resolve startPoint (template.startPoint, ou fallback city center).
 *   2. Discovery : Perplexity propose, Google Places géocode, walkability filtre.
 *   3. Adapt narrative : Claude réécrit themeDescription + narrative + noms
 *      poétiques pour coller aux landmarks réels découverts.
 *   4. Generate riddles : Claude écrit l'énigme + hints + AR pour chaque stop.
 *   5. Validate : second-pass QA Claude, regen au besoin.
 *   6. Photos historiques (Wikipedia) + epilogue.
 *   7. Insert DB.
 *
 * Le champ legacy `template.stops[]` est silencieusement IGNORÉ — la
 * découverte est intégralement déléguée à Perplexity. C'est le seul
 * levier de qualité, donc le seul à monitorer / tuner.
 */
/**
 * Phase 1 — DISCOVERY (STEP 0-2).
 *
 * Extrait de `generateGameFromTemplate` (2026-05-20) pour passer le timeout
 * Vercel 800s par step Inngest : roadtrips radius 30-60km mettaient 5-7 min
 * en discovery + 2-5 min en narration → total > 800s → 504, rien persisté.
 *
 * Split Phase 1 (cette fonction, ~5-7 min budget) + Phase 2 (narrative +
 * insert, ~2-5 min budget) → chaque step a son propre budget 800s.
 *
 * Contient :
 *   - STEP 0  : Résolution + auto-correction du startPoint
 *   - STEP 1  : Discovery widening progressif (1× → 1.5× → 2.5×)
 *   - STEP 1.5: Sanity-check cluster centroid drift
 *   - STEP 1.6: Free access ratio (roadtrip uniquement) + widening 2.5x flag
 *   - STEP 2  : Convert DiscoveredStop → ResearchedLocation[]
 *
 * Retourne un bundle 100% JSON-sérialisable (`Phase1Result`) passé tel quel
 * à `runPipelinePhase2NarrativeAndInsert`. Erreurs taggées avec
 * `PipelineErrorCode` pour cohérence avec `PipelineResult`.
 */
/**
 * Phase 1a (2026-05-21) — Perplexity Deep Research ISOLÉ.
 *
 * Pourquoi ce sub-step distinct :
 *   `deepResearchTheme()` utilise le modèle `sonar-deep-research` qui produit
 *   un rapport sourcé long (50k chars typique). Wall time observé : 2-5 min
 *   sur thèmes complexes (roadtrip Loire châteaux = 30 km + multi-figures
 *   historiques, par ex.). Combiné avec Google nearbysearch + Claude scoring
 *   dans le même `step.run()` Inngest, on dépassait le timeout HTTP entre
 *   Inngest Cloud et le SDK Vercel (~2m43s observé en prod 2026-05-21 sur
 *   `le-codex-oublie-des-reines`).
 *
 *   En sortant Perplexity DR dans un step.run() dédié, on lui donne sa propre
 *   fenêtre de timeout. Le résultat (`VerifiedThemeContext`, ~3-10 KB) est
 *   JSON-sérialisable et injecté dans `runPipelinePhase1Discovery` via
 *   `injectedVerifiedContext`, qui skip alors l'appel Perplexity interne.
 *
 *   ⚠️ QUALITÉ : aucune dégradation. Même modèle (sonar-deep-research), même
 *   prompt, même extraction Claude vers JSON structuré. La seule différence
 *   est l'isolation Inngest.
 *
 * Retourne `VerifiedThemeContext` (jamais throw — fallback `EMPTY_CONTEXT`
 * si Perplexity API HS).
 */
export async function runPipelinePhase1aDeepResearch(
  template: GameTemplate,
): Promise<VerifiedThemeContext> {
  const t0 = Date.now();
  console.log(
    `[Pipeline 1a] Deep Research START for theme="${template.theme}" in ${template.city}`,
  );
  const ctx = await deepResearchTheme({
    city: template.city,
    country: template.country,
    theme: template.theme,
    themeDescription: template.themeDescription,
    narrative: template.narrative,
    // Sprint 6.2ter (2026-05-22) — rich grounding text
    productDescription: template.productDescription,
  });
  const ms = Date.now() - t0;
  console.log(
    `[Pipeline 1a] Deep Research DONE in ${Math.round(ms / 1000)}s — ${ctx.iconicSites.length} iconic sites, ${ctx.realFigures.length} figures, ${ctx.events.length} events`,
  );
  return ctx;
}

export async function runPipelinePhase1Discovery(
  template: GameTemplate,
  /**
   * (2026-05-21) Si fourni, on saute l'appel Perplexity Deep Research interne
   * (déjà fait par `runPipelinePhase1aDeepResearch` dans le step Inngest
   * amont). On l'injecte dans `discoverParcours` via `injectedVerifiedContext`.
   *
   * Si absent : comportement legacy, `discoverParcours` lance Perplexity DR
   * en parallèle des nearbysearches Google.
   */
  injectedVerifiedContext?: VerifiedThemeContext,
): Promise<Phase1Result> {
  const phase1Start = Date.now();

  if (template.stops?.length) {
    console.warn(
      `[Pipeline] body.stops[] (${template.stops.length} item(s)) is IGNORED in intent-first mode — Perplexity will discover landmarks from theme + startPoint`,
    );
  }

  try {
    console.log(
      `[Pipeline] Starting intent-first generation: "${template.theme}" in ${template.city}`,
    );

    // ============================================
    // STEP 0 : Résoudre + AUTO-CORRIGER le point de départ
    // ============================================
    // Hiérarchie de SOURCE D'AUTORITÉ (du plus précis au plus générique) :
    //   1. template.startPointText géocodé — texte du checkpoint envoyé
    //      par oddballtrip ("Parvis de Notre-Dame de Paris", "Plaza del
    //      Charco devant la fontaine"). Précision ~5-30m.
    //   2. cityCenter géocodé (template.city) — centre admin de la ville.
    //      Précision ~500m.
    //   3. template.startPoint — les coords brutes envoyées par oddballtrip.
    //      Précision variable (peut être corrompu post-refonte).
    //
    // Stratégie : on prend la 1ère source disponible comme RÉFÉRENCE, et on
    // override body.startPoint si drift > 20km. Le jeu publie au bon endroit,
    // peu importe la qualité du startPoint envoyé. needs_review = true si
    // override pour signaler le bug upstream à l'opérateur.
    const cityToGeocode = template.city.split(/\s*[·,]\s*/)[0].trim();

    // ═══════════════════════════════════════════════════════════════════
    // RÉSOLUTION DU STARTPOINT — politique 2026-05-13
    // ═══════════════════════════════════════════════════════════════════
    //
    // PRINCIPE FONDAMENTAL :
    //   On ne fait JAMAIS confiance à `body.startPoint` (coords numériques
    //   envoyées par OddballTrip). On a observé qu'OddballTrip envoie
    //   régulièrement des coords corrompues (Béziers 13/05 : startPoint
    //   à 39.3 km de la cathédrale Saint-Nazaire). C'est leur DB qui
    //   est merdique sur ce champ — on ne s'en sert PAS comme source.
    //
    // HIÉRARCHIE D'AUTORITÉ (du plus précis au plus dégradé) :
    //   1. startPointText géocodé via Google Maps Geocoding API
    //      → précision sub-10m sur les vrais landmarks (cathédrales,
    //        tours, monuments). Marche pour "Cathédrale Saint-Nazaire,
    //        Béziers", "Tour Saint-Nicolas, La Rochelle", etc.
    //
    //   2. TOP LANDMARK touristique de la ville via Google Places nearby
    //      → si OddballTrip n'envoie pas startPointText, on cherche le
    //        monument le plus iconique de la ville et on l'utilise comme
    //        point de départ. Beaucoup plus précis et thématique que
    //        cityCenter brut.
    //
    //   3. cityCenter géocodé (geocodeLocation du nom de la ville)
    //      → ultime fallback si même Google Places ne retourne rien
    //        (zone tropicale isolée, mauvais nom de ville, etc.).
    //
    // body.startPoint est IGNORÉ. Volontairement. Documenté.

    // 1. ESSAI PRINCIPAL — géocode startPointText si fourni
    let resolvedStartPoint: { lat: number; lon: number } | null = null;
    let resolvedStartPointLabel: string = ""; // (2026-05-21) tracked for DB persistence
    let startPointSource:
      | "startPointText-geocoded"
      | "top-landmark-google-places"
      | "city-center-fallback" = "city-center-fallback";

    if (template.startPointText && template.startPointText.trim()) {
      try {
        const geo = await geocodeLocation(
          template.startPointText,
          cityToGeocode,
          template.country,
        );
        if (geo) {
          resolvedStartPoint = { lat: geo.lat, lon: geo.lon };
          resolvedStartPointLabel = template.startPointText.trim();
          startPointSource = "startPointText-geocoded";
          console.log(
            `[Pipeline] startPoint resolved via Google geocoding of "${template.startPointText}" → ${resolvedStartPoint.lat.toFixed(6)},${resolvedStartPoint.lon.toFixed(6)} (precision sub-10m)`,
          );
        } else {
          console.warn(
            `[Pipeline] startPointText "${template.startPointText}" failed to geocode — falling back to top landmark`,
          );
        }
      } catch (err) {
        console.warn(
          `[Pipeline] startPointText geocode threw: ${err instanceof Error ? err.message : err} — falling back to top landmark`,
        );
      }
    }

    // 2. FALLBACK — top landmark touristique de la ville via Google Places
    if (!resolvedStartPoint) {
      try {
        // D'abord on geocode la ville pour avoir un centre approximatif
        // (point de référence pour la recherche nearby Google Places).
        const cityGeo = await geocodeLocation(
          cityToGeocode,
          cityToGeocode,
          template.country,
        );
        if (cityGeo) {
          console.log(
            `[Pipeline] Searching top landmark of ${cityToGeocode} via Google Places (radius 2km around city center)`,
          );
          const landmarks = await discoverNearbyLandmarks(
            { lat: cityGeo.lat, lon: cityGeo.lon },
            {
              radiusM: 2_000,
              limit: 30,
              // Types priorisés (monuments emblématiques) :
              types: [
                "tourist_attraction",
                "church",
                "museum",
                "city_hall",
                "place_of_worship",
              ],
            },
          );

          if (landmarks.length > 0) {
            // Pick le top par "score touristique" : rating × log(reviews)
            // + bonus pour types prestigieux (cathedral, monument, castle…).
            const topLandmark = pickTopLandmarkForStartPoint(landmarks);
            resolvedStartPoint = {
              lat: topLandmark.lat,
              lon: topLandmark.lon,
            };
            resolvedStartPointLabel = topLandmark.name;
            startPointSource = "top-landmark-google-places";
            console.log(
              `[Pipeline] startPoint resolved via Google Places top landmark: "${topLandmark.name}" (rating ${topLandmark.rating ?? "?"}/5, ${topLandmark.userRatingsTotal ?? "?"} reviews) → ${resolvedStartPoint.lat.toFixed(6)},${resolvedStartPoint.lon.toFixed(6)} (precision sub-10m)`,
            );
          } else {
            console.warn(
              `[Pipeline] No landmark found in Google Places for ${cityToGeocode} — falling back to city center`,
            );
            resolvedStartPoint = { lat: cityGeo.lat, lon: cityGeo.lon };
            resolvedStartPointLabel = cityToGeocode;
            startPointSource = "city-center-fallback";
            console.log(
              `[Pipeline] startPoint = city center ${resolvedStartPoint.lat.toFixed(6)},${resolvedStartPoint.lon.toFixed(6)} (precision ~500m)`,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[Pipeline] Top landmark / cityCenter resolution threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 3. ÉCHEC TOTAL — impossible de géocoder quoi que ce soit
    if (!resolvedStartPoint) {
      const err = new Error(
        `INTERNAL_ERROR: cannot resolve startPoint for "${template.city}, ${template.country}" — startPointText geocode failed, Google Places returned nothing, city geocode failed.`,
      ) as Error & { code?: PipelineErrorCode };
      err.code = "INTERNAL_ERROR";
      throw err;
    }

    const startPoint = resolvedStartPoint;
    // (gardé pour compatibilité avec le reste du code qui s'attendait à
    // ce champ — toujours null car on n'auto-corrige plus depuis body.startPoint,
    // on ignore directement)
    const startPointAutoCorrected: null = null;
    // Si body.startPoint était fourni, on log juste pour audit, sans plus.
    if (template.startPoint) {
      const drift = haversineMeters(startPoint, template.startPoint);
      console.log(
        `[Pipeline] body.startPoint (${template.startPoint.lat.toFixed(4)},${template.startPoint.lon.toFixed(4)}) IGNORED — drift ${Math.round(drift / 1000 * 10) / 10}km from resolved startPoint. We trust Google Maps, not OddballTrip's numeric field.`,
      );
    }
    void startPointSource; // garder TS happy si non utilisé downstream

    // Plancher commercial : 6 stops minimum.
    // Plafond selon mode :
    //   - city_game : 9 (parcours compact, défi cognitif, ~2h)
    //   - city_tour : 15 (audioguide enrichi, on saturé la richesse de la
    //                ville sans dépasser ~2h30 de marche)
    // Politique 2026-05-19 (S9) :
    //   - body.stopCount absent → default selon mode (9 escape, 12 tour)
    //   - clamp final dans [6, ceiling] où ceiling dépend du mode
    const isTourMode = template.mode === "city_tour";
    const stopCeiling = isTourMode ? 15 : 9;
    const defaultStops = isTourMode ? 12 : 9;
    const requestedStopCount = template.stopCount ?? defaultStops;
    const stopCount = Math.max(6, Math.min(stopCeiling, requestedStopCount));
    if (requestedStopCount < 6) {
      console.warn(
        `[Pipeline] stopCount=${requestedStopCount} below commercial floor of 6 — bumped to 6`,
      );
    } else if (requestedStopCount > stopCeiling) {
      console.warn(
        `[Pipeline] stopCount=${requestedStopCount} above ceiling for mode=${template.mode ?? "city_game"} (${stopCeiling}) — capped to ${stopCeiling}`,
      );
    }
    console.log(
      `[Pipeline] Mode=${template.mode ?? "city_game"} → stopCount=${stopCount} (ceiling=${stopCeiling}, default=${defaultStops})`,
    );

    // ============================================
    // STEP 1 : Discovery avec WIDENING progressif
    // ============================================
    // Si la zone est sparse au radius standard, on retry avec un radius
    // + max-hop élargis. 3 niveaux : 1× → 1.5× → 2.5×. Le seul rejet
    // possible est si même à 2.5× on a < 5 walkables (zone vraiment
    // impossible — auquel cas oddballtrip doit reframer la fiche).
    //
    // Quand le widening kick in, on auto-bumpe la difficulty publiée à
    // 5/5 ("parcours costaud, longues marches") pour ne pas surprendre
    // le joueur en lui vendant un facile dans une zone difficile.
    const researchStart = Date.now();
    const wideningAttempts = [
      { multiplier: 1, label: "standard" },
      { multiplier: 1.5, label: "widened" },
      { multiplier: 2.5, label: "wide" },
    ];
    const discoveryParamsBase = {
      city: template.city,
      country: template.country,
      theme: template.theme,
      themeDescription: template.themeDescription,
      narrative: template.narrative,
      // (Sprint I, 2026-05-22) — propagate rich productDescription so
      // the Claude landmark proposer can ground its proposals on the
      // customer's promise (specific landmarks named on the product
      // page get priority lookup).
      productDescription: template.productDescription,
      startPoint,
      stopCount,
      // accessibility="free" filtre les POIs payants côté Google + Claude.
      // Pas de défaut : undefined laisse parcours-discovery décider (= "any").
      accessibility: template.accessibility,
      // ── ROADTRIP (contrat OddballTrip 2026-05-10) ────────────────
      // transportMode "walking" → comportement historique inchangé.
      // "driving" / "mixed" → rayon élargi (radiusKm * 1000), seedSites
      // passés à Claude curation comme priorités éditoriales.
      transportMode: template.transportMode,
      radiusKm: template.radiusKm,
      roadtripSeedSites: template.roadtripSeedSites,
      // (2026-05-21) Inject le contexte Perplexity DR pré-calculé pour
      // sauter l'appel interne. Pas de dégradation qualité — c'est le
      // résultat du même appel, juste exécuté dans un step Inngest amont.
      injectedVerifiedContext,
    };
    console.log(
      `[Pipeline] Discovery attempt: ${wideningAttempts[0].label} (multiplier ${wideningAttempts[0].multiplier}x)${injectedVerifiedContext ? " [verifiedContext pré-injecté]" : ""}`,
    );
    let discovery = await discoverParcours({
      ...discoveryParamsBase,
      wideningMultiplier: wideningAttempts[0].multiplier,
    });
    let usedWidening = wideningAttempts[0];
    // 2026-05-13 v2 — Politique stopCount cible MODÉRÉE.
    //
    // V1 (matin) avait viseé stopCount - 1 (= 8 pour stopCount=9). Mais
    // chaque widening retry = 1 nouveau call Perplexity DR (slow, 30-60s)
    // + 1 nouveau call Claude curation. 2 retries = +3 min total. Combiné
    // avec step generation (2-4 min) on dépassait le Vercel 600s timeout.
    // Observé Béziers 13/05 11:45 → 504 Gateway Timeout.
    //
    // V2 : on accepte (stopCount - 3), soit 6 stops minimum pour stopCount=9.
    // Ça correspond au plancher commercial historique. Si discovery donne
    // 6+ stops d'un coup, on prend (pas de retry). Si < 6, widening kick in
    // mais c'est rare et justifié.
    //
    // Trade-off : on garde la possibilité d'avoir 6 stops parfois, mais on
    // ne timeout PLUS jamais. Mieux 6 stops livrés que 9 stops timeoutés.
    const targetStopCount = Math.max(6, stopCount - 3);
    for (const attempt of wideningAttempts.slice(1)) {
      if (discovery.success && discovery.landmarks.length >= targetStopCount) break;
      console.warn(
        `[Pipeline] ${usedWidening.label} attempt yielded ${discovery.success ? discovery.landmarks.length : 0} stops (target ≥${targetStopCount}) — retrying with ${attempt.label} (multiplier ${attempt.multiplier}x)`,
      );
      discovery = await discoverParcours({
        ...discoveryParamsBase,
        wideningMultiplier: attempt.multiplier,
      });
      usedWidening = attempt;
    }

    // ════════════════════════════════════════════════════════════════
    // PATCH 100% INSERT GUARANTEE (2026-05-23) — pas user demand
    // ════════════════════════════════════════════════════════════════
    // V1 throw-ait si < 6 stops trouvés → purchase customer bloquée,
    // refund Stripe nécessaire. Avec ce patch :
    //   - Si discovery a trouvé ≥ 3 stops → on publie avec needs_review
    //     (mieux qu'un jeu inexistant pour un client qui a payé)
    //   - Si < 3 stops → fallback ULTIME : Google Places top tourist
    //     attractions de la ville (théme-agnostique), publie 5 stops
    //     "découverte ville" + needs_review explicite
    //   - JAMAIS de throw qui crash le pipeline
    if (!discovery.success || discovery.landmarks.length < 3) {
      console.warn(
        `[Pipeline] Discovery returned ${discovery.success ? discovery.landmarks.length : 0} stops (need ≥3) — TRIGGERING THEME-AGNOSTIC FALLBACK to guarantee insert`,
      );
      try {
        const fallback = await discoverNearbyLandmarks(startPoint, {
          radiusM: 3000,
          limit: 30,
          types: [
            "tourist_attraction",
            "museum",
            "church",
            "park",
            "place_of_worship",
            "city_hall",
          ],
        });
        // Take top 5 by rating
        const topFallback = [...fallback]
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
          .slice(0, 5);
        if (topFallback.length >= 3) {
          discovery.landmarks = topFallback.map((c) => ({
            name: c.name,
            description: `Theme-agnostic fallback stop (Google top tourist_attraction in ${template.city})`,
            source: "fallback-tourist-attractions",
            lat: c.lat,
            lon: c.lon,
            placeId: c.placeId,
            distanceFromStartM: c.distanceM,
            stopMode: "radar" as const,
            navigationHint: undefined,
            types: c.types,
            rating: c.rating,
          }));
          discovery.success = true;
          console.warn(
            `[Pipeline] FALLBACK installed ${discovery.landmarks.length} generic stops for ${template.city} — game will publish with needs_review=true`,
          );
        } else {
          console.warn(
            `[Pipeline] Even fallback failed: only ${topFallback.length} top-rated POIs in 3km. Pipeline will throw.`,
          );
        }
      } catch (fallbackErr) {
        console.warn(
          `[Pipeline] Fallback discovery threw: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`,
        );
      }
    }
    // Final guard : if even fallback didn't work, then throw (genuinely
    // unfixable — e.g., Google Places API down OR city name invalid).
    if (!discovery.success || discovery.landmarks.length < 3) {
      const err = new Error(
        discovery.error ||
          `Pipeline fallback exhausted — Google Places returned ${discovery.landmarks.length} stops for "${template.city}". Most likely : invalid city name OR Google API down. Manual review required.`,
      ) as Error & {
        code?: PipelineErrorCode;
        failedLandmarks?: FailedLandmark[];
      };
      err.code = discovery.errorCode ?? "PARCOURS_TOO_DISPERSED";
      err.failedLandmarks = discovery.rejected.map((r) => ({
        stopName: r.name,
        tried: [r.reason],
      }));
      throw err;
    }

    const researchDurationMs = Date.now() - researchStart;
    console.log(
      `[Pipeline] Discovery complete in ${Math.round(researchDurationMs / 1000)}s — ${discovery.landmarks.length} landmarks (${discovery.rejected.length} rejected) — widening=${usedWidening.label}`,
    );

    // Auto-bump difficulty si widening a kick in. Le joueur achète un
    // jeu où on lui annonce des longues marches entre stops — on calibre
    // la promesse produit pour ne pas surprendre ("difficile" attendu).
    let effectiveDifficulty = template.difficulty;
    if (usedWidening.multiplier > 1) {
      effectiveDifficulty = 5;
      console.warn(
        `[Pipeline] Widening triggered (${usedWidening.label}, ${usedWidening.multiplier}x) — auto-bumping difficulty ${template.difficulty} → 5/5 (longues marches entre stops, parcours costaud)`,
      );
    }

    // ============================================
    // STEP 1.5 : Sanity-check cluster centroid
    // ============================================
    // Calcule le centroïde des stops découverts et compare au startPoint.
    // Si > CENTROID_DRIFT_M, c'est le signal type Brest : startPoint
    // pointe sur le label SEO (Brest centre) mais le parcours réel est
    // ailleurs (Pointe Saint-Mathieu à 22 km). Le widening + curation
    // Claude ont fait au mieux avec ce qu'ils avaient — mais on flag
    // le jeu pour review humaine avant émission du code activation.
    //
    // Non-bloquant : le jeu publie quand même (mieux qu'un rejet hard),
    // mais needs_review=true invite l'opérateur à inspecter.
    //
    // THRESHOLD (2026-05-21) : scalé par transportMode + radiusKm.
    //   - walking         : 5 km (le sens original — détecte un Brest
    //                       SEO drift de >5 km).
    //   - mixed / driving : max(5 km, radiusKm × 0.5) — un roadtrip
    //                       60 km est CONÇU pour que le startPoint
    //                       (Blois) soit à un coin de la play zone et
    //                       que le centroïde tombe plus loin (Loire
    //                       châteaux : centroïde à 25 km de Blois car
    //                       les châteaux sont à 0-35 km).
    //                       Hardcoder 5 km flag-erait toujours en faux
    //                       positif sur roadtrip.
    const isRoadtripPhase1 =
      template.transportMode === "mixed" || template.transportMode === "driving";
    const radiusKmPhase1 = template.radiusKm ?? 0;
    const CENTROID_DRIFT_M = isRoadtripPhase1
      ? Math.max(5_000, Math.round(radiusKmPhase1 * 500))
      : 5_000;
    let needsReview = false;
    let reviewReason: string | undefined;

    // PATCH 100% INSERT GUARANTEE — if we used the theme-agnostic
    // fallback (top tourist_attraction), force needs_review=true with
    // explicit reason so the operator knows.
    const usedFallback = discovery.landmarks.every(
      (l) => l.source === "fallback-tourist-attractions",
    );
    if (usedFallback) {
      needsReview = true;
      reviewReason = `[FALLBACK_THEME_AGNOSTIC] Theme-specific discovery returned <3 stops for theme "${template.theme}". Pipeline fell back to Google Places top tourist_attractions in ${template.city}. Game published WITHOUT theme alignment — operator MUST manually edit stops + narration before release, OR refund the customer.`;
      console.warn(`[Pipeline] ⚠ needs_review=true — ${reviewReason}`);
    }

    {
      const n = discovery.landmarks.length;
      const cx = discovery.landmarks.reduce((s, l) => s + l.lat, 0) / n;
      const cy = discovery.landmarks.reduce((s, l) => s + l.lon, 0) / n;
      const drift = haversineMeters(
        { lat: cx, lon: cy },
        { lat: startPoint.lat, lon: startPoint.lon },
      );
      if (drift > CENTROID_DRIFT_M) {
        needsReview = true;
        reviewReason = `Cluster centroid is ${Math.round(drift / 100) / 10} km from body.startPoint (threshold ${CENTROID_DRIFT_M / 1000} km for transportMode=${template.transportMode ?? "walking"}, radiusKm=${radiusKmPhase1}) — likely the body.startPoint targets a SEO label rather than the actual play zone. Inspect via dump-game before releasing the activation code.`;
        console.warn(`[Pipeline] ⚠ needs_review=true — ${reviewReason}`);
      } else {
        console.log(
          `[Pipeline] Cluster sanity-check OK — centroid drift ${Math.round(drift)}m < ${CENTROID_DRIFT_M}m (threshold for transportMode=${template.transportMode ?? "walking"}, radiusKm=${radiusKmPhase1})`,
        );
      }
    }

    // ============================================
    // STEP 1.6 : Free access ratio check (roadtrip uniquement)
    // ============================================
    // Critère qualité OddballTrip (contrat 2026-05-10) : ≥50% des stops
    // d'un parcours roadtrip doivent être en accès LIBRE (énigmes
    // jouables sans entrée payante). Sinon le client achète un parcours
    // mais doit payer 5-10 entrées de musée pour le terminer → mauvaise
    // expérience, bad reviews.
    //
    // Méthode : on cross-référence les stops finaux avec les
    // roadtripSeedSites (qui ont un champ `access` curé par OddballTrip
    // via Perplexity). Si <50% de match en "libre", needs_review=true
    // avec reason="free_access_ratio_low".
    //
    // Cas où on N'APPLIQUE PAS le check :
    //   - transportMode = walking (la fiche walking actuelle ne fait
    //     pas la distinction libre/payant — comportement inchangé)
    //   - roadtripSeedSites absent (pas de ground truth pour évaluer)
    const isRoadtrip =
      template.transportMode === "driving" || template.transportMode === "mixed";
    if (isRoadtrip && template.roadtripSeedSites?.length) {
      const seedByName = new Map<string, "libre" | "payant" | "mixte">();
      for (const s of template.roadtripSeedSites) {
        seedByName.set(s.name.toLowerCase(), s.access);
      }
      let libreCount = 0;
      let matchedCount = 0;
      let totalCount = discovery.landmarks.length;
      for (const stop of discovery.landmarks) {
        const stopNameLower = stop.name.toLowerCase();
        // Match flexible : un seedSite "Plage Omaha Beach" matche un
        // stop "Omaha Beach Memorial" si leurs noms partagent ≥3 mots
        // significatifs ou un mot de ≥6 caractères.
        let matchedAccess: "libre" | "payant" | "mixte" | null = null;
        for (const [seedName, access] of seedByName) {
          // Match 1 : nom complet inclus
          if (stopNameLower.includes(seedName) || seedName.includes(stopNameLower)) {
            matchedAccess = access;
            break;
          }
          // Match 2 : token significatif partagé (≥6 char)
          const tokens = seedName
            .split(/\s+/)
            .filter((t) => t.length >= 6);
          for (const t of tokens) {
            if (stopNameLower.includes(t)) {
              matchedAccess = access;
              break;
            }
          }
          if (matchedAccess) break;
        }
        if (matchedAccess) {
          matchedCount++;
          // "mixte" compte comme libre (entrée payante mais énigme exploitable
          // depuis l'extérieur, cf. critère contrat OddballTrip).
          if (matchedAccess === "libre" || matchedAccess === "mixte") libreCount++;
        }
      }
      // Si moins de 50% des stops finaux sont matchés ET libres : flag.
      // Ratio calculé sur le total des stops, pas sur les matchés (un
      // stop non-matché = inconnu, considéré "non-libre" par défaut
      // par prudence).
      const libreRatio = totalCount > 0 ? libreCount / totalCount : 0;
      if (libreRatio < 0.5) {
        const newReason = `Free access ratio ${Math.round(libreRatio * 100)}% < 50% threshold — only ${libreCount}/${totalCount} stops matched seed sites with libre/mixte access. ${matchedCount} stops matched OddballTrip seed list. The remaining ${totalCount - matchedCount} stops are off-list and could require paid entry. Inspect manually before releasing.`;
        needsReview = true;
        // Concatène à la raison existante si déjà flagged par cluster drift.
        reviewReason = reviewReason
          ? `${reviewReason} | ${newReason}`
          : newReason;
        console.warn(`[Pipeline] ⚠ needs_review=true — free_access_ratio_low: ${libreCount}/${totalCount} libre, threshold 50%`);
      } else {
        console.log(
          `[Pipeline] Free access ratio OK — ${libreCount}/${totalCount} stops libre/mixte (${Math.round(libreRatio * 100)}%)`,
        );
      }
    }

    // ============================================
    // STEP 1.6 : Flag needs_review CONDITIONNEL
    // ============================================
    // Stratégie autonomy-first (2026-05-07) : la pipeline doit publier
    // sans intervention humaine sur 95%+ des achats. On NE flag QUE les
    // cas où la confiance est dégradée :
    //
    //   ✓ AUTO-PUBLISH (no flag) :
    //     - Auto-correct via startPointText géocodé (~5-30m précision,
    //       le pattern "Cluny → Brionnais corrigé via texte précis"
    //       que tu viens de tester)
    //     - body.startPoint cohérent avec city/textGeo (cas standard)
    //
    //   ⚠ FLAG needs_review :
    //     - Auto-correct via cityCenter SEUL (~500m précision, moins fiable)
    //     - Widening 2.5x triggered (zone sparse, content quality at risk)
    //     - (le centroid drift check post-discovery flag aussi indépendamment)
    //
    // Le marché global impose : un acheteur à 3h du matin doit recevoir
    // son code dans les 5-7 min sans qu'un humain le valide. Les rares
    // cas flaggés sont les vraies anomalies qui méritent inspection.
    // (SUPPRIMÉ 2026-05-13) — l'auto-correction depuis body.startPoint
    // est obsolète. body.startPoint est désormais TOTALEMENT IGNORÉ.
    // Le startPoint vient exclusivement de :
    //   1. Géocode Google Maps de startPointText (priorité)
    //   2. Top landmark Google Places de la ville (fallback)
    //   3. cityCenter (dernier recours)
    // Aucun de ces 3 cas n'a besoin d'un needs_review — tous précis.
    void startPointAutoCorrected; // toujours null désormais

    // Widening 2.5x = zone géographiquement extreme. La qualité des
    // stops trouvés peut être limite — on flag pour double-check humain.
    if (usedWidening.multiplier >= 2.5) {
      needsReview = true;
      const wideningReason = `Discovery widened to ${usedWidening.label} (radius/maxHop × ${usedWidening.multiplier}) to find ≥5 walkable stops. Zone is sparse — verify the parcours quality is acceptable before releasing.`;
      reviewReason = reviewReason
        ? `${reviewReason} | ${wideningReason}`
        : wideningReason;
    }

    // ============================================
    // STEP 2 : Convert to ResearchedLocation[] for downstream helpers
    // ============================================
    // Les helpers existants (generateGameSteps, fetchPhotosForSteps,
    // insertGameIntoDatabase) consomment des ResearchedLocation. On
    // mappe DiscoveredStop → ResearchedLocation pour ne pas perturber
    // ces helpers — ils restent inchangés.
    // Per-stop thematic context lookup, keyed by placeId. Populated when
    // the AI-first (Gemini) discovery succeeded — empty when the legacy
    // Google Places fallback ran.
    const thematicByPlaceId = new Map<
      string,
      {
        patrimonialRole: string;
        thematicRole: string;
        citation: string;
        category: "patrimonial_landmark" | "thematic_anchor" | "micro_memorial";
      }
    >();
    if (discovery.thematicContext) {
      for (const t of discovery.thematicContext) {
        thematicByPlaceId.set(t.placeId, {
          patrimonialRole: t.patrimonialRole,
          thematicRole: t.thematicRole,
          citation: t.citation,
          category: t.category,
        });
      }
    }

    const verifiedLocations: ResearchedLocation[] = discovery.landmarks.map(
      (s) => {
        const themed = s.placeId ? thematicByPlaceId.get(s.placeId) : undefined;
        return {
          name: s.name,
          landmarkName: s.name,
          latitude: s.lat,
          longitude: s.lon,
          whatToObserve: s.description,
          // "AUTO" = Claude doit inventer la réponse AR (un mot, une
          // date, un nombre romain) au moment de la génération de
          // l'énigme. Détecté plus bas par le garde-fou anti-leak.
          answer: "AUTO",
          answerType: "name" as const,
          answerSource: "virtual_ar" as const,
          source: s.source ?? "google-curated",
          themeLink: s.description,
          patrimonialRole: themed?.patrimonialRole,
          thematicRole: themed?.thematicRole,
          citation: themed?.citation,
          poiCategory: themed?.category,
        };
      },
    );

    // Tableaux indexés par step pour propager le mode (radar/narrative)
    // jusqu'au DB insert. ResearchedLocation n'a pas ces champs et on
    // ne veut pas le polluer ; on les track en parallèle ici.
    const stopModes: Array<"radar" | "narrative"> = discovery.landmarks.map(
      (s) => s.stopMode,
    );
    const navigationHints: Array<string | undefined> = discovery.landmarks.map(
      (s) => s.navigationHint,
    );

    console.log(
      `[Pipeline] Phase 1 (discovery) complete in ${Math.round((Date.now() - phase1Start) / 1000)}s — handing off to Phase 2 (narrative + insert)`,
    );

    return {
      success: true,
      verifiedLocations,
      discoveryLandmarks: discovery.landmarks,
      discoveryVerifiedContext: discovery.verifiedContext,
      discoveryRejected: discovery.rejected,
      discoverySource: discovery.discoverySource,
      escalatedTransportMode: discovery.escalatedTransportMode,
      effectiveDifficulty,
      needsReview,
      reviewReason,
      stopModes,
      // Map undefined → null pour rester JSON-sérialisable strict.
      navigationHints: navigationHints.map((h) => h ?? null),
      researchDurationMs,
      resolvedStopCount: stopCount,
      // (2026-05-21) Propagation à Phase 2c pour persistence en DB.
      resolvedStartPoint: startPoint,
      resolvedStartPointText: resolvedStartPointLabel,
      resolvedStartPointSource: startPointSource,
      // (Sprint 6.2quater, 2026-05-22) — full Google Places candidate
      // pool, exposed for Phase 1b5 thematic auto-repair. Empty array
      // if discovery used Gemini-only path (no Google pool to recycle).
      allCandidates: discovery.allCandidates ?? [],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Pipeline] Phase 1 failed after ${Math.round((Date.now() - phase1Start) / 1000)}s: ${errorMessage}`,
    );
    const tagged = error as Error & {
      code?: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
    };
    return {
      success: false,
      error: errorMessage,
      errorCode: tagged?.code ?? "INTERNAL_ERROR",
      failedLandmarks: tagged?.failedLandmarks,
      researchDurationMs: Date.now() - phase1Start,
    };
  }
}

/**
 * Phase 2a — NARRATION GENERATION (STEP 3 → 5.5).
 *
 * Consomme le `Phase1Result` produit par `runPipelinePhase1Discovery` et :
 *   - STEP 3   : Adapt narrative (Claude réécrit themeDescription + narrative
 *                + noms poétiques pour coller aux landmarks réels). MUTE
 *                verifiedLocations[i].name + .whatToObserve — propagé au
 *                Phase 2c via `verifiedLocationsAfterAdapt`.
 *   - STEP 4   : generateGameSteps (city_game) ou generateTourSteps (city_tour).
 *   - STEP 4.5 : Roman numeral auto-fix (skip si city_tour). Peut muter
 *                needsReview/reviewReason — propagé au Phase 2c.
 *   - STEP 5   : QA Claude #2 + regen ciblé (skip si city_tour).
 *   - STEP 5.5 : Override narratif sub-POIs (radius 80m + hint navigation) +
 *                roadtrip radius bump 250m.
 *
 * Budget Vercel ~1-2 min (la majorité du temps = appels Claude pour adapter
 * la narration + générer les énigmes/tour-steps).
 *
 * Le 2026-05-20 (split en 3 sub-phases) : on isole ce bloc pour passer le
 * timeout HTTP Inngest Cloud → Vercel SDK endpoint (2m43s observé en prod).
 */
export async function runPipelinePhase2aNarrationGen(
  template: GameTemplate,
  phase1: Phase1Result,
): Promise<Phase2aResult> {
  const startTime = Date.now();

  if (!phase1.success) {
    return {
      success: false,
      error: phase1.error,
      errorCode: phase1.errorCode,
      failedLandmarks: phase1.failedLandmarks,
      durationMs: 0,
    };
  }

  // Ré-hydratation des variables Phase 1. Même noms qu'avant le split pour
  // minimiser le diff sur le corps de fonction.
  const verifiedLocations = phase1.verifiedLocations;
  const stopModes = phase1.stopModes;
  const navigationHints: Array<string | undefined> = phase1.navigationHints.map(
    (h) => h ?? undefined,
  );
  const effectiveDifficulty = phase1.effectiveDifficulty;
  let needsReview = phase1.needsReview;
  let reviewReason = phase1.reviewReason;
  const discovery = {
    landmarks: phase1.discoveryLandmarks,
    verifiedContext: phase1.discoveryVerifiedContext,
  };
  const stopCount = phase1.resolvedStopCount;

  try {
    // ============================================
    // STEP 3 : Adapter la narration aux landmarks découverts
    // ============================================
    // Tous les landmarks viennent de Perplexity, donc tous sont des
    // "remplacements" du point de vue de l'opérateur — on demande à
    // Claude de réécrire themeDescription + narrative + noms poétiques
    // pour qu'ils collent aux POIs réels finaux. C'est ce que oddballtrip
    // doit utiliser pour rafraîchir la fiche produit (sinon la page
    // vendue ne correspond plus à ce qui est joué).
    let adaptedNarrative: AdaptedNarrativePayload | undefined;
    let effectiveNarrative = template.narrative;
    let effectiveThemeDescription = template.themeDescription;
    try {
      const adapted = await adaptNarrativeForReplacedStops({
        city: template.city,
        country: template.country,
        theme: template.theme,
        originalNarrative: template.narrative,
        finalStops: discovery.landmarks.map((s) => ({
          landmarkName: s.name,
          types: [],
          address: undefined,
          keptPoeticName: undefined,
          keptDescription: s.description,
          // En intent-first, TOUS les stops sont issus de la découverte
          // Perplexity. Pas de notion d'opérateur "kept" stops.
          isReplacement: true,
        })),
      });
      effectiveNarrative = adapted.narrative;
      effectiveThemeDescription = adapted.themeDescription;
      // Propager les noms poétiques + descriptions adaptés vers
      // verifiedLocations : Claude #1 lit ces champs pour écrire
      // l'énigme avec les bons noms côté joueur.
      for (let i = 0; i < verifiedLocations.length; i++) {
        verifiedLocations[i].name = adapted.stops[i].name;
        verifiedLocations[i].whatToObserve = adapted.stops[i].description;
      }
      adaptedNarrative = {
        themeDescription: adapted.themeDescription,
        narrative: adapted.narrative,
        stopNames: adapted.stops.map((s) => s.name),
      };
      console.log(
        `[Pipeline] Narrative adapted to ${discovery.landmarks.length} discovered landmark(s) — themeDescription/narrative/stop names rewritten`,
      );
    } catch (err) {
      console.warn(
        `[Pipeline] Narrative adaptation failed, keeping original: ${err instanceof Error ? err.message : err}`,
      );
    }

    // ============================================
    // STEP 4 : Génération du contenu narratif (Claude #1)
    // ============================================
    // S9 (2026-05-19) : branche selon mode du jeu.
    //   - city_game → generateGameSteps (énigmes courtes, answers, hints)
    //   - city_tour → generateTourSteps (narration encyclopédique 200-300
    //                 mots, pas d'énigme ni d'answer)
    //
    // Pour homogénéiser l'insert flow downstream (qui attend GeneratedStep),
    // on convertit les tour steps en GeneratedStep-compatible avec des
    // placeholders pour les champs escape-only. Le contenu RICHE tour
    // (encyclopedic_text, architectural_focus, cultural_connection) est
    // écrit dans `step_content` après l'insert game_steps.
    const creationStart = Date.now();
    const genre: GameGenre = template.genre ?? DEFAULT_GENRE;
    console.log(`[Pipeline] Genre: ${genre} (${template.genre ? "from operator" : "default fallback"})`);

    // Tour steps mémorisés en parallèle de steps[] pour l'écriture
    // step_content plus tard dans insertGameIntoDatabase. Vide en mode
    // city_game.
    let tourSteps: GeneratedTourStep[] = [];
    let steps: GeneratedStep[];

    if (template.mode === "city_tour") {
      console.log(`[Pipeline] Mode city_tour → generateTourSteps (${stopCount} stops, encyclopedic)`);
      tourSteps = await generateTourSteps(
        template.city,
        template.country,
        template.theme,
        effectiveNarrative,
        verifiedLocations,
        genre,
        discovery.verifiedContext,
        stopCount,
      );

      // Conversion tour → GeneratedStep shape pour l'insert legacy.
      // Le riddle_text accueille l'encyclopedic_text (devient le "main
      // text" du stop). Les champs escape-only ont des placeholders
      // neutres — ils ne seront jamais lus côté player UI mode tour,
      // mais évitent les erreurs NOT NULL côté DB.
      steps = tourSteps.map((t, i) => ({
        title: t.title,
        latitude: t.latitude,
        longitude: t.longitude,
        validation_radius_meters: t.validation_radius_meters,
        riddle_text: t.encyclopedic_text,           // CŒUR du tour
        answer_text: `STOP_${i + 1}`,               // placeholder, jamais comparé
        hints: [
          {
            order: 1,
            text: "Ouvre l'AR pour découvrir les détails du lieu et écouter sa narration complète.",
          },
        ],
        landmark_history: t.landmark_history,
        anecdote: t.anecdote,
        bonus_time_seconds: 0,
        answer_source: "virtual_ar" as const,
        ar_character_type: t.ar_character_type,
        ar_character_dialogue: t.ar_character_dialogue,
        ar_facade_text: "",                          // pas de magic word en tour
        ar_treasure_reward: "",                      // pas de récompense puzzle
        route_attractions: t.route_attractions,
      }));
    } else {
      steps = await generateGameSteps(
        template.city,
        template.country,
        template.theme,
        effectiveNarrative,
        effectiveDifficulty,
        verifiedLocations,
        genre,
        discovery.verifiedContext,
      );
    }

    // Garde anti-DUPLICATE indices (vision 2026-05-16, suite bug Séville
    // avec 2 stops sur AURUM). Claude doit avoir respecté INV-1, on
    // re-vérifie côté code. Si doublon détecté, on log un warn et on
    // tente de désambiguïser en suffixant le 2e occurrence — c'est un
    // patch d'urgence, le vrai fix c'est le prompt INV-1 renforcé.
    //
    // S9 (2026-05-19) : skip pour city_tour — pas d'answer à dédupliquer
    // en tour mode (les placeholders STOP_1, STOP_2... sont naturellement
    // uniques par construction).
    if (template.mode !== "city_tour") {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        const ans = (steps[i].answer_text || "").trim().toUpperCase();
        if (!ans) continue;
        if (seen.has(ans)) {
          dupes.push(ans);
          // Désambiguïsation simple : ajouter le step_order en suffixe
          // (e.g. AURUM → AURUM_2). Ce n'est pas idéal narrativement,
          // mais préserve l'unicité pour l'énigme finale. Le post-mortem
          // se fait via prompt strengthening.
          const newAns = `${ans}_${i + 1}`;
          steps[i] = {
            ...steps[i],
            answer_text: newAns,
            ar_facade_text: newAns,
          };
          console.warn(
            `[Pipeline] DUPLICATE INDICE detected at step ${i + 1} ("${ans}") — appended suffix → "${newAns}". Prompt INV-1 should be reinforced.`,
          );
        }
        seen.add(ans);
      }
      if (dupes.length > 0) {
        console.warn(
          `[Pipeline] ${dupes.length} duplicate indice(s) had to be patched: ${dupes.join(", ")}. Investigate prompt drift.`,
        );
      }
    } // end if mode !== city_tour (duplicate guard)

    // Garde anti-AUTO leak : si Claude a renvoyé le placeholder "AUTO"
    // (au lieu d'inventer un mot thématique), on régénère ce stop avec
    // un brief plus strict. On checke `answer_text` ET `ar_facade_text`
    // car les deux peuvent fuir indépendamment (Claude bascule parfois
    // l'un mais pas l'autre).
    //
    // CRITIQUE : avant de re-régen, on doit muter verifiedLocations[i].answer
    // de "AUTO" → "INVENT" pour que le prompt regenerateStep ne re-locke
    // pas Claude sur "AUTO" (cf. fix dans regenerateStep). Sinon le bug
    // se réplique à l'identique.
    //
    // S9 (2026-05-19) : skip pour city_tour — pas d'answer en tour mode.
    const isAutoLeaked = (s: GeneratedStep): boolean =>
      s.answer_text?.toUpperCase().trim() === "AUTO" ||
      s.ar_facade_text?.toUpperCase().trim() === "AUTO";

    if (template.mode !== "city_tour") {
    for (let i = 0; i < steps.length; i++) {
      let regenAttempts = 0;
      while (isAutoLeaked(steps[i]) && regenAttempts < 2) {
        regenAttempts++;
        console.warn(
          `[Pipeline] AUTO placeholder leaked at step ${i + 1} ("${steps[i].title}") — regenerating (attempt ${regenAttempts}/2)`,
        );
        // Reset l'answer du verifiedLocation à un marker explicite pour
        // que regenerateStep n'utilise PAS "AUTO" comme valeur fixe.
        const locForRegen: ResearchedLocation = {
          ...verifiedLocations[i],
          answer: "AUTO", // regenerateStep détecte "AUTO" et bascule en mode "invent"
        };
        steps[i] = await regenerateStep({
          brokenStep: steps[i],
          issue: {
            step_index: i,
            problem:
              "answer_text or ar_facade_text was the literal placeholder 'AUTO' — must be a real thematic answer (UPPERCASE Latin word, year, Roman numeral, or evocative single word).",
            severity: "blocking",
            suggestion:
              "Invent a single thematic answer fitting the theme. NEVER output 'AUTO' literally. Examples: VERITAS, MCMXIV, IGNIS, AURUM, REQUIESCAT, FIDES, BULGE.",
          },
          location: locForRegen,
          city: template.city,
          theme: template.theme,
          narrative: effectiveNarrative,
          stepNumber: i + 1,
          totalSteps: steps.length,
          genre,
        });
      }
      // Fallback dur : si après 2 régen Claude renvoie ENCORE "AUTO",
      // on injecte manuellement un mot thématique générique pour ne
      // pas publier un jeu cassé. C'est dégradé mais publiable.
      if (isAutoLeaked(steps[i])) {
        const fallbackAnswer = `STOP${i + 1}`;
        console.error(
          `[Pipeline] AUTO leak persisting after 2 regen attempts at step ${i + 1} — hard fallback to "${fallbackAnswer}"`,
        );
        steps[i].answer_text = fallbackAnswer;
        steps[i].ar_facade_text = fallbackAnswer;
      }
    }
    } // end if mode !== city_tour (AUTO leak guard)

    // ============================================
    // STEP 4.5 : Roman numeral AUTO-FIX
    // ============================================
    // Bug observé prod (Hakata 2026-05-07) : Claude a généré
    // answer_text="MCCXXXI" (=1231) alors que le riddle parlait de 1281
    // (Mongol invasion year). Triple incohérence riddle/answer/épilogue.
    //
    // Stratégie auto-fix (2026-05-08) :
    //   1. Détecte answer_text Roman numeral
    //   2. Cherche les années dans riddle/anecdote
    //   3. Cross-référence avec verifiedContext.events si dispo (Perplexity)
    //   4. Si l'année "intended" est claire, AUTO-CORRIGE answer_text +
    //      ar_facade_text avec le bon encoding
    //   5. Sinon, flag needs_review (cas ambigu)
    //
    // Le auto-fix s'applique AVANT la génération de l'épilogue, donc
    // l'épilogue référencera les bonnes valeurs.
    //
    // S9 (2026-05-19) : skip pour city_tour — pas de Roman numerals
    // dans les placeholders STOP_N, donc rien à corriger.
    if (template.mode !== "city_tour") {
    for (let i = 0; i < steps.length; i++) {
      const ans = steps[i].answer_text?.trim() ?? "";
      if (!isRomanNumeral(ans)) continue;
      const decoded = decodeRoman(ans);
      if (decoded === null) continue;
      // Cherche les années 4-digit dans riddle + anecdote
      const allText = `${steps[i].riddle_text ?? ""} ${steps[i].anecdote ?? ""}`;
      const yearMatches = [...allText.matchAll(/\b(1[0-9]{3}|20[0-2][0-9])\b/g)]
        .map((m) => parseInt(m[1], 10));
      if (yearMatches.length === 0) continue;
      // Cherche la date la plus fréquente (l'année principale du stop)
      const yearCounts = new Map<number, number>();
      for (const y of yearMatches) yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
      const intendedYear = [...yearCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0][0];
      const drift = Math.abs(intendedYear - decoded);
      if (drift > 50) {
        // Cross-check avec verifiedContext events si dispo : si l'année
        // intendedYear matche (à ±2 ans) un event Perplexity, on a une
        // confiance MAX pour auto-fixer.
        const eventYears: number[] = [];
        if (discovery.verifiedContext?.events) {
          for (const e of discovery.verifiedContext.events) {
            const m = e.date?.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
            if (m) eventYears.push(parseInt(m[1], 10));
          }
        }
        const intendedMatchesEvent = eventYears.some(
          (y) => Math.abs(y - intendedYear) <= 2,
        );
        const correctRoman = encodeRoman(intendedYear);
        if (intendedMatchesEvent || drift > 100) {
          // AUTO-FIX : on a forte confiance, on remplace.
          // Pourquoi : (a) Perplexity confirme l'année, OU (b) le drift
          // est >100ans donc Claude a clairement halluciné un Roman
          // sans rapport avec ce qu'il a écrit dans le riddle.
          console.warn(
            `[Pipeline] AUTO-FIX Roman numeral step ${i + 1}: was "${ans}" (=${decoded}), riddle clearly intends year ${intendedYear}${intendedMatchesEvent ? " (confirmed by verifiedContext)" : ""}, replacing with "${correctRoman}".`,
          );
          steps[i].answer_text = correctRoman;
          steps[i].ar_facade_text = correctRoman;
        } else {
          // Cas ambigu (drift 50-100 ans, pas confirmé par Perplexity) :
          // flag needs_review pour inspection humaine.
          needsReview = true;
          const romanReason = `Step ${i + 1}: roman numeral "${ans}" (=${decoded}) drifts ${drift}y from intended year ${intendedYear}. Suggested fix: "${correctRoman}". Auto-fix not applied (low confidence). Inspect via dump-game.`;
          reviewReason = reviewReason
            ? `${reviewReason} | ${romanReason}`
            : romanReason;
          console.warn(`[Pipeline] ⚠ Roman drift ambiguous step ${i + 1} — flagging needs_review`);
        }
      }
    }
    } // end if mode !== city_tour (Roman numeral fix)

    // ============================================
    // STEP 5 : QA Claude #2 + regen ciblé
    // ============================================
    // S9 (2026-05-19) : skip pour city_tour — le validator vérifie des
    // règles AR/answer-text/hint qui n'existent pas en tour mode. Le tour
    // est validé implicitement par le prompt encyclopédique strict + les
    // gardes downstream (telemetry + admin review).
    if (template.mode !== "city_tour") {
    const validation = await validateGeneratedSteps({
      steps,
      city: template.city,
      theme: template.theme,
      narrative: effectiveNarrative,
    });
    if (validation.issues?.length) {
      for (const issue of validation.issues) {
        if (issue.severity !== "blocking") continue;
        const idx = issue.step_index;
        if (idx < 0 || idx >= steps.length) continue;
        console.warn(
          `[Pipeline] QA blocked step ${idx + 1}: ${issue.problem} — regenerating (suggestion: ${issue.suggestion})`,
        );
        steps[idx] = await regenerateStep({
          brokenStep: steps[idx],
          issue,
          location: verifiedLocations[idx],
          city: template.city,
          theme: template.theme,
          narrative: effectiveNarrative,
          stepNumber: idx + 1,
          totalSteps: steps.length,
          genre,
        });
      }
    }
    } // end if mode !== city_tour (validator)
    const creationDurationMs = Date.now() - creationStart;

    // ============================================
    // STEP 5.5 : Override narratif pour les sub-POIs sans place_id
    // ============================================
    // Pour les stops en mode "narrative" (sub-monuments d'un site
    // archéologique non-indexés Google), on ne peut pas utiliser le
    // radar GPS strict (la coord est celle du site parent, pas du
    // sub-monument). On compense :
    //   - validation_radius_meters élargi à 80m (vs 30m radar) pour
    //     que la validation passe quand le joueur arrive à proximité
    //   - on prepend la phrase de navigation textuelle au riddle pour
    //     guider le joueur depuis le stop précédent
    // Mode radar (par défaut, POI Google indexé) : zéro changement,
    // le joueur est tracké via radar normal.
    for (let i = 0; i < steps.length; i++) {
      if (stopModes[i] === "narrative") {
        steps[i].validation_radius_meters = 80;
        const hint = navigationHints[i];
        if (
          hint &&
          !steps[i].riddle_text.toLowerCase().includes(hint.toLowerCase().slice(0, 30))
        ) {
          steps[i].riddle_text = `${hint}\n\n${steps[i].riddle_text}`;
        }
        console.log(
          `[Pipeline] Step ${i + 1} ("${steps[i].title}") in NARRATIVE mode — radius 80m, hint prepended`,
        );
      }
    }

    // ── ROADTRIP : valider radius élargi (driving / mixed) ───────────
    // Le radar walking valide à 30m. Au volant à 90 km/h, 30m = 1.2s →
    // false negatives garantis (le joueur passe sans déclencher). On
    // élargit à 250m en mode driving/mixed, ce qui correspond à ~10s
    // à 90 km/h — le temps de ralentir, garer, et déclencher l'AR.
    // N'écrase pas les 80m posés en mode narrative (plus restrictif).
    if (template.transportMode === "driving" || template.transportMode === "mixed") {
      for (let i = 0; i < steps.length; i++) {
        if (stopModes[i] !== "narrative") {
          steps[i].validation_radius_meters = 250;
        }
      }
      console.log(
        `[Pipeline] Roadtrip mode (${template.transportMode}) — validation radius bumped to 250m for non-narrative stops`,
      );
    }

    // ────────────────────────────────────────────────────────────────
    // PAID-ENTRY EXTERIOR-SCAN ALLOWANCE (Sprint 6 hotfix, 2026-05-21)
    // ────────────────────────────────────────────────────────────────
    // Observed on Malta `le-secret-du-caravage` (Valletta, real client) :
    // Step 1 was St. John's Co-Cathedral with paid entry (~€15) and a
    // 30m radar radius — players who didn't want to pay couldn't scan
    // the magic word LUMEN from outside. UX-wise this is a wall : we
    // ship a walking tour, the player arrives, and the gating monument
    // requires a ticket they may not want to buy.
    //
    // FIX : for stops whose landmark_name matches the paid-entry
    // pattern set (cathedral, palace, castle, museum, abbey, opera,
    // monastery, basilique, …), bump validation_radius_meters to 60m
    // unless it's already wider (narrative 80m, roadtrip 250m). 60m
    // covers the front square / esplanade of most iconic monuments so
    // players can scan from outside.
    //
    // Players who DO want to enter still get the immersive experience —
    // the radius is permissive, not restrictive. Paying customers
    // aren't penalized.
    //
    // QUALITATIVE : zero regression. Only ADDS reach.
    //
    // INSTRUMENTATION : every bump logs `[paid-entry-bump]` so we can
    // grep prod logs to confirm the heuristic is firing where expected.
    const PAID_ENTRY_PATTERNS = [
      // English
      /\bcathedral\b/i,
      /\bpalace\b/i,
      /\bcastle\b/i,
      /\bmuseum\b/i,
      /\babbey\b/i,
      /\bmonastery\b/i,
      /\bopera (house|of)\b/i,
      /\b(royal|imperial|grand) opera\b/i,
      /\bmausoleum\b/i,
      /\btomb of\b/i,
      // French
      /\bcath[ée]drale\b/i,
      /\bpalais\b/i,
      /\bch[âa]teau\b/i,
      /\bmus[ée]e\b/i,
      /\babbaye\b/i,
      /\bmonast[èe]re\b/i,
      /\bbasilique\b/i,
      // Italian/Spanish
      /\bbasilica\b/i,
      /\bduomo\b/i,
      /\bpalazzo\b/i,
      /\balc[áa]zar\b/i,
      // German
      /\bschloss\b/i,
      /\bdom\b/i,
      /\bkloster\b/i,
    ];
    const isPaidEntryLandmark = (name: string): boolean =>
      PAID_ENTRY_PATTERNS.some((p) => p.test(name));

    const PAID_ENTRY_MIN_RADIUS = 60;
    for (let i = 0; i < steps.length; i++) {
      // Skip if already wider (narrative 80, roadtrip 250)
      if ((steps[i].validation_radius_meters ?? 30) >= PAID_ENTRY_MIN_RADIUS) continue;
      // Use landmark_name from verifiedLocations (Phase 1) — the actual
      // POI name resolved by geocoding, NOT Claude's title rewrite.
      const landmarkName = phase1.verifiedLocations[i]?.name ?? steps[i].title ?? "";
      if (!isPaidEntryLandmark(landmarkName)) continue;
      const old = steps[i].validation_radius_meters ?? 30;
      steps[i].validation_radius_meters = PAID_ENTRY_MIN_RADIUS;
      console.log(
        `[Pipeline] [paid-entry-bump] Step ${i + 1} "${landmarkName}" — radius ${old}m → ${PAID_ENTRY_MIN_RADIUS}m (paid-entry pattern detected — allows exterior AR scan)`,
      );
    }

    return {
      success: true,
      steps,
      tourSteps,
      adaptedNarrative,
      effectiveNarrative,
      effectiveThemeDescription,
      verifiedLocationsAfterAdapt: verifiedLocations,
      needsReview,
      reviewReason,
      creationDurationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Pipeline] Phase 2a failed after ${Math.round(durationMs / 1000)}s: ${errorMessage}`,
    );

    const tagged = error as Error & {
      code?: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
    };
    const errorCode: PipelineErrorCode = tagged?.code ?? "INTERNAL_ERROR";

    return {
      success: false,
      error: errorMessage,
      errorCode,
      failedLandmarks: tagged?.failedLandmarks,
      durationMs,
    };
  }
}

/**
 * Phase 2b — GAME-WIDE NARRATIVE BLOCKS (STEP 6).
 *
 * Génère en parallèle epilogue + introSpeech + finalRiddle. Aucune des trois
 * n'est bloquante : si l'une échoue, on publie sans (UX dégrade gracieusement
 * côté joueur). Chacune est gardée par un .catch() qui retourne `null`.
 *
 * Note : peut potentiellement throw si `Promise.all` se réveille avec une
 * erreur non interceptée (ne devrait jamais arriver dans la pratique car
 * tous les branches retournent `null` en cas de fail). Si throw, le step
 * Inngest retry — non bloquant côté pipeline.
 *
 * Budget Vercel ~30-60s (3 appels Claude en parallèle).
 */
export async function runPipelinePhase2bGameWide(
  template: GameTemplate,
  phase1: Phase1Result,
  phase2a: Phase2aResult,
): Promise<Phase2bResult> {
  const startTime = Date.now();

  // Si Phase 1 ou Phase 2a a échoué, Phase 2b est skip — return un
  // résultat vide. Le caller (wrapper ou Inngest) checke d'abord les
  // erreurs en amont avant d'appeler Phase 2c.
  if (!phase1.success || !phase2a.success) {
    return {
      success: true,
      epilogue: null,
      introSpeech: null,
      finalRiddle: null,
      durationMs: 0,
    };
  }

  const steps = phase2a.steps;
  const effectiveNarrative = phase2a.effectiveNarrative;
  const effectiveThemeDescription = phase2a.effectiveThemeDescription;
  const effectiveDifficulty = phase1.effectiveDifficulty;
  const genre: GameGenre = template.genre ?? DEFAULT_GENRE;

  // ============================================
  // STEP 6 : Epilogue + Intro Speech + Final Riddle (parallèle)
  // ============================================
  // Trois nouveaux blocs narratifs (vision client 2026-05-16) :
  //   - intro_speech : monologue du guide avant stop 1 (durée, philosophie,
  //     "tous les lieux ne sont pas thématiques mais tous valent la visite")
  //   - final_riddle + final_answer + final_answer_explanation : énigme
  //     finale combinant les indices, 2 essais, épilogue conditionnel
  //   - epilogue (legacy) : conservé pour rétrocompat — joué après l'énigme
  //
  // Les trois tournent en parallèle pour ne pas séquentialiser 3 appels
  // Claude (~30s gagnées). Tout est non-bloquant : si l'un échoue, le
  // jeu publie quand même (mais l'UX du joueur dégrade gracieusement).
  const [epilogue, introSpeech, finalRiddle] = await Promise.all([
    generateEpilogue({
      city: template.city,
      country: template.country,
      theme: template.theme,
      narrative: effectiveNarrative,
      difficulty: effectiveDifficulty,
      steps,
      genre,
    }).catch((err) => {
      console.warn(
        `[Pipeline] Epilogue generation failed (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }),
    generateIntroSpeech({
      title: template.theme,
      city: template.city,
      country: template.country,
      theme: template.theme,
      themeDescription: effectiveThemeDescription,
      estimatedDurationMin: template.estimatedDurationMin,
      stopCount: steps.length,
    }).catch((err) => {
      console.warn(
        `[Pipeline] Intro speech generation failed (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }),
    (async () => {
      // S9 (2026-05-19) : skip final riddle pour city_tour — pas
      // d'énigme finale dans un audioguide, le tour se termine par
      // l'épilogue narratif et basta.
      if (template.mode === "city_tour") {
        console.log(`[Pipeline] city_tour mode : skip finalRiddle generation`);
        return null;
      }
      // Retry-with-rejection-fallback for final riddle generation
      // (2026-05-16). If the 1st attempt returns a weak/generic answer
      // ("renaissance", "harmony", etc.) we reject it via the sanity
      // check inside generateFinalRiddle, and retry ONCE here. If the
      // 2nd attempt also fails we publish without final riddle (the
      // player still gets all stops + epilogue, just no final puzzle).
      const finalRiddleArgs = {
        title: template.theme,
        city: template.city,
        country: template.country,
        theme: template.theme,
        themeDescription: effectiveThemeDescription,
        steps: steps.map((s, i) => ({
          stepOrder: i + 1,
          title: s.title,
          answer: s.answer_text,
          anecdote: s.anecdote,
        })),
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await generateFinalRiddle(finalRiddleArgs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < 1) {
            console.warn(
              `[Pipeline] Final riddle attempt ${attempt + 1} rejected (${msg.slice(0, 120)}). Retrying once...`,
            );
          } else {
            console.warn(
              `[Pipeline] Final riddle generation failed after retries (${msg.slice(0, 120)}) — game will publish without final puzzle.`,
            );
          }
        }
      }
      return null;
    })(),
  ]);

  console.log(
    `[Pipeline] Narrative shell: epilogue=${epilogue ? "✓" : "✗"}, intro=${introSpeech ? "✓" : "✗"}, finalRiddle=${finalRiddle ? "✓ (" + finalRiddle.answer + ")" : "✗"}`,
  );

  return {
    success: true,
    epilogue,
    introSpeech,
    finalRiddle,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Phase 2c — DB INSERT + payload final (STEP 7 → 8).
 *
 * Consomme phase1 + phase2a + phase2b et :
 *   - STEP 7 : insertGameIntoDatabase (gameId + game_steps + step_content si tour)
 *   - Photos historiques Landmark (Place Details + Place Photo) — fire-and-forget,
 *     non bloquant si quota Google saturé.
 *   - Telemetry estimated cost (logEstimatedGenerationCost) — fire-and-forget.
 *   - STEP 8 : Build payload `landmarks[]` + retour final.
 *
 * Budget Vercel ~15-30s (Supabase insert + Promise.allSettled photos sur 8 stops).
 */
export async function runPipelinePhase2cInsert(
  template: GameTemplate,
  phase1: Phase1Result,
  phase2a: Phase2aResult,
  phase2b: Phase2bResult,
  /**
   * (Sprint 6.2bis, 2026-05-22) — Pre-validated needs_review escalation
   * computed UPSTREAM by build-game.ts orchestrator. Carries flags from
   *   - Thematic-fit judge (lib/pipeline-thematic-judge)
   *   - Phase 1a Perplexity empty hard-flag
   *   - radius/duration coherence check
   * When provided, Phase 2c writes them to games.needs_review +
   * games.review_reason at INSERT time, BEFORE the post-insert
   * pipeline runs. This guarantees the gate is in place before any
   * code activation can be released.
   */
  forcedReviewFlag?: { needs_review: boolean; review_reason: string },
  /**
   * (Sprint 6.2bis, 2026-05-22) — Verbatim POST body from OddballTrip,
   * persisted in `games.original_payload` for post-incident RCA.
   * NULL is acceptable for legacy callers / non-Inngest sync path.
   */
  originalPayload?: Record<string, unknown>,
): Promise<PipelineResult> {
  const startTime = Date.now();

  // Garde-fou : si Phase 1 ou Phase 2a a échoué, Phase 2c ne peut rien faire.
  // Propager l'erreur structurée vers le caller.
  if (!phase1.success) {
    return {
      success: false,
      error: phase1.error,
      errorCode: phase1.errorCode,
      failedLandmarks: phase1.failedLandmarks,
      durationMs: 0,
      researchDurationMs: phase1.researchDurationMs,
    };
  }
  if (!phase2a.success) {
    return {
      success: false,
      error: phase2a.error,
      errorCode: phase2a.errorCode,
      failedLandmarks: phase2a.failedLandmarks,
      durationMs: phase2a.durationMs,
      researchDurationMs: phase1.researchDurationMs,
    };
  }

  // Ré-hydratation depuis phase1 + phase2a + phase2b. Mêmes noms qu'avant
  // le split pour minimiser le diff sur le corps de fonction.
  const verifiedLocations = phase2a.verifiedLocationsAfterAdapt;
  const effectiveDifficulty = phase1.effectiveDifficulty;
  const needsReview = phase2a.needsReview;
  const reviewReason = phase2a.reviewReason;
  const discovery = {
    landmarks: phase1.discoveryLandmarks,
    rejected: phase1.discoveryRejected,
    discoverySource: phase1.discoverySource,
    escalatedTransportMode: phase1.escalatedTransportMode,
  };
  const researchDurationMs = phase1.researchDurationMs;
  const creationDurationMs = phase2a.creationDurationMs;
  const steps = phase2a.steps;
  const tourSteps = phase2a.tourSteps;
  const effectiveNarrative = phase2a.effectiveNarrative;
  const effectiveThemeDescription = phase2a.effectiveThemeDescription;
  const adaptedNarrative = phase2a.adaptedNarrative;
  const epilogue = phase2b.epilogue;
  const introSpeech = phase2b.introSpeech;
  const finalRiddle = phase2b.finalRiddle;

  try {
    // ============================================
    // STEP 7 : Insert DB
    // ============================================
    // Si la discovery a escaladé le mode (walking → mixed/driving parce
    // que pas assez de sites dans le rayon serré), on REFLÈTE ce mode
    // dans la DB. La fiche produit OddballTrip devra signaler au client
    // "tour mixte à pied et voiture" au lieu de "walking tour" — sinon
    // décalage attentes/réalité.
    const effectiveTransportMode =
      discovery.escalatedTransportMode &&
      discovery.escalatedTransportMode !== (template.transportMode ?? "walking")
        ? discovery.escalatedTransportMode
        : (template.transportMode ?? "walking");
    if (effectiveTransportMode !== (template.transportMode ?? "walking")) {
      console.warn(
        `[Pipeline] Transport mode auto-escalated : "${template.transportMode}" → "${effectiveTransportMode}" (insufficient density in original radius). OddballTrip product page should be updated to match.`,
      );
    }

    // (Sprint 6.2bis, 2026-05-22) — Merge upstream forced needs_review
    // (thematic-fit fail, Perplexity-empty escalation, radius/duration
    // mismatch) with local Phase 1.5 centroid drift flag. The strictest
    // (any "fail" → needs_review=true) wins. Reasons concatenated for
    // operator visibility.
    let mergedNeedsReview = needsReview;
    let mergedReviewReason: string | undefined = reviewReason;
    if (forcedReviewFlag?.needs_review) {
      mergedNeedsReview = true;
      mergedReviewReason = mergedReviewReason
        ? `${mergedReviewReason} | ${forcedReviewFlag.review_reason}`
        : forcedReviewFlag.review_reason;
    }

    const gameId = await insertGameIntoDatabase(
      {
        ...template,
        narrative: effectiveNarrative,
        themeDescription: effectiveThemeDescription,
        difficulty: effectiveDifficulty,
        transportMode: effectiveTransportMode,
      },
      steps,
      [],
      epilogue,
      verifiedLocations,
      mergedNeedsReview,
      mergedReviewReason,
      introSpeech,
      finalRiddle,
      // S9 (2026-05-19) : tour steps (vide en mode city_game). Écrits
      // dans step_content avec le contenu narratif riche pour le mode
      // city_tour. Le riddle_text de game_steps contient juste
      // l'encyclopedic_text (utilisé en fallback).
      tourSteps,
      template.language ?? "en",
      // (2026-05-21) Persistence du startPoint résolu en DB
      // (migration 034). Phase 1 calcule la triple (lat, lon, text,
      // source) — on la propage telle quelle ici.
      {
        lat: phase1.resolvedStartPoint.lat,
        lon: phase1.resolvedStartPoint.lon,
        text: phase1.resolvedStartPointText,
        source: phase1.resolvedStartPointSource,
      },
      // (Sprint 6.2bis) — Verbatim OddballTrip payload for post-incident RCA.
      originalPayload,
    );
    console.log(`[Pipeline] Game created with ID: ${gameId}`);

    // C3 (2026-05-17) — Fetch landmark photos in PARALLEL after insert.
    // Each photo : 1 Place Details + 1 Place Photo = ~$0.024. For 8 stops
    // ≈ $0.19/game. UX win is massive for unfamiliar cities (target
    // audience = newcomers per project_target_audience.md).
    // Fire-and-forget — if Google quota / network fails, stop has no
    // photo, UI hides the card gracefully.
    try {
      const { fetchAndStoreLandmarkPhoto } = await import("@/lib/landmark-photos");
      const supabase = createAdminClient();
      const photoResults = await Promise.allSettled(
        steps.map(async (_step, idx) => {
          const verified = verifiedLocations[idx];
          const landmarkName =
            verified?.landmarkName?.trim() ||
            verified?.name ||
            null;
          if (!landmarkName) return null;
          const photo = await fetchAndStoreLandmarkPhoto({
            gameId,
            stepOrder: idx + 1,
            landmarkName,
            city: template.city,
            country: template.country ?? "",
          });
          if (!photo) return null;
          await supabase
            .from("game_steps")
            .update({
              landmark_photo_url: photo.publicUrl,
              landmark_photo_credit: photo.attribution,
            })
            .eq("game_id", gameId)
            .eq("step_order", idx + 1);
          return idx + 1;
        }),
      );
      const fetched = photoResults.filter(
        (r) => r.status === "fulfilled" && r.value !== null,
      ).length;
      console.log(
        `[Pipeline] Landmark photos fetched : ${fetched}/${steps.length} stops`,
      );
    } catch (err) {
      console.warn(
        `[Pipeline] landmark photos batch failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Estimated telemetry for pre-insert providers (Anthropic narrations,
    // Gemini discovery, Google Places geocode + photos + B3 cross-validation).
    // Fire-and-forget — fail silently if anything goes wrong. Gives the
    // admin visibility on the FULL cost per game (~$1.43 typical) instead
    // of just the ElevenLabs portion ($0.55) which was the only previously
    // tracked provider.
    try {
      const { logEstimatedGenerationCost } = await import(
        "@/lib/pipeline-telemetry"
      );
      await logEstimatedGenerationCost({
        gameId,
        stopCount: steps.length,
        language: template.language,
      });
    } catch (err) {
      console.warn(
        `[Pipeline] estimated telemetry failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    // ════════════════════════════════════════════════════════════
    // CHAINED PIPELINE — prepare+validate+repair moved to Lambda 2
    // ════════════════════════════════════════════════════════════
    // Auparavant ici : prepareGamePackage + validator + auto-repair
    // dans la même lambda. Avec les retries Gemini agressifs (jusqu'à
    // 220s par field × 30+ fields) on dépassait régulièrement 600s
    // Vercel maxDuration → lambda killed, game stuck is_published=false
    // (cas Lugdunum V4 11/05).
    //
    // Maintenant : la lambda 1 (ce code) s'arrête après l'insert game.
    // La lambda 2 (/api/internal/finalize-game) est déclenchée en
    // fire-and-forget depuis route.ts. Elle a son propre budget 10 min
    // pour faire prepareGamePackage + validator + auto-repair + flip
    // is_published. Total effectif = 20 min.
    //
    // Le game reste is_published=false jusqu'à ce que Lambda 2 complète
    // tous les checks. OddballTrip polle find-game et reçoit 404 pendant
    // tout ce temps → impossible de créer un code prématurément.
    console.log(
      `[Pipeline] Discovery + insert complete. Lambda 2 (finalize-game) will be triggered fire-and-forget for prepare + validate + auto-repair + is_published flip.`,
    );

    // (validator + auto-repair are now in Lambda 2 — see pipeline-finalize.ts)

    // ============================================
    // STEP 8 : Build canonical landmarks[] payload
    // ============================================
    // Cette liste est l'output principal pour oddballtrip — elle
    // contient les landmarks RÉELS du jeu (avec leurs photos et
    // sources Perplexity) qu'oddballtrip doit afficher sur la fiche
    // produit pour qu'elle reflète l'expérience.
    const landmarks: PublishedLandmark[] = discovery.landmarks.map(
      (s, i) => ({
        name: verifiedLocations[i].name, // nom poétique adapté par Claude
        landmarkName: s.name, // nom géocodable réel
        lat: s.lat,
        lon: s.lon,
        themeLink: s.description,
        source: s.source,
      }),
    );

    const durationMs = Date.now() - startTime;
    console.log(
      `[Pipeline] Complete in ${Math.round(durationMs / 1000)}s (${steps.length} steps published)`,
    );

    return {
      success: true,
      gameId,
      durationMs,
      steps: steps.length,
      researchDurationMs,
      creationDurationMs,
      landmarks,
      adaptedNarrative,
      discoverySource: discovery.discoverySource,
      ...(needsReview ? { needsReview: true, reviewReason } : {}),
      // droppedStops exposé seulement si la discovery a rejeté des
      // candidats (pour audit côté oddballtrip — non actionnable, juste
      // informatif sur la qualité Perplexity).
      ...(discovery.rejected.length > 0
        ? {
            droppedStops: discovery.rejected.map((r) => ({
              stopName: r.name,
              tried: [r.reason],
            })),
          }
        : {}),
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Pipeline] Phase 2c failed after ${Math.round(durationMs / 1000)}s: ${errorMessage}`,
    );

    const tagged = error as Error & {
      code?: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
    };
    const errorCode: PipelineErrorCode = tagged?.code ?? "INTERNAL_ERROR";

    return {
      success: false,
      error: errorMessage,
      errorCode,
      failedLandmarks: tagged?.failedLandmarks,
      durationMs,
      researchDurationMs,
    };
  }
}

/**
 * Phase 2 — LEGACY WRAPPER (STEP 3-8) — DELEGATE to 2a/2b/2c.
 *
 * Conservée pour rétrocompat avec les callers Inngest existants. Sous le capot,
 * exécute les trois sub-phases en séquence inline — comportement strictement
 * identique à l'ancienne fonction monolithique mais avec les 3 nouvelles
 * sub-fonctions exposées séparément pour les callers qui veulent splitter
 * Inngest en 3 step.run() (cf. build-game.ts).
 *
 * Budget Vercel ~2-5 min total (1-2 min 2a + 30-60s 2b + 15-30s 2c).
 */
export async function runPipelinePhase2NarrativeAndInsert(
  template: GameTemplate,
  phase1: Phase1Result,
): Promise<PipelineResult> {
  if (!phase1.success) {
    return {
      success: false,
      error: phase1.error,
      errorCode: phase1.errorCode,
      failedLandmarks: phase1.failedLandmarks,
      durationMs: 0,
      researchDurationMs: phase1.researchDurationMs,
    };
  }
  const phase2a = await runPipelinePhase2aNarrationGen(template, phase1);
  if (!phase2a.success) {
    return {
      success: false,
      error: phase2a.error,
      errorCode: phase2a.errorCode,
      failedLandmarks: phase2a.failedLandmarks,
      durationMs: phase2a.durationMs,
      researchDurationMs: phase1.researchDurationMs,
    };
  }
  const phase2b = await runPipelinePhase2bGameWide(template, phase1, phase2a);
  return runPipelinePhase2cInsert(template, phase1, phase2a, phase2b);
}

/**
 * Generate a complete game from a template — WRAPPER sync.
 *
 * Conserve la signature historique pour les callers qui n'utilisent pas
 * Inngest (typiquement `/api/external/generate-game` en mode sync, et
 * `/api/admin/regenerate-game`). Sous le capot : exécute Phase 1 → 2a → 2b → 2c
 * séquentiellement, exactement comme l'ancien comportement monolithique.
 *
 * Pour les callers Inngest (cf. `src/lib/inngest/build-game.ts`), il est
 * préférable d'appeler `runPipelinePhase1Discovery`,
 * `runPipelinePhase2aNarrationGen`, `runPipelinePhase2bGameWide` et
 * `runPipelinePhase2cInsert` dans quatre `step.run()` distincts afin de
 * bénéficier du budget timeout multiplié (4× 800s = 3200s effectifs) et
 * surtout de passer le timeout HTTP Inngest Cloud → Vercel (~2m43s).
 */
export async function generateGameFromTemplate(
  template: GameTemplate,
): Promise<PipelineResult> {
  const wrapperStart = Date.now();
  const phase1 = await runPipelinePhase1Discovery(template);
  if (!phase1.success) {
    return {
      success: false,
      error: phase1.error,
      errorCode: phase1.errorCode,
      failedLandmarks: phase1.failedLandmarks,
      durationMs: Date.now() - wrapperStart,
      researchDurationMs: phase1.researchDurationMs,
    };
  }
  const phase2a = await runPipelinePhase2aNarrationGen(template, phase1);
  if (!phase2a.success) {
    return {
      success: false,
      error: phase2a.error,
      errorCode: phase2a.errorCode,
      failedLandmarks: phase2a.failedLandmarks,
      durationMs: Date.now() - wrapperStart,
      researchDurationMs: phase1.researchDurationMs,
    };
  }
  const phase2b = await runPipelinePhase2bGameWide(template, phase1, phase2a);
  const result = await runPipelinePhase2cInsert(
    template,
    phase1,
    phase2a,
    phase2b,
  );
  // Le wrapper agrège la durée totale dans `durationMs` pour préserver la
  // sémantique historique : les callers (admin UI, callback OddballTrip)
  // lisent `durationMs` comme le temps TOTAL de bout en bout.
  return {
    ...result,
    durationMs: Date.now() - wrapperStart,
  };
}

/**
 * Insert a generated game and its steps into Supabase
 */
async function insertGameIntoDatabase(
  template: GameTemplate,
  steps: Awaited<ReturnType<typeof generateGameSteps>>,
  _stepPhotos: Array<null> = [],
  epilogue: GeneratedEpilogue | null = null,
  // Indexed by step_order - 1. Carries the locked-in geocoded
  // coordinates and the real landmark name for each step. Required by
  // the GPS-first flow: we copy lat/lon from here verbatim into the DB
  // and never trust whatever Claude returned for that field.
  verifiedLocations: ResearchedLocation[] = [],
  // Flag posé par la sanity-check post-discovery (cluster centroid drift).
  // Quand true, le jeu publie quand même mais oddballtrip retient le code
  // activation jusqu'à inspection humaine.
  needsReview: boolean = false,
  reviewReason: string | undefined = undefined,
  // Patrimoine-first UX (migration 027 / vision 2026-05-16) :
  //   - introSpeech : discours du guide avant le stop 1
  //   - finalRiddle : énigme finale combinant les indices, 2 essais,
  //                   épilogue conditionnel
  // Nullable : si la génération a échoué, le jeu publie quand même
  // mais l'UX dégrade (pas de page intro / pas d'énigme finale).
  introSpeech: { text: string } | null = null,
  finalRiddle: { riddle: string; answer: string; explanation: string } | null = null,
  // S9 (2026-05-19) : tour steps (vide pour city_game). Quand non-vide,
  // on écrit le contenu riche dans step_content après l'insert game_steps.
  tourSteps: GeneratedTourStep[] = [],
  contentLanguage: string = "en",
  // (2026-05-21) StartPoint résolu par Phase 1 STEP 0 — persisté en
  // games.start_point_* pour debug post-facto + affichage admin/player.
  // Optionnel pour ne pas casser les callers legacy.
  resolvedStartPoint?: {
    lat: number;
    lon: number;
    text: string;
    source:
      | "startPointText-geocoded"
      | "top-landmark-google-places"
      | "city-center-fallback"
      | "operator-curated";
  },
  // (Sprint 6.2bis, 2026-05-22) Verbatim OddballTrip POST body, persisted
  // in `games.original_payload` (migration 038) for post-incident RCA.
  // NULL acceptable for legacy callers / non-Inngest sync path.
  originalPayload?: Record<string, unknown>,
): Promise<string> {
  const supabase = createAdminClient();
  const gameId = uuidv4();

  // Insert game (English only — translated on demand by the app)
  const { error: gameError } = await supabase.from("games").insert({
    id: gameId,
    slug: template.slug,
    title: template.theme,
    description: template.themeDescription,
    city: template.city,
    difficulty: template.difficulty,
    estimated_duration_min: template.estimatedDurationMin,
    // is_published=false INITIALEMENT. La pipeline flippera à `true`
    // UNIQUEMENT après que validateFinalGame passe tous ses checks
    // (twin stops, Roman drift, translations 100%, audio coverage).
    // Tant que is_published=false :
    //   - /api/external/find-game retourne 404 (filtre WHERE is_published=true)
    //   - OddballTrip ne peut PAS trouver le game pour créer le code
    //   - Le client n'a aucun moyen de recevoir un jeu cassé
    // Fix race condition observée 11/05/26 — OddballTrip pollait find-game
    // dès l'INSERT (avant que prepareGamePackage + validator finissent),
    // créait le code, l'envoyait au client. Désormais : is_published=true
    // = signal "tout est en DB, validé, prêt".
    is_published: false,
    // 3 cheap hints per step is the sweet spot: hint 1 = atmospheric
    // nudge, hint 2 = where to look (e.g. "scan the facade above the
    // main door"), hint 3 = the SHAPE of the answer ("a Latin word + a
    // century in Roman numerals"). Without #2 and #3 the player has no
    // way to guess they should open the AR camera, which is exactly
    // what blocked Forest+Philippat in Tournus.
    // 2026-05-17 : reduced from 3 to 1. The pipeline now generates a
    // single practical hint per step (the AR-camera pointing one), the
    // 2 other legacy hints (atmospheric / answer-shape) were dropped
    // as redundant or spoilery. UI button "request hint" stays — it
    // just exposes 1 hint max now.
    max_hints_per_step: 1,
    hint_penalty_seconds: 30,
    cover_image: template.coverImage || null,
    // S9 (2026-05-18) — mode du jeu (city_game = escape, city_tour =
    // audioguide). Default 'city_game' si non spécifié.
    mode: template.mode ?? "city_game",
    // Narrative epilogue (English only here — translated on demand like other fields)
    epilogue_title: epilogue?.title ?? null,
    epilogue_text: epilogue?.text ?? null,
    // Review flag — needs_review=true tient le code activation côté
    // oddballtrip jusqu'à inspection humaine (cf. migration 023).
    needs_review: needsReview,
    review_reason: reviewReason ?? null,
    // Patrimoine-first UX (migration 027). Stored as JSONB ({en} for now,
    // translated on demand to other locales by the translation pipeline).
    intro_speech: introSpeech ? { en: introSpeech.text } : null,
    final_riddle_text: finalRiddle ? { en: finalRiddle.riddle } : null,
    final_answer: finalRiddle ? finalRiddle.answer : null,
    final_answer_explanation: finalRiddle ? { en: finalRiddle.explanation } : null,
    // ── ROADTRIP (contrat OddballTrip 2026-05-10, migration 024) ──
    transport_mode: template.transportMode ?? "walking",
    radius_km: template.radiusKm ?? null,
    recommended_days_min: template.recommendedDaysMin ?? null,
    recommended_days_max: template.recommendedDaysMax ?? null,
    // TTL du code activation.
    //
    // Politique 2026-05-15 — VALIDITÉ 7 JOURS PAR DÉFAUT (suite incident
    // Julien Alba qui a fait une pause déjeuner italienne + pluie) :
    //   - Walking : 168h (7 jours) — couvre vacances, mauvais temps,
    //                                 reprise sur plusieurs jours.
    //   - Roadtrip : (recommendedDaysMax + 7) × 24, soit ~264h pour 4j,
    //                ~336h pour 7j. Cohérent avec la durée prévue.
    //
    // Avant : walking=24h. Trop court — un client qui achète le matin
    // et veut faire le jeu le soir après mauvais temps : game over.
    // Standard du marché audio-tour (Voicemap, Detour, izi) = 7 jours.
    code_validity_hours: (() => {
      const isRoadtrip =
        template.transportMode === "driving" || template.transportMode === "mixed";
      if (!isRoadtrip) return 168; // walking : 7 jours
      const max = template.recommendedDaysMax;
      if (typeof max === "number" && max >= 1) {
        return (max + 7) * 24;
      }
      return 168; // 7 jours par défaut pour roadtrip sans days
    })(),
    // (2026-05-21, migration 034) Persistence du startPoint résolu.
    // Permet le debug post-facto ("où ce jeu démarre vraiment ?") et
    // l'affichage du point de RDV à l'admin/player sans avoir à re-
    // géocoder. Nullable car les callers legacy peuvent ne pas le
    // fournir (compat retro). Les nouveaux runs Phase 2c remplissent
    // toujours ces 4 colonnes.
    start_point_text: resolvedStartPoint?.text ?? null,
    start_point_lat: resolvedStartPoint?.lat ?? null,
    start_point_lon: resolvedStartPoint?.lon ?? null,
    start_point_source: resolvedStartPoint?.source ?? null,
    // (Sprint 6.2bis, migration 038) Verbatim OddballTrip payload —
    // post-incident RCA. NULL pour les callers legacy (sync path) ou
    // les jeux pré-déploiement de Sprint 6.2bis.
    original_payload: originalPayload ?? null,
    // (Sprint 6.2ter, migration 039) Rich product page description —
    // grounding text for all downstream prompts. NULL acceptable
    // (OddballTrip optionally sends it; pipeline tolerates absence).
    product_description: template.productDescription ?? null,
  });

  if (gameError) {
    throw new Error(`Failed to insert game: ${gameError.message}`);
  }

  /**
   * Normalize hints into the canonical [{order, text}] shape.
   *
   * Magali's first-customer purchase tonight surfaced a silent failure
   * mode: Claude sometimes returned hints as plain strings ("hint
   * text 1", "hint text 2") instead of {order, text} objects. The
   * previous .map(h => ({order: h.order, text: h.text})) produced
   * [{}, {}, {}] in that case — DB stored empty objects, the player
   * unlocked hints and saw nothing, then skipped the step. So we
   * accept BOTH shapes here and re-derive the order from the array
   * index when the model omitted it.
   */
  function normalizeHints(
    raw: unknown,
  ): Array<{ order: number; text: string }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((h, i) => {
        if (typeof h === "string") return { order: i + 1, text: h };
        if (h && typeof h === "object") {
          const obj = h as { order?: number; text?: string };
          const text = String(obj.text ?? "").trim();
          if (!text) return null;
          return { order: obj.order ?? i + 1, text };
        }
        return null;
      })
      .filter((h): h is { order: number; text: string } => h !== null);
  }

  // Insert steps
  const stepsToInsert = steps.map((step, index) => {
    const hints = normalizeHints(step.hints as unknown);
    // Threshold lowered 2026-05-17 (A1 commit cc8a1a0) — pipeline now
    // generates EXACTLY 1 practical hint per step (where to point the
    // AR camera). The previous 3-hint ladder was redundant : Hint 1
    // (atmospheric) was a clone of riddle_text, and Hint 3 (shape of
    // answer) was a spoiler. Only the camera-pointing hint kept.
    if (hints.length < 1) {
      throw new Error(
        `Step ${index + 1} has 0 hints. Pipeline expects EXACTLY 1 AR-camera-pointing hint. Raw: ${JSON.stringify(step.hints).slice(0, 200)}`,
      );
    }

    // Coords sanity check — refuse to publish a step with missing or
    // null-island coordinates. The Shibuya game shipped to two real
    // customers with 5 of 8 steps at lat=0 lon=0 (Claude couldn't
    // resolve some of the fictional venues from the Lucie Blackman case
    // and the pipeline silently inserted zeros). Without this guard
    // those players' radar pointed at the middle of the Atlantic.
    //
    // Special-case: the Royal Observatory in Greenwich is literally on
    // the prime meridian, so lon == 0 with lat ≈ 51.477 is legitimate.
    // The check stays narrow on purpose — anywhere else, lat=0 OR lon=0
    // means the data is broken.
    const lat = Number(step.latitude);
    const lon = Number(step.longitude);
    const isPrimeMeridianGreenwich =
      lon === 0 && Number.isFinite(lat) && lat >= 51.45 && lat <= 51.5;
    const coordsLookBroken =
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (!isPrimeMeridianGreenwich && (lat === 0 || lon === 0));
    if (coordsLookBroken) {
      throw new Error(
        `Step ${index + 1} ("${typeof step.title === "string" ? step.title : JSON.stringify(step.title)}") has invalid GPS coordinates lat=${step.latitude} lon=${step.longitude} — refusing to publish a game whose radar would point at the middle of the ocean. Re-prompt Claude with explicit GPS for every stop.`,
      );
    }

    // Keep up to 3 hints (Claude is asked for exactly 3). We used to
    // trim to 1 to match a previous max_hints_per_step=1 default, which
    // wasted the hints we'd already paid Claude to generate AND made
    // AR-locked games unrecoverable when the player couldn't see the
    // facade text.
    const trimmedHints = hints.slice(0, 3);

    // CRITICAL: enforce ar_facade_text === answer_text in uppercase.
    // Claude has a strong creative bias toward decorating the facade
    // text ("ANNO DOMINI 1189" instead of "1189", "TRES DOMINI" instead
    // of "III"). With AR auto-validate sending arFacadeText to the
    // server for comparison against answer_text, ANY decoration breaks
    // validation server-side and the player gets stuck. The prompt
    // says MUST EXACTLY match but Claude ignored it on the Agen test
    // game (5/8 steps mismatched). We override here, server-side, so
    // it can NEVER happen again regardless of what the model said.
    const enforcedFacade = step.answer_text
      ? String(step.answer_text).toUpperCase()
      : step.ar_facade_text || null;

    // Pull the locked-in real landmark name from the verified
    // location list, indexed by step order. This is what gets stored
    // in `game_steps.landmark_name` — used by audit / re-geocoding
    // tools, NEVER exposed to the player.
    const sourceLocation = verifiedLocations[index];
    const landmarkName =
      sourceLocation?.landmarkName?.trim() || sourceLocation?.name || null;

    // Résout le character_type à stocker en DB.
    //
    // Politique opérateur (changement 2026-05-05) : par défaut on met
    // un guide OddballTrip neutre (homme/femme alterné). On ne met un
    // personnage thématique que si Claude a EXPLICITEMENT renvoyé un
    // type valide du catalogue AR_CHARACTERS (knight/witch/monk/sailor/
    // detective/ghost/princess/peasant/soldier).
    //
    // Pourquoi : le catalogue thématique est volontairement restreint
    // à 9 archétypes ; sur la majorité des sites du monde aucun ne
    // colle vraiment. Mieux vaut un guide neutre qu'un mauvais match
    // (peasant au temple d'Héphaïstos = absurde).
    //
    // Le guide est sélectionné via pickFallbackGuide(stepId) — hash
    // stable sur l'id pour que le même stop affiche toujours le
    // MÊME guide (pas de flickering entre sessions).
    const stepId = uuidv4();
    const themedTypes = new Set<string>(AR_CHARACTERS.map((c) => c.type));
    const claudeChoice = (step.ar_character_type || "").toLowerCase().trim();
    const resolvedCharacter: string = themedTypes.has(claudeChoice)
      ? claudeChoice
      : pickFallbackGuide(stepId);

    return {
      id: stepId,
      game_id: gameId,
      step_order: index + 1,
      title: step.title,
      landmark_name: landmarkName,
      riddle_text: step.riddle_text,
      answer_text: step.answer_text,
      // Coords are taken VERBATIM from the geocoded source — Claude is
      // never allowed to override them at this stage. If anything
      // looks off here, the bug is upstream in the geocoder, not in
      // Claude.
      latitude: sourceLocation?.latitude ?? step.latitude,
      longitude: sourceLocation?.longitude ?? step.longitude,
      validation_radius_meters: step.validation_radius_meters,
      hints: trimmedHints,
      anecdote: step.anecdote,
      // Patrimoine-first (migration 027). landmark_history is the FULL
      // story of the place independent of the theme — played as the
      // first card after the AR find.
      //
      // JSONB wrapping : utilise la langue du CONTENU généré.
      //   - city_game : contenu généré en EN → {en: "..."}
      //   - city_tour : contenu généré directement dans la langue cible
      //     (FR si language=fr, etc.) → {<contentLanguage>: "..."}
      // Bug rapporté Montpellier 2026-05-20 : avant ce fix, le tour
      // stockait du texte FR sous la clé `en` — visuellement OK grâce
      // au fallback de t(), mais métadonnée incorrecte qui pouvait
      // induire des bugs subtils côté lecture API.
      landmark_history: step.landmark_history
        ? { [template.mode === "city_tour" ? contentLanguage : "en"]: step.landmark_history }
        : null,
      // Catégorie + citation propagées depuis la discovery Gemini
      // (vide pour les jeux en fallback Google Places legacy).
      poi_category: sourceLocation?.poiCategory ?? null,
      landmark_citation: sourceLocation?.citation ?? null,
      bonus_time_seconds: step.bonus_time_seconds,
      has_photo_challenge: false,
      // Photo historique AR (Wikipedia/archives) retirée du produit :
      // friction visuelle vs personnage AR + maintenance d'attribution
      // crédits. Colonnes droppées dans migration 0036.
      // AR-first flow: every step is virtual_ar regardless of what the
      // model returned. The "physical" mode is fully retired.
      answer_source: "virtual_ar" as const,
      // AR character — résolu vers une valeur stockable directement
      // (guide_male / guide_female / type thématique du catalogue).
      // Plus de "default" en DB : le runtime n'a pas à interpréter.
      ar_character_type: resolvedCharacter,
      ar_character_dialogue: step.ar_character_dialogue || null,
      ar_facade_text: enforcedFacade,
      ar_treasure_reward: step.ar_treasure_reward || null,
      // Route POIs — defensive normalization (drop entries missing
      // name or fact, cap at 4). Cap raised 2026-05-17 from 3 → 4
      // and the schema enriched with category + distance_m + lat/lon
      // (all optional). The filter ONLY requires name + fact ; the
      // enrichment fields are preserved when present and dropped
      // silently when malformed.
      // We log a warning when a step has 0 entries so the post-
      // generation alert email surfaces the gap ; we don't hard-fail
      // (legacy games would break) but the next attractions-fill
      // script can pick up the slack.
      route_attractions: (() => {
        const VALID_CATEGORIES = new Set([
          "heritage",
          "viewpoint",
          "quirky",
          "food",
          "nature",
        ]);
        type RawAttr = {
          name?: unknown;
          fact?: unknown;
          category?: unknown;
          distance_m?: unknown;
          lat?: unknown;
          lon?: unknown;
        };
        const valid = Array.isArray(step.route_attractions)
          ? (step.route_attractions as RawAttr[])
              .filter(
                (a): a is RawAttr & { name: string; fact: string } =>
                  !!a &&
                  typeof a === "object" &&
                  typeof a.name === "string" &&
                  typeof a.fact === "string" &&
                  a.name.trim().length > 0 &&
                  a.fact.trim().length > 0,
              )
              .map((a) => {
                const out: {
                  name: string;
                  fact: string;
                  category?: string;
                  distance_m?: number;
                  lat?: number;
                  lon?: number;
                } = { name: a.name, fact: a.fact };
                if (
                  typeof a.category === "string" &&
                  VALID_CATEGORIES.has(a.category)
                ) {
                  out.category = a.category;
                }
                if (
                  typeof a.distance_m === "number" &&
                  Number.isFinite(a.distance_m) &&
                  a.distance_m >= 0 &&
                  a.distance_m <= 5_000
                ) {
                  out.distance_m = Math.round(a.distance_m);
                }
                if (
                  typeof a.lat === "number" &&
                  typeof a.lon === "number" &&
                  Number.isFinite(a.lat) &&
                  Number.isFinite(a.lon) &&
                  Math.abs(a.lat) <= 90 &&
                  Math.abs(a.lon) <= 180
                ) {
                  out.lat = a.lat;
                  out.lon = a.lon;
                }
                return out;
              })
              .slice(0, 4)
          : [];
        if (valid.length === 0) {
          console.warn(
            `[Pipeline] Step ${index + 1} has NO route_attractions — UI card will be hidden. Consider re-running fill-step1-attractions or similar.`,
          );
        }
        return valid;
      })(),
    };
  });

  const { error: stepsError } = await supabase
    .from("game_steps")
    .insert(stepsToInsert);

  if (stepsError) {
    // Rollback: delete the game if steps fail
    await supabase.from("games").delete().eq("id", gameId);
    throw new Error(`Failed to insert steps: ${stepsError.message}`);
  }

  // ════════════════════════════════════════════════════════════════
  // S9 (2026-05-19) — Tour content : écrire dans step_content
  // ════════════════════════════════════════════════════════════════
  // Pour les jeux en mode city_tour, on écrit le contenu narratif
  // riche dans step_content (key par step_id + mode + language).
  // game_steps a déjà reçu le riddle_text = encyclopedic_text (utilisé
  // en fallback). step_content ajoute architectural_focus +
  // cultural_connection qui ne tiennent pas dans game_steps.
  if (template.mode === "city_tour" && tourSteps.length > 0) {
    const stepContentRows = stepsToInsert.map((dbStep, idx) => {
      const t = tourSteps[idx];
      if (!t) return null;
      return {
        step_id: dbStep.id,
        mode: "city_tour" as const,
        language: contentLanguage,
        title: t.title,
        landmark_history: t.landmark_history,
        anecdote: t.anecdote,
        // Tour-only fields
        encyclopedic_text: t.encyclopedic_text,
        architectural_focus: t.architectural_focus,
        cultural_connection: t.cultural_connection,
        // Escape-only fields NULL pour les rows tour
        riddle_text: null,
        hints: null,
        answer: null,
        answer_source: null,
        ar_character: t.ar_character_type
          ? { type: t.ar_character_type, dialogue: t.ar_character_dialogue }
          : null,
        ar_facade_text: null,
        ar_treasure_reward: null,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    const { error: contentError } = await supabase
      .from("step_content")
      .insert(stepContentRows);

    if (contentError) {
      // Non-bloquant : si step_content fail, on continue. Le jeu publie
      // quand même mais l'API tombera en fallback sur game_steps qui
      // contient déjà l'encyclopedic_text dans riddle_text. Log + flag.
      console.error(
        `[Pipeline] step_content insert failed (non-blocking, fallback game_steps): ${contentError.message}`,
      );
    } else {
      console.log(
        `[Pipeline] step_content ✓ ${stepContentRows.length} rows écrites pour le mode city_tour (lang=${contentLanguage})`,
      );
    }
  }

  return gameId;
}
