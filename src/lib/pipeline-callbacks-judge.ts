/**
 * Cross-stop callback judge (Sprint C, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — players re-buy stories, not puzzle compilations
 * ═══════════════════════════════════════════════════════════════════
 *
 * Quote from the Questo audit (22/05) :
 *   "Rupture de la cohérence narrative : énigmes déconnectées du
 *    scénario, le prétexte de l'enquête s'efface."
 *
 * The single biggest player-retention lever for outdoor escape-games
 * is whether the player walks away saying "that was ONE story" vs
 * "that was 7 independent puzzles". The former gets recommended,
 * the latter gets a one-time purchase.
 *
 * `generateGameSteps` now includes RULE G in its prompt instructing
 * Claude to weave cross-stop callbacks (each stop 2..N references a
 * PRIOR stop's title / figure / object / sigil ; the final stop
 * weaves multiple threads). This judge VERIFIES Claude complied.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Scoring per stop
 * ═══════════════════════════════════════════════════════════════════
 *
 * Stops 2..N each scored 0..10 on `callback_score` :
 *   10  Strong callback : explicitly names a prior stop's title /
 *       distinctive figure / object, AND the reference advances the
 *       narrative (not just decorative)
 *   7-9 Clear callback : references prior stop by recognizable element
 *       but reference is decorative rather than plot-advancing
 *   4-6 Weak callback : vague reference ("earlier in your journey")
 *       that doesn't tie to a specific prior stop
 *   1-3 Hint of continuity : same character archetype or thematic
 *       reuse without explicit callback
 *   0   No callback : stop reads as fully standalone
 *
 * The FINAL stop is scored more strictly : must have ≥ 2 distinct
 * callbacks (avg of those callbacks must be ≥ 7).
 *
 * Verdict :
 *   - pass : avg ≥ 6 AND no stop ≤ 2 AND final stop ≥ 7
 *   - weak : avg ≥ 4 AND no stop = 0
 *   - fail : avg < 4 OR any stop = 0 OR final stop < 4
 *
 * Cost : ~$0.006 per game (Haiku, one call covers all stops).
 */
import Anthropic from "@anthropic-ai/sdk";

export type CallbackVerdict = "pass" | "weak" | "fail";

export interface CallbackScore {
  step_order: number;
  landmark_name: string;
  callback_score: number; // 0..10
  callbacks_found: string[]; // textual snippets identified as callbacks
  recommendation: string;
}

export interface CallbackJudgeResult {
  stops: CallbackScore[];
  average_score: number;
  min_score: number;
  final_stop_score: number;
  verdict: CallbackVerdict;
  summary: string;
  needs_review_reason: string;
}

export interface CallbackJudgeInput {
  theme: string;
  /** All stops including stop 1 (judged for context only, not callback-scored). */
  stops: Array<{
    step_order: number;
    landmark_name: string;
    title: string;
    riddle_text: string;
    anecdote: string;
  }>;
}

const SYSTEM_PROMPT = `You are the NARRATIVE-COHESION judge for outdoor escape-games.

Your job : verify that each stop (from #2 onwards) explicitly REFERENCES
prior stops, so the player feels they are following ONE STORY rather
than solving N independent puzzles.

WHAT COUNTS AS A CALLBACK :
  ✅ Naming a prior stop's title or a distinctive landmark from a prior
     stop ("as at the Cathédrale of Stop 1...", "back at the Tour
     Carbonnière you saw the carved cross — here it returns")
  ✅ Re-using a NAMED figure, object, or symbol from a prior stop
     ("the same Cathar sigil", "the watchman's whispered date")
  ✅ A character/voice continuing across stops ("the apprentice scribe
     whose journal you began at Stop 2 writes here :")
  ✅ Plot-advancement that depends on knowing prior stops

WHAT DOES NOT COUNT :
  ❌ Generic "earlier in your journey" without specific reference
  ❌ Same thematic atmosphere without explicit pointer
  ❌ Same difficulty progression / same protagonist archetype reused
     (that's variety, not continuity — different concept)
  ❌ Reference to the GAME THEME in general (theme is constant, not
     a callback to a prior stop)

═══════════════════════════════════════════════════════════
SCORING SCALE (0-10, higher = stronger callback presence)
═══════════════════════════════════════════════════════════

  10  Explicit, named callback that ADVANCES the narrative (not just
      decorative). Example : "The cross you uncovered at the Cathédrale
      (Stop 1) was the southern half ; here is its northern twin — the
      pair finally aligned reveals…"

  7-9 Clear named callback, decorative quality. Example : "Remember
      the date whispered at the Tour Carbonnière ? It returns here, no
      coincidence."

  4-6 Weak callback : vague reference ("as you've seen before") without
      naming the prior stop. Player isn't sure WHAT to recall.

  1-3 Trace : recurring theme/atmosphere only, no textual callback.

  0   No callback. Stop reads fully standalone.

═══════════════════════════════════════════════════════════
SPECIAL RULES
═══════════════════════════════════════════════════════════

  - Stop 1 : score 10 by convention (nothing to call back to). Skip.

  - Final stop (last in the list) : MUST have at least 2 distinct
    callbacks weaving earlier threads. If only 1 callback present
    on final stop, score cap = 6 even if quality is strong. If 0
    callbacks on final stop → score 0 (the climax NEEDS the threads).

  - Don't let strong THEMATIC writing inflate the score. Theme work
    is separate from callbacks. A stop can have brilliant Cathar
    historical writing but ZERO callback → score 0.

OUTPUT : strict JSON, no markdown.
{
  "stops": [
    {
      "step_order": 1,
      "landmark_name": "<name>",
      "callback_score": 10,
      "callbacks_found": [],
      "recommendation": "first stop, no callback needed"
    },
    {
      "step_order": 2,
      "landmark_name": "<name>",
      "callback_score": <0..10>,
      "callbacks_found": ["<short snippet from the riddle/anecdote that IS a callback>", ...],
      "recommendation": "<one short sentence>"
    },
    ...
  ],
  "average_score": <average of step_order >= 2 scores, 2 decimals>,
  "min_score": <min of step_order >= 2 scores>,
  "final_stop_score": <score of the last stop>,
  "verdict": "pass" | "weak" | "fail",
  "summary": "<2-3 sentences>"
}

VERDICT RULES (compute yourself) :
  - "pass" : average_score >= 6 AND min_score >= 3 AND final_stop_score >= 7
  - "weak" : average_score >= 4 AND min_score >= 1
  - "fail" : average_score < 4 OR min_score = 0 OR final_stop_score < 4`;

function buildUserPrompt(input: CallbackJudgeInput): string {
  const stopsBlock = input.stops
    .map(
      (s) =>
        `Stop ${s.step_order} — ${s.landmark_name}
TITLE: ${s.title}
RIDDLE: ${s.riddle_text.slice(0, 800)}
ANECDOTE: ${s.anecdote.slice(0, 800)}`,
    )
    .join("\n\n──────────────\n\n");

  return `GAME THEME : "${input.theme}"

STOPS TO EVALUATE (${input.stops.length}) :

${stopsBlock}

Score each stop for cross-stop callbacks. Return JSON only.`;
}

export async function judgeCrossStopCallbacks(
  input: CallbackJudgeInput,
): Promise<CallbackJudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const client = new Anthropic({ apiKey });
  // Hard 30s timeout — see pipeline-landmark-proposer.ts.
  const msg = await client.messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 2400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    },
    { timeout: 30_000 },
  );

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Callbacks judge returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }

  const p = parsed as Record<string, unknown>;
  const stopsRaw = Array.isArray(p.stops) ? p.stops : [];
  const stops: CallbackScore[] = stopsRaw.map((s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const cbFound = Array.isArray(o.callbacks_found)
      ? (o.callbacks_found as unknown[]).filter(
          (c): c is string => typeof c === "string",
        )
      : [];
    return {
      step_order: typeof o.step_order === "number" ? o.step_order : 0,
      landmark_name:
        typeof o.landmark_name === "string" ? o.landmark_name : "",
      callback_score: Math.max(
        0,
        Math.min(
          10,
          typeof o.callback_score === "number" ? o.callback_score : 0,
        ),
      ),
      callbacks_found: cbFound,
      recommendation:
        typeof o.recommendation === "string" ? o.recommendation : "",
    };
  });

  // Compute metrics on stops 2..N (stop 1 doesn't have a callback target)
  const scorable = stops.filter((s) => s.step_order >= 2);
  const scoresList = scorable.map((s) => s.callback_score);
  const average =
    scoresList.length > 0
      ? scoresList.reduce((a, v) => a + v, 0) / scoresList.length
      : 0;
  const min = scoresList.length > 0 ? Math.min(...scoresList) : 0;
  const finalStop = stops[stops.length - 1];
  const finalStopScore = finalStop?.callback_score ?? 0;

  let verdict: CallbackVerdict;
  if (average >= 6 && min >= 3 && finalStopScore >= 7) verdict = "pass";
  else if (average >= 4 && min >= 1) verdict = "weak";
  else verdict = "fail";

  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `Callbacks judge: avg=${average.toFixed(2)}, min=${min}, final=${finalStopScore}, verdict=${verdict}`;

  const failingStops = scorable.filter((s) => s.callback_score < 4);
  const reason =
    verdict === "pass"
      ? ""
      : `[CALLBACKS_${verdict.toUpperCase()}] avg_callback_score=${average.toFixed(2)}, min=${min}, final=${finalStopScore}, ${failingStops.length}/${scorable.length} stops lack callbacks. Failing : ${failingStops
          .map(
            (s) =>
              `Step ${s.step_order} "${s.landmark_name}" (${s.callback_score}/10 — ${s.recommendation.slice(0, 120)})`,
          )
          .join(" ; ")}. Operator should rewrite to weave references to prior stops.`;

  return {
    stops,
    average_score: Number(average.toFixed(2)),
    min_score: min,
    final_stop_score: finalStopScore,
    verdict,
    summary,
    needs_review_reason: reason,
  };
}
