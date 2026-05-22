/**
 * Anti-armchair judge (Sprint B, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — kill the #1 critique of competitor Questo
 * ═══════════════════════════════════════════════════════════════════
 *
 * Quote from the Questo audit shared 22/05 :
 *   "certains joueurs rapportent avoir résolu l'intégralité d'une
 *    quête en moins de quarante minutes depuis leur domicile en
 *    s'aidant de simples recherches sur Google Maps et Wikipedia"
 *
 * If a riddle can be solved from the couch via Google/Wikipedia
 * lookups, the entire premise of an OUTDOOR escape-game collapses :
 *   - the player doesn't walk → no exercise value
 *   - they don't visit the landmarks → no tourist value
 *   - they don't engage with the location → no immersion
 *   - they finish in 20min from home → no replay/recommendation
 *
 * This judge scores each riddle on `site_presence_score` (0-10) :
 *   10  Requires AR overlay or close-up observation impossible from
 *       photos / Street View (e.g., "what's hidden under the tympanum?")
 *   7-9 Requires careful in-person inspection (specific detail not
 *       easily found in tourist guides)
 *   4-6 Solvable from Google Street View with effort (partially on-site)
 *   1-3 Solvable via Wikipedia / Google factual lookup (architect name,
 *       construction year, dynasty)
 *   0   Trivially Google-able in seconds (the answer IS the Wikipedia
 *       first paragraph) — game value destroyed
 *
 * Verdict :
 *   - pass : avg ≥ 6 AND no riddle ≤ 2
 *   - weak : avg ≥ 4 AND no riddle ≤ 0
 *   - fail : avg < 4 OR any riddle = 0
 *
 * Cost : ~$0.005 per game (Haiku, single call covers 7-8 riddles).
 * Negligible vs the cost of shipping a game players solve at home.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Architecture note — virtual_ar mode gets credit
 * ═══════════════════════════════════════════════════════════════════
 *
 * The pipeline marks riddles with answerSource = "virtual_ar" when the
 * answer is revealed via AR overlay locked behind a radar proximity
 * gate. Those are inherently armchair-proof (no way to trigger the AR
 * without being within 30m of the GPS target).
 *
 * The judge is told this and is instructed to score AR-revealed
 * answers floor=8/10. The remaining risk is the RIDDLE TEXT itself
 * being Google-able even when the AR answer is gated.
 *
 * Example caught :
 *   riddle="In what year did the architect of this cathedral die?"
 *   landmark="Cathédrale Saint-Nazaire de Béziers"
 *   answerSource="virtual_ar"  ← AR reveals "1283"
 *   → armchair score 2/10 : the player can google
 *     "architect Cathédrale Saint-Nazaire Béziers death year"
 *     and find the answer without ever visiting.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ArmchairVerdict = "pass" | "weak" | "fail";

export interface RiddleArmchairScore {
  step_order: number;
  landmark_name: string;
  site_presence_score: number; // 0..10, higher = better (harder to cheat)
  resolvability_path: string; // 1-2 sentences : how a cheater would solve it
  recommendation: string; // 1 sentence : how to harden it
}

export interface ArmchairJudgeResult {
  riddles: RiddleArmchairScore[];
  average_score: number;
  min_score: number;
  verdict: ArmchairVerdict;
  summary: string;
  /** Concatenated reason string ready to write to games.review_reason. */
  needs_review_reason: string;
}

export interface ArmchairJudgeInput {
  theme: string;
  city: string;
  /** Riddles to evaluate. */
  riddles: Array<{
    step_order: number;
    landmark_name: string;
    riddle_text: string;
    answer: string;
    /** "physical" = answer visible IRL, "virtual_ar" = AR overlay reveals
     *  the answer (gated by radar proximity). */
    answer_source?: "physical" | "virtual_ar";
  }>;
}

const SYSTEM_PROMPT = `You are the ANTI-CHEAT judge for outdoor escape-games.

Your job : for each riddle, decide HOW HARD it would be to solve from
home / café / hotel room — without ever physically visiting the
landmark.

A "cheater" you simulate has access to :
  - Google Search / Wikipedia (factual lookup)
  - Google Maps Street View (visual inspection of facades)
  - Tourist guides + travel blogs
  - Knowledge of the landmark name (the riddle reveals it)

A "cheater" does NOT have access to :
  - AR overlays gated by GPS proximity (virtual_ar answers)
  - Close-up details obscured at Street View resolution
  - Hidden / interior carvings not photographed publicly
  - Real-time observations (weather, signage updates, temporary plaques)

═══════════════════════════════════════════════════════════
SITE PRESENCE SCALE (0-10, higher = harder to cheat = better)
═══════════════════════════════════════════════════════════

  10  Requires AR overlay or close-up observation IMPOSSIBLE from
      Street View / photos. Examples : "what shape is hidden in the
      stained glass when sunlight hits it at 3pm?", "find the carved
      cat on the lower tympanum that isn't in any photo online".

  7-9 Requires careful in-person inspection of a non-iconic detail :
      a specific date on an obscure plaque, a count of statues on a
      facade fragment, an inscription on a side door. The detail
      exists but isn't documented in tourist guides.

  4-6 Solvable from Google Street View WITH EFFORT (zoom + angle
      hunting). The answer is technically visible online but the
      cheater has to spend real time to find it.

  1-3 Solvable via Wikipedia / Google factual lookup. Examples :
      "name the architect", "year of construction", "which dynasty
      built it". Pure factual knowledge that's the FIRST search result.

  0   Trivially answered by the landmark's Wikipedia intro paragraph.
      Total armchair-game. Cheater solves in <30 seconds.

═══════════════════════════════════════════════════════════
SCORING RULES (be calibrated, not generous)
═══════════════════════════════════════════════════════════

  - If answer_source = "virtual_ar" : floor the score at 8 ONLY IF the
    riddle TEXT alone doesn't telegraph the answer. If the riddle says
    "the architect of [landmark] was named X, in what year did X die?"
    that's still Google-able → don't floor.

  - Factual questions about famous landmarks (architect, construction
    year, monarch who commissioned it) score 1-3 regardless.

  - Questions like "how many statues are above the door" score 5-6 if
    the detail is visible on Street View, 8-9 if it requires close
    inspection or a specific angle.

  - Questions referencing virtual_ar reveals ("activate AR to see the
    Cathar sigil") with no factual content score 9-10.

OUTPUT : strict JSON, no markdown.
{
  "riddles": [
    {
      "step_order": 1,
      "landmark_name": "<name>",
      "site_presence_score": <0..10>,
      "resolvability_path": "<one short sentence : how a cheater would solve it from home, or NONE if can't>",
      "recommendation": "<one short sentence : how to harden it, or KEEP AS-IS if already strong>"
    },
    ...
  ],
  "average_score": <number, 2 decimals>,
  "min_score": <number>,
  "verdict": "pass" | "weak" | "fail",
  "summary": "<2-3 sentences explaining overall anti-armchair strength>"
}

VERDICT RULES (compute yourself) :
  - "pass" : average_score >= 6 AND min_score >= 3
  - "weak" : average_score >= 4 AND min_score >= 1
  - "fail" : average_score < 4 OR min_score = 0`;

function buildUserPrompt(input: ArmchairJudgeInput): string {
  const riddlesBlock = input.riddles
    .map(
      (r) =>
        `${r.step_order}. LANDMARK: ${r.landmark_name}\n   RIDDLE: ${r.riddle_text}\n   EXPECTED ANSWER: ${r.answer}\n   ANSWER REVEAL: ${r.answer_source ?? "physical"}`,
    )
    .join("\n\n");

  return `GAME THEME : "${input.theme}"
CITY : ${input.city}

RIDDLES TO JUDGE (${input.riddles.length}) :

${riddlesBlock}

Score each riddle for site-presence requirement. Return JSON only.`;
}

/**
 * Run the anti-armchair judge on a game's riddle set.
 *
 * Throws on Anthropic API error / malformed JSON. Caller should
 * fail-open (no flag) on infra failure rather than block publish.
 */
export async function judgeArmchairResolvability(
  input: ArmchairJudgeInput,
): Promise<ArmchairJudgeResult> {
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
      `Armchair judge returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }

  const p = parsed as Record<string, unknown>;
  const riddlesRaw = Array.isArray(p.riddles) ? p.riddles : [];
  const riddles: RiddleArmchairScore[] = riddlesRaw.map((r: unknown) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      step_order: typeof o.step_order === "number" ? o.step_order : 0,
      landmark_name:
        typeof o.landmark_name === "string" ? o.landmark_name : "",
      site_presence_score: Math.max(
        0,
        Math.min(
          10,
          typeof o.site_presence_score === "number"
            ? o.site_presence_score
            : 0,
        ),
      ),
      resolvability_path:
        typeof o.resolvability_path === "string" ? o.resolvability_path : "",
      recommendation:
        typeof o.recommendation === "string" ? o.recommendation : "",
    };
  });

  const scores = riddles.map((r) => r.site_presence_score);
  const average =
    scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const min = scores.length > 0 ? Math.min(...scores) : 0;

  let verdict: ArmchairVerdict;
  if (average >= 6 && min >= 3) verdict = "pass";
  else if (average >= 4 && min >= 1) verdict = "weak";
  else verdict = "fail";

  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `Armchair judge: avg=${average.toFixed(2)}, min=${min}, verdict=${verdict}`;

  const failingRiddles = riddles.filter((r) => r.site_presence_score < 4);
  const reason =
    verdict === "pass"
      ? ""
      : `[ARMCHAIR_${verdict.toUpperCase()}] avg_site_presence=${average.toFixed(2)}, min=${min}, ${failingRiddles.length}/${riddles.length} riddles armchair-solvable. Failing : ${failingRiddles
          .map(
            (r) =>
              `Step ${r.step_order} "${r.landmark_name}" (${r.site_presence_score}/10 — ${r.resolvability_path.slice(0, 120)})`,
          )
          .join(" ; ")}. Operator must rewrite these riddles to require on-site observation.`;

  return {
    riddles,
    average_score: Number(average.toFixed(2)),
    min_score: min,
    verdict,
    summary,
    needs_review_reason: reason,
  };
}
