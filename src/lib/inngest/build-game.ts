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
  runPipelinePhase1aDeepResearch,
  runPipelinePhase1Discovery,
  runPipelinePhase2aNarrationGen,
  runPipelinePhase2bGameWide,
  runPipelinePhase2cInsert,
  type GameTemplate,
  type Phase1Result,
  type Phase2aResult,
  type Phase2bResult,
} from "@/lib/game-pipeline";
import { type VerifiedThemeContext } from "@/lib/perplexity";
import {
  scorePhase1a,
  scorePhase1b,
  scorePhase2a,
  scorePhase2b,
  assertPhasePassesOrThrow,
} from "@/lib/pipeline-quality-scorer";
import { recordPhaseQuality } from "@/lib/pipeline-telemetry-writer";
import { judgeThematicRelevance } from "@/lib/pipeline-thematic-judge";
import {
  checkRadiusDurationCoherence,
  escalateOnPhase1aEmpty,
  aggregateCoherenceFlags,
} from "@/lib/pipeline-coherence";

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
    // 5-STEP SPLIT (2026-05-21) — passer le timeout HTTP Inngest Cloud
    // ════════════════════════════════════════════════════════════════
    // V1 (avant) : un seul step.run("build-from-template") avec budget
    // Vercel 800s. Les roadtrips radius 30-60km timeoutaient à 800030ms.
    //
    // V2 : split Phase 1 (discovery) + Phase 2 (narrative + insert) en
    // 2 steps. Mais Phase 2 dure encore 2-3 min cumulés, ce qui dépasse
    // le timeout HTTP Inngest Cloud → Vercel SDK endpoint (~2m43s).
    //
    // V3 (2026-05-20) : split Phase 2 en 3 sub-phases :
    //   - 2a : narration Claude (adapt + generateSteps + Roman fix + QA)
    //   - 2b : blocs game-wide (epilogue + intro + final riddle)
    //   - 2c : insert DB + photos historiques + telemetry
    // Mais Phase 1 (discovery) reste monolithique. Sur roadtrip (radius
    // 30-60km), Perplexity sonar-deep-research prend 2-5 min, combiné
    // au scoring Claude de 150 candidats + multi-center nearbysearch
    // → Phase 1 dépasse encore le timeout HTTP ~2m43s. Observé en prod
    // 2026-05-21 sur `le-codex-oublie-des-reines` : 2 attempts timeout.
    //
    // V4 (ce code) : split Phase 1 en 2 sub-phases ALSO :
    //   - 1a : Perplexity sonar-deep-research ISOLÉ (the long pole)
    //   - 1b : Google Places + Gemini pool + Claude scoring + selection
    //         (reçoit le verifiedContext de 1a en input — pas de dégrad.
    //         qualité, même résultat exact qu'avant le split).
    //
    // Chaque step a son propre budget 800s ET son propre HTTP roundtrip,
    // soit 5×800s cumulés effectifs. Inngest persiste les payloads
    // sérialisés entre les étapes (idempotent en cas de retry).
    //
    // Inngest sérialise/désérialise le payload entre step.run() — son type
    // `JsonifyObject` rend les `| undefined` optionnels (clé absente vs
    // valeur `undefined`). Le runtime est identique, mais le compilateur
    // refuse l'assignation directe vers les types canoniques. On cast
    // chaque payload : Inngest garantit l'isomorphisme JSON round-trip
    // pour les types simples qu'on emploie ici.
    const verifiedCtxRaw = await step.run("phase1a-deep-research", async () => {
      return await runPipelinePhase1aDeepResearch(template);
    });
    const verifiedContext = verifiedCtxRaw as VerifiedThemeContext;

    // ── Quality gate post-1a (Sprint 2.2) ────────────────────────────
    // Phase 1a is non-critical — pipeline still produces a usable game
    // with empty Perplexity context, just degraded historical anchors.
    // We log + don't throw. Telemetry persists the score for Sprint 4.
    const qa1a = scorePhase1a(verifiedContext);
    logger.info(`[quality] phase1a ${qa1a.summary}`);
    void recordPhaseQuality({
      gameId: null,
      phase: "phase1a",
      quality: qa1a,
      provider: "perplexity",
      metadata: {
        slug: data.slug,
        transport_mode: data.transportMode ?? "walking",
        radius_km: data.radiusKm ?? null,
      },
    });

    const phase1Raw = await step.run("phase1b-discovery", async () => {
      return await runPipelinePhase1Discovery(template, verifiedContext);
    });
    const phase1 = phase1Raw as Phase1Result;

    if (!phase1.success) {
      throw new Error(
        `Pipeline Phase 1b (discovery) failed: ${phase1.error ?? "(no message)"}`,
      );
    }

    // ── Quality gate post-1b (Sprint 2.2) ────────────────────────────
    // Phase 1b is CRITICAL — below floor = we'd ship a broken game.
    // Hard throw → Inngest retry logic kicks in.
    const qa1b = scorePhase1b(phase1);
    logger.info(`[quality] phase1b ${qa1b.summary}`);
    void recordPhaseQuality({
      gameId: null,
      phase: "phase1b",
      quality: qa1b,
      provider: "google_places",
      metadata: {
        slug: data.slug,
        transport_mode: data.transportMode ?? "walking",
        radius_km: data.radiusKm ?? null,
        stop_count: phase1.discoveryLandmarks.length,
      },
    });
    assertPhasePassesOrThrow("phase1b", qa1b);

    const phase2aRaw = await step.run("phase2a-narration", async () => {
      return await runPipelinePhase2aNarrationGen(template, phase1);
    });
    const phase2a = phase2aRaw as Phase2aResult;

    if (!phase2a.success) {
      throw new Error(
        `Pipeline Phase 2a (narration) failed: ${phase2a.error ?? "(no message)"}`,
      );
    }

    // ── Quality gate post-2a (Sprint 2.2) ────────────────────────────
    // Phase 2a CRITICAL : missing riddles/answers = unplayable.
    const qa2a = scorePhase2a(phase2a.verifiedLocationsAfterAdapt ?? []);
    logger.info(`[quality] phase2a ${qa2a.summary}`);
    void recordPhaseQuality({
      gameId: null,
      phase: "phase2a",
      quality: qa2a,
      provider: "claude",
      metadata: { slug: data.slug },
    });
    assertPhasePassesOrThrow("phase2a", qa2a);

    const phase2bRaw = await step.run("phase2b-game-wide", async () => {
      return await runPipelinePhase2bGameWide(template, phase1, phase2a);
    });
    const phase2b = phase2bRaw as Phase2bResult;

    // ── Quality gate post-2b (Sprint 2.2) ────────────────────────────
    // Phase 2b degrades gracefully (intro/epilogue can be empty), so
    // score-but-don't-throw. Below floor → flag needs_review.
    const qa2b = scorePhase2b({
      introSpeech: phase2b.introSpeech,
      epilogue: phase2b.epilogue,
      finalRiddle: phase2b.finalRiddle,
    });
    logger.info(`[quality] phase2b ${qa2b.summary}`);
    void recordPhaseQuality({
      gameId: null,
      phase: "phase2b",
      quality: qa2b,
      provider: "claude",
      metadata: { slug: data.slug },
    });
    if (!qa2b.passes) {
      logger.warn(
        `[quality] phase2b BELOW FLOOR — game will publish but flagged for review (intro/epilogue/final_riddle gaps).`,
      );
    }

    // ════════════════════════════════════════════════════════════════
    // SPRINT 6.2bis (2026-05-22) — POST-INCIDENT SAFETY GATES
    // ════════════════════════════════════════════════════════════════
    // Run defensive checks BEFORE Phase 2c INSERT so that any
    // needs_review flag is written atomically with the game. Without
    // this, there's a tiny race window where is_published=true could
    // be observed before the flag lands → OddballTrip could fetch and
    // generate a code prematurely.
    //
    // Checks executed :
    //   B. radius_km vs estimated_duration_min coherence
    //   E. Phase 1a Perplexity-empty hard escalation
    //   A. Thematic-fit judge (Claude Haiku) — most expensive but
    //      most important. The Aigues-Mortes 22/05 incident would
    //      have been caught at THIS gate.
    //
    // Each check produces a CoherenceFlag (or null). The aggregator
    // composes a single { needs_review, review_reason } object passed
    // to Phase 2c insert. Multiple flags → reasons concatenated.
    const coherenceRaw = await step.run("phase2b5-coherence-gates", async () => {
      const radiusFlag = checkRadiusDurationCoherence({
        transport_mode:
          template.transportMode === "driving" ||
          template.transportMode === "mixed" ||
          template.transportMode === "walking"
            ? template.transportMode
            : "walking",
        radius_km: template.radiusKm ?? null,
        estimated_duration_min: template.estimatedDurationMin ?? null,
      });
      const perplexityEscalation = escalateOnPhase1aEmpty(qa1a.score);
      const perplexityFlag = perplexityEscalation.trigger
        ? {
            code: "perplexity_dr_empty",
            severity: "fail" as const,
            message: perplexityEscalation.reason,
            details: { phase1a_quality: qa1a.score },
          }
        : null;

      // Thematic-fit judge — call Claude Haiku as a strict judge.
      let thematicFlag = null;
      try {
        const judge = await judgeThematicRelevance({
          theme: template.theme,
          themeDescription: template.themeDescription,
          narrative: template.narrative,
          city: template.city,
          stops: phase1.discoveryLandmarks.map((l, i) => ({
            step_order: i + 1,
            name: l.name,
            description:
              (l as { description?: string }).description ?? "",
          })),
        });
        logger.info(
          `[thematicJudge] ${judge.summary} (avg=${judge.average_score}, min=${judge.min_score}, verdict=${judge.verdict})`,
        );
        if (judge.verdict !== "pass") {
          thematicFlag = {
            code: `thematic_${judge.verdict}`,
            severity: "fail" as const,
            message: judge.needs_review_reason,
            details: {
              avg_score: judge.average_score,
              min_score: judge.min_score,
              stops: judge.stops,
            },
          };
        }
      } catch (err) {
        logger.warn(
          `[thematicJudge] judge unavailable (${err instanceof Error ? err.message : err}) — fail-open, no thematic flag added. Existing safety nets still apply.`,
        );
      }

      return aggregateCoherenceFlags([radiusFlag, perplexityFlag, thematicFlag]);
    });
    const coherence = coherenceRaw as ReturnType<typeof aggregateCoherenceFlags>;
    if (coherence.needs_review) {
      logger.warn(
        `[Sprint6.2bis] needs_review=TRUE forced by coherence gates : ${coherence.review_reason.slice(0, 300)}`,
      );
    } else {
      logger.info(`[Sprint6.2bis] all coherence gates passed`);
    }

    const result = (await step.run("phase2c-insert", async () => {
      const pipelineResult = await runPipelinePhase2cInsert(
        template,
        phase1,
        phase2a,
        phase2b,
        // (Sprint 6.2bis) — propagate forced flag + original payload
        { needs_review: coherence.needs_review, review_reason: coherence.review_reason },
        (data as { originalPayload?: Record<string, unknown> }).originalPayload,
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
