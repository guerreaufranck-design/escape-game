/**
 * One-shot fix for the Tournus "Saint Valentine" game so it stops
 * trapping players (Forest + Philippat hit a 1-hint wall and quit).
 *
 *   1. Bump games.max_hints_per_step from 1 to 3.
 *   2. For every step with < 3 hints, ask Claude to generate the
 *      missing ones (preserving the existing hint as #1, adding the
 *      AR-instruction hint #2 and the answer-shape hint #3).
 *   3. Wipe the cached translations of the affected fields so the
 *      backfill that follows re-translates the new content.
 *
 * Idempotent — re-running it leaves a 3-hint game alone.
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

const GAME_ID = "9102f3b4-f9b2-407b-a74a-a5986edebf51";

interface Hint { order: number; text: string }

interface Step {
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

async function generateExtraHints(step: Step, existingHint: string): Promise<{ hint2: string; hint3: string }> {
  const prompt = `You are fixing a step in an outdoor escape game. The original hint is fine but we need TWO more hints to complete the 3-hint ladder.

CONTEXT:
- Step title: ${asString(step.title)}
- Riddle text: ${asString(step.riddle_text)}
- Answer the player must enter: ${asString(step.answer_text)}
- AR overlay (text that materialises on the façade in AR): ${step.ar_facade_text}
- Hint #1 (already written, atmospheric): ${existingHint}

You must generate EXACTLY 2 new hints, in JSON:

{
  "hint2": "Tell the player to OPEN THE AR CAMERA and aim at a SPECIFIC visible surface. Plain words anyone can find, no jargon. Under 200 chars. Critical: this is the hint that unblocks players who don't realise the answer is in AR.",
  "hint3": "Tell the player the SHAPE / FORMAT of the answer (e.g. 'a Roman numeral followed by a single Latin word', 'two words in Latin'). Never reveal the literal answer. Under 200 chars."
}

Output ONLY the JSON object, no commentary, no markdown fences.`;

  const msg = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { hint2: string; hint3: string };
  if (!parsed.hint2?.trim() || !parsed.hint3?.trim()) {
    throw new Error(`incomplete hints: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function main() {
  // 1. Bump max_hints_per_step
  const { error: upd } = await supabase
    .from("games")
    .update({ max_hints_per_step: 3 })
    .eq("id", GAME_ID);
  if (upd) {
    console.error("failed to bump max_hints_per_step:", upd.message);
    process.exit(1);
  }
  console.log("✓ games.max_hints_per_step set to 3");

  // 2. Fetch every step
  const { data: steps } = await supabase
    .from("game_steps")
    .select("id, step_order, title, riddle_text, answer_text, ar_facade_text, hints")
    .eq("game_id", GAME_ID)
    .order("step_order");

  if (!steps?.length) {
    console.error("no steps found");
    process.exit(1);
  }

  const affectedStepIds: string[] = [];

  for (const raw of steps as Step[]) {
    const existing = Array.isArray(raw.hints) ? raw.hints : [];
    if (existing.length >= 3) {
      console.log(`  step ${raw.step_order}: already has ${existing.length} hints — skip`);
      continue;
    }
    if (existing.length < 1) {
      console.warn(`  step ${raw.step_order}: ZERO existing hints, regenerating from scratch`);
    }
    const existingText = existing[0]?.text ?? `Look around at the place described in the step.`;
    process.stdout.write(`  step ${raw.step_order}: generating 2 extra hints... `);
    try {
      const { hint2, hint3 } = await generateExtraHints(raw, existingText);
      const merged: Hint[] = [
        { order: 1, text: existingText },
        { order: 2, text: hint2 },
        { order: 3, text: hint3 },
      ];
      const { error } = await supabase
        .from("game_steps")
        .update({ hints: merged })
        .eq("id", raw.id);
      if (error) throw new Error(error.message);
      affectedStepIds.push(raw.id);
      console.log("OK");
      console.log(`     #2: ${hint2.slice(0, 100)}`);
      console.log(`     #3: ${hint3.slice(0, 100)}`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
    // Pace Claude calls
    await new Promise((r) => setTimeout(r, 800));
  }

  // 3. Wipe the cached `hints` translations for affected steps so the
  //    next prepareGamePackage run re-translates the full ladder. The
  //    cache key for hints is `hint-<gameId>-<stepNumber>-<idx>`.
  if (affectedStepIds.length) {
    const stepNumbers = (steps as Step[])
      .filter((s) => affectedStepIds.includes(s.id))
      .map((s) => s.step_order);
    for (const num of stepNumbers) {
      for (const idx of [0, 1, 2]) {
        const key = `hint-${GAME_ID}-${num}-${idx}`;
        await supabase.from("translations_cache").delete().eq("source_id", key);
      }
    }
    console.log(`✓ wiped cached hint translations for ${stepNumbers.length} step(s)`);
  }

  console.log(
    "\nDone. Now re-run prepareGamePackage for every (game, language) pair " +
    "to fill the new hint translations: npx tsx scripts/backfill-translations.ts " +
    GAME_ID,
  );
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
