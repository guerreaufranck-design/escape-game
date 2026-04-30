/**
 * One-shot — fill the missing route_attractions on Step 1 of the
 * Tournus game (9102f3b4). Claude returned 0 attractions on step 1
 * which is the recurring "I have no 'way to' so I skipped" failure
 * mode despite the prompt's instruction to surface points visible
 * from the starting point.
 *
 * Calls Claude one more time with riddle context + an explicit
 * "we're at step 1, no 'way to', use what's visible from the abbey
 * main entrance" framing.
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const GAME_ID = "9102f3b4-f9b2-407b-a74a-a5986edebf51";

interface Attraction {
  name: string;
  fact: string;
}

async function main() {
  // Fetch step 1
  const { data: step } = await supabase
    .from("game_steps")
    .select("id, title, riddle_text, route_attractions")
    .eq("game_id", GAME_ID)
    .eq("step_order", 1)
    .single();

  if (!step) {
    console.error("Step 1 not found");
    process.exit(1);
  }

  const titleStr =
    typeof step.title === "string"
      ? step.title
      : (step.title as Record<string, string>)?.en || "";
  const riddleStr =
    typeof step.riddle_text === "string"
      ? step.riddle_text
      : (step.riddle_text as Record<string, string>)?.en || "";

  console.log(`Generating attractions for Step 1 (${titleStr})...`);

  const prompt = `You are completing data for an outdoor heritage AR game in Tournus, Burgundy, France.

Step 1 is at the main entrance of the Abbey of Saint-Philibert (Abbaye Saint-Philibert).
Step title: "${titleStr}"
Step riddle context: ${riddleStr.slice(0, 600)}

Generate EXACTLY 2 to 3 real, factual heritage points-of-interest VISIBLE from the abbey's main west facade entrance — things the player can spot WITHOUT walking far. Real Tournus heritage only, no fiction.

Examples of plausible candidates (pick from these or similar real ones you know):
  - The Saint-Michel and Saint-Philibert towers of the abbey's west facade
  - The narthex / porch with its 11th-century Romanesque architecture
  - The carved tympanum or any bas-reliefs above the main door
  - The Place des Arts in front of the abbey
  - Nearby medieval houses (Maison du Trésorier, etc.)
  - Roman or pre-Romanesque foundation stones embedded in the walls

Return ONLY a valid JSON array, this STRICT shape:
[
  { "name": "<short name in English under 60 chars>", "fact": "<one factual sentence under 140 chars>" },
  ...
]

Each entry MUST have BOTH name AND fact, both non-empty. NEVER return a string array. NEVER reference fictional Saint Valentine relics in the facts (those are the riddle's premise, the attractions must be REAL Tournus heritage). 2 or 3 entries, no more no less.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    console.error("No JSON array found in Claude output:", text.slice(0, 300));
    process.exit(1);
  }
  const parsed = JSON.parse(match[0]) as Attraction[];

  // Sanity filter
  const valid = parsed.filter(
    (a) =>
      a &&
      typeof a.name === "string" &&
      typeof a.fact === "string" &&
      a.name.trim().length > 0 &&
      a.fact.trim().length > 0,
  );
  if (valid.length === 0) {
    console.error("No valid attraction returned");
    process.exit(1);
  }

  console.log(`Got ${valid.length} attraction(s):`);
  for (const a of valid) {
    console.log(`  • ${a.name}`);
    console.log(`    ${a.fact}`);
  }

  // UPDATE the row — touch ONLY route_attractions, leave everything else
  const { error: updErr } = await supabase
    .from("game_steps")
    .update({ route_attractions: valid })
    .eq("id", step.id);

  if (updErr) {
    console.error("DB update failed:", updErr.message);
    process.exit(1);
  }

  console.log(`\n✅ Step 1 route_attractions updated (${valid.length} POIs).`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
