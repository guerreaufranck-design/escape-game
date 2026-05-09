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
  generateEpilogue,
  validateGeneratedSteps,
  regenerateStep,
  adaptNarrativeForReplacedStops,
  type GeneratedEpilogue,
  type GeneratedStep,
} from "./anthropic";
import { createAdminClient } from "./supabase/admin";
import { geocodeLocation, haversineMeters } from "./geocode";
import { discoverParcours } from "./parcours-discovery";
import { prepareGamePackage } from "./game-package";
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
export async function generateGameFromTemplate(
  template: GameTemplate
): Promise<PipelineResult> {
  const startTime = Date.now();

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
    const CITY_STARTPOINT_DRIFT_M = 20_000;
    const cityToGeocode = template.city.split(/\s*[·,]\s*/)[0].trim();

    // 1. Géocode le startPointText précis si fourni
    let textGeo: { lat: number; lon: number } | null = null;
    if (template.startPointText && template.startPointText.trim()) {
      try {
        const geo = await geocodeLocation(
          template.startPointText,
          cityToGeocode,
          template.country,
        );
        if (geo) {
          textGeo = { lat: geo.lat, lon: geo.lon };
          console.log(
            `[Pipeline] startPointText "${template.startPointText}" geocoded at ${textGeo.lat.toFixed(4)},${textGeo.lon.toFixed(4)} (PRECISE source)`,
          );
        } else {
          console.warn(
            `[Pipeline] startPointText "${template.startPointText}" failed to geocode — falling back to cityCenter`,
          );
        }
      } catch (err) {
        console.warn(
          `[Pipeline] startPointText geocode threw (non-blocking): ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 2. Géocode le city comme fallback (et pour comparaison)
    let cityCenter: { lat: number; lon: number } | null = null;
    try {
      const cityGeo = await geocodeLocation(
        cityToGeocode,
        cityToGeocode,
        template.country,
      );
      if (cityGeo) cityCenter = { lat: cityGeo.lat, lon: cityGeo.lon };
    } catch (err) {
      console.warn(
        `[Pipeline] City geocode threw (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
    }

    // Source d'autorité choisie : textGeo > cityCenter
    const authoritativeStart = textGeo ?? cityCenter;
    const authoritativeSource = textGeo ? "startPointText" : "cityCenter";

    let startPoint = template.startPoint;
    let startPointAutoCorrected: {
      from: { lat: number; lon: number };
      to: { lat: number; lon: number };
      driftKm: number;
      source: string;
    } | null = null;
    if (!startPoint) {
      // Pas de startPoint envoyé — fallback obligatoire vers authoritativeStart.
      if (!authoritativeStart) {
        const err = new Error(
          `INTERNAL_ERROR: cannot geocode startPointText nor city center as fallback startPoint for "${template.city}, ${template.country}"`,
        ) as Error & { code?: PipelineErrorCode };
        err.code = "INTERNAL_ERROR";
        throw err;
      }
      console.warn(
        `[Pipeline] ⚠ MISSING template.startPoint — using ${authoritativeSource} ${authoritativeStart.lat.toFixed(4)},${authoritativeStart.lon.toFixed(4)}`,
      );
      startPoint = authoritativeStart;
    } else if (authoritativeStart) {
      // body.startPoint fourni ET authoritativeStart dispo → on vérifie le drift.
      const drift = haversineMeters(authoritativeStart, startPoint);
      if (drift > CITY_STARTPOINT_DRIFT_M) {
        console.warn(
          `[Pipeline] ⚠ AUTO-CORRECT startPoint: ${authoritativeSource} at ${authoritativeStart.lat.toFixed(4)},${authoritativeStart.lon.toFixed(4)} but body.startPoint was ${(drift / 1000).toFixed(1)}km away (${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)}). Overriding to ${authoritativeSource}.`,
        );
        startPointAutoCorrected = {
          from: { lat: startPoint.lat, lon: startPoint.lon },
          to: { lat: authoritativeStart.lat, lon: authoritativeStart.lon },
          driftKm: Math.round((drift / 1000) * 10) / 10,
          source: authoritativeSource,
        };
        startPoint = authoritativeStart;
      } else {
        console.log(
          `[Pipeline] startPoint from operator: ${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)} — drift ${Math.round(drift)}m from ${authoritativeSource}, OK`,
        );
      }
    } else {
      // body.startPoint fourni mais aucune source de vérité dispo → trust body.
      console.log(
        `[Pipeline] startPoint from operator: ${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)} (no startPointText nor cityCenter geocode available, no validation)`,
      );
    }

    // Plancher commercial : 6 stops minimum, plafond 9 (cf.
    // ABSOLUTE_MIN_STOPS et ABSOLUTE_MAX_STOPS dans parcours-discovery.ts).
    // Politique 2026-05-09 :
    //   - body.stopCount absent ou < 6 → bump à 6
    //   - body.stopCount > 9 → cap à 9
    //   - Default si rien envoyé : 9 (le but est de viser le MAX dans la
    //     tranche 6-9, le pipeline élague vers le bas si la zone n'a pas
    //     assez de POIs walkables).
    const requestedStopCount = template.stopCount ?? 9;
    const stopCount = Math.max(6, Math.min(9, requestedStopCount));
    if (requestedStopCount < 6) {
      console.warn(
        `[Pipeline] stopCount=${requestedStopCount} below commercial floor of 6 — bumped to 6`,
      );
    } else if (requestedStopCount > 9) {
      console.warn(
        `[Pipeline] stopCount=${requestedStopCount} above commercial ceiling of 9 — capped to 9`,
      );
    }

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
      startPoint,
      stopCount,
    };
    console.log(
      `[Pipeline] Discovery attempt: ${wideningAttempts[0].label} (multiplier ${wideningAttempts[0].multiplier}x)`,
    );
    let discovery = await discoverParcours({
      ...discoveryParamsBase,
      wideningMultiplier: wideningAttempts[0].multiplier,
    });
    let usedWidening = wideningAttempts[0];
    for (const attempt of wideningAttempts.slice(1)) {
      if (discovery.success && discovery.landmarks.length >= 5) break;
      console.warn(
        `[Pipeline] ${usedWidening.label} attempt yielded ${discovery.success ? discovery.landmarks.length : 0} stops (need ≥5) — retrying with ${attempt.label} (multiplier ${attempt.multiplier}x)`,
      );
      discovery = await discoverParcours({
        ...discoveryParamsBase,
        wideningMultiplier: attempt.multiplier,
      });
      usedWidening = attempt;
    }

    if (!discovery.success || discovery.landmarks.length < 5) {
      const err = new Error(
        discovery.error ||
          `All widening attempts failed — zone too sparse for ≥5 walkable stops even at 2.5× radius/maxHop. Reframe the fiche editorially.`,
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
    const CENTROID_DRIFT_M = 5_000;
    let needsReview = false;
    let reviewReason: string | undefined;
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
        reviewReason = `Cluster centroid is ${Math.round(drift / 100) / 10} km from body.startPoint (threshold ${CENTROID_DRIFT_M / 1000} km) — likely the body.startPoint targets a SEO label rather than the actual play zone. Inspect via dump-game before releasing the activation code.`;
        console.warn(`[Pipeline] ⚠ needs_review=true — ${reviewReason}`);
      } else {
        console.log(
          `[Pipeline] Cluster sanity-check OK — centroid drift ${Math.round(drift)}m < ${CENTROID_DRIFT_M}m`,
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
    if (startPointAutoCorrected) {
      if (startPointAutoCorrected.source === "startPointText") {
        // Haute précision : auto-correct via le texte géocodé. Pas de flag.
        // On log juste pour traçabilité — utile pour identifier les
        // fiches oddballtrip à corriger upstream à un autre moment.
        console.log(
          `[Pipeline] AUTO-PUBLISH after correction via startPointText (high precision, no review needed). UPSTREAM BUG to fix later: oddballtrip should fix stored startPoint for slug "${template.slug}" (was ${startPointAutoCorrected.driftKm}km off).`,
        );
      } else {
        // Précision dégradée (cityCenter ~500m) : on flag pour review
        needsReview = true;
        const correctReason = `body.startPoint auto-corrected to CITY CENTER (less precise than startPointText would be). Was ${startPointAutoCorrected.driftKm}km off. Game playable at city level but checkpoint precision is ~500m. oddballtrip should provide startPointText for this slug to enable auto-publish next time.`;
        reviewReason = reviewReason
          ? `${reviewReason} | ${correctReason}`
          : correctReason;
      }
    }

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
    const verifiedLocations: ResearchedLocation[] = discovery.landmarks.map(
      (s) => ({
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
      }),
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
    // STEP 4 : Génération des énigmes (Claude #1)
    // ============================================
    const creationStart = Date.now();
    const genre: GameGenre = template.genre ?? DEFAULT_GENRE;
    console.log(`[Pipeline] Genre: ${genre} (${template.genre ? "from operator" : "default fallback"})`);
    let steps: GeneratedStep[] = await generateGameSteps(
      template.city,
      template.country,
      template.theme,
      effectiveNarrative,
      effectiveDifficulty,
      verifiedLocations,
      genre,
      discovery.verifiedContext,
    );

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
    const isAutoLeaked = (s: GeneratedStep): boolean =>
      s.answer_text?.toUpperCase().trim() === "AUTO" ||
      s.ar_facade_text?.toUpperCase().trim() === "AUTO";

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

    // ============================================
    // STEP 5 : QA Claude #2 + regen ciblé
    // ============================================
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

    // ============================================
    // STEP 6 : Epilogue
    // ============================================
    // Photos historiques Wikipedia retirées (commit 2026-05-05) — la
    // couche AR fonctionne sans : le mot magique se matérialise sur
    // la façade, le character_dialogue donne le contexte, l'AR_treasure
    // est révélé. La photo Wikipedia ajoutait peu et compliquait la
    // mise en page UI.
    const epilogue = await generateEpilogue({
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
      });

    // ============================================
    // STEP 7 : Insert DB
    // ============================================
    const gameId = await insertGameIntoDatabase(
      {
        ...template,
        narrative: effectiveNarrative,
        themeDescription: effectiveThemeDescription,
        difficulty: effectiveDifficulty,
      },
      steps,
      [],
      epilogue,
      verifiedLocations,
      needsReview,
      reviewReason,
    );
    console.log(`[Pipeline] Game created with ID: ${gameId}`);

    // ============================================
    // STEP 7.5 : Pré-génération audio + traductions (langue acheteur)
    // ============================================
    // Pour que le joueur ait ZÉRO latence quand il démarre la session,
    // on génère ICI tous les audios + traductions dans la langue
    // qu'il a achetée. Sans ça, chaque stop déclenche une génération
    // ElevenLabs + Claude/Gemini en cours de jeu (~5-10 sec × 8 stops
    // = ~60 sec de blocage cumulés, ressentis comme « l'app est cassée »).
    //
    // Validation simple : on attend un code ISO 2 lettres en lowercase
    // (cf. /api/external/generate-code). Sinon on warn et on laisse
    // le pipeline générer en lazy à la demande — pas idéal mais le
    // jeu publie quand même.
    if (template.language && /^[a-z]{2}$/.test(template.language)) {
      const lang = template.language;
      const audioStart = Date.now();
      try {
        const pkg = await prepareGamePackage(gameId, lang);
        const audioMs = Date.now() - audioStart;
        if (pkg.success) {
          console.log(
            `[Pipeline] Pre-generated audio package for "${lang}" in ${Math.round(audioMs / 1000)}s — generated=${pkg.audioGenerated}, skipped=${pkg.audioSkipped}, failed=${pkg.audioFailed}`,
          );
        } else {
          console.warn(
            `[Pipeline] Audio package for "${lang}" returned errors (non-blocking): ${pkg.errors?.join("; ")}`,
          );
        }
      } catch (err) {
        console.warn(
          `[Pipeline] Audio package generation threw (non-blocking): ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      console.warn(
        `[Pipeline] ⚠ MISSING template.language — audios will be generated LAZILY when the player starts the session. Latency in-game ~5-10s × 8 stops. Send body.language = "fr"|"en"|... in /api/games/generate to pre-generate.`,
      );
    }

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
      `[Pipeline] Failed after ${Math.round(durationMs / 1000)}s: ${errorMessage}`,
    );

    const tagged = error as Error & {
      code?: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
    };
    const errorCode: PipelineErrorCode =
      tagged?.code ?? "INTERNAL_ERROR";

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
    is_published: true, // Auto-published — generated games are ready to play
    // 3 cheap hints per step is the sweet spot: hint 1 = atmospheric
    // nudge, hint 2 = where to look (e.g. "scan the facade above the
    // main door"), hint 3 = the SHAPE of the answer ("a Latin word + a
    // century in Roman numerals"). Without #2 and #3 the player has no
    // way to guess they should open the AR camera, which is exactly
    // what blocked Forest+Philippat in Tournus.
    max_hints_per_step: 3,
    hint_penalty_seconds: 30,
    cover_image: template.coverImage || null,
    // Narrative epilogue (English only here — translated on demand like other fields)
    epilogue_title: epilogue?.title ?? null,
    epilogue_text: epilogue?.text ?? null,
    // Review flag — needs_review=true tient le code activation côté
    // oddballtrip jusqu'à inspection humaine (cf. migration 023).
    needs_review: needsReview,
    review_reason: reviewReason ?? null,
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
    if (hints.length < 3) {
      // Hard fail rather than silently shipping a step the player can't
      // get unstuck on. AR-locked steps need the full 3-hint ladder
      // (atmosphere → where to look → shape of the answer) — without it,
      // a player whose AR doesn't render perfectly has no way forward.
      // The throw surfaces in the pipeline failure email so we know to
      // re-prompt Claude rather than ship a broken game.
      throw new Error(
        `Step ${index + 1} has only ${hints.length} hint(s), need >= 3. Raw: ${JSON.stringify(step.hints).slice(0, 200)}`,
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
      bonus_time_seconds: step.bonus_time_seconds,
      has_photo_challenge: false,
      ar_historical_photo_url: null,
      ar_historical_photo_credit: null,
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
      // name or fact, cap at 3). We log a warning when a step has 0
      // entries so the post-generation alert email surfaces the gap;
      // we don't hard-fail (legacy games would break) but the next
      // attractions-fill script can pick up the slack.
      route_attractions: (() => {
        const valid = Array.isArray(step.route_attractions)
          ? step.route_attractions
              .filter(
                (a): a is { name: string; fact: string } =>
                  !!a &&
                  typeof a === "object" &&
                  typeof (a as { name?: unknown }).name === "string" &&
                  typeof (a as { fact?: unknown }).fact === "string" &&
                  (a as { name: string }).name.trim().length > 0 &&
                  (a as { fact: string }).fact.trim().length > 0,
              )
              .slice(0, 3)
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

  return gameId;
}
