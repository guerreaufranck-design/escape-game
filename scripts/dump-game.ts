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

const slug = process.argv[2];
if (!slug) { console.error("usage: dump-game <slug>"); process.exit(1); }

async function main() {
  const { data: game } = await sb.from("games").select("*").eq("slug", slug).single();
  if (!game) { console.error(`No game with slug ${slug}`); process.exit(1); }
  const { data: steps } = await sb.from("game_steps").select("*").eq("game_id", game.id).order("step_order");

  console.log(`═══════════════════════════════════════════════════════════════════════`);
  console.log(`GAME: ${game.title}`);
  console.log(`Slug: ${game.slug}    City: ${game.city}    Difficulty: ${game.difficulty}`);
  console.log(`Description: ${game.description}`);
  console.log(`═══════════════════════════════════════════════════════════════════════`);

  for (const s of steps ?? []) {
    console.log(`\n────────  STEP ${s.step_order}/${steps?.length}  ────────`);
    console.log(`Title          : ${s.title}`);
    console.log(`Landmark (real): ${s.landmark_name}`);
    console.log(`GPS            : ${s.latitude}, ${s.longitude}   (radius ${s.validation_radius_meters}m)`);
    console.log(`AR character   : ${s.ar_character_type}`);
    console.log(`AR facade text : "${s.ar_facade_text}"`);
    console.log(`Answer text    : "${s.answer_text}"`);
    console.log(`AR dialogue    : ${s.ar_character_dialogue}`);
    console.log(`AR treasure    : ${s.ar_treasure_reward}`);
    console.log(`\nRiddle:\n${s.riddle_text}`);
    console.log(`\nAnecdote:\n${s.anecdote}`);
    if (s.hints) {
      console.log(`\nHints:`);
      for (const h of s.hints) console.log(`  ${h.order}. ${h.text}`);
    }
    if (Array.isArray(s.route_attractions) && s.route_attractions.length) {
      console.log(`\nRoute attractions:`);
      for (const ra of s.route_attractions) console.log(`  • ${ra.name} — ${ra.fact}`);
    }
  }

  if (game.epilogue_title || game.epilogue_text) {
    console.log(`\n═══════════════════════════════════════════════════════════════════════`);
    console.log(`EPILOGUE: ${game.epilogue_title}`);
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    console.log(game.epilogue_text);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
