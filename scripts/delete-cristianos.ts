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

type DeleteResult = { error: { message: string } | null; count: number | null };

async function report(label: string, result: DeleteResult) {
  if (result.error) {
    console.warn(`  ⚠ ${label}: ${result.error.message}`);
  } else {
    console.log(`  ✓ ${label}: ${result.count ?? 0} row(s) deleted`);
  }
}

async function main() {
  console.log(`Deleting game ${GAME_ID} (Los Cristianos)...`);

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

  // Children of sessions
  for (const sid of sessionIds) {
    await report(
      `step_completions for session ${sid.slice(0, 8)}`,
      await supabase.from("step_completions").delete({ count: "exact" }).eq("session_id", sid),
    );
    await report(
      `hint_uses for session ${sid.slice(0, 8)}`,
      await supabase.from("hint_uses").delete({ count: "exact" }).eq("session_id", sid),
    );
  }
  if (sessionIds.length) {
    await report(
      "game_sessions",
      await supabase.from("game_sessions").delete({ count: "exact" }).eq("game_id", GAME_ID),
    );
  }

  // Children of steps
  for (const stepId of stepIds) {
    await report(
      `step_photos for step ${stepId.slice(0, 8)}`,
      await supabase.from("step_photos").delete({ count: "exact" }).eq("step_id", stepId),
    );
    await report(
      `step_feedback for step ${stepId.slice(0, 8)}`,
      await supabase.from("step_feedback").delete({ count: "exact" }).eq("step_id", stepId),
    );
  }

  // Translation cache — three families of source_ids:
  //    a) gameId (game.title, game.description, game.epilogue_text)
  //    b) hint-<gameId>-<step>-<idx> (per-hint synthetic key)
  //    c) <stepId> (step.title, step.riddle_text, etc.)
  //    d) <stepId>-attraction-<idx> (per-attraction synthetic key)
  await report(
    "translations_cache (game-level)",
    await supabase.from("translations_cache").delete({ count: "exact" }).eq("source_id", GAME_ID),
  );
  await report(
    "translations_cache (hints)",
    await supabase.from("translations_cache").delete({ count: "exact" }).like("source_id", `hint-${GAME_ID}-%`),
  );
  if (stepIds.length) {
    await report(
      "translations_cache (steps)",
      await supabase.from("translations_cache").delete({ count: "exact" }).in("source_id", stepIds),
    );
    for (const stepId of stepIds) {
      await report(
        `translations_cache (attractions for step ${stepId.slice(0, 8)})`,
        await supabase.from("translations_cache").delete({ count: "exact" }).like("source_id", `${stepId}-attraction-%`),
      );
    }
  }

  // Audio + codes
  await report(
    "audio_cache",
    await supabase.from("audio_cache").delete({ count: "exact" }).eq("game_id", GAME_ID),
  );
  await report(
    "activation_codes",
    await supabase.from("activation_codes").delete({ count: "exact" }).eq("game_id", GAME_ID),
  );

  // Steps and the game itself
  await report(
    "game_steps",
    await supabase.from("game_steps").delete({ count: "exact" }).eq("game_id", GAME_ID),
  );
  await report(
    "games",
    await supabase.from("games").delete({ count: "exact" }).eq("id", GAME_ID),
  );

  console.log("\n✅ Done. Los Cristianos is wiped — safe to regenerate.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
