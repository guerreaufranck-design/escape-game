/**
 * Wipe the Los Cristianos game ("The Code of Ichasagua") and every
 * related row across all tables — steps, sessions, completions, hints,
 * photos, feedback, activation codes, audio_cache, translations_cache.
 *
 * Used to regenerate the game from scratch with the new pipeline so
 * nothing from the old version (untranslated description, missing
 * AR fields, etc.) lingers in any cache.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const GAME_ID = "b9192887-2d5e-4d5d-ae49-30094ce950ec";

async function safeDelete(
  table: string,
  filter: (q: ReturnType<typeof supabase.from>) => unknown,
  label: string,
) {
  const q = supabase.from(table).delete({ count: "exact" });
  const final = filter(q) as ReturnType<typeof q.eq>;
  const { error, count } = await final;
  if (error) {
    console.warn(`  ⚠ ${label}: ${error.message}`);
  } else {
    console.log(`  ✓ ${label}: ${count ?? 0} row(s) deleted`);
  }
}

async function main() {
  console.log(`Deleting game ${GAME_ID} (Los Cristianos)...`);

  // 1. Find related IDs we'll cascade through.
  const { data: sessions } = await supabase
    .from("game_sessions")
    .select("id")
    .eq("game_id", GAME_ID);
  const sessionIds = (sessions || []).map((s) => s.id);
  console.log(`  found ${sessionIds.length} session(s)`);

  const { data: steps } = await supabase
    .from("game_steps")
    .select("id")
    .eq("game_id", GAME_ID);
  const stepIds = (steps || []).map((s) => s.id);
  console.log(`  found ${stepIds.length} step(s)`);

  // 2. Children of sessions
  for (const sid of sessionIds) {
    await safeDelete(
      "step_completions",
      (q) => q.eq("session_id", sid),
      `step_completions for session ${sid.slice(0, 8)}`,
    );
    await safeDelete(
      "hint_uses",
      (q) => q.eq("session_id", sid),
      `hint_uses for session ${sid.slice(0, 8)}`,
    );
  }
  if (sessionIds.length) {
    await safeDelete(
      "game_sessions",
      (q) => q.eq("game_id", GAME_ID),
      "game_sessions",
    );
  }

  // 3. Children of steps
  for (const stepId of stepIds) {
    await safeDelete(
      "step_photos",
      (q) => q.eq("step_id", stepId),
      `step_photos for step ${stepId.slice(0, 8)}`,
    );
    await safeDelete(
      "step_feedback",
      (q) => q.eq("step_id", stepId),
      `step_feedback for step ${stepId.slice(0, 8)}`,
    );
  }

  // 4. Translation cache — three families of source_ids:
  //    a) gameId itself (game.title, game.description, game.epilogue_text)
  //    b) hint-<gameId>-<step>-<idx> (per-hint synthetic key)
  //    c) <stepId> (step.title, step.riddle_text, etc.)
  //    d) <stepId>-attraction-<idx> (per-attraction synthetic key)
  await safeDelete(
    "translations_cache",
    (q) => q.eq("source_id", GAME_ID),
    "translations_cache (game-level)",
  );
  await safeDelete(
    "translations_cache",
    (q) => q.like("source_id", `hint-${GAME_ID}-%`),
    "translations_cache (hints)",
  );
  if (stepIds.length) {
    await safeDelete(
      "translations_cache",
      (q) => q.in("source_id", stepIds),
      "translations_cache (steps)",
    );
    // Attractions are keyed as `<stepId>-attraction-<idx>`. We can't
    // express that with `.in()`, so loop per step.
    for (const stepId of stepIds) {
      await safeDelete(
        "translations_cache",
        (q) => q.like("source_id", `${stepId}-attraction-%`),
        `translations_cache (attractions for step ${stepId.slice(0, 8)})`,
      );
    }
  }

  // 5. Audio + codes
  await safeDelete("audio_cache", (q) => q.eq("game_id", GAME_ID), "audio_cache");
  await safeDelete(
    "activation_codes",
    (q) => q.eq("game_id", GAME_ID),
    "activation_codes",
  );

  // 6. Steps and the game itself
  await safeDelete("game_steps", (q) => q.eq("game_id", GAME_ID), "game_steps");
  await safeDelete("games", (q) => q.eq("id", GAME_ID), "games");

  console.log("\n✅ Done. Los Cristianos is wiped — safe to regenerate.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
