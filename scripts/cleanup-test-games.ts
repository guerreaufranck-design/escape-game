/**
 * Delete the two King's Cross test games (test runs by the admin, not
 * paying customers). Preserves the Clervaux game c993f408 (paying
 * customer Magali) and any other production games.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TEST_GAME_IDS = [
  // Agen test game — broken facade_text mismatches + missing route_attractions
  "c37949d1-1dcc-40ae-a222-f70842b208f9",
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
  for (const gameId of TEST_GAME_IDS) {
    console.log(`\nDeleting test game ${gameId}...`);

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

  console.log("\n✅ Test games cleaned up.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
