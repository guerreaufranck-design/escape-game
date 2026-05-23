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
  /**
   * (Sprint 6.2ter, 2026-05-22) Rich product page description from
   * OddballTrip. When present, the judge uses it as the CANONICAL
   * reference (vs the short themeDescription) for scoring fit. The
   * judge is also instructed to STRONGLY prefer stops whose name
   * appears in the productDescription text.
   */
  productDescription?: string;
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

const SYSTEM_PROMPT = `You are a CITY-FIRST themed-tour judge for outdoor escape-game stops.

🎯 GUIDING PRINCIPLE :
   Customers buy a CITY VISIT first, theme second. A great tourist
   landmark is GOOD even if its theme connection is loose — the
   narrator will weave the theme on top via creative storytelling.

Your job : given a game's theme + description, rate each stop on a
0-10 scale using : base patrimoine + theme bonus.

SCORING FORMULA :
  fit_score = base_patrimoine (1-9) + theme_bonus (-1 to +1)  (cap 0-10)

  BASE PATRIMOINE (visitor-value of the landmark itself) :
    9  Iconic landmark of the city, must-see for any visitor
       (Cathédrale, Casas Colgadas, Tour Eiffel)
    7-8 Top tourist patrimoine (named churches, towers, Roman ruins,
        named bridges, historic squares with own Google entry)
    5-6 Notable heritage — ANY MUSEUM (even off-theme like a
        bullfighting "Musée Taurin", a regional art museum), any
        named public garden ("Jardin de la Plantade"), secondary
        churches, named historic streets, named promenades
        ("Allées Paul Riquet")
    3-4 Generic but named (named atmospheric small buildings)
    1-2 Anonymous (random unnamed path, parking lot)
    0   Anti-patrimoine ONLY (gas station, fast-food, modern mall,
        supermarket, hotel chain).

  🚨 V12 CALIBRATION FIX :
     NEVER score a museum or named public garden below 4. They are
     PATRIMOINE TOURISTIQUE by definition. The Musée Taurin in
     Béziers = base 5 minimum (museum = cultural visit), even on a
     Cathar theme. Narrator weaves : "Long after the Cathares fell,
     this building became a bullfighting museum — but its walls
     remember the smoke..."

     Same for Jardin de la Plantade = base 4-5 (public garden, named).

  THEME BONUS :
    +1  Documented connection to theme (specific event/figure/era)
    0   Era-flexible (existed during theme period OR atmospherically
        compatible — DEFAULT for most heritage stops)
    -1  Genuinely post-theme construction (e.g., 19th-c park on a
        1209 medieval theme — still acceptable, narrator weaves)

CRITICAL HISTORICAL REASONING (don't be dogmatic) :
  - Roman ruins EXISTED during medieval times. The Cathares of 1209
    walked past the Arènes Romaines every day. Score Arènes :
    base 7 (top patrimoine) + theme_bonus 0 (existed in 1209) = 7,
    NOT 2 (wrong era). Cathares used the structure for shelter.
  - Same logic for any pre-theme structure that was still standing :
    a 12th-c church on a 16th-c theme = base 7 + bonus 0 = 7.
  - Only score genuinely POST-theme constructions lower : a 1990s
    shopping mall on a medieval theme = base 1 = 1.

  Mental model :
    "Would a knowledgeable tourist guide of this city say this is
     worth visiting ?" → that's the base score.
    "Does it have documented theme tie ?" → +1.

OBVIOUS REJECTS (score 0) :
  - Aquariums (never fit historical themes)
  - Modern shopping malls
  - Hotels/parking/transport stations
  - Events/temporary shows ("Spectacle Son & Lumière 2024")

CHURCH FROM WRONG CENTURY :
  - If well-known church in old town : base 6 + bonus 0 = 6 (not 2-3)
  - The OLD prompt downgraded these incorrectly.

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
  - "pass" : average_score >= 5.5
  - "weak" : average_score >= 4.0
  - "fail" : average_score < 4.0
  (V12 — verdict on AVERAGE ONLY, no min_score floor. A single weak-
   theme stop should not torpedo a game with good average quality —
   narrator weaves it in.)`;

function buildUserPrompt(input: JudgeInput): string {
  const stopsBlock = input.stops
    .map(
      (s) =>
        `${s.step_order}. ${s.name}${s.description ? ` — ${s.description.slice(0, 300)}` : ""}`,
    )
    .join("\n");

  // Sprint 6.2ter (2026-05-22) — when productDescription is provided,
  // use it as the canonical reference. The judge must STRONGLY prefer
  // stops whose name appears in this text (the customer was promised
  // these specific landmarks on the product page).
  const richProductBlock =
    input.productDescription && input.productDescription.trim().length > 50
      ? `\n\nPRODUCT-PAGE DESCRIPTION (the EXACT text the customer read before buying — names the promised landmarks and role-play) :\n"""${input.productDescription.trim()}"""\n\nIMPORTANT JUDGING RULE : any stop whose name (or a clear synonym) appears in the product-page description above MUST score AT LEAST 8/10 — these are the landmarks the customer was explicitly promised. Conversely, a stop NOT mentioned in the description has to demonstrate strong thematic fit on its own merits.`
      : "";

  return `GAME THEME : "${input.theme}"
THEME DESCRIPTION : ${input.themeDescription}
${input.narrative ? `NARRATIVE CONTEXT : ${input.narrative.slice(0, 600)}\n` : ""}CITY CONTEXT : ${input.city}${richProductBlock}

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
  // Hard 30s timeout — see pipeline-landmark-proposer.ts for context.
  const msg = await client.messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 2048,
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
  // V12 (2026-05-23) — verdict on AVERAGE ONLY, no min threshold.
  // Reason : even if 1 stop scores low (off-theme museum etc.), the
  // narrator can weave it into the story. As long as the AVERAGE
  // quality is good, we ship. The user mandate : "client buys a
  // city visit, theme is a narrative layer — never block on a
  // single weak-theme stop".
  if (average >= 5.5) verdict = "pass";
  else if (average >= 4.0) verdict = "weak";
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
