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

async function main() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour

  console.log(`\n🔍 Pipeline activity since ${since}\n`);

  // Recent games
  const { data: games } = await sb
    .from("games")
    .select("id, slug, title, city, difficulty, created_at, needs_review, epilogue_title")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  console.log(`═══════════════════════════════════════════════════════════════════════`);
  console.log(`GAMES créés (dernière heure): ${games?.length ?? 0}`);
  console.log(`═══════════════════════════════════════════════════════════════════════`);
  for (const g of games ?? []) {
    console.log(`  • ${g.title}`);
    console.log(`    slug: ${g.slug}    city: ${g.city}`);
    console.log(`    difficulty: ${g.difficulty}    needs_review: ${g.needs_review}`);
    console.log(`    epilogue: ${g.epilogue_title || "—"}`);
    console.log(`    created: ${g.created_at}`);
    console.log();
  }

  // Recent codes
  const { data: codes } = await sb
    .from("activation_codes")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  console.log(`═══════════════════════════════════════════════════════════════════════`);
  console.log(`CODES créés (dernière heure): ${codes?.length ?? 0}`);
  console.log(`═══════════════════════════════════════════════════════════════════════`);
  for (const c of codes ?? []) {
    console.log(`  • code: ${c.code}`);
    console.log(`    game_id: ${c.game_id}`);
    console.log(`    team: ${c.team_name ?? "—"}    email: ${c.buyer_email ?? "—"}`);
    console.log(`    order_id: ${c.order_id ?? "—"}`);
    console.log(`    created: ${c.created_at}`);
    console.log();
  }

  // For each game, count steps + audio_cache + translations
  if (games && games.length > 0) {
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    console.log(`PRÉPARATION (steps / audio / translations)`);
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    for (const g of games) {
      const { count: stepCount } = await sb.from("game_steps").select("*", { count: "exact", head: true }).eq("game_id", g.id);
      const { count: audioCount } = await sb.from("audio_cache").select("*", { count: "exact", head: true }).eq("game_id", g.id);
      const { count: trCount } = await sb.from("translations").select("*", { count: "exact", head: true }).eq("game_id", g.id);
      console.log(`  • ${g.title}`);
      console.log(`    steps: ${stepCount ?? 0}    audio_cache: ${audioCount ?? 0}    translations: ${trCount ?? 0}`);
    }
  }

  // Error reports
  const { data: errors } = await sb
    .from("pipeline_errors")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (errors && errors.length > 0) {
    console.log(`\n⚠️  PIPELINE ERRORS (dernière heure): ${errors.length}`);
    for (const e of errors) {
      console.log(`  • ${e.created_at}: ${e.error_message ?? JSON.stringify(e)}`);
    }
  } else {
    console.log(`\n✅ Aucune erreur pipeline dans la dernière heure`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
