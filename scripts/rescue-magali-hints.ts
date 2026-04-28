/**
 * EMERGENCY — Magali's game has empty hints ([{}, {}, {}]) on every
 * step because the pipeline insert misread Claude's response shape.
 * She's been stuck on step 3 with no working clue. This script asks
 * Claude to regenerate three hints per step from the existing riddle +
 * answer, then UPDATEs game_steps.hints in place. Her session and
 * progression stay untouched.
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error(
    `Missing env: SUPABASE_URL=${!!SUPABASE_URL} SUPABASE_KEY=${!!SUPABASE_SERVICE_KEY} ANTHROPIC=${!!ANTHROPIC_KEY}`,
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const GAME_ID = "c993f408-0d8f-4654-87c7-724471b0bf24";

interface HintTriple {
  zone: string;
  surface: string;
  format: string;
}

async function generateHintsFor(args: {
  stepOrder: number;
  title: string;
  riddleText: string;
  answer: string;
  facade: string | null;
}): Promise<HintTriple> {
  const prompt = `You are designing the 3 unlockable hints for an outdoor AR escape-game step. The player is on site, looking through their phone camera, trying to spot golden letters that materialise on a surface around them. They've already seen the riddle but they can't find the AR clue and they unlock hints one by one.

CONTEXT:
- Step ${args.stepOrder} title: ${args.title}
- Riddle (English): ${args.riddleText}
- Answer (in caps as it appears on the facade): ${args.facade || args.answer.toUpperCase()}

Write THREE hints, escalating in precision about WHERE the AR clue lives, NOT what the answer is:

1. ZONE — point at a broad area without naming the exact surface. Examples: "near the main entrance", "toward the side facing the plaza", "around the steeple". The player still has to scan a wide area.

2. SURFACE — narrow it to one specific wall, door, window, plaque, or cobbled area. Whatever the riddle's narrator told them to scan. Make it easy to find from here.

3. FORMAT — describe the SHAPE of the answer without spelling it. Number of letters / digits, language hint, or roman-numeral mention. Examples: "a 4-digit year", "a single Latin word, 6 letters", "a small roman numeral less than X".

Each hint MUST be in English (the runtime translates it). Each MUST be one short sentence (under 140 characters).

NEVER name the literal answer in any of the three hints.

Return ONLY a valid JSON object, no commentary:
{
  "zone": "<hint 1 text>",
  "surface": "<hint 2 text>",
  "format": "<hint 3 text>"
}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 600,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as HintTriple;
}

async function main() {
  const { data: steps, error } = await supabase
    .from("game_steps")
    .select(
      "id, step_order, title, riddle_text, answer_text, ar_facade_text",
    )
    .eq("game_id", GAME_ID)
    .order("step_order", { ascending: true });

  if (error || !steps) {
    console.error("Could not fetch steps:", error?.message);
    process.exit(1);
  }

  console.log(`Generating hints for ${steps.length} step(s)...`);

  for (const step of steps) {
    const titleStr =
      typeof step.title === "string"
        ? step.title
        : (step.title as Record<string, string>)?.en || "";
    const riddleStr =
      typeof step.riddle_text === "string"
        ? step.riddle_text
        : (step.riddle_text as Record<string, string>)?.en || "";
    const answerStr =
      typeof step.answer_text === "string"
        ? step.answer_text
        : (step.answer_text as Record<string, string>)?.en || "";

    console.log(`\n[step ${step.step_order}] ${titleStr}`);
    let hints: HintTriple;
    try {
      hints = await generateHintsFor({
        stepOrder: step.step_order,
        title: titleStr,
        riddleText: riddleStr,
        answer: answerStr,
        facade: step.ar_facade_text,
      });
    } catch (err) {
      console.error(
        `  ✗ generation failed: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }

    const hintsArray = [
      { order: 1, text: hints.zone },
      { order: 2, text: hints.surface },
      { order: 3, text: hints.format },
    ];

    console.log(`  1. ${hints.zone}`);
    console.log(`  2. ${hints.surface}`);
    console.log(`  3. ${hints.format}`);

    const { error: updErr } = await supabase
      .from("game_steps")
      .update({ hints: hintsArray })
      .eq("id", step.id);
    if (updErr) {
      console.error(`  ✗ DB update failed: ${updErr.message}`);
    } else {
      console.log(`  ✓ DB updated`);
    }
  }

  console.log("\n✅ Magali's hints regenerated.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
