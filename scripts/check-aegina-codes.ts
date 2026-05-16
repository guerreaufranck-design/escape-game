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

const AEGINA_ID = "ddf0ac68-9402-48d3-877d-f9fdeaf1411c";

async function main() {
  const { data: game } = await sb.from("games").select("*").eq("id", AEGINA_ID).single();
  console.log(`\n🎮 Game: ${game?.title}`);
  console.log(`   slug: ${game?.slug}`);
  console.log(`   created: ${game?.created_at}\n`);

  const { data: codes, error } = await sb
    .from("activation_codes")
    .select("*")
    .eq("game_id", AEGINA_ID)
    .order("created_at", { ascending: false });

  if (error) {
    console.log(`❌ Error: ${error.message}`);
    return;
  }

  if (!codes || codes.length === 0) {
    console.log(`❌ Aucun code créé pour ce jeu`);
    return;
  }

  console.log(`═══════════════════════════════════════════════════════════════════════`);
  console.log(`✅ ${codes.length} code(s) pour Aegina:`);
  console.log(`═══════════════════════════════════════════════════════════════════════\n`);

  for (const c of codes) {
    console.log(`─────────────────────────────────────────────────────────────────────`);
    for (const [k, v] of Object.entries(c)) {
      const display = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
      console.log(`  ${k.padEnd(22)}: ${display}`);
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
