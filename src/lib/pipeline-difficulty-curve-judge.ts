/**
 * Riddle difficulty curve judge (Sprint E, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — progressive challenge, peak at climax
 * ═══════════════════════════════════════════════════════════════════
 *
 * Closes Questo grievance #1 from the 22/05/2026 audit :
 *   "Simplicité excessive des mécanismes de résolution : énigmes
 *    s'apparentent à des jeux de réflexion élémentaires"
 *
 * AND prevents the inverse failure (random spike of hard riddle in
 * act 1 that frustrates players before they're invested).
 *
 * The pipeline carries a GAME-WIDE difficulty (1-5) chosen by
 * OddballTrip at creation, but does not currently assess or shape
 * the PER-STOP difficulty curve. F1-grade games follow a clear
 * progression : easy/medium for warm-up, hardest at climax, slight
 * drop at resolution. Anything else breaks pacing.
 *
 * This judge scores each riddle's intrinsic difficulty 1-10 and
 * verifies the curve :
 *
 *   - Stop 1     : 2-4   (warm-up, low cognitive load)
 *   - Act 2      : 3-7   (escalating, no big spikes)
 *   - Climax     : 6-9   (hardest, must be the peak)
 *   - Resolution : 4-7   (relax slightly, payoff over puzzle)
 *
 * Verdict :
 *   - pass : curve respects min/max per position AND climax is the
 *           hardest (or tied for hardest)
 *   - weak : minor deviations (one stop ±2 outside its band)
 *   - fail : climax not the hardest, or act 1 stop > 5, or any stop = 10
 *           (too hard) or = 1 (insultingly trivial)
 *
 * Cost : ~$0.006 per game (one Haiku call).
 *
 * Note : per-stop difficulty is judged INTRINSICALLY (independent of
 * the GAME-WIDE difficulty rating). A "casual / 2/5" game still needs
 * a curve, just with lower absolute values. The judge ALSO returns
 * an `aligned_with_game_difficulty` boolean so the operator knows if
 * the absolute level matches what was sold.
 */
import Anthropic from "@anthropic-ai/sdk";

export type DifficultyVerdict = "pass" | "weak" | "fail";

export type CurvePosition =
  | "warmup" // stop 1
  | "rising" // act 2
  | "climax" // stop N-1
  | "resolution"; // stop N

export interface RiddleDifficulty {
  step_order: number;
  landmark_name: string;
  expected_band: CurvePosition;
  expected_range: [number, number]; // e.g. [2, 4] for warmup
  difficulty_score: number; // 0..10
  reasoning: string;
  in_range: boolean;
}

export interface DifficultyJudgeResult {
  stops: RiddleDifficulty[];
  climax_is_peak: boolean; // true iff climax stop has max score
  average_score: number;
  game_difficulty_match: number; // 0..10 alignment with template.difficulty (1-5 scale)
  verdict: DifficultyVerdict;
  summary: string;
  needs_review_reason: string;
}

export interface DifficultyJudgeInput {
  theme: string;
  /** Game-wide difficulty 1-5 chosen at creation. */
  gameDifficulty: number;
  stops: Array<{
    step_order: number;
    landmark_name: string;
    title: string;
    riddle_text: string;
    answer: string;
    hint_count: number;
  }>;
}

function expectedBandFor(
  stepOrder: number,
  totalStops: number,
): { band: CurvePosition; range: [number, number] } {
  if (stepOrder === 1) return { band: "warmup", range: [2, 4] };
  if (stepOrder === totalStops - 1) return { band: "climax", range: [6, 9] };
  if (stepOrder === totalStops) return { band: "resolution", range: [4, 7] };
  return { band: "rising", range: [3, 7] };
}

const SYSTEM_PROMPT = `You are the PACING judge for outdoor escape-games.

Your job : score the INTRINSIC difficulty of each riddle (independent
of game-wide difficulty setting) on a 0-10 scale, and assess whether
the curve respects the standard pacing arc.

═══════════════════════════════════════════════════════════
DIFFICULTY SCALE (per-riddle, 0-10)
═══════════════════════════════════════════════════════════

  0   Insultingly trivial. Single-word lookup. "What is the name of
      this cathedral ?" with the answer in the riddle title.
  1-2 Very easy : single observation, no logical step. "Count the
      towers" (3). "Look for the year 1789" (1789).
  3-4 Easy : one-step deduction. "What year is half of 3576 ?" (1788).
      "Combine the first letters of these statues."
  5-6 Medium : two-step deduction OR requires recognizing a thematic
      cue. "The watchman writes 'the year of the white rose' — what
      year ?" (player needs to connect rose symbol → known year).
  7-8 Hard : multi-step reasoning, requires synthesizing prior stops,
      cryptic clue requiring genre knowledge.
  9   Very hard : combines multiple cryptic clues, anagram + symbol +
      callback. Player will need ≥ 2 hints.
  10  Bordering unfair. Avoid this — players give up.

═══════════════════════════════════════════════════════════
PACING ARC (expected per stop position)
═══════════════════════════════════════════════════════════

  Stop 1 (warm-up)        : target 2-4  (welcome the player gently)
  Mid-game (rising)       : target 3-7  (escalating)
  Stop N-1 (climax)       : target 6-9  (hardest moment, peak emotion)
  Stop N (resolution)     : target 4-7  (payoff > puzzle ; relax slightly)

═══════════════════════════════════════════════════════════
SCORING RULES
═══════════════════════════════════════════════════════════

  - Score the RIDDLE itself, not the answer mechanism. The AR overlay
    revealing the answer doesn't change intrinsic riddle difficulty.

  - hint_count is a SIGNAL (higher = harder). Use it as one input.

  - Climax stop : DOUBLE-CHECK. The climax should be intrinsically
    THE HARDEST stop. If a mid-game stop is harder, that's a curve
    failure (peak misplaced).

  - Stop 1 : DOUBLE-CHECK. Must NOT exceed 5 — players give up if the
    first riddle frustrates them before they're invested.

  - Alignment with game-wide difficulty :
      gameDifficulty 1 (casual) : average should be ≤ 4
      gameDifficulty 2          : average should be 3-5
      gameDifficulty 3 (mid)    : average should be 4-6
      gameDifficulty 4          : average should be 5-7
      gameDifficulty 5 (hard)   : average should be 6-8

OUTPUT : strict JSON, no markdown.
{
  "stops": [
    {
      "step_order": <int>,
      "landmark_name": "<name>",
      "expected_band": "warmup" | "rising" | "climax" | "resolution",
      "expected_range": [<min>, <max>],
      "difficulty_score": <0..10>,
      "reasoning": "<one sentence why this score>",
      "in_range": <bool — true iff score is within expected_range>
    },
    ...
  ],
  "climax_is_peak": <bool — true iff climax stop's score is max of all stops>,
  "average_score": <number, 2 decimals>,
  "game_difficulty_match": <0..10 alignment with gameDifficulty input>,
  "verdict": "pass" | "weak" | "fail",
  "summary": "<2-3 sentences>"
}

VERDICT RULES (compute yourself) :
  - "pass" : ALL stops in_range AND climax_is_peak AND game_difficulty_match >= 6
  - "weak" : <= 2 stops out_of_range AND climax_is_peak (or climax is within 1 of peak)
  - "fail" : climax_is_peak = false OR stop 1 score > 5 OR any score = 10 OR > 2 stops out_of_range`;

function buildUserPrompt(input: DifficultyJudgeInput): string {
  const total = input.stops.length;
  const stopsBlock = input.stops
    .map((s) => {
      const exp = expectedBandFor(s.step_order, total);
      return `Stop ${s.step_order}/${total} (expected: ${exp.band}, range ${exp.range[0]}-${exp.range[1]}) — ${s.landmark_name}
TITLE: ${s.title}
RIDDLE: ${s.riddle_text.slice(0, 700)}
EXPECTED ANSWER: ${s.answer}
HINT COUNT: ${s.hint_count}`;
    })
    .join("\n\n──────────────\n\n");

  return `GAME THEME : "${input.theme}"
GAME-WIDE DIFFICULTY (chosen by operator) : ${input.gameDifficulty}/5

RIDDLES TO JUDGE (${input.stops.length}) :

${stopsBlock}

Score each riddle's intrinsic difficulty and verify the pacing curve. Return JSON only.`;
}

export async function judgeRiddleDifficultyCurve(
  input: DifficultyJudgeInput,
): Promise<DifficultyJudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2400,
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
      `Difficulty judge returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }

  const p = parsed as Record<string, unknown>;
  const stopsRaw = Array.isArray(p.stops) ? p.stops : [];
  const total = input.stops.length;
  const stops: RiddleDifficulty[] = stopsRaw.map((s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const stepOrder = typeof o.step_order === "number" ? o.step_order : 0;
    const exp = expectedBandFor(stepOrder, total);
    const score = Math.max(
      0,
      Math.min(
        10,
        typeof o.difficulty_score === "number" ? o.difficulty_score : 0,
      ),
    );
    return {
      step_order: stepOrder,
      landmark_name:
        typeof o.landmark_name === "string" ? o.landmark_name : "",
      expected_band: exp.band,
      expected_range: exp.range,
      difficulty_score: score,
      reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
      in_range: score >= exp.range[0] && score <= exp.range[1],
    };
  });

  const scores = stops.map((s) => s.difficulty_score);
  const average =
    scores.length > 0 ? scores.reduce((a, v) => a + v, 0) / scores.length : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const climaxStop = stops.find((s) => s.step_order === total - 1);
  const climaxIsPeak =
    climaxStop !== undefined && climaxStop.difficulty_score >= maxScore;
  const gameDifficultyMatch =
    typeof p.game_difficulty_match === "number"
      ? Math.max(0, Math.min(10, p.game_difficulty_match))
      : 5;

  const stop1Score = stops.find((s) => s.step_order === 1)?.difficulty_score ?? 0;
  const anyTen = scores.some((s) => s === 10);
  const outOfRangeCount = stops.filter((s) => !s.in_range).length;

  let verdict: DifficultyVerdict;
  if (
    outOfRangeCount === 0 &&
    climaxIsPeak &&
    gameDifficultyMatch >= 6 &&
    stop1Score <= 5 &&
    !anyTen
  ) {
    verdict = "pass";
  } else if (
    outOfRangeCount <= 2 &&
    (climaxIsPeak ||
      (climaxStop !== undefined && climaxStop.difficulty_score >= maxScore - 1))
  ) {
    verdict = "weak";
  } else {
    verdict = "fail";
  }

  if (!climaxIsPeak || stop1Score > 5 || anyTen || outOfRangeCount > 2) {
    verdict = "fail";
  }

  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `Difficulty judge: avg=${average.toFixed(2)}, climax_peak=${climaxIsPeak}, out_of_range=${outOfRangeCount}, verdict=${verdict}`;

  const issues: string[] = [];
  if (!climaxIsPeak)
    issues.push(
      `climax stop ${total - 1} is not the hardest (${climaxStop?.difficulty_score}/10 vs max ${maxScore})`,
    );
  if (stop1Score > 5) issues.push(`stop 1 too hard (${stop1Score}/10, max 5)`);
  if (anyTen)
    issues.push(`one or more riddles rated 10/10 (unfair — players give up)`);
  if (gameDifficultyMatch < 6)
    issues.push(
      `intrinsic difficulty doesn't match game-wide setting ${input.gameDifficulty}/5 (alignment ${gameDifficultyMatch}/10)`,
    );
  const outOfRangeStops = stops.filter((s) => !s.in_range);
  if (outOfRangeStops.length > 0)
    issues.push(
      `${outOfRangeStops.length} stop(s) out-of-range : ${outOfRangeStops.map((s) => `Step ${s.step_order} (${s.difficulty_score}/10, expected ${s.expected_range[0]}-${s.expected_range[1]})`).join("; ")}`,
    );

  const reason =
    verdict === "pass"
      ? ""
      : `[DIFFICULTY_${verdict.toUpperCase()}] avg=${average.toFixed(2)}, climax_peak=${climaxIsPeak}, game_difficulty_match=${gameDifficultyMatch}/10. Issues : ${issues.join(" ; ")}. Operator should rewrite stop riddles to respect the warmup → rising → climax → resolution curve.`;

  return {
    stops,
    climax_is_peak: climaxIsPeak,
    average_score: Number(average.toFixed(2)),
    game_difficulty_match: gameDifficultyMatch,
    verdict,
    summary,
    needs_review_reason: reason,
  };
}
