/**
 * Game Generation Pipeline
 * Orchestrates: Perplexity (research) → Claude (creation) → Supabase (storage)
 *
 * Two modes:
 * 1. Predefined: Game designer provides stops from oddballtrip → Perplexity researches facts → Claude creates riddles
 * 2. Discovery: Only city/theme provided → Perplexity finds locations AND facts → Claude creates riddles
 */

import {
  discoverThematicLandmarks,
  type PredefinedStop,
  type ResearchedLocation,
} from "./perplexity";
import {
  generateGameSteps,
  generateEpilogue,
  validateGeneratedSteps,
  regenerateStep,
  adaptNarrativeForReplacedStops,
  selectThematicallyRelevantLandmarks,
  validateOperatorStopsThematically,
  type GeneratedEpilogue,
  type GeneratedStep,
} from "./anthropic";
import { createAdminClient } from "./supabase/admin";
import { fetchHistoricalPhoto, type HistoricalPhotoResult } from "./wikipedia";
import {
  discoverNearbyLandmarks,
  geocodeLocation,
  haversineMeters,
  type DiscoveredLandmark,
} from "./geocode";
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
  /** Predefined stops from oddballtrip — if provided, Perplexity only researches these */
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

export interface PipelineResult {
  success: boolean;
  gameId?: string;
  error?: string;
  /** Structured failure category for callers to switch on. */
  errorCode?: PipelineErrorCode;
  /** When errorCode === "GEOCODING_FAILED": the operator-facing list
   *  of stops the geocoder couldn't resolve. */
  failedLandmarks?: FailedLandmark[];
  /** Stops that failed to geocode but the game was still published
   *  with the remaining ones (graceful degradation). Present on
   *  successful runs when 1-2 stops were dropped. Operator can
   *  later regenerate with corrected landmark names if they care. */
  droppedStops?: FailedLandmark[];
  /** Stops dont le landmarkName fourni était introuvable et qui ont
   *  été remplacés par un POI réel découvert via Google Places.
   *  Le jeu publie avec le compte de stops attendu. */
  replacedStops?: ReplacedStop[];
  /** Présent ssi `replacedStops.length > 0` : nouveau scénario généré
   *  par Claude pour matcher les POIs auto-découverts. oddballtrip
   *  doit l'utiliser pour rafraîchir la fiche produit côté commerce. */
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
export async function generateGameFromTemplate(
  template: GameTemplate
): Promise<PipelineResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[Pipeline] Starting game generation for ${template.city} - "${template.theme}"`
    );
    if (template.stops?.length) {
      console.log(
        `[Pipeline] Mode: PREDEFINED (${template.stops.length} stops from oddballtrip)`
      );
    } else {
      console.log("[Pipeline] Mode: DISCOVERY (finding locations from scratch)");
    }

    // ============================================
    // STEP 1: GPS-first geocoding of every operator-provided stop
    // ============================================
    // The legacy LLM-research-first flow (Perplexity + Claude) routinely
    // produced coordinates that drifted by 50-2 800 m from the real
    // landmark they described — a 34% / 32% / 34% split of OK / WARNING /
    // CRITICAL across the existing 11 games. Validation radius is 25-50 m,
    // so anything past that = player physically arrives but the app says
    // "you're not there yet".
    //
    // The new contract: oddballtrip.com sends a `stops[]` array where each
    // stop carries an OPTIONAL `landmarkName` field — the real, geocoder-
    // friendly name ("Abbaye Saint-Philibert, Tournus"). We use that to
    // fetch authoritative GPS via Google Places (sub-10 m on named
    // landmarks), Nominatim as fallback. The coords we get are LOCKED:
    // Claude is never allowed to paraphrase, round, or invent them.
    //
    // If a stop has no `landmarkName`, we fall back to its `name`. If
    // both fail to geocode, the pipeline rejects the whole game with a
    // clear error — better fail-loud than ship a broken radar to a
    // paying customer.
    if (!template.stops || template.stops.length === 0) {
      throw new Error(
        "GPS_FIRST_REQUIRED: pipeline now requires `stops[]` from oddballtrip. Discovery mode is deprecated — generation cannot proceed without operator-provided landmark names.",
      );
    }

    console.log(
      `[Pipeline] Step 1: Geocoding ${template.stops.length} stops directly (GPS-first mode)...`,
    );
    const researchStart = Date.now();

    // STEP 0 : géocoder la ville. Sert UNIQUEMENT de bias pour aider
    // Google Places à désambiguïser les homonymes ("Pont Saint-Pierre"
    // → celui de la bonne ville, pas celui de Genève à 800 km). Le
    // centre-ville N'EST PAS la référence du parcours — un parcours
    // peut tenir dans un quartier (Montmartre, Trastevere) à plusieurs
    // km du centre. La vraie référence est calculée plus bas en STEP 0.5
    // (startPoint operator OU centroïde des stops géocodés).
    let cityRef: { lat: number; lon: number } | undefined;
    try {
      const cityGeo = await geocodeLocation(
        `${template.city}, ${template.country}`,
        template.city,
        template.country,
      );
      if (cityGeo) {
        cityRef = { lat: cityGeo.lat, lon: cityGeo.lon };
        console.log(
          `[Pipeline] City bias for "${template.city}, ${template.country}" : ${cityRef.lat.toFixed(4)},${cityRef.lon.toFixed(4)} — used to disambiguate landmark names, NOT as the parcours reference`,
        );
      } else {
        console.warn(
          `[Pipeline] Could not geocode city center for "${template.city}" — landmark geocoding will run WITHOUT location bias (homonym risk)`,
        );
      }
    } catch (err) {
      console.warn(
        `[Pipeline] City geocoding threw:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Wrapper local : on a besoin de tracker le place_id et la nature
    // (héritée vs auto-découverte) de chaque stop pour pouvoir (a)
    // exclure les déjà-utilisés de la discovery, (b) réordonner par
    // greedy NN, (c) briefer Claude lors de la régénération de
    // narration. ResearchedLocation reste le format consommé par le
    // reste du pipeline.
    type PipelineStop = {
      loc: ResearchedLocation;
      isReplacement: boolean;
      placeId?: string;
      types?: string[];
      address?: string;
      /** Nom du stop original (poétique) si héritage. Sert à mapper
       *  failed → replacement pour le callback. */
      originalStopName?: string;
    };

    const stopsAfterGeocode: PipelineStop[] = [];
    const geocodeFailures: Array<{ stopName: string; tried: string[] }> = [];

    // PHASE A — géocodage permissif autour de la ville. À ce stade, on
    // accepte un rayon LARGE (50 km) parce qu'on n'a pas encore le point
    // de référence du parcours. Le bias `cityRef` reste serré pour
    // disambiguïser les homonymes, mais on tolère des résultats à
    // plusieurs km — c'est PHASE B (post-centroïde) qui appliquera le
    // filtre 1.5 km final.
    const PHASE_A_LOOSE_M = 50_000;
    for (const stop of template.stops) {
      const queryName = stop.landmarkName?.trim() || stop.name.trim();
      const tried = [queryName];
      let geo = await geocodeLocation(
        queryName,
        template.city,
        template.country,
        { referencePoint: cityRef, maxDistanceM: PHASE_A_LOOSE_M },
      );
      // If we used `landmarkName` and it failed, give the poetic `name`
      // a single second chance — it might still happen to be a real
      // place ("Iglesia del Carmen" works even without "landmarkName").
      if (!geo && stop.landmarkName && stop.landmarkName.trim() !== stop.name.trim()) {
        tried.push(stop.name.trim());
        geo = await geocodeLocation(
          stop.name,
          template.city,
          template.country,
          { referencePoint: cityRef, maxDistanceM: PHASE_A_LOOSE_M },
        );
      }
      if (!geo) {
        geocodeFailures.push({ stopName: stop.name, tried });
        continue;
      }
      console.log(
        `[Pipeline] geocoded "${queryName}" → ${geo.lat.toFixed(6)},${geo.lon.toFixed(6)} (source=${geo.source}, confidence=${geo.confidence})`,
      );
      stopsAfterGeocode.push({
        loc: {
          name: stop.name,
          landmarkName: stop.landmarkName?.trim() || queryName,
          latitude: geo.lat,
          longitude: geo.lon,
          // Description from operator becomes the "what to observe"
          // hint Claude uses to anchor the riddle. Fallback wording
          // works for any virtual_ar step.
          whatToObserve:
            stop.description?.trim() ||
            `Look around ${stop.name} — the AR camera will reveal the answer.`,
          // "AUTO" = Claude must invent the AR answer (a year, a Latin
          // word, a Roman numeral) at narrative time. Distinct from the
          // legacy "UNVERIFIED" flag so we can tell the cases apart in
          // logs / diagnostics.
          answer: "AUTO",
          answerType: "name",
          answerSource: "virtual_ar",
          source: "operator-provided",
          themeLink: "",
        },
        isReplacement: false,
        placeId: geo.externalId,
        originalStopName: stop.name,
      });
    }

    // ============================================
    // STEP 0.5 : POINT DE DÉPART DU PARCOURS
    // ============================================
    // Trois sources possibles, dans l'ordre de priorité :
    //   1. `template.startPoint` transmis explicitement par oddballtrip
    //      — cas nominal, le client opérateur dit où le joueur démarre.
    //   2. Coords du PREMIER stop opérateur géocodé (= le stop d'index 0
    //      tel qu'il a été ordonné par oddballtrip). C'est le start
    //      naturel du parcours quand pas de startPoint explicite — le
    //      joueur arrive au stop 1 et marche vers les suivants.
    //   3. Centre-ville (cityRef) en dernier recours si AUCUN stop n'a
    //      pu être géocodé (= toute la liste est hallucinée). Permet à
    //      l'auto-discovery de tourner quand même sur la zone.
    //
    // Note : on n'utilise PAS de centroïde. Le centre d'un parcours est
    // mal défini (point géographique moyen ? mi-chemin du tracé ?) et
    // sensible aux outliers. Le point de départ, lui, est sans
    // ambiguïté : l'opérateur l'a choisi, le joueur y arrive.
    //
    // C'est cette référence — pas le centre-ville — qui servira au
    // filtre 1.5 km, à l'auto-discovery Perplexity / Google, et au NN
    // reorder. Cas d'usage : un parcours dans Montmartre est valide à
    // Paris même si Montmartre est à 5 km du "centre" (Île de la Cité).
    let parcoursRef: { lat: number; lon: number } | undefined;
    if (template.startPoint) {
      parcoursRef = template.startPoint;
      console.log(
        `[Pipeline] Parcours start: operator-provided startPoint at ${parcoursRef.lat.toFixed(4)},${parcoursRef.lon.toFixed(4)}`,
      );
    } else if (stopsAfterGeocode.length > 0) {
      const first = stopsAfterGeocode[0];
      parcoursRef = {
        lat: first.loc.latitude,
        lon: first.loc.longitude,
      };
      console.log(
        `[Pipeline] Parcours start: first geocoded operator stop "${first.loc.name}" at ${parcoursRef.lat.toFixed(4)},${parcoursRef.lon.toFixed(4)} (no explicit startPoint from oddballtrip)`,
      );
    } else if (cityRef) {
      parcoursRef = cityRef;
      console.warn(
        `[Pipeline] Parcours start: falling back to city center (no operator startPoint, no geocoded stops)`,
      );
    }

    // ============================================
    // PHASE B — filtre les stops opérateur à 1.5 km de parcoursRef
    // ============================================
    // Maintenant qu'on a la vraie référence du parcours, on retire les
    // stops qui sont géocodés mais hors zone (= en dehors du parcours
    // que l'opérateur a effectivement designé). C'est ici que "Saint-
    // Joseph à 2,2 km du château de Clervaux" tombe enfin — référence
    // = château + ses voisins, pas le centre administratif de la
    // commune.
    if (parcoursRef) {
      const PHASE_B_TIGHT_M = 1_500;
      const removeIdx: number[] = [];
      for (let i = 0; i < stopsAfterGeocode.length; i++) {
        const s = stopsAfterGeocode[i];
        const d = haversineMeters(parcoursRef, {
          lat: s.loc.latitude,
          lon: s.loc.longitude,
        });
        if (d > PHASE_B_TIGHT_M) {
          console.warn(
            `[Pipeline] Stop "${s.loc.name}" geocoded ${Math.round(d)}m from parcours reference > ${PHASE_B_TIGHT_M}m — moving to auto-discovery`,
          );
          removeIdx.push(i);
          geocodeFailures.push({
            stopName: s.loc.name,
            tried: [
              `geocoded out of parcours zone: ${Math.round(d)}m from ref`,
            ],
          });
        }
      }
      // Suppression de la fin vers le début pour préserver les indices
      removeIdx.sort((a, b) => b - a);
      for (const idx of removeIdx) stopsAfterGeocode.splice(idx, 1);
      if (removeIdx.length > 0) {
        console.log(
          `[Pipeline] Phase B: ${removeIdx.length} stop(s) outside parcours zone, ${stopsAfterGeocode.length} kept`,
        );
      }
    }

    // ============================================
    // STEP 1.4 : Validation thématique des stops opérateur
    // ============================================
    // Un stop géocodable n'est pas forcément thématiquement pertinent.
    // Test #4 Clervaux a montré que oddballtrip envoyait "Family of Man"
    // (musée photo, aucun lien BoB), "Kapel Maria" et "Chapelle Lorette"
    // (chapelles génériques) dans un thème WWII Battle of the Bulge —
    // tous géocodés OK, tous laissés passer, scénario hallucine ensuite
    // des "Sister Augustine résistante" pour habiller le bruit.
    //
    // Stratégie : Claude juge chaque stop opérateur. Le seuil est BAS
    // (atmosphérique = ok, lien partiel = ok). On marque "replace"
    // uniquement quand l'écart est flagrant. Les "replace" sont déplacés
    // vers `geocodeFailures` pour que l'auto-discovery Perplexity les
    // remplace par de vrais sites mémoire.
    //
    // Skip si on n'a aucun stop géocodé (tous ont déjà échoué) — la
    // validation thématique n'a rien à juger.
    if (stopsAfterGeocode.length > 0) {
      try {
        const verdicts = await validateOperatorStopsThematically({
          theme: template.theme,
          themeDescription: template.themeDescription,
          narrative: template.narrative,
          stops: stopsAfterGeocode.map((s) => ({
            landmarkName: s.loc.landmarkName ?? s.loc.name,
            name: s.loc.name,
            description: s.loc.whatToObserve,
          })),
        });

        const toRemoveIdx: number[] = [];
        for (const v of verdicts) {
          if (v.decision === "replace") {
            const stop = stopsAfterGeocode[v.index];
            if (stop) {
              console.warn(
                `[Pipeline] Off-theme operator stop flagged for replacement: "${stop.loc.name}" (${stop.loc.landmarkName}) — ${v.rationale}`,
              );
              toRemoveIdx.push(v.index);
              geocodeFailures.push({
                stopName: stop.loc.name,
                tried: [
                  `off-theme: ${v.rationale}`,
                ],
              });
            }
          }
        }
        // Remove from end → start to preserve indices.
        toRemoveIdx.sort((a, b) => b - a);
        for (const idx of toRemoveIdx) {
          stopsAfterGeocode.splice(idx, 1);
        }
        if (toRemoveIdx.length > 0) {
          console.log(
            `[Pipeline] Thematic validation: ${toRemoveIdx.length} operator stop(s) flagged off-theme, routed to auto-discovery. ${stopsAfterGeocode.length} kept.`,
          );
        } else {
          console.log(
            `[Pipeline] Thematic validation: all ${stopsAfterGeocode.length} operator stop(s) pass.`,
          );
        }
      } catch (err) {
        console.warn(
          `[Pipeline] validateOperatorStopsThematically threw: ${err instanceof Error ? err.message : err} — skipping thematic gate (operator stops kept as-is)`,
        );
      }
    }

    // ============================================
    // STEP 1.5: Auto-discovery des stops manquants
    // ============================================
    // Si certains landmarkName fournis par oddballtrip n'ont pas pu
    // être géocodés (typiquement parce que le LLM amont a halluciné
    // le nom — "Église Saint-Cunibert" qui n'existe pas à Clervaux,
    // "Sentier de la Blees" alors que la rivière s'appelle Clerve),
    // on tente de combler les trous avec des POIs réels découverts
    // dans un rayon de 1,5 km autour du centre ville (cf. analyse
    // post-mortem Clervaux : au-delà, le parcours devient injouable
    // à pied même si le POI est techniquement "proche du centre").
    //
    // Pas de fallback à 10 km : si la densité POI dans 1,5 km est
    // insuffisante, on droppe les stops manquants (graceful) plutôt
    // que de gonfler la zone et publier un parcours non-marchable.
    //
    // Filtrage thématique : on ne sélectionne PAS sur le seul score
    // patrimonial. Claude reçoit la narration originale + la liste
    // candidate, et choisit les POIs qui peuvent s'inscrire SANS
    // forcer la réécriture du scénario. C'est essentiel pour ne pas
    // diluer le thème vendu (ex. ne pas glisser une mall moderne
    // dans une histoire de résistance WWII).
    //
    // Quand au moins un remplacement réussit, on devra (a) réordonner
    // tous les stops via greedy nearest-neighbor depuis le centre
    // ville pour garder un parcours cohérent (pas de retour en
    // arrière), (b) demander à Claude de régénérer la narration et
    // les noms poétiques pour qu'ils collent aux nouveaux lieux —
    // sinon le scénario continuerait de référencer les landmarks
    // hallucinés.
    const replacedStops: ReplacedStop[] = [];
    if (geocodeFailures.length > 0 && parcoursRef) {
      const usedPlaceIds = new Set<string>(
        stopsAfterGeocode
          .map((s) => s.placeId)
          .filter((id): id is string => !!id),
      );
      const usedNames = stopsAfterGeocode.map(
        (s) => s.loc.landmarkName ?? s.loc.name,
      );
      const needed = geocodeFailures.length;

      // PRIMARY PATH : Perplexity découverte thématique. Demande à un
      // LLM avec recherche web de proposer des landmarks RÉELS
      // documentés comme liés au thème (vs Google nearbysearch qui
      // ne renvoie que des POIs catégorisés `church`/`museum` sans
      // notion de thème). Sur Clervaux/Battle of the Bulge, Perplexity
      // sait que l'Hôtel Claravallis ou le Buste Fuller sont les
      // bons sites mémoire — Google nearbysearch retombe sur des
      // chapelles génériques (Lorette, Maria) sans rapport.
      //
      // Les noms retournés sont géocodés via Google Places (sub-10 m).
      // Ceux que Google ne trouve pas sont droppés silencieusement —
      // c'est OK, on accepte un parcours plus court mais propre.
      const verifiedDiscovered: DiscoveredLandmark[] = [];
      try {
        const perplexityCandidates = await discoverThematicLandmarks({
          city: template.city,
          country: template.country,
          theme: template.theme,
          themeDescription: template.themeDescription,
          narrative: template.narrative,
          needed,
          excludeNames: usedNames,
        });

        for (const cand of perplexityCandidates) {
          if (verifiedDiscovered.length >= needed) break;
          // Géocode chaque candidat avec le bias serré 1,5 km. Pas
          // de fallback sur le `name` poétique : Perplexity nous a
          // déjà donné le nom géocodable.
          // Géocode chaque candidat Perplexity avec bias serré sur
          // parcoursRef (pas cityRef) pour que Google nous donne le
          // résultat dans la zone du parcours, pas celui d'une ville
          // lointaine portant un nom similaire.
          const geo = await geocodeLocation(
            cand.name,
            template.city,
            template.country,
            { referencePoint: parcoursRef },
          );
          if (!geo) {
            console.log(
              `[Pipeline] Perplexity candidate "${cand.name}" failed geocoding — dropping`,
            );
            continue;
          }
          // Dédup contre les place_id déjà utilisés (au cas où Perplexity
          // proposerait le même lieu qu'un stop opérateur).
          if (geo.externalId && usedPlaceIds.has(geo.externalId)) {
            console.log(
              `[Pipeline] Perplexity candidate "${cand.name}" duplicates an existing stop — dropping`,
            );
            continue;
          }
          if (geo.externalId) usedPlaceIds.add(geo.externalId);
          verifiedDiscovered.push({
            name: cand.name,
            lat: geo.lat,
            lon: geo.lon,
            // Synthétise un id si Google n'a pas renvoyé de place_id
            // (cas Nominatim) — sert juste à dé-dupliquer.
            placeId: geo.externalId ?? `geocoded:${cand.name}`,
            address: undefined,
            types: [],
            distanceM: haversineMeters(parcoursRef, { lat: geo.lat, lon: geo.lon }),
          });
          console.log(
            `[Pipeline] Perplexity → geocoded "${cand.name}" → ${geo.lat.toFixed(6)},${geo.lon.toFixed(6)} (${geo.source})`,
          );
        }
      } catch (err) {
        console.warn(
          `[Pipeline] discoverThematicLandmarks threw: ${err instanceof Error ? err.message : err}`,
        );
      }

      // FALLBACK PATH : si Perplexity n'a pas suffi (rate-limit, JSON
      // mal parsé, candidats tous non-géocodables), on retombe sur
      // l'ancien combo Google nearbysearch + filtre Claude. Mieux que
      // rien, et reste contraint au rayon 1,5 km + filtre thématique.
      if (verifiedDiscovered.length < needed) {
        const stillNeeded = needed - verifiedDiscovered.length;
        console.log(
          `[Pipeline] Perplexity gave ${verifiedDiscovered.length}/${needed} viable candidates — falling back to Google nearbysearch for ${stillNeeded} more`,
        );

        let googleCandidates: DiscoveredLandmark[] = [];
        try {
          googleCandidates = await discoverNearbyLandmarks(parcoursRef, {
            radiusM: 1_500,
            excludePlaceIds: usedPlaceIds,
            limit: 30,
          });
        } catch (err) {
          console.warn(
            `[Pipeline] discoverNearbyLandmarks threw: ${err instanceof Error ? err.message : err}`,
          );
        }

        if (googleCandidates.length > 0) {
          try {
            const filter = await selectThematicallyRelevantLandmarks({
              theme: template.theme,
              themeDescription: template.themeDescription,
              narrative: template.narrative,
              candidates: googleCandidates.map((c) => ({
                name: c.name,
                types: c.types,
                address: c.address,
                distanceM: c.distanceM,
              })),
              needed: stillNeeded,
            });
            const fallbackPicked = filter.selectedIndices.map(
              (i) => googleCandidates[i],
            );
            console.log(
              `[Pipeline] Fallback thematic filter: kept ${fallbackPicked.length}/${googleCandidates.length} Google candidate(s)${filter.rationale ? ` — ${filter.rationale}` : ""}`,
            );
            for (const c of fallbackPicked) {
              if (verifiedDiscovered.length >= needed) break;
              if (c.placeId && usedPlaceIds.has(c.placeId)) continue;
              if (c.placeId) usedPlaceIds.add(c.placeId);
              verifiedDiscovered.push(c);
            }
          } catch (err) {
            console.warn(
              `[Pipeline] selectThematicallyRelevantLandmarks threw: ${err instanceof Error ? err.message : err} — using Google top-${stillNeeded} by heritage rank`,
            );
            for (const c of googleCandidates.slice(0, stillNeeded)) {
              if (verifiedDiscovered.length >= needed) break;
              if (c.placeId && usedPlaceIds.has(c.placeId)) continue;
              if (c.placeId) usedPlaceIds.add(c.placeId);
              verifiedDiscovered.push(c);
            }
          }
        }
      }

      const toFill = Math.min(verifiedDiscovered.length, needed);
      console.log(
        `[Pipeline] ${needed} stop(s) failed geocoding, ${verifiedDiscovered.length} viable candidate(s) (Perplexity + Google fallback), filling ${toFill}`,
      );

      for (let i = 0; i < toFill; i++) {
        const c = verifiedDiscovered[i];
        const failure = geocodeFailures[i];
        stopsAfterGeocode.push({
          loc: {
            // Le `name` poétique sera réécrit par adaptNarrativeForReplacedStops.
            // En attendant on met un placeholder lisible — il ne
            // sera utilisé que si la regen narrative échoue (fallback
            // dégradé mais publiable).
            name: c.name,
            landmarkName: c.name,
            latitude: c.lat,
            longitude: c.lon,
            whatToObserve: `Look around ${c.name} — the AR camera will reveal the answer.`,
            answer: "AUTO",
            answerType: "name",
            answerSource: "virtual_ar",
            source: "auto-discovered",
            themeLink: "",
          },
          isReplacement: true,
          placeId: c.placeId,
          types: c.types,
          address: c.address,
          originalStopName: failure.stopName,
        });
        replacedStops.push({
          original: failure.stopName,
          replacement: c.name,
          replacementPlaceId: c.placeId,
          lat: c.lat,
          lon: c.lon,
        });
      }

      // Les failures restantes (pas assez de candidats fittants pour
      // combler) tomberont dans le `droppedStops` legacy via la
      // condition de dégradation gracieuse plus bas.
      geocodeFailures.splice(0, toFill);
    } else if (geocodeFailures.length > 0 && !parcoursRef) {
      console.warn(
        `[Pipeline] ${geocodeFailures.length} stop(s) failed but no parcours reference — auto-discovery disabled, falling through to graceful drop`,
      );
    }

    // Réordonnancement par nearest-neighbor depuis le point de départ
    // du parcours dès qu'un remplacement a eu lieu : la liste résultante
    // mélange des stops opérateur et des POIs auto-découverts dont les
    // positions n'ont aucune raison de tracer un parcours cohérent
    // dans l'ordre d'insertion. NN garantit qu'on ne « repasse pas
    // au point A » entre deux étapes. Pour 8 stops c'est suffisant ;
    // si on voulait optimiser globalement il faudrait un vrai TSP
    // mais le gain serait marginal.
    if (replacedStops.length > 0 && parcoursRef) {
      const ordered = greedyNearestNeighborFromRef(stopsAfterGeocode, parcoursRef);
      stopsAfterGeocode.splice(0, stopsAfterGeocode.length, ...ordered);
    }

    // ============================================
    // STEP 1.6 : Garde-fou inter-stops
    // ============================================
    // Même quand chaque stop est dans le rayon 1,5 km du point de départ,
    // deux stops diamétralement opposés peuvent être à 2-3 km l'un de l'autre.
    // Le NN reorder atténue mais ne résout pas (le dernier stop d'une
    // tournée NN peut toujours être à 2 km du précédent — c'est ce qui
    // s'est passé sur Clervaux avec Saint-Joseph à 2,2 km).
    //
    // Stratégie : tant qu'il existe un saut > MAX_INTER_STOP_M ET qu'on
    // a strictement plus que MIN_STOPS_TO_PUBLISH stops, on droppe le
    // stop "le plus excentré" (somme des distances à ses voisins en
    // chaîne) puis on relance le NN reorder. On s'arrête quand soit
    // tous les sauts sont ≤ seuil, soit on a atteint le plancher de
    // stops publiables.
    const distanceDroppedStops: FailedLandmark[] = [];
    if (parcoursRef && stopsAfterGeocode.length > MIN_STOPS_TO_PUBLISH) {
      const maxJump = () => {
        let m = 0;
        for (let i = 1; i < stopsAfterGeocode.length; i++) {
          const d = haversineMeters(
            { lat: stopsAfterGeocode[i - 1].loc.latitude, lon: stopsAfterGeocode[i - 1].loc.longitude },
            { lat: stopsAfterGeocode[i].loc.latitude, lon: stopsAfterGeocode[i].loc.longitude },
          );
          if (d > m) m = d;
        }
        return m;
      };

      let currentMax = maxJump();
      while (
        currentMax > MAX_INTER_STOP_M &&
        stopsAfterGeocode.length > MIN_STOPS_TO_PUBLISH
      ) {
        // Trouve le stop avec le plus gros score d'éloignement (somme
        // des distances à ses 1-2 voisins immédiats dans la chaîne).
        let worstIdx = -1;
        let worstScore = -1;
        for (let i = 0; i < stopsAfterGeocode.length; i++) {
          let score = 0;
          if (i > 0) {
            score += haversineMeters(
              { lat: stopsAfterGeocode[i].loc.latitude, lon: stopsAfterGeocode[i].loc.longitude },
              { lat: stopsAfterGeocode[i - 1].loc.latitude, lon: stopsAfterGeocode[i - 1].loc.longitude },
            );
          }
          if (i < stopsAfterGeocode.length - 1) {
            score += haversineMeters(
              { lat: stopsAfterGeocode[i].loc.latitude, lon: stopsAfterGeocode[i].loc.longitude },
              { lat: stopsAfterGeocode[i + 1].loc.latitude, lon: stopsAfterGeocode[i + 1].loc.longitude },
            );
          }
          if (score > worstScore) {
            worstScore = score;
            worstIdx = i;
          }
        }
        const [dropped] = stopsAfterGeocode.splice(worstIdx, 1);
        distanceDroppedStops.push({
          stopName: dropped.loc.name,
          tried: [
            `dropped: parcours non-marchable, jump > ${MAX_INTER_STOP_M}m (was ${Math.round(currentMax)}m)`,
          ],
        });
        // Si c'était un remplacement auto, retirer aussi de replacedStops
        // (on ne veut pas annoncer à oddballtrip un stop remplacé qu'on
        // a finalement droppé).
        if (dropped.isReplacement) {
          const ridx = replacedStops.findIndex(
            (r) => r.replacementPlaceId && r.replacementPlaceId === dropped.placeId,
          );
          if (ridx >= 0) replacedStops.splice(ridx, 1);
        }
        // Re-NN-reorder pour que la chaîne reste cohérente après drop.
        const reordered = greedyNearestNeighborFromRef(stopsAfterGeocode, parcoursRef);
        stopsAfterGeocode.splice(0, stopsAfterGeocode.length, ...reordered);
        console.warn(
          `[Pipeline] Dropped "${dropped.loc.name}" (jump=${Math.round(currentMax)}m > ${MAX_INTER_STOP_M}m), ${stopsAfterGeocode.length} stop(s) remaining`,
        );
        currentMax = maxJump();
      }

      if (currentMax > MAX_INTER_STOP_M) {
        console.warn(
          `[Pipeline] After drops, max inter-stop jump still ${Math.round(currentMax)}m > ${MAX_INTER_STOP_M}m. Floor MIN_STOPS_TO_PUBLISH=${MIN_STOPS_TO_PUBLISH} hit — pipeline will reject.`,
        );
        const err = new Error(
          `GEOCODING_FAILED: parcours non-marchable. Max distance entre 2 stops consécutifs: ${Math.round(currentMax)}m (limite: ${MAX_INTER_STOP_M}m). Les landmarks fournis sont trop dispersés pour constituer un escape game à pied. Resserrez la zone (centre-ville plus compact) ou choisissez d'autres landmarks plus regroupés.`,
        ) as Error & {
          code?: PipelineErrorCode;
          failedLandmarks?: FailedLandmark[];
        };
        err.code = "GEOCODING_FAILED";
        err.failedLandmarks = [...geocodeFailures, ...distanceDroppedStops];
        throw err;
      }
    }

    // Fusionner les drops "distance" dans la liste globale pour que
    // l'opérateur reçoive l'info via l'email STOPS_DROPPED + callback.
    geocodeFailures.push(...distanceDroppedStops);

    // Graceful degradation : on tolère jusqu'à 2 stops droppés tant
    // qu'il reste >= MIN_STOPS_TO_PUBLISH stops géocodés correctement.
    // Au-dessous, le parcours devient trop court (jeu écourté), on
    // rejette pour forcer une correction côté oddballtrip.
    if (stopsAfterGeocode.length < MIN_STOPS_TO_PUBLISH) {
      const failureSummary = geocodeFailures
        .map(
          (f) =>
            `  - "${f.stopName}" (tried: ${f.tried.map((s) => `"${s}"`).join(", ")})`,
        )
        .join("\n");
      const err = new Error(
        `GEOCODING_FAILED: only ${stopsAfterGeocode.length} of ${template.stops.length} stop(s) could be geocoded or auto-substituted — minimum is ${MIN_STOPS_TO_PUBLISH}. Failed:\n${failureSummary}\n\nFix the landmarkName for these stops on oddballtrip, broaden the city, or accept fewer stops.`,
      ) as Error & {
        code?: PipelineErrorCode;
        failedLandmarks?: FailedLandmark[];
      };
      err.code = "GEOCODING_FAILED";
      err.failedLandmarks = geocodeFailures;
      throw err;
    }

    // Stocker les stops droppés pour les remonter à l'opérateur. Le
    // jeu publie quand même mais on log + email d'avertissement (pas
    // d'erreur bloquante) avec la liste des landmarks corrigeables.
    const droppedStops: FailedLandmark[] = geocodeFailures;
    if (droppedStops.length > 0) {
      const summary = droppedStops
        .map((f) => `"${f.stopName}"`)
        .join(", ");
      console.warn(
        `[Pipeline] ${droppedStops.length} stop(s) dropped, game published with ${stopsAfterGeocode.length} stops. Dropped: ${summary}`,
      );
    }
    if (replacedStops.length > 0) {
      console.warn(
        `[Pipeline] ${replacedStops.length} stop(s) auto-replaced via Google Places nearbysearch: ${replacedStops.map((r) => `"${r.original}" → "${r.replacement}"`).join("; ")}`,
      );
    }

    // Adapter la narration aux stops finaux (Claude #0). On le fait
    // AVANT la génération des énigmes pour que le brief de Claude #1
    // soit cohérent. En cas d'échec on continue avec la narration
    // originale — les énigmes n'utilisent pas directement les noms
    // poétiques des stops, donc le jeu reste publiable.
    let adaptedNarrative: AdaptedNarrativePayload | undefined;
    let effectiveNarrative = template.narrative;
    let effectiveThemeDescription = template.themeDescription;
    if (replacedStops.length > 0) {
      try {
        const adapted = await adaptNarrativeForReplacedStops({
          city: template.city,
          country: template.country,
          theme: template.theme,
          originalNarrative: template.narrative,
          finalStops: stopsAfterGeocode.map((s) => ({
            landmarkName: s.loc.landmarkName ?? s.loc.name,
            types: s.types,
            address: s.address,
            keptPoeticName: s.isReplacement ? undefined : s.loc.name,
            keptDescription: s.isReplacement ? undefined : s.loc.whatToObserve,
            isReplacement: s.isReplacement,
          })),
        });
        effectiveNarrative = adapted.narrative;
        effectiveThemeDescription = adapted.themeDescription;
        // Propager les nouveaux noms poétiques + descriptions vers
        // les ResearchedLocation : Claude #1 va les voir dans le
        // brief et écrire les énigmes en cohérence.
        for (let i = 0; i < stopsAfterGeocode.length; i++) {
          stopsAfterGeocode[i].loc.name = adapted.stops[i].name;
          stopsAfterGeocode[i].loc.whatToObserve = adapted.stops[i].description;
        }
        adaptedNarrative = {
          themeDescription: adapted.themeDescription,
          narrative: adapted.narrative,
          stopNames: adapted.stops.map((s) => s.name),
        };
        console.log(
          `[Pipeline] Narrative adapted to ${replacedStops.length} replacement(s) — themeDescription/narrative/stop names refreshed`,
        );
      } catch (err) {
        console.warn(
          `[Pipeline] Narrative adaptation failed, keeping original: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    const verifiedLocations: ResearchedLocation[] = stopsAfterGeocode.map(
      (s) => s.loc,
    );

    const researchDurationMs = Date.now() - researchStart;
    console.log(
      `[Pipeline] All ${verifiedLocations.length} stops geocoded in ${Math.round(researchDurationMs / 1000)}s — coords are LOCKED for the rest of the pipeline`,
    );

    const physicalCount = verifiedLocations.filter(
      (l) => l.answerSource === "physical",
    ).length;
    const virtualCount = verifiedLocations.length - physicalCount;
    console.log(
      `[Pipeline] ${verifiedLocations.length} locations: ${physicalCount} physical, ${virtualCount} virtual_ar`,
    );

    // ============================================
    // STEP 2: Create riddles with Claude
    // ============================================
    console.log("[Pipeline] Step 2: Creating riddles with Claude...");
    const creationStart = Date.now();

    let steps: GeneratedStep[] = await generateGameSteps(
      template.city,
      template.country,
      template.theme,
      effectiveNarrative,
      template.difficulty,
      verifiedLocations
    );

    const creationDurationMs = Date.now() - creationStart;
    console.log(
      `[Pipeline] Generated ${steps.length} game steps in ${Math.round(creationDurationMs / 1000)}s`
    );

    // ============================================
    // STEP 2.1: AUTO placeholder leak guard
    // ============================================
    // Claude is instructed to invent a thematic AR answer when the
    // input answer field reads "AUTO" — but we just shipped a game
    // (Clervaux, étape 5) where Claude copied the literal "AUTO"
    // string into answer_text and ar_facade_text instead of inventing
    // a word. Player would see "AUTO" on the AR overlay, which is
    // gibberish. We catch the leak here, ask Claude to regenerate
    // ONLY the offending step, and fail loudly if it persists.
    const looksLikePlaceholder = (v: unknown): boolean => {
      const s = typeof v === "string" ? v.trim().toUpperCase() : "";
      return s === "AUTO" || s === "";
    };
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (
        !looksLikePlaceholder(st.answer_text) &&
        !looksLikePlaceholder(st.ar_facade_text)
      ) {
        continue;
      }
      const sourceLoc = verifiedLocations[i];
      if (!sourceLoc) continue;
      console.warn(
        `[Pipeline] Step ${i + 1} leaked AUTO placeholder (answer_text="${st.answer_text}", ar_facade_text="${st.ar_facade_text}") — regenerating`,
      );
      try {
        const fixed = await regenerateStep({
          brokenStep: st,
          issue: {
            step_index: i,
            severity: "blocking",
            problem:
              "answer_text or ar_facade_text was left as the placeholder 'AUTO'. INVENT a real thematic answer for this step (year, Latin/local word, Roman numeral, 1-2 word phrase) and put it in BOTH fields. The literal 'AUTO' is FORBIDDEN as output.",
            suggestion:
              "Pick a year tied to a real historical event about this landmark, OR a Latin word fitting the theme, OR a 1-2 word phrase in the local language. ALL CAPS for AR readability. Update answer_text + ar_facade_text consistently.",
          },
          location: sourceLoc,
          city: template.city,
          theme: template.theme,
          narrative: effectiveNarrative,
          stepNumber: i + 1,
          totalSteps: steps.length,
        });
        steps[i] = fixed;
      } catch (err) {
        const msg = `Step ${i + 1} kept the AUTO placeholder after regen: ${err instanceof Error ? err.message : err}`;
        const tagged = new Error(`GENERATION_FAILED: ${msg}`) as Error & {
          code?: PipelineErrorCode;
        };
        tagged.code = "GENERATION_FAILED";
        throw tagged;
      }
      // Re-check after regen — if Claude STILL leaked AUTO, fail loud.
      const after = steps[i];
      if (
        looksLikePlaceholder(after.answer_text) ||
        looksLikePlaceholder(after.ar_facade_text)
      ) {
        const tagged = new Error(
          `GENERATION_FAILED: Step ${i + 1} still has AUTO placeholder after regen (answer_text="${after.answer_text}", ar_facade_text="${after.ar_facade_text}"). Aborting.`,
        ) as Error & { code?: PipelineErrorCode };
        tagged.code = "GENERATION_FAILED";
        throw tagged;
      }
    }

    // ============================================
    // STEP 2.5: Walking-route safety check (warn-only)
    // ============================================
    // Verify the player won't have to cross a multi-lane road or take a
    // long detour between consecutive stops. We don't block generation
    // on this — surfacing it in logs is enough to flag manually until we
    // wire automated reordering. Field-test feedback prompted this.
    try {
      const { checkWalkingRoute } = await import("./route-safety");
      const route = await checkWalkingRoute(
        steps.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      );
      console.log(
        `[Pipeline] Route safety: total straight ${route.totalStraightM}m, walking ${route.totalWalkingM ?? "n/a"}m, allOk=${route.allOk}`,
      );
      route.legs.forEach((leg, i) => {
        if (!leg.ok) {
          console.warn(
            `[Pipeline] ⚠ Leg ${i + 1}→${i + 2}: straight=${leg.straightDistanceM}m walking=${leg.walkingDistanceM ?? "?"}m ratio=${leg.detourRatio ?? "?"} — ${leg.reasons.join("; ")}`,
          );
        }
      });
    } catch (err) {
      console.warn(
        `[Pipeline] Route safety check failed (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
    }

    // ============================================
    // STEP 2bis: Validation + auto-correction (Claude #2)
    // ============================================
    // A second Claude call critiques the generated steps. If it flags real
    // problems (too-easy answers, broken riddles, factual errors), we
    // regenerate the offending step(s). Max 2 retries to bound the cost.
    console.log("[Pipeline] Step 2bis: Validating with Claude reviewer...");
    const validationStart = Date.now();

    for (let attempt = 1; attempt <= 2; attempt++) {
      const validation = await validateGeneratedSteps({
        steps,
        city: template.city,
        theme: template.theme,
        narrative: effectiveNarrative,
      });

      if (validation.ok || validation.issues.length === 0) {
        console.log(`[Pipeline] Validation OK on attempt ${attempt}`);
        break;
      }

      // Only regenerate steps with major or blocking issues — minor are accepted
      const blockingIssues = validation.issues.filter(
        (i) => i.severity === "major" || i.severity === "blocking",
      );

      if (blockingIssues.length === 0) {
        console.log(
          `[Pipeline] Validation found ${validation.issues.length} minor issue(s), accepting as-is`,
        );
        break;
      }

      console.log(
        `[Pipeline] Validation flagged ${blockingIssues.length} step(s) on attempt ${attempt}: ${blockingIssues
          .map((i) => `step ${i.step_index + 1} (${i.severity})`)
          .join(", ")}`,
      );

      if (attempt === 2) {
        // After 2 attempts, ship as-is rather than block delivery
        console.warn(
          `[Pipeline] Validation still failing after 2 attempts — shipping as-is. Admin should review.`,
        );
        break;
      }

      // Regenerate each flagged step
      for (const issue of blockingIssues) {
        const idx = issue.step_index;
        if (idx < 0 || idx >= steps.length) continue;
        // Find the matching source location (same coordinates)
        const stepLat = steps[idx].latitude;
        const stepLon = steps[idx].longitude;
        const sourceLoc =
          verifiedLocations.find(
            (l) =>
              Math.abs(l.latitude - stepLat) < 0.0001 &&
              Math.abs(l.longitude - stepLon) < 0.0001,
          ) || verifiedLocations[idx];
        if (!sourceLoc) continue;

        try {
          steps[idx] = await regenerateStep({
            brokenStep: steps[idx],
            issue,
            location: sourceLoc,
            city: template.city,
            theme: template.theme,
            narrative: effectiveNarrative,
            stepNumber: idx + 1,
            totalSteps: steps.length,
          });
          console.log(`[Pipeline]   ↳ regenerated step ${idx + 1}`);
        } catch (err) {
          console.warn(
            `[Pipeline]   ↳ regeneration failed for step ${idx + 1}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    console.log(
      `[Pipeline] Validation completed in ${Math.round((Date.now() - validationStart) / 1000)}s`,
    );

    // ============================================
    // STEP 2b: Fetch Wikipedia historical photos for AR overlay
    // ============================================
    console.log("[Pipeline] Step 2b: Fetching historical photos from Wikipedia...");
    const photoStart = Date.now();
    const stepPhotos = await fetchPhotosForSteps(steps, verifiedLocations, template.city);
    console.log(
      `[Pipeline] Got ${stepPhotos.filter((p) => p !== null).length}/${steps.length} photos in ${Math.round((Date.now() - photoStart) / 1000)}s`
    );

    // ============================================
    // STEP 2c: Generate narrative epilogue (Claude)
    // ============================================
    console.log("[Pipeline] Step 2c: Generating narrative epilogue...");
    const epilogueStart = Date.now();
    let epilogue: GeneratedEpilogue | null = null;
    try {
      epilogue = await generateEpilogue({
        city: template.city,
        country: template.country,
        theme: template.theme,
        narrative: effectiveNarrative,
        difficulty: template.difficulty,
        steps,
      });
      console.log(
        `[Pipeline] Epilogue generated ("${epilogue.title}", ${epilogue.text.length} chars) in ${Math.round((Date.now() - epilogueStart) / 1000)}s`,
      );
    } catch (err) {
      // Non-blocking: if epilogue generation fails, the game still ships.
      // The results page will just show a fallback message.
      console.warn(
        `[Pipeline] Epilogue generation failed, continuing without it: ${err instanceof Error ? err.message : err}`,
      );
    }

    // ============================================
    // STEP 3: Insert into Supabase
    // ============================================
    console.log("[Pipeline] Step 3: Inserting into Supabase...");
    // On passe au stockage la version « effective » de la narration et
    // de la description : si la regen narrative a réussi suite à un
    // remplacement de stops, c'est cette version qui doit aller en DB
    // (et être servie au joueur), PAS le contenu original qui parlait
    // des landmarks hallucinés.
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

    const durationMs = Date.now() - startTime;
    console.log(
      `[Pipeline] Complete in ${Math.round(durationMs / 1000)}s`
    );

    return {
      success: true,
      gameId,
      durationMs,
      steps: steps.length,
      researchDurationMs,
      creationDurationMs,
      // Présent ssi des stops ont été droppés mais le jeu a quand même
      // été publié (>= MIN_STOPS_TO_PUBLISH). Permet à oddballtrip
      // d'afficher un warning à l'opérateur ou de planifier une
      // re-génération avec des landmarkName corrigés.
      ...(droppedStops.length > 0 ? { droppedStops } : {}),
      // Présent ssi le pipeline a auto-substitué un ou plusieurs
      // stops via Google Places nearbysearch. oddballtrip s'en sert
      // pour mettre à jour la fiche produit (la narration et les
      // titres d'étapes ont changé).
      ...(replacedStops.length > 0 ? { replacedStops } : {}),
      ...(adaptedNarrative ? { adaptedNarrative } : {}),
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Pipeline] Failed after ${Math.round(durationMs / 1000)}s: ${errorMessage}`
    );

    // The geocoding stage tags its Errors with `.code` and
    // `.failedLandmarks` so the caller can build a structured
    // failure callback. Non-tagged errors fall back to a generic
    // "INTERNAL_ERROR" code; the message still surfaces.
    const tagged = error as Error & {
      code?: PipelineErrorCode;
      failedLandmarks?: FailedLandmark[];
    };
    const errorCode: PipelineErrorCode =
      tagged?.code ?? (errorMessage.startsWith("GEOCODING_FAILED")
        ? "GEOCODING_FAILED"
        : "INTERNAL_ERROR");

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
 * Réordonne une liste de stops par voisin le plus proche, en partant
 * du point de référence (typiquement le centre ville géocodé).
 *
 * Utilisé après auto-discovery : la liste post-fill mélange les stops
 * opérateur conservés et les POIs auto-substitués dans un ordre qui
 * n'a aucune raison d'être un parcours marchable. Greedy NN garantit
 * que (a) le 1er stop est le plus proche du centre ville (entrée
 * naturelle dans le parcours), (b) chaque stop suivant est le plus
 * proche du précédent, donc pas de retour en arrière franc.
 *
 * Limitations connues : ce n'est pas un TSP optimal, le dernier stop
 * peut finir loin du début. Pour 6-8 points dans un rayon de 5 km
 * c'est suffisant ; un vrai TSP avec retour-au-départ ne gagnerait
 * que quelques centaines de mètres au mieux.
 */
function greedyNearestNeighborFromRef<
  T extends { loc: { latitude: number; longitude: number } },
>(stops: T[], start: { lat: number; lon: number }): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let cursor = { lat: start.lat, lon: start.lon };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i].loc;
      const d = haversineMeters(cursor, { lat: r.latitude, lon: r.longitude });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    cursor = { lat: picked.loc.latitude, lon: picked.loc.longitude };
  }
  return ordered;
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
