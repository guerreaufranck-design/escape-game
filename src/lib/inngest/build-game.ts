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
import {
  type VerifiedThemeContext,
  type ResearchedLocation,
} from "@/lib/perplexity";
import { type DiscoveredStop } from "@/lib/parcours-discovery";
import {
  scorePhase1a,
  scorePhase1b,
  scorePhase2a,
  scorePhase2b,
  assertPhasePassesOrThrow,
} from "@/lib/pipeline-quality-scorer";
import { recordPhaseQuality } from "@/lib/pipeline-telemetry-writer";
import {
  judgeThematicRelevance,
  type ThematicJudgeResult,
} from "@/lib/pipeline-thematic-judge";
import {
  checkRadiusDurationCoherence,
  escalateOnPhase1aEmpty,
  aggregateCoherenceFlags,
  type CoherenceFlag,
} from "@/lib/pipeline-coherence";
import { autoRepairThematicStops } from "@/lib/pipeline-auto-repair-stops";
import { judgeArmchairResolvability } from "@/lib/pipeline-armchair-judge";
import { judgeCrossStopCallbacks } from "@/lib/pipeline-callbacks-judge";
import { judgeNarrativeArc } from "@/lib/pipeline-narrative-arc-judge";
import { judgeRiddleDifficultyCurve } from "@/lib/pipeline-difficulty-curve-judge";

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

    // Guard v1 (2026-05-25) : V2 est désormais le default. v1 ne tourne
    // QUE si explicitement demandée (body.pipelineVersion=v1 OU env=v1).
    const wantsV1 = (data as { pipelineVersion?: string }).pipelineVersion === "v1"
      || process.env.PIPELINE_VERSION === "v1";
    if (!wantsV1) {
      logger.info(`[build-game v1] SKIP — V2 est désormais default, déléguant à buildGameV2`);
      return { skipped: true, reason: "v2_is_default" };
    }

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
      // Sprint 6.2ter (2026-05-22) — rich product description forwarded
      // through the template so every downstream stage (Perplexity DR,
      // discovery, narration, judge, validator) can ground on it.
      productDescription: (data as { productDescription?: string }).productDescription,
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
    const phase1Initial = phase1Raw as Phase1Result;

    if (!phase1Initial.success) {
      throw new Error(
        `Pipeline Phase 1b (discovery) failed: ${phase1Initial.error ?? "(no message)"}`,
      );
    }
    // `let` (not const) — Phase 1b5 auto-repair may rebind this with
    // repaired landmarks before Phase 2a consumes it. We pin the type
    // to the success variant so reassignments preserve narrowing.
    let phase1: Extract<Phase1Result, { success: true }> = phase1Initial;

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

    // ════════════════════════════════════════════════════════════════
    // SPRINT 6.2quater (2026-05-22) — THEMATIC AUTO-REPAIR
    // ════════════════════════════════════════════════════════════════
    // Closes the auto-correction loop opened by Sprint 6.2bis. Instead
    // of merely DETECTING thematic drift (judge) and escalating to a
    // human, we now ATTEMPT TO FIX it automatically by reshuffling the
    // Google Places candidate pool that Phase 1b already produced.
    //
    // Algorithm :
    //   1. Run the thematic-fit judge on phase1.discoveryLandmarks.
    //   2. If verdict === "pass" → no-op, continue to Phase 2a.
    //   3. Else split stops : keep (fit_score ≥ 4), discard (< 4).
    //   4. Re-pick N replacements from the Google Places pool
    //      (phase1.allCandidates minus already-selected ids), guided
    //      by Claude Haiku with strict Tier 1/2/3 + museum policy.
    //   5. Re-run the judge on [keep + new picks]. If pass (or weak ≥
    //      6.0 avg) → swap in the repaired landmarks AND matching
    //      ResearchedLocation array. Phase 2a then narrates the new
    //      stops as if they'd been chosen originally.
    //   6. If still failing after MAX_ATTEMPTS=2 → emit a
    //      `residualThematicFlag` so phase2b5-coherence-gates can
    //      escalate to needs_review (preserving Sprint 6.2bis safety).
    //
    // Anti-hallucination : Claude RE-RANKS the existing pool ; it
    // cannot invent place_ids. Every replacement has valid GPS + types
    // + Google rating already validated by Phase 1b.
    //
    // Running this BEFORE phase2a-narration means the narration is
    // generated against the FINAL (repaired) stops list — no wasted
    // Claude calls re-adapting a doomed narrative.
    const autoRepairRaw = await step.run(
      "phase1b5-thematic-autorepair",
      async () => {
        // 1. Run the thematic judge on the initial Phase 1b selection.
        let initialJudge: ThematicJudgeResult;
        try {
          initialJudge = await judgeThematicRelevance({
            theme: template.theme,
            themeDescription: template.themeDescription,
            narrative: template.narrative,
            productDescription: template.productDescription,
            city: template.city,
            stops: phase1.discoveryLandmarks.map((l, i) => ({
              step_order: i + 1,
              name: l.name,
              description:
                (l as { description?: string }).description ?? "",
            })),
          });
        } catch (err) {
          logger.warn(
            `[phase1b5-autorepair] thematic judge unavailable (${err instanceof Error ? err.message : err}). Fail-open : skipping auto-repair, no residual flag. Sprint 6.2bis safety nets still apply.`,
          );
          return {
            judged: false,
            repaired: false,
            reason: "judge unavailable",
            newLandmarks: null,
            newVerifiedLocations: null,
            newStopModes: null,
            newNavigationHints: null,
            residualThematicFlag: null,
            initialJudgeSummary: null,
            repairReplacedCount: 0,
            repairAttempts: 0,
            repairFinalAvgScore: null,
          };
        }

        logger.info(
          `[phase1b5-autorepair] initial judge : ${initialJudge.summary} (avg=${initialJudge.average_score}, min=${initialJudge.min_score}, verdict=${initialJudge.verdict})`,
        );

        if (initialJudge.verdict === "pass") {
          return {
            judged: true,
            repaired: false,
            reason: "initial judge passed — no repair needed",
            newLandmarks: null,
            newVerifiedLocations: null,
            newStopModes: null,
            newNavigationHints: null,
            residualThematicFlag: null,
            initialJudgeSummary: initialJudge.summary,
            repairReplacedCount: 0,
            repairAttempts: 0,
            repairFinalAvgScore: initialJudge.average_score,
          };
        }

        // 2. Verdict != pass → attempt auto-repair via pool reshuffle.
        logger.warn(
          `[phase1b5-autorepair] judge ${initialJudge.verdict} — invoking pool-reshuffling auto-repair (avg=${initialJudge.average_score}, min=${initialJudge.min_score})`,
        );

        const candidatePool = phase1.allCandidates ?? [];
        if (candidatePool.length === 0) {
          logger.warn(
            "[phase1b5-autorepair] candidate pool empty (Gemini-only discovery path?) — cannot auto-repair, escalating to needs_review.",
          );
          return {
            judged: true,
            repaired: false,
            reason: "candidate pool empty — auto-repair skipped",
            newLandmarks: null,
            newVerifiedLocations: null,
            newStopModes: null,
            newNavigationHints: null,
            residualThematicFlag: {
              code: `thematic_${initialJudge.verdict}`,
              // V10 silence : thematic_weak → WARN. Only thematic_fail
              // (avg < 4, catastrophic) blocks. weak (avg 4-5.5) ships.
              severity: (initialJudge.verdict === "fail" ? "fail" : "warn") as "fail" | "warn",
              message: `${initialJudge.needs_review_reason} (auto-repair skipped : no candidate pool available — Gemini-only discovery path)`,
              details: {
                avg_score: initialJudge.average_score,
                min_score: initialJudge.min_score,
                stops: initialJudge.stops,
                auto_repair_skipped_reason: "pool_empty",
              },
            },
            initialJudgeSummary: initialJudge.summary,
            repairReplacedCount: 0,
            repairAttempts: 0,
            repairFinalAvgScore: initialJudge.average_score,
          };
        }

        const scoreByStepOrder = new Map(
          initialJudge.stops.map((s) => [s.step_order, s.fit_score]),
        );
        const originalStops = phase1.discoveryLandmarks.map((l, i) => ({
          step_order: i + 1,
          name: l.name,
          lat: l.lat,
          lon: l.lon,
          placeId: l.placeId,
          types: l.types,
          rating: l.rating,
          fit_score: scoreByStepOrder.get(i + 1) ?? 0,
          description: (l as { description?: string }).description,
        }));

        const repair = await autoRepairThematicStops({
          theme: template.theme,
          themeDescription: template.themeDescription,
          productDescription: template.productDescription,
          city: template.city,
          country: template.country,
          originalStops,
          pool: candidatePool,
        });

        if (!repair.success) {
          logger.warn(
            `[phase1b5-autorepair] ❌ auto-repair failed : ${repair.reason}`,
          );
          return {
            judged: true,
            repaired: false,
            reason: repair.reason,
            newLandmarks: null,
            newVerifiedLocations: null,
            newStopModes: null,
            newNavigationHints: null,
            residualThematicFlag: {
              code: `thematic_${initialJudge.verdict}`,
              // V10 silence : thematic_weak → WARN. Only thematic_fail
              // (avg < 4, catastrophic) blocks. weak (avg 4-5.5) ships.
              severity: (initialJudge.verdict === "fail" ? "fail" : "warn") as "fail" | "warn",
              message: `${initialJudge.needs_review_reason} | Auto-repair attempted but failed: ${repair.reason}`,
              details: {
                avg_score: initialJudge.average_score,
                min_score: initialJudge.min_score,
                stops: initialJudge.stops,
                auto_repair_attempts: repair.attempts,
                auto_repair_final_avg:
                  repair.postRepairJudge?.average_score ?? null,
                auto_repair_final_verdict:
                  repair.postRepairJudge?.verdict ?? null,
              },
            },
            initialJudgeSummary: initialJudge.summary,
            repairReplacedCount: 0,
            repairAttempts: repair.attempts,
            repairFinalAvgScore:
              repair.postRepairJudge?.average_score ?? null,
          };
        }

        // 3. Auto-repair succeeded — synthesize the new DiscoveredStop[]
        //    and matching ResearchedLocation[]. Keepers reuse their
        //    original entries verbatim ; replacements are minted from
        //    the Google Places pool. Phase 2a's adaptNarrativeForReplaced
        //    Stops will then write a fresh narration for the new mix.
        logger.info(
          `[phase1b5-autorepair] ✅ auto-repair succeeded : ${repair.reason}`,
        );

        const newLandmarks: DiscoveredStop[] = repair.repairedStops.map(
          (rs) => {
            if (!rs.fromAutoRepair) {
              const original = phase1.discoveryLandmarks.find(
                (l) =>
                  (l.placeId && l.placeId === rs.placeId) ||
                  l.name === rs.name,
              );
              if (original) return original;
            }
            const poolEntry = (phase1.allCandidates ?? []).find(
              (c) => c.placeId === rs.placeId,
            );
            return {
              name: rs.name,
              description: "",
              source: "auto-repair-google-places",
              lat: rs.lat,
              lon: rs.lon,
              placeId: rs.placeId,
              distanceFromStartM: poolEntry?.distanceM ?? 0,
              stopMode: "radar" as const,
              navigationHint: undefined,
              types: rs.types,
              rating: rs.rating,
            };
          },
        );

        const newVerifiedLocations: ResearchedLocation[] = newLandmarks.map(
          (s) => ({
            name: s.name,
            landmarkName: s.name,
            latitude: s.lat,
            longitude: s.lon,
            whatToObserve: s.description,
            answer: "AUTO",
            answerType: "name" as const,
            answerSource: "virtual_ar" as const,
            source: s.source ?? "auto-repair-google-places",
            themeLink: s.description,
          }),
        );

        const newStopModes = newLandmarks.map((l) => l.stopMode);
        const newNavigationHints = newLandmarks.map(
          (l) => l.navigationHint ?? null,
        );

        return {
          judged: true,
          repaired: true,
          reason: repair.reason,
          newLandmarks,
          newVerifiedLocations,
          newStopModes,
          newNavigationHints,
          residualThematicFlag: null,
          initialJudgeSummary: initialJudge.summary,
          repairReplacedCount: repair.replacedCount,
          repairAttempts: repair.attempts,
          repairFinalAvgScore:
            repair.postRepairJudge?.average_score ?? null,
        };
      },
    );
    const autoRepair = autoRepairRaw as {
      judged: boolean;
      repaired: boolean;
      reason: string;
      newLandmarks: DiscoveredStop[] | null;
      newVerifiedLocations: ResearchedLocation[] | null;
      newStopModes: Array<"radar" | "narrative"> | null;
      newNavigationHints: Array<string | null> | null;
      residualThematicFlag: CoherenceFlag | null;
      initialJudgeSummary: string | null;
      repairReplacedCount: number;
      repairAttempts: number;
      repairFinalAvgScore: number | null;
    };

    if (
      autoRepair.repaired &&
      autoRepair.newLandmarks &&
      autoRepair.newVerifiedLocations &&
      autoRepair.newStopModes &&
      autoRepair.newNavigationHints
    ) {
      logger.info(
        `[build-game] Applying auto-repair : ${autoRepair.repairReplacedCount} stop(s) replaced from pool (attempts=${autoRepair.repairAttempts}, final_avg=${autoRepair.repairFinalAvgScore}). Phase 2a will narrate the repaired mix.`,
      );
      // Annotate the existing review reason so the operator can see the
      // auto-repair fingerprint without forcing needs_review (the judge
      // is now happy with the repaired mix).
      const repairTrace = `[AUTO_REPAIR_APPLIED] ${autoRepair.repairReplacedCount} stop(s) auto-swapped from Google Places pool (final avg fit=${autoRepair.repairFinalAvgScore}, attempts=${autoRepair.repairAttempts}).`;
      const prevReason = phase1.reviewReason;
      phase1 = {
        ...phase1,
        discoveryLandmarks: autoRepair.newLandmarks,
        verifiedLocations: autoRepair.newVerifiedLocations,
        stopModes: autoRepair.newStopModes,
        navigationHints: autoRepair.newNavigationHints,
        reviewReason: prevReason
          ? `${prevReason} | ${repairTrace}`
          : repairTrace,
      };
    } else if (autoRepair.judged && autoRepair.residualThematicFlag) {
      logger.warn(
        `[build-game] Auto-repair could not fix thematic drift — residual flag will force needs_review at phase2b5.`,
      );
    } else if (autoRepair.judged) {
      logger.info(`[build-game] Initial thematic judge passed — no repair needed.`);
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
    //   + Sprint 6.2quater integration : thematic flag is now sourced
    //     from the upstream phase1b5-thematic-autorepair step (only
    //     emitted if auto-repair failed to fix the drift).
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
    //   A. Residual thematic-fit flag from phase1b5-thematic-autorepair
    //      (judge + auto-repair already ran upstream ; we just consume
    //      whatever flag survived). The Aigues-Mortes 22/05 incident
    //      would now be auto-repaired before reaching this point —
    //      this flag only fires when auto-repair itself couldn't fix.
    //
    // Each check produces a CoherenceFlag (or null). The aggregator
    // composes a single { needs_review, review_reason } object passed
    // to Phase 2c insert. Multiple flags → reasons concatenated.
    const thematicFlagFromAutoRepair = autoRepair.residualThematicFlag;
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

      // ════════════════════════════════════════════════════════════
      // SPRINTS B/C/D/E (2026-05-22) — 4 EXPERIENCE-QUALITY JUDGES
      // EMERGENCY PATCH 2026-05-23 : run in PARALLEL via Promise.allSettled
      // ════════════════════════════════════════════════════════════
      // The Béziers V5 incident 23/05 08:02 UTC showed that running these
      // 4 Claude Haiku judges SEQUENTIALLY pushed the phase2b5 step.run
      // budget past Vercel's HTTP timeout (~2m43s on Inngest Cloud →
      // Vercel SDK endpoint). Now :
      //
      //   1. All 4 judges share a single Promise.allSettled, so wall-clock
      //      time = max(individual), not sum.
      //   2. Each Anthropic call has a hard 30s timeout (patched into the
      //      judge modules themselves).
      //   3. Fail-open semantics preserved : any rejected promise = no
      //      flag added (we never block publish on infra failure).
      //
      // What each judge catches :
      //   B armchair  : Questo #1 critique — "solved from couch via Google"
      //   C callbacks : Questo #4 critique — "rupture cohérence narrative"
      //   D arc       : Questo #5 critique — "dénouement abrupt"
      //   E difficulty: Questo #1 alt — "simplicité excessive" + curve
      const judgeStops = phase2a.steps.map((s, i) => ({
        step_order: i + 1,
        landmark_name: s.title,
        title: s.title,
        riddle_text: s.riddle_text,
        anecdote: s.anecdote,
      }));
      const [armchairRes, callbacksRes, arcRes, difficultyRes] =
        await Promise.allSettled([
          judgeArmchairResolvability({
            theme: template.theme,
            city: template.city,
            riddles: phase2a.steps.map((s, i) => ({
              step_order: i + 1,
              landmark_name: s.title,
              riddle_text: s.riddle_text,
              answer: s.answer_text,
              answer_source: s.answer_source,
            })),
          }),
          judgeCrossStopCallbacks({
            theme: template.theme,
            stops: judgeStops,
          }),
          judgeNarrativeArc({
            theme: template.theme,
            narrative: template.narrative,
            stops: judgeStops,
            finalRiddle: phase2b.finalRiddle?.riddle,
          }),
          judgeRiddleDifficultyCurve({
            theme: template.theme,
            gameDifficulty: template.difficulty ?? 3,
            stops: phase2a.steps.map((s, i) => ({
              step_order: i + 1,
              landmark_name: s.title,
              title: s.title,
              riddle_text: s.riddle_text,
              answer: s.answer_text,
              hint_count: s.hints?.length ?? 0,
            })),
          }),
        ]);

      let armchairFlag: CoherenceFlag | null = null;
      if (armchairRes.status === "fulfilled") {
        const j = armchairRes.value;
        logger.info(
          `[armchairJudge] ${j.summary} (avg=${j.average_score}, min=${j.min_score}, verdict=${j.verdict})`,
        );
        // V10 silence : keep armchair as FAIL only when ALL riddles are
        // armchair-solvable (verdict=fail). Verdict=weak → just warn.
        // We don't want to block over the occasional Google-able riddle.
        if (j.verdict !== "pass") {
          armchairFlag = {
            code: `armchair_${j.verdict}`,
            severity: j.verdict === "fail" ? "fail" : "warn",
            message: j.needs_review_reason,
            details: {
              avg_site_presence: j.average_score,
              min_site_presence: j.min_score,
              riddles: j.riddles,
            },
          };
        }
      } else {
        logger.warn(
          `[armchairJudge] judge unavailable (${armchairRes.reason instanceof Error ? armchairRes.reason.message : armchairRes.reason}) — fail-open, no armchair flag.`,
        );
      }

      let callbacksFlag: CoherenceFlag | null = null;
      if (callbacksRes.status === "fulfilled") {
        const j = callbacksRes.value;
        logger.info(
          `[callbacksJudge] ${j.summary} (avg=${j.average_score}, min=${j.min_score}, final=${j.final_stop_score}, verdict=${j.verdict})`,
        );
        // V10 silence : narration quality judge → WARN only, no needs_review.
        // Informational audit log only. Game ships regardless.
        if (j.verdict !== "pass") {
          callbacksFlag = {
            code: `callbacks_${j.verdict}`,
            severity: "warn",
            message: j.needs_review_reason,
            details: {
              avg_callback_score: j.average_score,
              min_callback_score: j.min_score,
              final_stop_score: j.final_stop_score,
              stops: j.stops,
            },
          };
        }
      } else {
        logger.warn(
          `[callbacksJudge] judge unavailable (${callbacksRes.reason instanceof Error ? callbacksRes.reason.message : callbacksRes.reason}) — fail-open, no callbacks flag.`,
        );
      }

      let arcFlag: CoherenceFlag | null = null;
      if (arcRes.status === "fulfilled") {
        const j = arcRes.value;
        logger.info(
          `[arcJudge] ${j.summary} (avg=${j.average_score}, climax=${j.climax_score}, final=${j.final_score}, verdict=${j.verdict})`,
        );
        // V10 silence : narrative arc judge → WARN only, no needs_review.
        if (j.verdict !== "pass") {
          arcFlag = {
            code: `arc_${j.verdict}`,
            severity: "warn",
            message: j.needs_review_reason,
            details: {
              avg_score: j.average_score,
              climax_score: j.climax_score,
              final_score: j.final_score,
              stops: j.stops,
            },
          };
        }
      } else {
        logger.warn(
          `[arcJudge] judge unavailable (${arcRes.reason instanceof Error ? arcRes.reason.message : arcRes.reason}) — fail-open, no arc flag.`,
        );
      }

      let difficultyFlag: CoherenceFlag | null = null;
      if (difficultyRes.status === "fulfilled") {
        const j = difficultyRes.value;
        logger.info(
          `[difficultyJudge] ${j.summary} (avg=${j.average_score}, climax_peak=${j.climax_is_peak}, verdict=${j.verdict})`,
        );
        // V10 silence : difficulty curve judge → WARN only, no needs_review.
        if (j.verdict !== "pass") {
          difficultyFlag = {
            code: `difficulty_${j.verdict}`,
            severity: "warn",
            message: j.needs_review_reason,
            details: {
              avg_score: j.average_score,
              climax_is_peak: j.climax_is_peak,
              game_difficulty_match: j.game_difficulty_match,
              stops: j.stops,
            },
          };
        }
      } else {
        logger.warn(
          `[difficultyJudge] judge unavailable (${difficultyRes.reason instanceof Error ? difficultyRes.reason.message : difficultyRes.reason}) — fail-open, no difficulty flag.`,
        );
      }

      return aggregateCoherenceFlags([
        radiusFlag,
        perplexityFlag,
        thematicFlagFromAutoRepair,
        armchairFlag,
        callbacksFlag,
        arcFlag,
        difficultyFlag,
      ]);
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
