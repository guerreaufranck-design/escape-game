/**
 * Inngest function — classify a player error report and route to
 * auto-rectifier or admin queue.
 *
 * Sprint 6.1 (2026-05-21). Triggered by `player/error-report.submitted`.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Flow
 * ═══════════════════════════════════════════════════════════════════
 *
 *   1. Load the error_reports row + step context (landmark, GPS, answer)
 *   2. Call lib/error-report-classifier → category + confidence
 *   3. Insert a pipeline_incidents row capturing the full context
 *   4. Route :
 *      - if category is auto-rectifiable AND confidence ≥ AUTO_THRESHOLD
 *        AND (Sprint 6.1 : category in audio set, will expand later)
 *        → apply the rectifier, update incident.resolution
 *      - otherwise → leave incident.resolution='pending' for admin
 *   5. Update error_reports.status accordingly :
 *      - 'fixed' when auto-rectified
 *      - 'reviewed' (kept 'new' actually, admin marks reviewed) when
 *        we just classified without applying
 *
 * ═══════════════════════════════════════════════════════════════════
 * Safety
 * ═══════════════════════════════════════════════════════════════════
 *
 * Every step.run() is idempotent. If Inngest retries this function,
 * the duplicate guards (existing incident by source_report_id, audio
 * already present check, etc.) prevent double-applications.
 */
import { inngest, errorReportSubmitted } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyErrorReport,
  CATEGORY_AUTORECTIFIABLE,
  type ErrorCategory,
  type StepContext,
} from "@/lib/error-report-classifier";
import {
  routeCategoryToActionType,
  applyAction,
  type OperatorAction,
  type AudioSlot,
} from "@/lib/auto-rectify-actions";

/** Minimum classifier confidence to trigger auto-rectify. Below this,
 *  even an "auto"-dispositioned category goes to admin queue. */
const AUTO_THRESHOLD = 0.75;

export const classifyAndRectifyErrorReport = inngest.createFunction(
  {
    id: "classify-and-rectify-error-report",
    name: "Classify + auto-rectify player error reports",
    triggers: [{ event: errorReportSubmitted }],
    // Bound the concurrency : keep Anthropic + ElevenLabs API pressure
    // moderate. If a flood of reports arrives we throttle naturally.
    concurrency: { limit: 4 },
    // 2 retries on transient failures (API timeouts). After that, the
    // incident is left pending=true and surfaces in admin queue.
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const reportId = event.data.reportId;
    logger.info(`[classifyAndRectify] Start for report ${reportId}`);

    // ── Step 1 : Load report + context ─────────────────────────────
    const ctxRaw = await step.run("load-report-context", async () => {
      const supabase = createAdminClient();
      const { data: report, error: reportErr } = await supabase
        .from("error_reports")
        .select("id, game_id, step_id, session_id, player_name, step_order, message, status")
        .eq("id", reportId)
        .single();
      if (reportErr || !report) {
        throw new Error(`error_reports row ${reportId} not found: ${reportErr?.message}`);
      }

      // Guard : already processed ?
      const { data: existingIncident } = await supabase
        .from("pipeline_incidents")
        .select("id, resolution")
        .eq("source_report_id", reportId)
        .maybeSingle();
      if (existingIncident) {
        return { skip: true as const, existingIncident, report };
      }

      // Fetch step context for grounded classification
      let stepCtx: StepContext = {
        landmark_name: "(unknown)",
        latitude: 0,
        longitude: 0,
        answer_text: "(none)",
        step_order: report.step_order ?? null,
        city: "(unknown)",
      };
      if (report.step_id) {
        const { data: stepRow } = await supabase
          .from("game_steps")
          .select("landmark_name, latitude, longitude, answer_text")
          .eq("id", report.step_id)
          .maybeSingle();
        if (stepRow) {
          stepCtx.landmark_name = stepRow.landmark_name ?? stepCtx.landmark_name;
          stepCtx.latitude = stepRow.latitude ?? 0;
          stepCtx.longitude = stepRow.longitude ?? 0;
          stepCtx.answer_text = stepRow.answer_text ?? "(none)";
        }
      }
      if (report.game_id) {
        const { data: gameRow } = await supabase
          .from("games")
          .select("city")
          .eq("id", report.game_id)
          .maybeSingle();
        if (gameRow) {
          stepCtx.city = gameRow.city ?? "(unknown)";
        }
      }
      return { skip: false as const, report, stepCtx };
    });
    const ctx = ctxRaw as
      | { skip: true; existingIncident: { id: string; resolution: string }; report: { id: string } }
      | {
          skip: false;
          report: {
            id: string;
            game_id: string | null;
            step_id: string | null;
            step_order: number | null;
            message: string;
          };
          stepCtx: StepContext;
        };

    if (ctx.skip) {
      logger.info(
        `[classifyAndRectify] Skip ${reportId} — already has incident ${ctx.existingIncident.id} (resolution=${ctx.existingIncident.resolution})`,
      );
      return { skipped: true, reason: "already_processed" };
    }

    // ── Step 2 : Classify via LLM ──────────────────────────────────
    const classificationRaw = await step.run("classify", async () => {
      return classifyErrorReport(ctx.report.message, ctx.stepCtx);
    });
    const classification = classificationRaw as {
      category: ErrorCategory;
      confidence: number;
      evidence: string;
      actionable: boolean;
      reasoning: string;
      hints: Record<string, string | number>;
    };

    // ── Step 3 : Create pipeline_incidents row ─────────────────────
    const incidentIdRaw = await step.run("create-incident", async () => {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("pipeline_incidents")
        .insert({
          game_id: ctx.report.game_id,
          step_id: ctx.report.step_id,
          trigger_type: "player_report",
          error_signature: classification.category,
          pipeline_context: {
            step_order: ctx.report.step_order,
            landmark_name: ctx.stepCtx.landmark_name,
            city: ctx.stepCtx.city,
          },
          flagged_features: {
            player_message: ctx.report.message,
            classifier_confidence: classification.confidence,
            classifier_evidence: classification.evidence,
            classifier_reasoning: classification.reasoning,
            actionable: classification.actionable,
            hints: classification.hints,
          },
          source_report_id: ctx.report.id,
          resolution: "pending",
        })
        .select("id")
        .single();
      if (error) throw new Error(`pipeline_incidents insert failed: ${error.message}`);
      return data.id as string;
    });
    const incidentId = incidentIdRaw as string;

    // ── Step 4 : Decide whether to auto-rectify ────────────────────
    const disposition = CATEGORY_AUTORECTIFIABLE[classification.category] ?? "admin";
    const actionType = routeCategoryToActionType(classification.category);
    const shouldAutoRectify =
      disposition === "auto" &&
      classification.confidence >= AUTO_THRESHOLD &&
      classification.actionable === true &&
      actionType !== null;

    logger.info(
      `[classifyAndRectify] report=${reportId} category=${classification.category} ` +
        `confidence=${classification.confidence.toFixed(2)} ` +
        `disposition=${disposition} actionType=${actionType ?? "(none)"} ` +
        `decision=${shouldAutoRectify ? "AUTO_RECTIFY" : "ADMIN_QUEUE"}`,
    );

    if (!shouldAutoRectify) {
      // Leave incident pending; admin will pick it up.
      return {
        reportId,
        incidentId,
        category: classification.category,
        confidence: classification.confidence,
        decision: "admin_queue",
        reason: classification.actionable
          ? `category=${classification.category} disposition=${disposition} confidence=${classification.confidence.toFixed(2)} (threshold ${AUTO_THRESHOLD})`
          : "classifier marked as not actionable",
      };
    }

    // ── Step 5 : Apply rectifier ───────────────────────────────────
    // For Sprint 6.1 only audio actions are wired. The router returns
    // null for everything else → we'd never get here for non-audio.
    if (actionType !== "rectifyMissingAudio" && actionType !== "rectifyAudioTextMismatch") {
      // Defensive : shouldn't happen given the router logic.
      return {
        reportId,
        incidentId,
        decision: "admin_queue",
        reason: `actionType ${actionType} not implemented in Sprint 6.1`,
      };
    }

    // Both audio actions need (gameId, stepId, stepOrder, language, slot).
    // We have gameId + stepId + stepOrder from the report; language comes
    // from the game's player_language (fall back to "fr" then "en");
    // slot we guess from the classifier hints, default to "all_step_slots"
    // for mismatch and require a known slot for missing_audio.
    if (!ctx.report.game_id || !ctx.report.step_id || ctx.report.step_order == null) {
      return {
        reportId,
        incidentId,
        decision: "admin_queue",
        reason: "audio rectifier requires gameId + stepId + stepOrder; one or more missing",
      };
    }

    const language = await step.run("resolve-language", async () => {
      const supabase = createAdminClient();
      const { data: trans } = await supabase
        .from("translations_cache")
        .select("language")
        .eq("source_table", "games")
        .eq("source_id", ctx.report.game_id!)
        .limit(1)
        .maybeSingle();
      return trans?.language ?? "fr"; // default FR — our most common audience
    }) as string;

    // Slot guess from classifier hints (if any)
    const hintSlot = classification.hints.slot;
    const slotGuess: AudioSlot | "all_step_slots" =
      typeof hintSlot === "string" &&
      ["riddle", "anecdote", "landmark_history", "character"].includes(hintSlot)
        ? (hintSlot as AudioSlot)
        : "all_step_slots";

    const action: OperatorAction =
      actionType === "rectifyMissingAudio"
        ? {
            type: "rectifyMissingAudio",
            gameId: ctx.report.game_id,
            stepId: ctx.report.step_id,
            stepOrder: ctx.report.step_order,
            language,
            // For missing audio we MUST know which slot; if classifier
            // didn't tell us, default to "riddle" (most common report).
            slot: slotGuess === "all_step_slots" ? "riddle" : slotGuess,
          }
        : {
            type: "rectifyAudioTextMismatch",
            gameId: ctx.report.game_id,
            stepId: ctx.report.step_id,
            stepOrder: ctx.report.step_order,
            language,
            slot: slotGuess,
          };

    const rectifyResultRaw = await step.run("apply-rectifier", async () => {
      return applyAction(action, { incidentId });
    });
    const rectifyResult = rectifyResultRaw as Awaited<ReturnType<typeof applyAction>>;

    // ── Step 6 : Update incident + error_report status ─────────────
    await step.run("finalize-incident", async () => {
      const supabase = createAdminClient();
      const newResolution = rectifyResult.applied ? "auto_rectified" : "pending";
      const operatorActions = rectifyResult.applied
        ? [{ type: action.type, language, slot: slotGuess, ...rectifyResult.detail }]
        : [];
      await supabase
        .from("pipeline_incidents")
        .update({
          resolution: newResolution,
          operator_actions: operatorActions,
          resolved_at: rectifyResult.applied ? new Date().toISOString() : null,
        })
        .eq("id", incidentId);

      if (rectifyResult.applied) {
        await supabase
          .from("error_reports")
          .update({
            status: "fixed",
            admin_notes: `Auto-rectified by Sprint 6.1 (${action.type}, log=${rectifyResult.rectification_log_id ?? "n/a"})`,
          })
          .eq("id", ctx.report.id);
      }
    });

    logger.info(
      `[classifyAndRectify] ✅ Done report=${reportId} incident=${incidentId} applied=${rectifyResult.applied}` +
        (rectifyResult.applied
          ? ` action=${rectifyResult.action_type}`
          : ` reason="${rectifyResult.reason}"`),
    );

    return {
      reportId,
      incidentId,
      category: classification.category,
      confidence: classification.confidence,
      decision: rectifyResult.applied ? "auto_rectified" : "admin_queue_after_rectify_failed",
      rectifyResult,
    };
  },
);
