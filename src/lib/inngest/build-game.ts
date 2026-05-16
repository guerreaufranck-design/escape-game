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
import { generateGameFromTemplate, type GameTemplate } from "@/lib/game-pipeline";

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

    const result = (await step.run(
      "build-from-template",
      async () => {
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
        };

        const pipelineResult = await generateGameFromTemplate(template);
        if (!pipelineResult.success || !pipelineResult.gameId) {
          throw new Error(
            `Pipeline failed: ${pipelineResult.error ?? "(no message)"}`,
          );
        }
        return {
          gameId: pipelineResult.gameId,
          stepsCount: pipelineResult.steps ?? 0,
          discoverySource: pipelineResult.discoverySource ?? "unknown",
        };
      },
    )) as {
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
