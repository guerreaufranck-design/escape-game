/**
 * Surgical cleanup — deletes ONLY the FR translation_cache entries
 * tied to a specific game. Does NOT touch the game itself, its steps,
 * activation_codes, sessions, or completions. The game stays fully
 * playable; the next loader (Magali) just gets fresh Gemini
 * translations instead of the possibly-poisoned cached values.
 *
 * Cache entries we're cleaning, all on language='fr':
 *   - game-level fields            : source_id = GAME_ID
 *   - per-step fields              : source_id IN (step_ids of game)
 *   - route_attractions            : source_id LIKE '<step_id>-attraction-%'
 *   - hints                        : source_id LIKE 'hint-<game_id>-%'
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const GAME_ID = "6a924ec5-1967-4e8f-a790-689895827464";
const LANGUAGE = "fr";

async function main() {
  console.log(
    `🧹 Cleaning translation cache for game ${GAME_ID}, language=${LANGUAGE}\n`,
  );

  // Step ids belonging to this game
  const { data: steps } = await supabase
    .from("game_steps")
    .select("id")
    .eq("game_id", GAME_ID);
  const stepIds = (steps || []).map((s) => s.id);
  console.log(`Found ${stepIds.length} step(s) for this game.`);

  let total = 0;

  // Game-level fields (title, description, epilogue_title, epilogue_text)
  {
    const { error, count } = await supabase
      .from("translations_cache")
      .delete({ count: "exact" })
      .eq("source_id", GAME_ID)
      .eq("language", LANGUAGE);
    if (error) console.warn(`  ⚠ game-level: ${error.message}`);
    else {
      console.log(`  ✓ game-level fields: ${count ?? 0} row(s) deleted`);
      total += count ?? 0;
    }
  }

  // Per-step fields (one source_id per step)
  for (const sid of stepIds) {
    const { error, count } = await supabase
      .from("translations_cache")
      .delete({ count: "exact" })
      .eq("source_id", sid)
      .eq("language", LANGUAGE);
    if (error) console.warn(`  ⚠ step ${sid.slice(0, 8)}: ${error.message}`);
    else if ((count ?? 0) > 0) {
      console.log(`  ✓ step ${sid.slice(0, 8)}: ${count} row(s) deleted`);
      total += count ?? 0;
    }
  }

  // Route attractions — source_id pattern '<step_id>-attraction-<idx>'
  for (const sid of stepIds) {
    const { error, count } = await supabase
      .from("translations_cache")
      .delete({ count: "exact" })
      .like("source_id", `${sid}-attraction-%`)
      .eq("language", LANGUAGE);
    if (error)
      console.warn(`  ⚠ attraction ${sid.slice(0, 8)}: ${error.message}`);
    else if ((count ?? 0) > 0) {
      console.log(`  ✓ attractions ${sid.slice(0, 8)}: ${count} row(s) deleted`);
      total += count ?? 0;
    }
  }

  // Hints — source_id pattern 'hint-<game_id>-<step>-<idx>'
  {
    const { error, count } = await supabase
      .from("translations_cache")
      .delete({ count: "exact" })
      .like("source_id", `hint-${GAME_ID}-%`)
      .eq("language", LANGUAGE);
    if (error) console.warn(`  ⚠ hints: ${error.message}`);
    else {
      console.log(`  ✓ hints: ${count ?? 0} row(s) deleted`);
      total += count ?? 0;
    }
  }

  console.log(
    `\n✅ Done. ${total} stale FR translation row(s) cleaned. Game and session are untouched.`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
