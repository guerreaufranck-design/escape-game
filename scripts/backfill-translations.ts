/**
 * Backfill the new translation fields (game.title, game.description,
 * step.ar_treasure_reward, step.hints, step.route_attractions) for every
 * (game × language) pair that was previously packaged.
 *
 * The pipeline used to skip these fields, so existing games served them
 * untranslated (often in French) to non-English players. Running this
 * script makes prepareGamePackage idempotent against the new schema —
 * already-cached translations are kept, only the missing ones get filled.
 *
 * Usage:
 *   npx tsx scripts/backfill-translations.ts            # all games × all packaged langs
 *   npx tsx scripts/backfill-translations.ts <gameId>   # restrict to one game
 *   npx tsx scripts/backfill-translations.ts <gameId> <lang>   # one (game, lang) pair
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { prepareGamePackage } from "@/lib/game-package";

async function main() {
  const [, , filterGameId, filterLang] = process.argv;
  const supabase = createAdminClient();

  // Find every (game_id, language) pair that has at least one audio_cache
  // row. That set is exactly the games that have been packaged in the
  // past, so re-running prepareGamePackage on it covers everyone who
  // could be playing today without paying for languages no customer
  // ever bought.
  let query = supabase
    .from("audio_cache")
    .select("game_id, language");
  if (filterGameId) query = query.eq("game_id", filterGameId);
  if (filterLang) query = query.eq("language", filterLang);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[backfill] failed to query audio_cache:", error.message);
    process.exit(1);
  }

  // Dedupe (audio_cache has multiple slots per game × language)
  const pairs = new Set<string>();
  for (const r of rows ?? []) {
    pairs.add(`${r.game_id}|${r.language}`);
  }

  if (pairs.size === 0) {
    console.log("[backfill] nothing to do — no packaged games found");
    return;
  }

  console.log(`[backfill] ${pairs.size} (game × language) pair(s) to process`);

  let ok = 0;
  let failed = 0;
  for (const pair of pairs) {
    const [gameId, language] = pair.split("|");
    process.stdout.write(`[backfill] ${gameId} × ${language} ... `);
    try {
      const res = await prepareGamePackage(gameId, language);
      if (res.success) {
        ok++;
        console.log(
          `OK (audio +${res.audioGenerated}/${res.audioSkipped} skipped, ${res.durationMs}ms)`,
        );
      } else {
        failed++;
        console.log(`FAILED: ${res.errors.join("; ")}`);
      }
    } catch (err) {
      failed++;
      console.log(`THREW: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[backfill] done. ${ok} ok, ${failed} failed.`);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
