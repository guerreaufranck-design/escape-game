/**
 * Narrative arc judge (Sprint D, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — dramaturgical structure beats puzzle compilation
 * ═══════════════════════════════════════════════════════════════════
 *
 * Closes Questo grievance #5 from the 22/05/2026 audit :
 *   "Concentration artificielle des indices en fin de parcours :
 *    dénouement abrupt où l'application délivre l'ensemble des
 *    pièces à conviction sous forme de dossier documentaire massif
 *    à la dernière étape, rendant vains les efforts d'analyse menés
 *    durant le trajet."
 *
 * The pipeline currently generates `stopCount` riddles + game-wide
 * intro/epilogue, but does NOT explicitly model an Act 1 / Act 2 /
 * climax / resolution structure. Result : stops feel monotonic, the
 * payoff (final riddle + epilogue) can land flat because the build-up
 * wasn't structured.
 *
 * This judge maps stops to dramaturgical positions and verifies the
 * arc actually CRESCENDOS :
 *
 *   Act 1 — Exposition (stops 1..floor(N×0.3))
 *     Establish world + premise + hook. Player feels invited in.
 *
 *   Act 2 — Rising action (stops floor(N×0.3)+1 .. N-2)
 *     Revelations, complications, new information that re-frames
 *     what was set up. Stakes raise. Player feels pulled along.
 *
 *   Climax — Penultimate stop (stop N-1)
 *     Big reveal, dramatic high. The "moment of truth" of the
 *     narrative. Tension peaks here.
 *
 *   Act 3 — Resolution (stop N)
 *     Payoff. Threads tie. Final riddle (game-wide block) is the
 *     direct consequence of the climax reveal.
 *
 * Each stop scored 0-10 on `arc_fit_score` : does its content
 * match its expected dramaturgical role ?
 *
 * Verdict :
 *   - pass : avg ≥ 6 AND climax_score ≥ 7 (penultimate must really climax)
 *   - weak : avg ≥ 4 AND climax_score ≥ 4
 *   - fail : avg < 4 OR climax_score < 4 OR final_score < 3
 *
 * Cost : ~$0.006 per game.
 *
 * Why penultimate stop = climax (not last) : the LAST stop is the
 * resolution. The CLIMAX (max dramatic tension) should occur right
 * before the resolution. This is the standard 3-act movie structure
 * and matches how players experience pacing.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ArcVerdict = "pass" | "weak" | "fail";

export type ArcPosition =
  | "act1_exposition"
  | "act2_rising"
  | "climax"
  | "act3_resolution";

export interface StopArcScore {
  step_order: number;
  landmark_name: string;
  expected_position: ArcPosition;
  observed_role: string; // 1 sentence : what this stop actually does narratively
  arc_fit_score: number; // 0..10
  recommendation: string;
}

export interface ArcJudgeResult {
  stops: StopArcScore[];
  average_score: number;
  climax_score: number;
  final_score: number;
  verdict: ArcVerdict;
  summary: string;
  needs_review_reason: string;
}

export interface ArcJudgeInput {
  theme: string;
  narrative: string;
  stops: Array<{
    step_order: number;
    landmark_name: string;
    title: string;
    riddle_text: string;
    anecdote: string;
  }>;
  /** Game-wide final riddle from Phase 2b — if present, climax should
   *  set it up. */
  finalRiddle?: string;
}

/**
 * Map stop index → expected dramaturgical position.
 * Standard 3-act structure with climax on N-1, resolution on N.
 *
 * Examples (1-indexed) :
 *   N=8 : 1,2 act1 / 3,4,5,6 act2 / 7 climax / 8 resolution
 *   N=7 : 1,2 act1 / 3,4,5 act2 / 6 climax / 7 resolution
 *   N=6 : 1,2 act1 / 3,4 act2 / 5 climax / 6 resolution
 *   N=5 : 1 act1 / 2,3 act2 / 4 climax / 5 resolution
 *   N=4 : 1 act1 / 2 act2 / 3 climax / 4 resolution
 */
export function expectedArcPosition(
  stepOrder: number,
  totalStops: number,
): ArcPosition {
  if (stepOrder === totalStops) return "act3_resolution";
  if (stepOrder === totalStops - 1) return "climax";
  const act1End = Math.max(1, Math.floor(totalStops * 0.3));
  if (stepOrder <= act1End) return "act1_exposition";
  return "act2_rising";
}

const SYSTEM_PROMPT = `You are the DRAMATURGY judge for outdoor escape-games.

Your job : map each stop to its expected position in a 3-act narrative
arc + climax + resolution, and verify the content actually delivers
that beat.

═══════════════════════════════════════════════════════════
THE 3-ACT + CLIMAX STRUCTURE (standard movie pacing)
═══════════════════════════════════════════════════════════

  ACT 1 — EXPOSITION (first ~30% of stops)
    Establish : the world (period, place, atmosphere), the premise
    (what mystery / quest), the hook (why should the player care).
    Tone : invitation, intrigue, atmospheric setup.
    SHOULD : introduce a question, character, or symbol.
    SHOULD NOT : deliver the main twist already.

  ACT 2 — RISING ACTION (middle ~50% of stops)
    Build : reveal new information, raise stakes, complicate the
    premise. Each stop in act 2 should DEEPEN the mystery or shift
    what the player thought they knew.
    Tone : escalation, suspense.
    SHOULD : surprise OR complicate previous understanding.

  CLIMAX — PENULTIMATE stop
    Peak : the dramatic high. The biggest reveal, the most charged
    moment, the boss-fight equivalent. Tension maxes out here.
    Tone : revelation, confrontation, peak emotion.
    SHOULD : feel BIG. The player should think "oh wow".

  ACT 3 — RESOLUTION (last stop)
    Payoff : threads tie. Direct consequence of the climax. Sets up
    the GAME-WIDE final riddle if present.
    Tone : aftermath, reflection, closure (with one last twist OK).
    SHOULD : provide a sense of arrival.

═══════════════════════════════════════════════════════════
SCORING per stop (arc_fit_score 0-10)
═══════════════════════════════════════════════════════════

  10  Stop perfectly delivers its expected beat (e.g. climax stop
      genuinely climaxes — biggest revelation, peak tension)
  7-9 Strong match : the content fits the expected position well
  4-6 Mediocre : content is fine but doesn't ESCALATE relative to
      prior stops (e.g. an act 2 stop that just exposits more like
      act 1, or a climax stop that lands flat)
  1-3 Weak : the content actively works AGAINST the expected beat
      (e.g. an act 1 stop that already drops the main twist, or
      a climax stop that's lower-stakes than mid-game)
  0   The stop completely lacks dramaturgical role (pure info dump
      with no narrative purpose)

═══════════════════════════════════════════════════════════
SPECIAL RULES
═══════════════════════════════════════════════════════════

  - The CLIMAX (penultimate stop) is the MOST IMPORTANT. Score it
    strictly. If the climax doesn't feel like a climax, the whole
    game falls flat regardless of other stops.

  - If a stop INTRODUCES a major twist EARLIER than climax, that's
    a structural error (twist is now used up). Penalize.

  - If the FINAL stop's content doesn't reflect the climax revelation
    (i.e., resolution doesn't pay off the climax setup), penalize
    both : climax score capped at 6, resolution capped at 4.

OUTPUT : strict JSON, no markdown.
{
  "stops": [
    {
      "step_order": <int>,
      "landmark_name": "<name>",
      "expected_position": "act1_exposition" | "act2_rising" | "climax" | "act3_resolution",
      "observed_role": "<one sentence : what this stop actually does narratively>",
      "arc_fit_score": <0..10>,
      "recommendation": "<one sentence>"
    },
    ...
  ],
  "average_score": <number, 2 decimals>,
  "climax_score": <score of the climax stop (penultimate)>,
  "final_score": <score of the final stop>,
  "verdict": "pass" | "weak" | "fail",
  "summary": "<2-3 sentences explaining overall arc quality>"
}

VERDICT RULES (compute yourself) :
  - "pass" : average_score >= 6 AND climax_score >= 7
  - "weak" : average_score >= 4 AND climax_score >= 4
  - "fail" : average_score < 4 OR climax_score < 4 OR final_score < 3`;

function buildUserPrompt(input: ArcJudgeInput): string {
  const total = input.stops.length;
  const stopsBlock = input.stops
    .map((s) => {
      const pos = expectedArcPosition(s.step_order, total);
      return `Stop ${s.step_order}/${total} (expected: ${pos}) — ${s.landmark_name}
TITLE: ${s.title}
RIDDLE: ${s.riddle_text.slice(0, 600)}
ANECDOTE: ${s.anecdote.slice(0, 600)}`;
    })
    .join("\n\n──────────────\n\n");

  const finalRiddleBlock = input.finalRiddle
    ? `\n\nGAME-WIDE FINAL RIDDLE (delivered after the resolution stop) :\n${input.finalRiddle.slice(0, 800)}`
    : "";

  return `GAME THEME : "${input.theme}"
NARRATIVE PREMISE : ${input.narrative.slice(0, 500)}

STOPS TO EVALUATE (${input.stops.length}) :

${stopsBlock}${finalRiddleBlock}

Map each stop to its expected dramaturgical position (already provided)
and score the fit. Return JSON only.`;
}

export async function judgeNarrativeArc(
  input: ArcJudgeInput,
): Promise<ArcJudgeResult> {
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
      `Arc judge returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }

  const p = parsed as Record<string, unknown>;
  const stopsRaw = Array.isArray(p.stops) ? p.stops : [];
  const stops: StopArcScore[] = stopsRaw.map((s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const pos = typeof o.expected_position === "string" ? o.expected_position : "";
    const validPositions: ArcPosition[] = [
      "act1_exposition",
      "act2_rising",
      "climax",
      "act3_resolution",
    ];
    return {
      step_order: typeof o.step_order === "number" ? o.step_order : 0,
      landmark_name:
        typeof o.landmark_name === "string" ? o.landmark_name : "",
      expected_position: validPositions.includes(pos as ArcPosition)
        ? (pos as ArcPosition)
        : "act2_rising",
      observed_role:
        typeof o.observed_role === "string" ? o.observed_role : "",
      arc_fit_score: Math.max(
        0,
        Math.min(
          10,
          typeof o.arc_fit_score === "number" ? o.arc_fit_score : 0,
        ),
      ),
      recommendation:
        typeof o.recommendation === "string" ? o.recommendation : "",
    };
  });

  const scoresList = stops.map((s) => s.arc_fit_score);
  const average =
    scoresList.length > 0
      ? scoresList.reduce((a, v) => a + v, 0) / scoresList.length
      : 0;

  const total = input.stops.length;
  const climaxStop = stops.find((s) => s.step_order === total - 1);
  const finalStop = stops.find((s) => s.step_order === total);
  const climaxScore = climaxStop?.arc_fit_score ?? 0;
  const finalScore = finalStop?.arc_fit_score ?? 0;

  let verdict: ArcVerdict;
  if (average >= 6 && climaxScore >= 7) verdict = "pass";
  else if (average >= 4 && climaxScore >= 4) verdict = "weak";
  else verdict = "fail";

  // Override : if final stop too weak (resolution missing), fail anyway
  if (finalScore < 3) verdict = "fail";

  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `Arc judge: avg=${average.toFixed(2)}, climax=${climaxScore}, final=${finalScore}, verdict=${verdict}`;

  const failingStops = stops.filter((s) => s.arc_fit_score < 4);
  const reason =
    verdict === "pass"
      ? ""
      : `[ARC_${verdict.toUpperCase()}] avg=${average.toFixed(2)}, climax=${climaxScore}, final=${finalScore}, ${failingStops.length}/${stops.length} stops mis-positioned. Failing : ${failingStops
          .map(
            (s) =>
              `Step ${s.step_order} "${s.landmark_name}" (expected ${s.expected_position}, score ${s.arc_fit_score}/10 — ${s.recommendation.slice(0, 120)})`,
          )
          .join(" ; ")}. Operator should rewrite to deliver expected dramaturgical beats (Act 1/2/climax/resolution).`;

  return {
    stops,
    average_score: Number(average.toFixed(2)),
    climax_score: climaxScore,
    final_score: finalScore,
    verdict,
    summary,
    needs_review_reason: reason,
  };
}
