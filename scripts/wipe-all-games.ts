/**
 * Hard wipe — delete EVERY game and all dependent rows from the
 * escape-game DB. Used after a test session to start fresh before
 * regenerating with the latest pipeline code.
 *
 * Cascades through: step_completions → hint_uses → game_sessions →
 * activation_codes → step_photos → step_feedback → game_steps → games.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function safeDeleteAll(table: string) {
  // Need a never-true filter that returns all rows.
  // The supabase-js delete() requires WHERE; using neq on uuid id
  // with a sentinel that doesn't exist gets every row.
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) console.warn(`  ⚠ ${table}: ${error.message}`);
  else console.log(`  ✓ ${table}: ${count ?? 0} row(s) deleted`);
}

async function safeDeleteAllCache(table: string, keyCol: string) {
  // For tables without a uuid `id` column (audio_cache, translations_cache),
  // we can't use the same trick as above — we need a column we know
  // accepts neq. game_id (uuid) and source_id (text now) both work.
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .neq(keyCol, "00000000-0000-0000-0000-000000000000");
  if (error) console.warn(`  ⚠ ${table}: ${error.message}`);
  else console.log(`  ✓ ${table}: ${count ?? 0} row(s) deleted`);
}

async function main() {
  console.log("🚮 Wiping ALL games and dependent data...\n");

  // Children first — most dependent tables
  await safeDeleteAll("step_completions");
  await safeDeleteAll("hint_uses");
  await safeDeleteAll("step_photos");
  await safeDeleteAll("step_feedback");
  await safeDeleteAll("game_sessions");
  await safeDeleteAll("activation_codes");

  // Caches keyed by game_id / source_id — drop them all (cheaper to
  // re-fetch on the next playthrough than to keep stale entries that
  // reference deleted games).
  await safeDeleteAllCache("audio_cache", "game_id");
  await safeDeleteAllCache("translations_cache", "source_id");

  await safeDeleteAll("game_steps");
  await safeDeleteAll("games");

  console.log("\n✅ All games and caches wiped.");

  // Final state check
  const { count: gameCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true });
  const { count: codeCount } = await supabase
    .from("activation_codes")
    .select("*", { count: "exact", head: true });
  const { count: stepCount } = await supabase
    .from("game_steps")
    .select("*", { count: "exact", head: true });
  const { count: sessionCount } = await supabase
    .from("game_sessions")
    .select("*", { count: "exact", head: true });

  console.log(`\nFinal state: games=${gameCount ?? "?"}, codes=${codeCount ?? "?"}, steps=${stepCount ?? "?"}, sessions=${sessionCount ?? "?"}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
