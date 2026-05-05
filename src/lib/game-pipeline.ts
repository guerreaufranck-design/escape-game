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
import { fetchHistoricalPhoto, type HistoricalPhotoResult } from "./wikipedia";
import { geocodeLocation, haversineMeters } from "./geocode";
import { discoverParcours } from "./parcours-discovery";
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
  /** Combien de stops au final dans le jeu (défaut 8). Dans le modèle
   *  intent-first, c'est ce nombre que Perplexity essaie de produire,
   *  filtré ensuite par géocodage et walkability. Plancher dur = 6 ;
   *  en dessous le pipeline rejette. */
  stopCount?: number;
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
  photoUrl?: string | null;
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
    // STEP 0 : Résoudre le point de départ
    // ============================================
    let startPoint = template.startPoint;
    if (!startPoint) {
      console.warn(
        `[Pipeline] ⚠ MISSING template.startPoint — falling back to city center geocode (less precise for big cities, oddballtrip should transmit startPoint)`,
      );
      const cityGeo = await geocodeLocation(
        `${template.city}, ${template.country}`,
        template.city,
        template.country,
      );
      if (!cityGeo) {
        const err = new Error(
          `INTERNAL_ERROR: cannot geocode city center as fallback startPoint for "${template.city}, ${template.country}"`,
        ) as Error & { code?: PipelineErrorCode };
        err.code = "INTERNAL_ERROR";
        throw err;
      }
      startPoint = { lat: cityGeo.lat, lon: cityGeo.lon };
      console.log(
        `[Pipeline] Fallback startPoint = city center ${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)}`,
      );
    } else {
      console.log(
        `[Pipeline] startPoint from operator: ${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)}`,
      );
    }

    const stopCount = template.stopCount ?? 8;
    if (stopCount < 6) {
      const err = new Error(
        `INTERNAL_ERROR: stopCount=${stopCount} below floor of 6 — pipeline cannot publish a game shorter than 6 stops`,
      ) as Error & { code?: PipelineErrorCode };
      err.code = "INTERNAL_ERROR";
      throw err;
    }

    // ============================================
    // STEP 1 : Discovery (Perplexity → Google → walkability)
    // ============================================
    const researchStart = Date.now();
    const discovery = await discoverParcours({
      city: template.city,
      country: template.country,
      theme: template.theme,
      themeDescription: template.themeDescription,
      narrative: template.narrative,
      startPoint,
      stopCount,
    });

    if (!discovery.success) {
      const err = new Error(
        discovery.error || "Discovery failed (unknown reason)",
      ) as Error & {
        code?: PipelineErrorCode;
        failedLandmarks?: FailedLandmark[];
      };
      err.code = discovery.errorCode ?? "DISCOVERY_FAILED";
      err.failedLandmarks = discovery.rejected.map((r) => ({
        stopName: r.name,
        tried: [r.reason],
      }));
      throw err;
    }

    const researchDurationMs = Date.now() - researchStart;
    console.log(
      `[Pipeline] Discovery complete in ${Math.round(researchDurationMs / 1000)}s — ${discovery.landmarks.length} landmarks (${discovery.rejected.length} rejected)`,
    );

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
    let steps: GeneratedStep[] = await generateGameSteps(
      template.city,
      template.country,
      template.theme,
      effectiveNarrative,
      template.difficulty,
      verifiedLocations,
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
    // STEP 6 : Photos historiques + epilogue (en parallèle)
    // ============================================
    const [stepPhotos, epilogue] = await Promise.all([
      fetchPhotosForSteps(steps, verifiedLocations, template.city),
      generateEpilogue({
        city: template.city,
        country: template.country,
        theme: template.theme,
        narrative: effectiveNarrative,
        difficulty: template.difficulty,
        steps,
      }).catch((err) => {
        console.warn(
          `[Pipeline] Epilogue generation failed (non-blocking): ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }),
    ]);

    // ============================================
    // STEP 7 : Insert DB
    // ============================================
    const gameId = await insertGameIntoDatabase(
      {
        ...template,
        narrative: effectiveNarrative,
        themeDescription: effectiveThemeDescription,
      },
      steps,
      stepPhotos,
      epilogue,
      verifiedLocations,
    );
    console.log(`[Pipeline] Game created with ID: ${gameId}`);

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
        photoUrl: stepPhotos[i]?.url ?? null,
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
 * Match each generated step to its source location by GPS proximity, then
 * fetch a Wikipedia historical photo for that location. Runs in parallel.
 * Returns one entry per step (null if no photo found).
 */
async function fetchPhotosForSteps(
  steps: Awaited<ReturnType<typeof generateGameSteps>>,
  locations: ResearchedLocation[],
  city: string,
): Promise<(HistoricalPhotoResult | null)[]> {
  // Distance in metres between two GPS points (fast equirectangular approx)
  const distance = (a: [number, number], b: [number, number]) => {
    const R = 6371000;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const x = dLon * Math.cos((lat1 + lat2) / 2);
    return R * Math.sqrt(x * x + dLat * dLat);
  };

  // For each step, find the nearest source location (usually <20m)
  const queries = steps.map((step) => {
    let best: ResearchedLocation | null = null;
    let bestDist = Infinity;
    for (const loc of locations) {
      const d = distance([step.latitude, step.longitude], [loc.latitude, loc.longitude]);
      if (d < bestDist) {
        bestDist = d;
        best = loc;
      }
    }
    return best ? best.name : step.title;
  });

  return Promise.all(queries.map((name) => fetchHistoricalPhoto(name, city)));
}

/**
 * Insert a generated game and its steps into Supabase
 */
async function insertGameIntoDatabase(
  template: GameTemplate,
  steps: Awaited<ReturnType<typeof generateGameSteps>>,
  stepPhotos: (HistoricalPhotoResult | null)[] = [],
  epilogue: GeneratedEpilogue | null = null,
  // Indexed by step_order - 1. Carries the locked-in geocoded
  // coordinates and the real landmark name for each step. Required by
  // the GPS-first flow: we copy lat/lon from here verbatim into the DB
  // and never trust whatever Claude returned for that field.
  verifiedLocations: ResearchedLocation[] = [],
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

    return {
      id: uuidv4(),
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
      ar_historical_photo_url: stepPhotos[index]?.url || null,
      ar_historical_photo_credit: stepPhotos[index]?.credit || null,
      // AR-first flow: every step is virtual_ar regardless of what the
      // model returned. The "physical" mode is fully retired.
      answer_source: "virtual_ar" as const,
      // AR runtime layer — populated by Claude during generation
      ar_character_type: step.ar_character_type || "default",
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
