/**
 * Inngest function — BUILD GAME FROM SCRATCH (durable, async).
 *
 * Vision 2026-05-16 (post-incident Aegina) : on déplace `generateGameFromTemplate`
 * de l'endpoint webhook synchrone vers une fonction Inngest durable.
 *
 * AVANT (KO) :
 *   OddballTrip POST → /api/external/generate-game
 *     → runFullPipeline sync (5-15 min)
 *     → Si Vercel timeout 13 min → tout perdu, rien en DB
 *     → OddballTrip timeout 30 min, marque generation_failed
 *
 * APRÈS (ce fichier) :
 *   OddballTrip POST → /api/external/generate-game
 *     → emit "game/build.requested"
 *     → 200 OK immédiat à OddballTrip
 *
 *   Inngest `buildGameDurable` consume :
 *     - Step "build-from-template" (jusqu'à 15 min, retry indépendant)
 *       → generateGameFromTemplate → insert game (is_published=false) +
 *         emit "game/generate.requested" (existing post-insert pipeline)
 *
 *   La function existante `generateGame` (post-insert) prend ensuite la
 *   relève pour translations + audio + validator + publish + callback.
 *
 * Idempotence : ce step peut être retry par Inngest. generateGameFromTemplate
 * doit gérer le cas "jeu déjà inséré pour ce slug" (currently it doesn't —
 * if retry fires, it inserts a duplicate). À surveiller. La grosse majorité
 * des throws viendront de Gemini/Claude/ElevenLabs en amont du insert, donc
 * en pratique pas de risque de duplicate.
 */
import { inngest, gameBuildRequested } from "@/lib/inngest-client";
import {
  runPipelinePhase1Discovery,
  runPipelinePhase2aNarrationGen,
  runPipelinePhase2bGameWide,
  runPipelinePhase2cInsert,
  type GameTemplate,
  type Phase1Result,
  type Phase2aResult,
  type Phase2bResult,
} from "@/lib/game-pipeline";

export const buildGameDurable = inngest.createFunction(
  {
    id: "build-game-durable",
    name: "Build game from scratch (durable)",
    triggers: [{ event: gameBuildRequested }],
    /**
     * Retry strategy : 1 retry au niveau function (le step interne fait
     * déjà du retry au niveau API Gemini/Claude). Le retry function se
     * déclenche sur un crash complet (exception non catchée, Vercel
     * function killed mid-execution).
     */
    retries: 1,
  },
  async ({ event, step, logger }) => {
    const data = event.data;
    logger.info(
      `[build-game] Start for slug=${data.slug} city=${data.city} mode=${data.transportMode ?? "walking"}`,
    );

    const template: GameTemplate = {
      slug: data.slug,
      city: data.city,
      country: data.country ?? "",
      theme: data.title,
      themeDescription: data.themeDescription,
      narrative:
        data.narrative ??
        `An outdoor adventure called "${data.title}", set in ${data.city}. ${data.themeDescription}`,
      difficulty: data.difficulty ?? 3,
      estimatedDurationMin: data.estimatedDurationMin ?? 135,
      stopCount: data.stopCount ?? 8,
      transportMode: data.transportMode,
      radiusKm: data.radiusKm,
      recommendedDaysMin: data.recommendedDaysMin,
      recommendedDaysMax: data.recommendedDaysMax,
      language: data.language,
      startPointText: data.startPointText,
      startPoint:
        typeof data.startPointLat === "number" &&
        typeof data.startPointLon === "number"
          ? { lat: data.startPointLat, lon: data.startPointLon }
          : undefined,
      accessibility: data.accessibility,
      // S9 (2026-05-18) — propagate game mode through pipeline.
      // OddballTrip peut maintenant envoyer mode="city_tour" pour
      // déclencher la variante audioguide.
      mode: data.mode,
    };

    // ════════════════════════════════════════════════════════════════
    // 4-STEP SPLIT (2026-05-20) — passer le timeout HTTP Inngest Cloud
    // ════════════════════════════════════════════════════════════════
    // V1 (avant) : un seul step.run("build-from-template") avec budget
    // Vercel 800s. Les roadtrips radius 30-60km timeoutaient à 800030ms.
    //
    // V2 : split Phase 1 (discovery) + Phase 2 (narrative + insert) en
    // 2 steps. Mais Phase 2 dure encore 2-3 min cumulés, ce qui dépasse
    // le timeout HTTP Inngest Cloud → Vercel SDK endpoint (~2m43s).
    // Erreur observée en prod : "Your server reset the connection while
    // we were reading the reply: Unexpected ending response."
    //
    // V3 (ce code) : split Phase 2 en 3 sub-phases :
    //   - 2a : narration Claude (adapt + generateSteps + Roman fix + QA)
    //   - 2b : blocs game-wide (epilogue + intro + final riddle)
    //   - 2c : insert DB + photos historiques + telemetry
    // Chaque step a son propre budget 800s ET son propre HTTP roundtrip,
    // soit 4×800s cumulés effectifs. Inngest persiste les payloads
    // sérialisés entre les étapes (idempotent en cas de retry).
    //
    // Inngest sérialise/désérialise le payload entre step.run() — son type
    // `JsonifyObject` rend les `| undefined` optionnels (clé absente vs
    // valeur `undefined`). Le runtime est identique, mais le compilateur
    // refuse l'assignation directe vers les types canoniques. On cast
    // chaque payload : Inngest garantit l'isomorphisme JSON round-trip
    // pour les types simples qu'on emploie ici.
    const phase1Raw = await step.run("phase1-discovery", async () => {
      return await runPipelinePhase1Discovery(template);
    });
    const phase1 = phase1Raw as Phase1Result;

    if (!phase1.success) {
      throw new Error(
        `Pipeline Phase 1 (discovery) failed: ${phase1.error ?? "(no message)"}`,
      );
    }

    const phase2aRaw = await step.run("phase2a-narration", async () => {
      return await runPipelinePhase2aNarrationGen(template, phase1);
    });
    const phase2a = phase2aRaw as Phase2aResult;

    if (!phase2a.success) {
      throw new Error(
        `Pipeline Phase 2a (narration) failed: ${phase2a.error ?? "(no message)"}`,
      );
    }

    const phase2bRaw = await step.run("phase2b-game-wide", async () => {
      return await runPipelinePhase2bGameWide(template, phase1, phase2a);
    });
    const phase2b = phase2bRaw as Phase2bResult;

    const result = (await step.run("phase2c-insert", async () => {
      const pipelineResult = await runPipelinePhase2cInsert(
        template,
        phase1,
        phase2a,
        phase2b,
      );
      if (!pipelineResult.success || !pipelineResult.gameId) {
        throw new Error(
          `Pipeline Phase 2c (insert) failed: ${pipelineResult.error ?? "(no message)"}`,
        );
      }
      return {
        gameId: pipelineResult.gameId,
        stepsCount: pipelineResult.steps ?? 0,
        discoverySource: pipelineResult.discoverySource ?? "unknown",
      };
    })) as {
      gameId: string;
      stepsCount: number;
      discoverySource: string;
    };

    // Step 2 — chain into post-insert pipeline (translations + audio +
    // validator + publish + callback). Existing function `generateGame`
    // (in ./generate-game.ts) consumes this event.
    await step.sendEvent("trigger-post-insert", {
      name: "game/generate.requested",
      data: {
        gameId: result.gameId,
        slug: data.slug,
        language: data.language,
        city: data.city,
        theme: data.title,
        narrative:
          data.narrative ??
          `An outdoor adventure called "${data.title}", set in ${data.city}. ${data.themeDescription}`,
        genre: data.genre,
        buyerEmail: data.buyerEmail,
        orderId: data.orderId,
        callbackUrl: data.callbackUrl,
        callbackSecret: data.callbackSecret,
      },
    });

    logger.info(
      `[build-game] ✅ Build done — gameId=${result.gameId} steps=${result.stepsCount} source=${result.discoverySource}. Post-insert pipeline event emitted.`,
    );

    return {
      gameId: result.gameId,
      slug: data.slug,
      stepsCount: result.stepsCount,
      discoverySource: result.discoverySource,
    };
  },
);
