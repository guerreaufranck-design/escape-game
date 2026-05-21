/**
 * Error report classifier (Sprint 6.1, 2026-05-21).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose
 * ═══════════════════════════════════════════════════════════════════
 *
 * Player-submitted error reports arrive as FREE-FORM text in the
 * `error_reports` table. Before we can route them to an auto-rectifier
 * or admin queue, we need a STRUCTURED category + confidence score.
 *
 * We use Claude to read the message + step context and assign one of
 * the ~12 predefined categories. The classifier output is the input
 * for the auto-rectifier router (lib/auto-rectify-actions.ts).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Why LLM and not keyword matching ?
 * ═══════════════════════════════════════════════════════════════════
 *
 * Players write in 3+ languages with typos, slang, partial English,
 * voice-to-text artifacts. A keyword classifier would catch ~30% of
 * cases. Claude with grounded context catches ~85% reliably with a
 * confidence score we can threshold.
 *
 * Cost : 1 Haiku-tier call per report ≈ $0.003. For 100 reports/month
 * that's $0.30. Negligible.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Categories — the typed output space
 * ═══════════════════════════════════════════════════════════════════
 *
 * Each category maps to an auto-rectifier (or "admin only") in
 * lib/auto-rectify-actions.ts. When adding a new category here, also
 * update the rectifier router.
 */

import Anthropic from "@anthropic-ai/sdk";

export type ErrorCategory =
  // Geo problems
  | "wrong_gps"               // "Je suis au bon endroit mais le radar dit que je suis loin"
  | "cannot_find_landmark"    // "Je suis au point GPS mais je ne vois pas le château"
  // Content/audio problems
  | "audio_text_mismatch"     // "L'audio dit X mais l'écran affiche Y"
  | "missing_audio"           // "L'audio ne joue pas"
  | "translation_error"       // "Le texte français contient des fautes / mots non traduits"
  // Gameplay problems
  | "wrong_answer_rejected"   // "Ma bonne réponse n'est pas acceptée"
  | "wrong_answer_accepted"   // "J'ai entré n'importe quoi et c'est validé"
  | "ar_overlay_broken"       // "La caméra AR ne montre pas la réponse"
  | "riddle_too_hard_or_unclear" // "Énigme incompréhensible / besoin de plus de hints"
  // Content quality
  | "factual_error"           // "Date / nom historique incorrect"
  | "narrative_inconsistency" // "L'intro mentionne un personnage qui n'apparaît pas"
  // Catch-all
  | "other";

/**
 * One auto-rectifier per category. Filled in `auto-rectify-actions.ts`.
 * Listed here so the type is documented alongside the categories.
 */
export const CATEGORY_AUTORECTIFIABLE: Record<ErrorCategory, "auto" | "admin"> = {
  wrong_gps: "auto",                  // with quorum + Nominatim cross-check
  cannot_find_landmark: "auto",       // extend validation_radius
  audio_text_mismatch: "auto",        // regen audio (reversible)
  missing_audio: "auto",              // regen audio
  translation_error: "auto",          // re-trigger Gemini translate
  wrong_answer_rejected: "auto",      // add accepted variant (Sprint 6.4)
  wrong_answer_accepted: "admin",     // requires expert review
  ar_overlay_broken: "admin",         // typically device-specific
  riddle_too_hard_or_unclear: "auto", // generate +1 hint (Sprint 6.4)
  factual_error: "admin",             // never auto-edit factual content
  narrative_inconsistency: "admin",   // complex multi-step rewrite needed
  other: "admin",
};

export interface ClassifyResult {
  category: ErrorCategory;
  confidence: number;        // [0..1]
  evidence: string;          // short quote from the message
  actionable: boolean;       // false = report too vague to act on
  reasoning: string;         // 1-sentence rationale
  /** Suggested narrow context that helps the auto-rectifier. E.g. for
   *  "wrong_gps", might include the player's guessed correct location. */
  hints: Record<string, string | number>;
}

export interface StepContext {
  landmark_name: string;
  latitude: number;
  longitude: number;
  answer_text: string;
  step_order: number | null;
  city: string;
}

const SYSTEM_PROMPT = `You are an error report classifier for an outdoor escape game (PWA + AR).
Players submit free-form reports via an in-game button. Your job is to map
each report to ONE typed category from the list below, with a confidence
score and short evidence quote.

Be strict : if the message is too vague to act on (e.g. "ça marche pas"),
set actionable=false and category="other".

Categories (pick exactly one) :
- wrong_gps : player at the right physical place but radar says wrong / arrow points wrong
- cannot_find_landmark : at GPS point but doesn't see the landmark / can't identify it
- audio_text_mismatch : audio narration doesn't match what's on screen
- missing_audio : audio doesn't play / silent
- translation_error : grammar/typo/untranslated text in their language
- wrong_answer_rejected : player swears their answer was correct but app refused
- wrong_answer_accepted : player typed nonsense and app validated
- ar_overlay_broken : AR camera doesn't reveal the magic word / breaks
- riddle_too_hard_or_unclear : riddle text is confusing or needs more hints
- factual_error : historical date / name / fact is wrong
- narrative_inconsistency : story characters/events don't line up
- other : anything else (vague, off-topic, multi-issue)

Return ONLY a strict JSON object, no markdown, no commentary, with this shape :
{
  "category": "wrong_gps",
  "confidence": 0.85,
  "evidence": "le radar dit que je suis a 60m alors que je suis devant",
  "actionable": true,
  "reasoning": "Player describes a clear GPS-vs-physical mismatch at the step",
  "hints": { "suggested_action": "verify GPS coords against Nominatim" }
}`;

const USER_PROMPT_TEMPLATE = (report: string, ctx: StepContext) =>
  `PLAYER REPORT (free text, possibly mixed language) :
"""
${report}
"""

CONTEXT for the step the player was on (if known) :
- Landmark name : "${ctx.landmark_name || "(unknown)"}"
- Stop order : ${ctx.step_order ?? "(unknown)"}
- City : ${ctx.city}
- GPS in DB : (${ctx.latitude}, ${ctx.longitude})
- Correct answer : "${ctx.answer_text || "(none)"}"

Classify the report. Return strict JSON.`;

/**
 * Classify one error report.
 *
 * Throws if the Anthropic API call fails or returns non-JSON. Caller
 * (Inngest function) catches and marks the incident as "needs admin
 * triage — classifier failed".
 */
export async function classifyErrorReport(
  reportMessage: string,
  stepContext: StepContext,
): Promise<ClassifyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const client = new Anthropic({ apiKey });

  // Use Haiku for cost — we just need a JSON classification, not deep
  // reasoning. ~$0.003 per call.
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: USER_PROMPT_TEMPLATE(reportMessage, stepContext) },
    ],
  });

  // Concatenate all text blocks (Anthropic returns content as an array)
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip any accidental code-fence markdown the model added despite
  // instructions ("```json\n...\n```"). Robust to variations.
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Classifier returned non-JSON (${err instanceof Error ? err.message : err}) : ${text.slice(0, 200)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Classifier returned non-object: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  const p = parsed as Record<string, unknown>;
  const category = (p.category as ErrorCategory) ?? "other";
  const confidence = typeof p.confidence === "number"
    ? Math.max(0, Math.min(1, p.confidence))
    : 0;
  const evidence = typeof p.evidence === "string" ? p.evidence : "";
  const actionable = p.actionable !== false; // default true if missing
  const reasoning = typeof p.reasoning === "string" ? p.reasoning : "";
  const hints = (p.hints && typeof p.hints === "object")
    ? (p.hints as Record<string, string | number>)
    : {};

  // Sanity : if category isn't in our enum, downgrade to "other".
  const validCategories = Object.keys(CATEGORY_AUTORECTIFIABLE) as ErrorCategory[];
  const finalCategory = validCategories.includes(category) ? category : "other";

  console.log(
    `[errorReportClassifier] "${reportMessage.slice(0, 60)}..." → ${finalCategory} (confidence=${confidence.toFixed(2)}, actionable=${actionable})`,
  );

  return {
    category: finalCategory,
    confidence,
    evidence,
    actionable,
    reasoning,
    hints,
  };
}
