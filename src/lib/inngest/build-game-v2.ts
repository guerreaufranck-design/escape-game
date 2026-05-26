/**
 * Inngest function — buildGameV2 (pipeline v5)
 *
 * Mandat user 2026-05-25 : "utilise Inngest comme il faut".
 *
 * Chaque step.run() = sa propre exécution Vercel (10 min max chacune).
 * Inngest cache le résultat de chaque step. Si une étape plante, seule
 * cette étape est rejouée (avec les résultats des précédentes en cache).
 *
 * Séquence (chaque ligne = 1 step.run()) :
 *
 *   1.   insert-empty-game        ~1s   créer row games minimal + flag pipeline_v2
 *   1.5  check-draft (NEW)        ~1s   lookup game_drafts validated → skip 2-4 si hit
 *   1.6  resolve-start (cond.)    ~2s   géocode startPointText (skip si draft hit)
 *   2.   discover (cond.)         ~10s  Perplexity sonar (skip si draft hit)
 *   3.   geocode (cond.)          ~30s  Google Places (skip si draft hit)
 *   4.   select (cond.)           ~30s  Claude pick 8 (skip si draft hit)
 *   5.   narrate                  ~60s  Claude écrit riddles/anecdotes/AR en EN
 *   6.   persist-master-en        ~2s   UPDATE games + INSERT 8 game_steps
 *   7.   persist-translation-en   ~2s   UPSERT translations_cache EN
 *   8.   translate                ~15s  Gemini EN → langue client (skip si EN)
 *   9.   persist-translation      ~2s   UPSERT translations_cache client_lang
 *  10.   audio                    ~3min ElevenLabs dans langue client + Storage
 *  11.   persist-audios           ~1s   UPSERT audio_cache
 *  12.   activation-code          ~1s   INSERT activation_codes (idempotent)
 *  13.   publish                  ~1s   UPDATE games.is_published=true
 *  13.5  mark-draft-consumed      ~1s   set game_drafts.status='consumed' (si draft hit)
 *  14.   callback                 ~3s   POST OddballTrip callback URL
 *
 * Total estimé :
 *   - draft hit (slug pré-validé)  : ~4 min (économie 1-2 min + ~$0.50/vente)
 *   - draft miss (full pipeline)   : ~5-7 min
 *
 * Échec d'un step → retry automatique sans repayer les précédents.
 */

import { inngest, gameBuildRequested } from "@/lib/inngest-client";
import {
  buildPipelineInput,
  validateStartPoint,
  shouldResolveStartFromText,
} from "@/lib/pipeline-v2/input";
import { runDiscover } from "@/lib/pipeline-v2/discover";
import { runGeocode, geocodeStartPoint } from "@/lib/pipeline-v2/geocode";
import { runSelect } from "@/lib/pipeline-v2/select";
import { runNarrate } from "@/lib/pipeline-v2/narrate";
import { runAudio } from "@/lib/pipeline-v2/audio";
import { translateGame } from "@/lib/pipeline-v2/translate";
import {
  insertEmptyGame,
  persistMasterEN,
  persistTranslation,
  persistAudios,
  createActivationCode,
  publishGame,
  notifyOddballTrip,
  haltForReview,
  loadValidatedDraft,
  markDraftConsumed,
  releaseDraft,
} from "@/lib/pipeline-v2/persist";
import { CONFIG } from "@/lib/pipeline-v2/config";
import type {
  GeocodedLandmark,
  StructuredGame,
  TranslationResult,
} from "@/lib/pipeline-v2/types";

export const buildGameV2 = inngest.createFunction(
  {
    id: "build-game-v2",
    name: "v5 — Pipeline propre (multi step.run Inngest)",
    triggers: [{ event: gameBuildRequested }],
    concurrency: { limit: 3 },
    retries: 2, // chaque step a 2 retries Inngest
  },
  async ({ event, step, logger }) => {
    const data = event.data;

    // Skip si v1 explicitement demandé (legacy escape hatch)
    const wantsV1 =
      (data as { pipelineVersion?: string }).pipelineVersion === "v1" ||
      process.env.PIPELINE_VERSION === "v1";
    if (wantsV1) {
      logger.info(`[v5] SKIP — pipelineVersion=v1 demandé`);
      return { skipped: true, reason: "v1_requested" };
    }

    // Build input + valide startPoint
    const input = buildPipelineInput(data);
    try {
      validateStartPoint(input);
    } catch (e) {
      throw new Error(`[v5] startPoint invalide: ${e instanceof Error ? e.message : "?"}`);
    }
    logger.info(
      `[v5] start slug=${input.slug} city=${input.city} clientLang=${input.language} mode=${input.transportMode} radius=${input.radiusKm}km`,
    );

    // ── STEP 1 : insert empty game ──
    const gameId = await step.run("insert-empty-game", async () => {
      return await insertEmptyGame(input);
    });
    logger.info(`[v5] gameId=${gameId} créé (flag ${CONFIG.PIPELINE_VERSION_TAG})`);

    // ── STEP 1.5 : CHECK DRAFT (NEW 2026-05-26) ──
    // Si un draft `validated` existe pour ce slug, on saute la phase
    // discovery (Perplexity ~10s + Google ~30s + Claude select ~30s).
    // Économie : 1-2 min + ~$0.50 par vente. Stratégie alignée sur V1.
    const draft = await step.run("check-draft", async () => {
      return await loadValidatedDraft(input.slug);
    });

    let selectedStops: GeocodedLandmark[];
    let editorialWarning: string | undefined;
    const draftId = draft?.draftId;

    if (draft) {
      // ─── Chemin "draft hit" : skip discover/geocode/select ───
      logger.info(
        `[v5] 🚀 DRAFT FOUND pour slug=${input.slug} — ${draft.stops.length} stops pré-validés, skip discover/geocode/select`,
      );
      selectedStops = draft.stops;
      editorialWarning = draft.editorialWarning;
      // Align input.startPoint sur stop 1 du draft (= déjà aligné en DB
      // suite au fix script du 26/05, mais on s'assure côté mémoire).
      input.startPoint = { lat: selectedStops[0].lat, lon: selectedStops[0].lon };
      // Le buyer's startPointText est IGNORÉ ici : le draft est source de
      // vérité (l'opérateur l'a pré-validé en sachant quel sera le stop 1).
      // Si OddballTrip souhaite forcer un autre start, il faut éditer le
      // draft manuellement OU supprimer le draft pour relancer la pipeline.
    } else {
      // ─── Chemin standard : pas de draft → full discovery ───
      logger.info(`[v5] no draft for ${input.slug} → full discover/geocode/select pipeline`);

      // ── STEP 1.6 : RESOLVE START POINT + force as stop 1 ──
      // Si payload contient startPointText non vide → résout + force stop 1.
      let forcedStartLandmark: Awaited<ReturnType<typeof geocodeStartPoint>> = null;
      const hasStartText =
        typeof input.startPointText === "string" && input.startPointText.trim().length > 0;
      if (hasStartText || shouldResolveStartFromText(input)) {
        forcedStartLandmark = await step.run("resolve-start", async () => {
          return await geocodeStartPoint(input.startPointText!, input.city);
        });
        if (!forcedStartLandmark) {
          const reason = `resolve-start échec : Google Places n'a pas trouvé "${input.startPointText}" dans ${input.city}`;
          await haltForReview(gameId, reason);
          throw new Error(reason);
        }
        input.startPoint = { lat: forcedStartLandmark.lat, lon: forcedStartLandmark.lon };
        logger.info(
          `[v5] startPoint résolu via Google : ${forcedStartLandmark.googleName} @ ${forcedStartLandmark.lat},${forcedStartLandmark.lon}`,
        );
      }

      // ── STEP 2 : DISCOVER (Perplexity) ──
      let discovery;
      try {
        discovery = await step.run("discover", async () => {
          return await runDiscover(input);
        });
      } catch (e) {
        const reason = `Discover échec : ${e instanceof Error ? e.message : "?"}`;
        await haltForReview(gameId, reason);
        throw new Error(reason);
      }

      // ── STEP 3 : GEOCODE (Google Places) — injecte le forced start landmark ──
      const geocode = await step.run("geocode", async () => {
        return await runGeocode(input, discovery.landmarks, forcedStartLandmark);
      });

      if (geocode.geocoded.length < CONFIG.MIN_STOPS) {
        const reason = `Geocode : seulement ${geocode.geocoded.length} landmarks géocodés (min ${CONFIG.MIN_STOPS}). Failed: ${geocode.failed.length}`;
        await haltForReview(gameId, reason);
        return { gameId, halted: true, reason };
      }

      // ── STEP 4 : SELECT (Claude) ──
      let selection;
      try {
        selection = await step.run("select", async () => {
          return await runSelect(input, geocode);
        });
      } catch (e) {
        const reason = `Select échec : ${e instanceof Error ? e.message : "?"}`;
        await haltForReview(gameId, reason);
        throw new Error(reason);
      }

      if (selection.selected.length < CONFIG.MIN_STOPS) {
        const reason = `Select : seulement ${selection.selected.length} landmarks (min ${CONFIG.MIN_STOPS})`;
        await haltForReview(gameId, reason);
        return { gameId, halted: true, reason };
      }

      selectedStops = selection.selected;
      editorialWarning = discovery.warning;
    }

    // ── STEP 5 : NARRATE (Claude EN) ──
    // Reçoit selectedStops (draft.stops ou selection.selected — même type).
    let game: StructuredGame;
    try {
      game = await step.run("narrate", async () => {
        return await runNarrate(input, selectedStops, editorialWarning);
      });
    } catch (e) {
      // Si on consommait un draft, on le libère pour qu'un retry puisse y accéder
      if (draftId) await releaseDraft(draftId);
      const reason = `Narrate échec : ${e instanceof Error ? e.message : "?"}`;
      await haltForReview(gameId, reason);
      throw new Error(reason);
    }

    // ── STEP 6 : PERSIST master EN ──
    await step.run("persist-master-en", async () => {
      await persistMasterEN(gameId, input, game);
    });
    logger.info(`[v5] master EN persisté : ${game.stops.length} stops`);

    // Source as translation (EN) — pour persist + audio
    const sourceAsTranslation: TranslationResult = {
      language: "en",
      meta: game.meta,
      stops: game.stops.map((s) => ({
        step_order: s.step_order,
        title: s.title,
        landmarkName: s.landmarkName,
        riddle: s.riddle,
        anecdote: s.anecdote,
        arCharacterDialogue: s.arCharacterDialogue,
        arTreasureReward: s.arTreasureReward,
        hint: s.hints[0]?.text ?? "",
      })),
    };

    // ── STEP 7 : persist translation EN ──
    await step.run("persist-translation-en", async () => {
      await persistTranslation(gameId, sourceAsTranslation);
    });

    // ── STEP 8 : TRANSLATE (Gemini) si client_lang != EN ──
    const clientLang = input.language;
    let clientContent: TranslationResult = sourceAsTranslation;
    if (clientLang !== "en") {
      try {
        clientContent = await step.run("translate", async () => {
          return await translateGame(game, clientLang);
        });
        await step.run("persist-translation-client", async () => {
          await persistTranslation(gameId, clientContent);
        });
      } catch (e) {
        logger.warn(`[v5] translate ${clientLang} failed, fallback EN: ${e instanceof Error ? e.message : "?"}`);
        clientContent = sourceAsTranslation;
      }
    }

    // ── STEP 10 : AUDIO langue client ──
    await step.run("audio", async () => {
      const audios = await runAudio(gameId, game, clientContent);
      await persistAudios(gameId, audios);
    });
    logger.info(`[v5] audio ${clientLang} terminé`);

    // ── STEP 12 : ACTIVATION CODE ──
    const code = await step.run("activation-code", async () => {
      return await createActivationCode(gameId, input);
    });
    logger.info(`[v5] activation_code créé : ${code}`);

    // ── STEP 13 : PUBLISH ──
    await step.run("publish", async () => {
      await publishGame(gameId);
    });

    // ── STEP 13.5 : MARK DRAFT FULFILLED (si utilisé) ──
    // Aligné sur V1 (game-pipeline.ts:2449). Le draft verrouillé en
    // 'fulfilling' au début passe en 'fulfilled' + on stocke le gameId
    // produit (pour traçabilité audit).
    if (draftId) {
      await step.run("mark-draft-fulfilled", async () => {
        await markDraftConsumed(draftId, gameId);
      });
      logger.info(`[v5] draft ${draftId} marqué fulfilled (game=${gameId.slice(0, 8)})`);
    }

    // ── STEP 14 : CALLBACK OddballTrip ──
    if (input.callbackUrl && input.callbackSecret) {
      await step.run("callback", async () => {
        await notifyOddballTrip(input, gameId, code);
      });
    }

    logger.info(
      `[v5] DONE — slug=${input.slug} code=${code} stops=${game.stops.length} ${draftId ? "(via draft hit)" : "(full pipeline)"}`,
    );
    return {
      gameId,
      code,
      stops: game.stops.length,
      language: clientLang,
      usedDraft: !!draftId,
    };
  },
);
