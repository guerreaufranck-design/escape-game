/**
 * Thematic-fit judge (Sprint 6.2bis, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — POST-INCIDENT Aigues-Mortes 22/05/2026
 * ═══════════════════════════════════════════════════════════════════
 *
 * The pipeline produced a game where 7/7 stops were aquariums and
 * unrelated Montpellier museums on a "1572 Huguenot prophecy" theme.
 * Every existing safety net (cluster centroid, gps_out_of_cluster,
 * sources_thin, quality_score phase1b) returned green because none of
 * them measure SEMANTIC RELEVANCE of stops to the theme.
 *
 * This module fills that gap : after Phase 1b completes (stops
 * selected), we call Claude Haiku as a strict thematic-fit JUDGE.
 * Claude scores each stop 0-10 on its connection to the theme and
 * returns an overall verdict (pass / weak / fail).
 *
 * When verdict is "fail" or "weak", the pipeline FORCES
 * `needs_review=true` with a structured `review_reason` so the
 * sanity-check email reaches the operator BEFORE the activation code
 * is released to the client.
 *
 * Cost : ~$0.005 per game (single Haiku call covers 7-8 stops + game-
 * level fields). Negligible vs the cost of shipping a broken game
 * (refund + customer relationship damage).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Calibration — what scores mean
 * ═══════════════════════════════════════════════════════════════════
 *
 *  10  Stop is THE iconic landmark for this theme (Tour de Constance
 *      for "Huguenot prison", Notre-Dame de Paris for "Catholic Paris")
 *  7-9 Direct, documented connection to the theme (same person /
 *      event / era / place mentioned in the themeDescription)
 *  4-6 Partial connection (right region or era, but theme link is
 *      atmospheric rather than specific)
 *  1-3 Tenuous (right area but theme connection is weak — could be in
 *      any game about that city)
 *  0   No thematic connection (wrong era, wrong topic, wrong region)
 *
 * Verdict thresholds :
 *   - pass : avg ≥ 6.5 AND no individual stop < 3
 *   - weak : avg ≥ 5.0 (operator review recommended)
 *   - fail : avg < 5.0 OR any stop = 0 (block publish)
 */
import Anthropic from "@anthropic-ai/sdk";

export type ThematicVerdict = "pass" | "weak" | "fail";

export interface StopScore {
  step_order: number;
  name: string;
  fit_score: number; // 0..10
  reasoning: string; // 1 sentence
}

export interface ThematicJudgeResult {
  stops: StopScore[];
  average_score: number;
  min_score: number;
  verdict: ThematicVerdict;
  summary: string;
  /** Auto-derived needs_review_reason when verdict != pass. Empty otherwise. */
  needs_review_reason: string;
}

export interface JudgeInput {
  theme: string;
  themeDescription: string;
  /** Optional narrative provided by OddballTrip — gives extra context. */
  narrative?: string;
  /** City context — helps the judge accept regional fit for borderline cases. */
  city: string;
  /** Stops to evaluate. Provide name + a short description (landmark_history
   *  or anecdote works well). step_order required so the operator can
   *  identify which stop failed. */
  stops: Array<{
    step_order: number;
    name: string;
    description?: string;
  }>;
}

const SYSTEM_PROMPT = `You are a STRICT thematic-fit judge for outdoor escape-game stops.

Your job : given a game's theme + description, rate how well each proposed
stop fits the theme, on a 0-10 scale.

SCORING SCALE (be calibrated, not generous) :
  10  Stop is THE iconic landmark for this theme
       (Tour de Constance for "Huguenot prison")
  7-9 Direct, documented connection to the theme
       (same person, event, era, place explicitly tied to themeDescription)
  4-6 Partial connection — right region or era, but link is atmospheric
       rather than specific (a square central to the era's life, a building
       from the right century but not tied to the specific event)
  1-3 Tenuous — right area but theme link is weak (could be in any game
       about that city, no specific tie to the theme's narrative)
  0   No thematic connection (wrong era / wrong topic / wrong region /
       generic tourist attraction unrelated to the theme)

CALIBRATION REMINDERS (lean strict, not generous) :
- An aquarium has score 0 for ANY historical theme.
- A modern art museum has score 0 for ANY pre-1900 historical theme.
- A church from the wrong century scores 2-3 (right type, wrong era).
- A landmark from the right era but no specific link to the theme scores 4-5.
- A landmark documented in academic sources as tied to the theme scores 7-9.
- THE landmark inseparable from the theme's main protagonist scores 10.

OUTPUT : strict JSON, no markdown, no commentary.
{
  "stops": [
    { "step_order": 1, "name": "<name>", "fit_score": <0..10>, "reasoning": "<one sentence justifying the score>" },
    ...
  ],
  "average_score": <number, 2 decimals>,
  "min_score": <number>,
  "verdict": "pass" | "weak" | "fail",
  "summary": "<2-3 sentences explaining overall fit>"
}

VERDICT RULES (compute yourself, don't deviate) :
  - "pass" : average_score >= 6.5 AND min_score >= 3
  - "weak" : average_score >= 5.0 AND min_score >= 1
  - "fail" : average_score < 5.0 OR min_score = 0`;

function buildUserPrompt(input: JudgeInput): string {
  const stopsBlock = input.stops
    .map(
      (s) =>
        `${s.step_order}. ${s.name}${s.description ? ` — ${s.description.slice(0, 300)}` : ""}`,
    )
    .join("\n");
  return `GAME THEME : "${input.theme}"
THEME DESCRIPTION : ${input.themeDescription}
${input.narrative ? `NARRATIVE CONTEXT : ${input.narrative.slice(0, 600)}\n` : ""}CITY CONTEXT : ${input.city}

PROPOSED STOPS (${input.stops.length}) :
${stopsBlock}

Score each stop strictly. Return JSON only.`;
}

/**
 * Judge the thematic fit of a stops list against a theme.
 *
 * Throws if the Anthropic API call fails or returns non-JSON. Caller
 * (build-game.ts orchestrator) catches and falls back to "verdict=weak
 * — judge unavailable" rather than blocking publish on infra failure.
 */
export async function judgeThematicRelevance(
  input: JudgeInput,
): Promise<ThematicJudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

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
      `Thematic judge returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }

  const p = parsed as Record<string, unknown>;
  const stopsRaw = Array.isArray(p.stops) ? p.stops : [];
  const stops: StopScore[] = stopsRaw.map((s: unknown) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return {
      step_order: typeof r.step_order === "number" ? r.step_order : 0,
      name: typeof r.name === "string" ? r.name : "",
      fit_score: Math.max(
        0,
        Math.min(10, typeof r.fit_score === "number" ? r.fit_score : 0),
      ),
      reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    };
  });

  // Recompute average + min ourselves to avoid trust issues with the model
  const scores = stops.map((s) => s.fit_score);
  const average =
    scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const min = scores.length > 0 ? Math.min(...scores) : 0;

  // Recompute verdict ourselves (model verdict is double-check)
  let verdict: ThematicVerdict;
  if (average >= 6.5 && min >= 3) verdict = "pass";
  else if (average >= 5.0 && min >= 1) verdict = "weak";
  else verdict = "fail";

  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `Thematic judge: avg=${average.toFixed(2)}, min=${min}, verdict=${verdict}`;

  // Build the needs_review_reason string the build-game orchestrator
  // will write to games.review_reason when verdict != pass.
  const failingStops = stops.filter((s) => s.fit_score < 4);
  const reason =
    verdict === "pass"
      ? ""
      : `[THEMATIC_${verdict.toUpperCase()}] avg_fit=${average.toFixed(2)}, min_fit=${min}, ${failingStops.length}/${stops.length} stops scored < 4 thematic-fit. Failing stops : ${failingStops
          .map(
            (s) =>
              `Step ${s.step_order} "${s.name}" (${s.fit_score}/10 — ${s.reasoning.slice(0, 100)})`,
          )
          .join(" ; ")}. Operator must inspect before code release.`;

  return {
    stops,
    average_score: Number(average.toFixed(2)),
    min_score: min,
    verdict,
    summary,
    needs_review_reason: reason,
  };
}
