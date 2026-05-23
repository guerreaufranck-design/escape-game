/**
 * Apply manual edits to the Cuenca game post-discovery review.
 *
 * Edits :
 *   1. Stop 3 Plaza Mayor — GPS update (small drift correction)
 *   2. Stop 5 Paseo del Compi — GPS update (small drift correction)
 *   3. Stop 7 Pequeña Cascada — full REPLACE with new landmark
 *      (name + GPS + regenerated narration via Claude for coherence)
 *
 * Run :
 *   node scripts/edit-cuenca-stops.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

const env = Object.fromEntries(
  readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }),
);
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const GAME_ID = "2956f57e-f47f-4928-afb6-3957c260a434";

// ─── User-validated GPS corrections ────────────────────────────────
const PLAZA_MAYOR_LAT = 40.07861618554211;
const PLAZA_MAYOR_LON = -2.1298801166966483;
const PASEO_LAT = 40.08124598725031;
const PASEO_LON = -2.130795443687727;

// ─── Stop 7 replacement (PENDING USER CHOICE) ──────────────────────
// Default = Convento de San Pablo. User can change before running.
const STOP_7_NEW = {
  landmark_name: "Convento de San Pablo",
  name: "Convento de San Pablo",
  latitude: 40.07898,
  longitude: -2.12656,
  context_for_claude: "16th-century Dominican monastery, dramatically perched on the opposite cliff of the Huécar gorge, directly facing the Hanging Houses across the San Pablo Bridge. Now a parador (state hotel). Cohérence narrative : where Master Builder Rodrigo's body was discovered mysteriously after his disappearance from the Castillo workshop — the monks of San Pablo finding him on October 13, 1391, clutching his bronze mechanism, with the Hanging Houses visible across the gorge as if watching over their creator's final rest.",
};

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════

async function main() {
  // ── Fetch current state ──────────────────────────────────────────
  const { data: steps, error } = await supa
    .from("game_steps")
    .select("*")
    .eq("game_id", GAME_ID)
    .order("step_order");
  if (error) { console.error(error); process.exit(1); }
  console.log(`Found ${steps.length} steps for Cuenca game ${GAME_ID}\n`);

  // ── EDIT 1 : Plaza Mayor GPS ────────────────────────────────────
  const stop3 = steps.find((s) => s.step_order === 3);
  if (!stop3) { console.error("No step 3 found"); process.exit(1); }
  console.log(`[EDIT 1] Stop 3 "${stop3.landmark_name}"`);
  console.log(`  old GPS: ${stop3.latitude}, ${stop3.longitude}`);
  console.log(`  new GPS: ${PLAZA_MAYOR_LAT}, ${PLAZA_MAYOR_LON}`);
  const { error: e1 } = await supa
    .from("game_steps")
    .update({ latitude: PLAZA_MAYOR_LAT, longitude: PLAZA_MAYOR_LON })
    .eq("id", stop3.id);
  if (e1) { console.error("EDIT 1 failed:", e1); process.exit(1); }
  console.log("  ✅ updated\n");

  // ── EDIT 2 : Paseo del Compi GPS ────────────────────────────────
  const stop5 = steps.find((s) => s.step_order === 5);
  if (!stop5) { console.error("No step 5 found"); process.exit(1); }
  console.log(`[EDIT 2] Stop 5 "${stop5.landmark_name}"`);
  console.log(`  old GPS: ${stop5.latitude}, ${stop5.longitude}`);
  console.log(`  new GPS: ${PASEO_LAT}, ${PASEO_LON}`);
  const { error: e2 } = await supa
    .from("game_steps")
    .update({ latitude: PASEO_LAT, longitude: PASEO_LON })
    .eq("id", stop5.id);
  if (e2) { console.error("EDIT 2 failed:", e2); process.exit(1); }
  console.log("  ✅ updated\n");

  // ── EDIT 3 : Replace Stop 7 (Pequeña Cascada → Convento San Pablo) ──
  const stop7 = steps.find((s) => s.step_order === 7);
  if (!stop7) { console.error("No step 7 found"); process.exit(1); }
  console.log(`[EDIT 3] Stop 7 REPLACE`);
  console.log(`  old : "${stop7.landmark_name}" @ ${stop7.latitude}, ${stop7.longitude}`);
  console.log(`  new : "${STOP_7_NEW.landmark_name}" @ ${STOP_7_NEW.latitude}, ${STOP_7_NEW.longitude}`);
  console.log(`  → regenerating riddle/anecdote/landmark_history via Claude...`);

  // Get neighbors for callback continuity
  const stop6 = steps.find((s) => s.step_order === 6);
  const stop8 = steps.find((s) => s.step_order === 8);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }
  const client = new Anthropic({ apiKey });

  const regenPrompt = `You are rewriting ONE stop of an outdoor AR escape-game in Cuenca, Spain.

GAME THEME : "The Hanging Houses" — Master Builder Rodrigo (fictional, 1390-1391), the architect who created the Casas Colgadas. Story arc : his vision (stop 1) → first proof (stops 2-4) → riverside investigation (stop 5) → secret castle workshop (stop 6) → MYSTERIOUS DEATH HERE (stop 7) → final revelation in tower (stop 8).

CURRENT STOP 7 (to replace) :
  landmark_name : "${stop7.landmark_name}"
  riddle : ${stop7.riddle_text}
  anecdote : ${stop7.anecdote}

NEW STOP 7 (replacement) :
  landmark_name : "${STOP_7_NEW.landmark_name}"
  GPS : ${STOP_7_NEW.latitude}, ${STOP_7_NEW.longitude}
  context : ${STOP_7_NEW.context_for_claude}

NEIGHBORING STOPS (preserve narrative coherence) :
  Stop 6 (preceding) : "${stop6?.landmark_name}" — Castillo de Cuenca, where Rodrigo had his hidden workshop with revolutionary blueprints (ARCANUM).
  Stop 8 (following) : "${stop8?.landmark_name}" — Torre de Mangana, where Rodrigo's final secrets converge (LEVITAS, levitation).

INSTRUCTIONS :
  1. The story beat MUST be : Rodrigo's mysterious death is discovered AT this new location (not waterfall anymore — adapt to the monastery).
  2. Keep the answer_text : "MYSTERIUM" (unchanged, already in DB)
  3. Keep the AR character "ghost" tone (he died here)
  4. Reference Stop 6 (the castle workshop) and set up Stop 8 (Torre Mangana revelation)
  5. Write IN ENGLISH (the pipeline translates EN → FR automatically).

OUTPUT — strict JSON only :
{
  "riddle_text": "5-7 sentences, AR-game style, points the player toward observing a specific feature of ${STOP_7_NEW.landmark_name}, ends with an action call to use the AR camera",
  "anecdote": "1-3 sentences thematic explanation of why this site for this story beat",
  "landmark_history": "150-200 words historical background of the REAL ${STOP_7_NEW.landmark_name} in Cuenca",
  "hint_text": "1 sentence : tell player where to point the AR camera"
}`;

  const msg = await client.messages.create(
    {
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      temperature: 0.5,
      messages: [{ role: "user", content: regenPrompt }],
    },
    { timeout: 60_000 },
  );
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const newContent = JSON.parse(jsonText);

  console.log("\n  ── New riddle ──");
  console.log(newContent.riddle_text.split("\n").map((l) => "    " + l).join("\n"));
  console.log("\n  ── New anecdote ──");
  console.log("    " + newContent.anecdote);
  console.log("\n  ── New hint ──");
  console.log("    " + newContent.hint_text);

  // Apply the update
  const updatePayload = {
    name: STOP_7_NEW.name,
    landmark_name: STOP_7_NEW.landmark_name,
    latitude: STOP_7_NEW.latitude,
    longitude: STOP_7_NEW.longitude,
    riddle_text: newContent.riddle_text,
    anecdote: newContent.anecdote,
    landmark_history: { en: newContent.landmark_history },
    hints: [{ order: 1, text: newContent.hint_text }],
  };
  const { error: e3 } = await supa
    .from("game_steps")
    .update(updatePayload)
    .eq("id", stop7.id);
  if (e3) { console.error("EDIT 3 failed:", e3); process.exit(1); }
  console.log("\n  ✅ stop 7 replaced + narration regenerated\n");

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("ALL 3 EDITS APPLIED.");
  console.log("\nNEXT STEPS :");
  console.log("  1. ⚠️  Audio FR for stop 7 needs regeneration (the riddle/anecdote/history changed)");
  console.log("     → run : npx tsx scripts/republish-game.ts les-maisons-suspendues-cuenca --language=fr");
  console.log("  2. After audio regenerated, lift the needs_review flag :");
  console.log("     → run : npx tsx scripts/release-game.ts les-maisons-suspendues-cuenca");
  console.log("══════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
