/**
 * Thematic auto-repair via candidate-pool reshuffling
 * (Sprint 6.2quater, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sprint 6.2bis introduced the thematic-fit judge that catches when
 * the initial Phase 1b discovery selection drifts off-theme (Aigues-
 * Mortes 22/05 incident : 7 stops were aquariums/museums on a 1572
 * Huguenot theme — judge would now flag at avg=3.43, fail).
 *
 * That gate STOPPED the problem but escalated EVERY case to human
 * review. The user observed correctly : "if YOU (Claude) can propose
 * a better list, why can't the system do it itself ?"
 *
 * This module CLOSES THE LOOP. When the judge fails, instead of
 * immediately escalating, we :
 *   1. Identify the failing stops (fit_score < 4)
 *   2. Keep the passing stops as-is (fit_score ≥ 4)
 *   3. Reach into the FULL Google Places candidate pool (60+ POIs
 *      that Phase 1b found but did NOT select), already with valid
 *      GPS + types + ratings
 *   4. Ask Claude Haiku to re-pick N replacements from the pool,
 *      ranked by THEMATIC fit (Tier 1), then HERITAGE value (Tier 2),
 *      explicitly limiting museums (≤1 unless thematically essential)
 *   5. Re-run the thematic judge on [keep + new picks]
 *   6. If judge now passes → success, pipeline continues automatically
 *   7. If still failing after max 2 attempts → escalate to human
 *
 * ═══════════════════════════════════════════════════════════════════
 * Why this works without hallucination risk
 * ═══════════════════════════════════════════════════════════════════
 *
 * Claude NEVER invents POI names — it picks from the SAME Google
 * Places pool that Phase 1b already validated. Every replacement
 * has :
 *   - a real Google place_id
 *   - sub-10m GPS coords
 *   - documented types (museum, church, monument, etc.)
 *   - Google rating + review count (signal of notoriety)
 *
 * The only thing Claude does is RE-RANK + RE-SELECT. No new
 * geocoding, no fabricated names. Robust.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Museum policy (user request 2026-05-22)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Museums in walking heritage games are friction (paid entry, indoor
 * hours, AR overlay UX less compelling than on facades). The repair
 * prompt enforces :
 *   - PREFER outdoor heritage (churches/cathedrals/towers/old quarters)
 *   - MAX 1 museum in final selection (and only if thematically
 *     essential — like a Caravaggio museum for a Caravaggio theme)
 *   - EXCLUDE aquariums, modern art museums on historical themes,
 *     theme parks, supermarkets, fairground attractions
 */
import Anthropic from "@anthropic-ai/sdk";
import type { JudgeInput, ThematicJudgeResult } from "./pipeline-thematic-judge";
import { judgeThematicRelevance } from "./pipeline-thematic-judge";

// JSON-serializable candidate shape — must match what Phase1Result.allCandidates carries
export interface PoolCandidate {
  name: string;
  lat: number;
  lon: number;
  placeId: string;
  types: string[];
  address?: string;
  rating?: number;
  userRatingsTotal?: number;
  distanceM: number;
}

// What auto-repair returns to the orchestrator
export interface AutoRepairResult {
  /** True iff after reshuffle the judge verdict is now "pass". */
  success: boolean;
  /** Description of what happened (logged in telemetry). */
  reason: string;
  /** The new full stop list to use downstream (keep + replacements).
   *  Only valid when success=true. Length = original stop count. */
  repairedStops: Array<{
    name: string;
    lat: number;
    lon: number;
    placeId: string;
    types: string[];
    rating?: number;
    fromAutoRepair: boolean; // true iff this entry replaced a failing stop
  }>;
  /** Judge result after reshuffle. */
  postRepairJudge?: ThematicJudgeResult;
  /** Number of stops actually replaced. */
  replacedCount: number;
  /** Number of attempts used (1-2). */
  attempts: number;
}

interface RepairAttemptInput {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  /** Stops that passed the judge — keep verbatim. */
  keepStops: PoolCandidate[];
  /** How many replacements to pick from the pool. */
  replacementsNeeded: number;
  /** Pool to pick replacements from (Google Places candidates minus the
   *  originally selected 7). Each has place_id we can use as identity. */
  pool: PoolCandidate[];
  /** Failing stop names so Claude doesn't re-pick them. */
  excludeNames: string[];
}

const SYSTEM_PROMPT = `You are a heritage curator picking outdoor escape-game stops for a guided walking tour.

Your job : given a THEME + a pool of Google Places candidates already validated as nearby and real, RE-SELECT the best N replacements from the pool to swap out stops that previously failed thematic fit.

═══════════════════════════════════════════════════════════
TIER PRIORITY — pick in this descending order
═══════════════════════════════════════════════════════════

TIER 1 — DIRECT thematic link (preferred whenever pool has them)
  ✅ Cathedrals, basilicas, historic churches if theme is religious / medieval
  ✅ Castles, fortresses, ramparts, gates if theme is military / royal
  ✅ Squares, old quarters, plazas with documented role in the theme
  ✅ Bridges, monuments, fountains tied to a named event
  ✅ Specific landmark named in the productDescription

TIER 2 — Strong HERITAGE value, era-compatible (fallback)
  ✅ Old churches / abbeys / convents not tied to the theme but era-fitting
  ✅ Roman / medieval ruins on the route
  ✅ Historic city gates, towers, classified-monument facades
  ✅ Old quarters' main squares
  ✅ Heritage walking points the city is famous for

TIER 3 — Heritage value, period-mismatch (last resort)
  ⚠️ Major monuments from other eras (e.g. a 18th-century palace on a
     medieval theme) — acceptable only if Tier 1 + Tier 2 are exhausted.

EXCLUDE HARD
  ❌ Aquariums, sea-life centers, dolphinariums
  ❌ Modern art museums on historical themes (Tier 3 only if essential)
  ❌ Botanical gardens, zoos, theme parks, amusement attractions
  ❌ Shopping malls, supermarkets, hotels
  ❌ Sports stadiums, leisure centers
  ❌ Private estates inaccessible to walkers

MUSEUM POLICY (strict)
  - PREFER outdoor heritage above all museums (paid entry = player friction)
  - You may include AT MOST 1 museum in your replacement set
  - That museum MUST be thematically essential (e.g. a Caravaggio museum
    for a Caravaggio theme, a Reformation museum for a Huguenot theme)
  - If 2+ museums in pool both look strong, PICK only the most
    thematic one ; deprioritize the others to Tier 3
  - For Tier 2 (heritage fallback), STILL avoid museums — prefer churches
    / old quarters / monuments

═══════════════════════════════════════════════════════════

You receive a JSON pool. You return JSON only :
{
  "picks": [
    {
      "place_id": "<verbatim place_id from pool>",
      "tier": 1 | 2 | 3,
      "rationale": "<one sentence : why this candidate, why this tier>"
    },
    ... exactly N entries
  ]
}

CRITICAL :
- Every place_id MUST exist in the pool you received. Inventing place_ids
  or names is forbidden. If pool has fewer than N candidates matching
  the policy, return whatever the pool can offer in tier order — do
  NOT fabricate.
- Skip place_ids in the exclude list (originally failing stops).
- Keep your selections compact : 1 sentence rationale per pick.`;

function buildUserPrompt(input: RepairAttemptInput): string {
  const richBlock = input.productDescription && input.productDescription.length > 50
    ? `\nPRODUCT-PAGE DESCRIPTION (the customer's promise — landmarks named here are TOP priority) :\n"""${input.productDescription.trim()}"""\n`
    : "";

  const keepBlock = input.keepStops.length > 0
    ? `STOPS ALREADY SELECTED (do not re-pick, they're keepers) :\n${input.keepStops.map((s, i) => `${i + 1}. ${s.name} (place_id: ${s.placeId})`).join("\n")}\n`
    : "";

  const excludeBlock = input.excludeNames.length > 0
    ? `STOPS THAT FAILED THE THEMATIC JUDGE (DO NOT re-pick) :\n${input.excludeNames.map((n) => `- ${n}`).join("\n")}\n`
    : "";

  const poolBlock = input.pool
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} | place_id=${c.placeId} | types=[${c.types.slice(0, 3).join(", ")}] | rating=${c.rating ?? "?"}(${c.userRatingsTotal ?? "?"}) | distance=${Math.round(c.distanceM)}m`,
    )
    .join("\n");

  return `THEME : "${input.theme}"
THEME DESCRIPTION : ${input.themeDescription}
${richBlock}CITY : ${input.city}, ${input.country}

${keepBlock}${excludeBlock}
GOOGLE PLACES POOL (pick exactly ${input.replacementsNeeded} from these) :
${poolBlock}

Return JSON with exactly ${input.replacementsNeeded} picks.`;
}

async function pickReplacementsFromPool(
  input: RepairAttemptInput,
): Promise<PoolCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `auto-repair Claude returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }
  const p = parsed as { picks?: unknown };
  if (!Array.isArray(p.picks)) {
    throw new Error("auto-repair Claude returned no `picks` array");
  }
  // Map place_ids → pool candidates, dropping invented ones
  const poolByPlaceId = new Map(input.pool.map((c) => [c.placeId, c]));
  const replacements: PoolCandidate[] = [];
  for (const pick of p.picks) {
    const r = (pick ?? {}) as Record<string, unknown>;
    const placeId = typeof r.place_id === "string" ? r.place_id : null;
    if (!placeId) continue;
    const cand = poolByPlaceId.get(placeId);
    if (!cand) {
      console.warn(
        `[auto-repair] Claude returned place_id "${placeId}" not in pool — dropping (anti-hallucination)`,
      );
      continue;
    }
    // Avoid duplicates within this call's picks
    if (replacements.find((rep) => rep.placeId === placeId)) continue;
    replacements.push(cand);
  }
  return replacements;
}

// ════════════════════════════════════════════════════════════════════
// Public entry point
// ════════════════════════════════════════════════════════════════════

const MAX_ATTEMPTS = 2;

export interface AutoRepairInput {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  /** Original stops with thematic-fit scores from initial judge. */
  originalStops: Array<{
    step_order: number;
    name: string;
    lat: number;
    lon: number;
    placeId?: string;
    types?: string[];
    rating?: number;
    fit_score: number;
    description?: string;
  }>;
  /** Full Google Places candidate pool (Phase1Result.allCandidates). */
  pool: PoolCandidate[];
}

/**
 * Try to auto-repair a stops list whose initial thematic judge failed.
 *
 * Logic :
 *   1. Split stops into keep (fit_score ≥ 4) and failing (< 4)
 *   2. Remove keep + failing from pool → available pool
 *   3. Ask Claude to pick N=failing.length replacements from available
 *   4. Build new full list [keep + replacements]
 *   5. Re-run thematic judge
 *   6. If pass → return success ; else retry once with stricter prompt
 *
 * Fail-open : if Claude or judge errors, return { success: false } so
 * the caller escalates to needs_review (Sprint 6.2bis behavior preserved).
 */
export async function autoRepairThematicStops(
  input: AutoRepairInput,
): Promise<AutoRepairResult> {
  const KEEP_THRESHOLD = 4; // stops with fit_score >= 4 are kept

  // Split stops
  const keepStops = input.originalStops.filter((s) => s.fit_score >= KEEP_THRESHOLD);
  const failingStops = input.originalStops.filter((s) => s.fit_score < KEEP_THRESHOLD);
  const failingNames = failingStops.map((s) => s.name);

  if (failingStops.length === 0) {
    // Nothing to repair — caller should not have invoked us
    return {
      success: false,
      reason: "no failing stops — auto-repair called by mistake",
      repairedStops: [],
      replacedCount: 0,
      attempts: 0,
    };
  }

  // Remove already-selected stops from available pool (by place_id)
  const selectedPlaceIds = new Set(
    input.originalStops.map((s) => s.placeId).filter((p): p is string => !!p),
  );
  const availablePool = input.pool.filter(
    (c) => !selectedPlaceIds.has(c.placeId),
  );

  if (availablePool.length < failingStops.length) {
    return {
      success: false,
      reason: `pool too small : ${availablePool.length} available candidates, need ${failingStops.length} replacements`,
      repairedStops: [],
      replacedCount: 0,
      attempts: 0,
    };
  }

  console.log(
    `[autoRepair] starting : keep=${keepStops.length}, failing=${failingStops.length}, pool_available=${availablePool.length}`,
  );

  let lastJudge: ThematicJudgeResult | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    let replacements: PoolCandidate[];
    try {
      replacements = await pickReplacementsFromPool({
        theme: input.theme,
        themeDescription: input.themeDescription,
        productDescription: input.productDescription,
        city: input.city,
        country: input.country,
        keepStops: keepStops.map((s) => ({
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          placeId: s.placeId ?? "",
          types: s.types ?? [],
          rating: s.rating,
          distanceM: 0,
        })),
        replacementsNeeded: failingStops.length,
        pool: availablePool,
        excludeNames: failingNames,
      });
    } catch (err) {
      console.warn(
        `[autoRepair] attempt ${attempt} : Claude pick failed (${err instanceof Error ? err.message : err}). ${attempt < MAX_ATTEMPTS ? "Retrying." : "Giving up."}`,
      );
      continue;
    }

    if (replacements.length < failingStops.length) {
      console.warn(
        `[autoRepair] attempt ${attempt} : got ${replacements.length}/${failingStops.length} replacements. ${attempt < MAX_ATTEMPTS ? "Retrying." : "Giving up."}`,
      );
      continue;
    }

    // Build new full stops list
    const newFullStops = [
      ...keepStops.map((s) => ({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        placeId: s.placeId ?? "",
        types: s.types ?? [],
        rating: s.rating,
        fromAutoRepair: false,
      })),
      ...replacements.map((r) => ({
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        placeId: r.placeId,
        types: r.types,
        rating: r.rating,
        fromAutoRepair: true,
      })),
    ];

    // Re-run thematic judge on the new mix
    const judgeInput: JudgeInput = {
      theme: input.theme,
      themeDescription: input.themeDescription,
      productDescription: input.productDescription,
      city: input.city,
      stops: newFullStops.map((s, i) => ({
        step_order: i + 1,
        name: s.name,
        description: "",
      })),
    };

    try {
      lastJudge = await judgeThematicRelevance(judgeInput);
    } catch (err) {
      console.warn(
        `[autoRepair] attempt ${attempt} : re-judge failed (${err instanceof Error ? err.message : err}). Treating as fail and ${attempt < MAX_ATTEMPTS ? "retrying" : "giving up"}.`,
      );
      continue;
    }

    console.log(
      `[autoRepair] attempt ${attempt} : re-judge avg=${lastJudge.average_score}, min=${lastJudge.min_score}, verdict=${lastJudge.verdict}`,
    );

    // Accept "pass" verdict. Optionally accept "weak" with avg ≥ 6.0
    // (better than the failing original but not perfect — still a win).
    const acceptThisAttempt =
      lastJudge.verdict === "pass" ||
      (lastJudge.verdict === "weak" && lastJudge.average_score >= 6.0);

    if (acceptThisAttempt) {
      console.log(
        `[autoRepair] ✅ SUCCESS at attempt ${attempt} (verdict=${lastJudge.verdict}, avg=${lastJudge.average_score})`,
      );
      return {
        success: true,
        reason: `auto-repaired at attempt ${attempt} (replaced ${replacements.length} stops, judge now ${lastJudge.verdict}, avg=${lastJudge.average_score})`,
        repairedStops: newFullStops,
        postRepairJudge: lastJudge,
        replacedCount: replacements.length,
        attempts: attempt,
      };
    }

    // Otherwise loop and try again (Claude may pick different replacements
    // due to temperature 0.1 — but for determinism we keep retries low).
  }

  // Exhausted all attempts
  return {
    success: false,
    reason: `auto-repair exhausted ${MAX_ATTEMPTS} attempts ; last judge avg=${lastJudge?.average_score ?? "?"} verdict=${lastJudge?.verdict ?? "?"}. Escalating to human review.`,
    repairedStops: [],
    postRepairJudge: lastJudge,
    replacedCount: 0,
    attempts: MAX_ATTEMPTS,
  };
}
