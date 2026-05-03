/**
 * Backfill the 3-hint ladder on every game generated before the
 * pipeline started shipping ≥3 hints by default. Applies the same fix
 * fix-tournus-hints.ts does, but across the whole library.
 *
 * For each game with max_hints_per_step < 3 OR any step with fewer
 * than 3 hints:
 *   1. Bump games.max_hints_per_step to 3 (one-time).
 *   2. For each step with < 3 hints, ask Claude to generate the
 *      missing ones (preserving the existing hint(s) as the start of
 *      the ladder). Hint #2 always tells the player to OPEN THE AR
 *      CAMERA + where to look — that's the one that unsticks the
 *      majority of cases.
 *   3. Wipe the cached hint translations for the affected step so the
 *      next backfill-translations run repopulates them.
 *
 * Idempotent — re-running it leaves a 3-hint game alone and skips it.
 *
 * After this finishes, run:
 *   npx tsx scripts/backfill-translations.ts
 * (no game-id filter — to cover every (game × language) pair).
 *
 * Usage:
 *   npx tsx scripts/fix-all-games-hints.ts            # all games
 *   npx tsx scripts/fix-all-games-hints.ts <gameId>   # restrict to one game
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface Hint { order: number; text: string }
interface StepRow {
  id: string;
  step_order: number;
  title: unknown;
  riddle_text: unknown;
  answer_text: unknown;
  ar_facade_text: string | null;
  hints: Hint[] | null;
}

function asString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, string>;
    return o.en || o.fr || Object.values(o)[0] || "";
  }
  return String(v);
}

function gameLabel(g: { id: string; city: string | null; title: unknown }): string {
  return `${asString(g.title).slice(0, 60)} — ${g.city ?? "?"} (${g.id.slice(0, 8)})`;
}

/**
 * Ask Claude to fill the gaps in a step's hint ladder.
 * `existing` is the hints already in DB (1 or 2). The ladder is always
 * 3-long: #1 atmospheric, #2 open the camera + where, #3 shape.
 */
async function generateMissingHints(
  step: StepRow,
  existing: Hint[],
): Promise<Hint[]> {
  const need = 3 - existing.length;
  if (need <= 0) return existing;

  const existingDescription = existing
    .map((h, i) => `Hint #${i + 1} (already written): ${h.text}`)
    .join("\n");

  const prompt = `You are fixing a step in an outdoor escape game. The step needs a 3-hint ladder. ${existing.length} hint(s) already exist; you must produce the missing ${need} so the full ladder is:
  #1 ATMOSPHERIC nudge — re-anchors the player in the riddle without giving the mechanism away
  #2 OPEN THE AR CAMERA + WHERE TO LOOK — tells the player explicitly to open the AR camera and aim at a specific surface; this is the critical one that unsticks players who don't realise the answer is in AR
  #3 SHAPE OF THE ANSWER — names the format (e.g. "two Latin words", "a 4-digit year") without revealing the literal answer

CONTEXT:
- Step title: ${asString(step.title)}
- Riddle text: ${asString(step.riddle_text)}
- Answer the player must enter: ${asString(step.answer_text)}
- AR overlay text (what materialises on the façade in AR): ${step.ar_facade_text ?? "(none)"}
${existingDescription}

Produce ONLY the missing hints, in JSON, in slot order. Each hint must be under 200 chars.

${need === 2 ? `{"hint2": "...", "hint3": "..."}` : `{"hint3": "..."}`}

No commentary, no markdown fences.`;

  const msg = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { hint2?: string; hint3?: string };

  const result: Hint[] = [...existing];
  if (need === 2) {
    if (!parsed.hint2?.trim() || !parsed.hint3?.trim())
      throw new Error(`missing hints in response: ${JSON.stringify(parsed)}`);
    result.push({ order: 2, text: parsed.hint2.trim() });
    result.push({ order: 3, text: parsed.hint3.trim() });
  } else if (need === 1) {
    if (!parsed.hint3?.trim())
      throw new Error(`missing hint3 in response: ${JSON.stringify(parsed)}`);
    result.push({ order: 3, text: parsed.hint3.trim() });
  }
  // Re-number to be safe.
  return result.map((h, i) => ({ order: i + 1, text: h.text }));
}

async function fixGame(gameId: string): Promise<{ stepsFixed: number; bumpedHintsCap: boolean; affectedStepNumbers: number[] }> {
  // 1. Bump max_hints_per_step if needed
  const { data: game } = await supabase
    .from("games")
    .select("max_hints_per_step")
    .eq("id", gameId)
    .single();

  let bumpedHintsCap = false;
  if (game && (game.max_hints_per_step ?? 0) < 3) {
    const { error } = await supabase
      .from("games")
      .update({ max_hints_per_step: 3 })
      .eq("id", gameId);
    if (error) throw new Error(`bump max_hints_per_step: ${error.message}`);
    bumpedHintsCap = true;
  }

  // 2. Walk each step
  const { data: steps } = await supabase
    .from("game_steps")
    .select("id, step_order, title, riddle_text, answer_text, ar_facade_text, hints")
    .eq("game_id", gameId)
    .order("step_order");

  if (!steps?.length) return { stepsFixed: 0, bumpedHintsCap, affectedStepNumbers: [] };

  const affectedStepNumbers: number[] = [];
  let stepsFixed = 0;

  for (const raw of steps as StepRow[]) {
    const existing = Array.isArray(raw.hints) ? raw.hints : [];
    if (existing.length >= 3) continue;

    process.stdout.write(`    step ${raw.step_order}: ${existing.length} hint(s) → 3... `);
    try {
      const merged = await generateMissingHints(raw, existing);
      const { error } = await supabase
        .from("game_steps")
        .update({ hints: merged })
        .eq("id", raw.id);
      if (error) throw new Error(error.message);
      stepsFixed++;
      affectedStepNumbers.push(raw.step_order);
      console.log("OK");
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
    // Pace Claude calls
    await new Promise((r) => setTimeout(r, 800));
  }

  // 3. Wipe cached hint translations for affected steps. Hints use the
  // synthetic key `hint-<gameId>-<stepNumber>-<idx>`.
  for (const stepNum of affectedStepNumbers) {
    for (const idx of [0, 1, 2]) {
      const key = `hint-${gameId}-${stepNum}-${idx}`;
      await supabase.from("translations_cache").delete().eq("source_id", key);
    }
  }

  return { stepsFixed, bumpedHintsCap, affectedStepNumbers };
}

async function main() {
  const filter = process.argv[2];

  // List games to process
  let q = supabase
    .from("games")
    .select("id, city, title, max_hints_per_step, created_at")
    .order("created_at", { ascending: true });
  if (filter) q = q.eq("id", filter);

  const { data: games, error } = await q;
  if (error) {
    console.error("failed to list games:", error.message);
    process.exit(1);
  }
  if (!games?.length) {
    console.log("no games to process");
    return;
  }

  console.log(`[fix-all-games-hints] ${games.length} game(s) to inspect\n`);

  let processed = 0;
  let touched = 0;
  let totalStepsFixed = 0;

  for (const g of games) {
    console.log(`── ${gameLabel(g)}  cap=${g.max_hints_per_step}`);
    try {
      const res = await fixGame(g.id);
      processed++;
      if (res.bumpedHintsCap || res.stepsFixed > 0) {
        touched++;
        totalStepsFixed += res.stepsFixed;
        console.log(
          `   ${res.bumpedHintsCap ? "bumped cap to 3, " : ""}${res.stepsFixed} step(s) updated`,
        );
      } else {
        console.log("   already healthy — skipped");
      }
    } catch (err) {
      console.log(`   ERROR: ${err instanceof Error ? err.message : err}`);
    }
    console.log();
  }

  console.log(`──`);
  console.log(`Done. ${processed}/${games.length} games inspected, ${touched} touched, ${totalStepsFixed} step(s) regenerated.`);
  if (touched > 0) {
    console.log(
      `\nNext: re-run prepareGamePackage on every (game × language) pair so the new hints land in every cached language:`,
    );
    console.log(`  npx tsx scripts/backfill-translations.ts`);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
