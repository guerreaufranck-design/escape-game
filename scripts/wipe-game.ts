/**
 * Wipe ciblé d'un jeu (ou plusieurs) par slug. Cascade complète :
 *   step_completions → game_sessions → activation_codes → audio_cache
 *   → translations_cache → game_steps → games
 *
 * Utilisé pour libérer un slug afin qu'oddballtrip puisse re-déclencher
 * la pipeline (idempotency guard sinon empêche la régénération).
 *
 * Usage :
 *   npx tsx scripts/wipe-game.ts <slug-or-id>
 *   npx tsx scripts/wipe-game.ts <slug1> <slug2> <slug3> ...
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

for (const rel of [".env.local", "../.env.local", "../../.env.local", "../../../.env.local", "../../../../.env.local"]) {
  const p = resolve(process.cwd(), rel);
  if (existsSync(p)) { config({ path: p, override: true }); break; }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function wipeOne(ref: string): Promise<boolean> {
  const isUuid = /^[0-9a-f]{8}-/i.test(ref);
  const { data: game, error: gErr } = await sb
    .from("games")
    .select("id, slug, title, city")
    .eq(isUuid ? "id" : "slug", ref)
    .maybeSingle();
  if (gErr) {
    console.error(`  ✗ ${ref}: lookup error: ${gErr.message}`);
    return false;
  }
  if (!game) {
    console.log(`  · ${ref}: not in DB (already wiped or never existed)`);
    return true;
  }

  console.log(`\n→ Wiping "${game.title}" (${game.slug}) — id ${game.id} (${game.city})`);

  // Get step IDs for translations_cache + step_completions cascade
  const { data: steps } = await sb
    .from("game_steps")
    .select("id")
    .eq("game_id", game.id);
  const stepIds = (steps ?? []).map((s) => s.id);

  // Cascade — children first
  const r1 = stepIds.length
    ? await sb.from("step_completions").delete({ count: "exact" }).in("step_id", stepIds)
    : { count: 0 };
  const r2 = await sb.from("game_sessions").delete({ count: "exact" }).eq("game_id", game.id);
  const r3 = await sb.from("activation_codes").delete({ count: "exact" }).eq("game_id", game.id);
  const r4 = await sb.from("audio_cache").delete({ count: "exact" }).eq("game_id", game.id);
  const r5 = stepIds.length
    ? await sb.from("translations_cache").delete({ count: "exact" }).in("source_id", stepIds)
    : { count: 0 };
  const r6 = await sb.from("game_steps").delete({ count: "exact" }).eq("game_id", game.id);
  const r7 = await sb.from("games").delete({ count: "exact" }).eq("id", game.id);

  console.log(
    `  step_completions=${r1.count ?? 0}, sessions=${r2.count ?? 0}, codes=${r3.count ?? 0}, audio=${r4.count ?? 0}, translations=${r5.count ?? 0}, steps=${r6.count ?? 0}, games=${r7.count ?? 0}`,
  );
  return true;
}

async function main() {
  const refs = process.argv.slice(2);
  if (refs.length === 0) {
    console.error(
      "Usage: npx tsx scripts/wipe-game.ts <slug-or-id> [<slug-or-id>...]",
    );
    process.exit(1);
  }

  let success = 0;
  for (const ref of refs) {
    if (await wipeOne(ref)) success++;
  }
  console.log(`\n✅ Wiped ${success}/${refs.length} games.`);
  console.log(
    `\nNext: re-trigger generation from oddballtrip admin for each slug to regenerate with the latest pipeline code.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
