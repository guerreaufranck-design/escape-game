/**
 * Hard delete of Magali Fontaine's broken Clervaux session.
 *   game c993f408 → 8 game_steps (with empty hints — root cause)
 *   session 3b2cf8f3 → 2 step_completions
 *   activation_code CLER-E5M2-RJUP (used 1/1)
 *   typo'd duplicate code CLER-Y8UN-BYRL (gamail.com)
 *
 * Customer recovery path: this clean slate lets the admin generate a
 * fresh game from OddballTrip, send a new code by email, and add a
 * 1-year free-game voucher with an apology.
 *
 * Also handles the orphan duplicate Clervaux game bfecc97d that the
 * cron created without attaching a code.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const GAME_IDS = [
  "c993f408-0d8f-4654-87c7-724471b0bf24", // Magali's broken game
  "bfecc97d-5af1-420b-ab7e-de981f273471", // orphan Clervaux duplicate from yesterday
];

async function safeDelete(table: string, col: string, val: string) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .eq(col, val);
  if (error) console.warn(`  ⚠ ${table}: ${error.message}`);
  else console.log(`  ✓ ${table}: ${count ?? 0} row(s) deleted`);
}

async function main() {
  for (const gameId of GAME_IDS) {
    console.log(`\nDeleting game ${gameId}...`);

    const { data: sessions } = await supabase
      .from("game_sessions")
      .select("id")
      .eq("game_id", gameId);
    const sessionIds = (sessions || []).map((s) => s.id);

    const { data: steps } = await supabase
      .from("game_steps")
      .select("id")
      .eq("game_id", gameId);
    const stepIds = (steps || []).map((s) => s.id);

    for (const sid of sessionIds) {
      await safeDelete("step_completions", "session_id", sid);
      await safeDelete("hint_uses", "session_id", sid);
    }
    if (sessionIds.length) {
      const { error: e, count } = await supabase
        .from("game_sessions")
        .delete({ count: "exact" })
        .eq("game_id", gameId);
      if (e) console.warn(`  ⚠ game_sessions: ${e.message}`);
      else console.log(`  ✓ game_sessions: ${count ?? 0} row(s) deleted`);
    }

    for (const sid of stepIds) {
      await safeDelete("step_photos", "step_id", sid);
      await safeDelete("step_feedback", "step_id", sid);
    }

    await safeDelete("activation_codes", "game_id", gameId);
    await safeDelete("game_steps", "game_id", gameId);
    await safeDelete("games", "id", gameId);
  }
  console.log("\n✅ Magali's broken game + orphan duplicate gone.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
