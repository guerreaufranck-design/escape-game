/**
 * Full content dump for Magali's Clervaux game (game_id c993f408).
 * Includes: riddle, answer, the 3 unlockable hints, and the treasure
 * description. Used to judge whether the riddles are too cryptic.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const GAME_ID = "c993f408-0d8f-4654-87c7-724471b0bf24";

interface Hint {
  order: number;
  text: string;
}

async function main() {
  const { data: steps } = await supabase
    .from("game_steps")
    .select(
      "step_order, title, riddle_text, answer_text, hints, ar_treasure_reward, ar_facade_text, ar_character_type",
    )
    .eq("game_id", GAME_ID)
    .order("step_order", { ascending: true });

  if (!steps) {
    console.log("No steps found.");
    return;
  }

  for (const s of steps) {
    console.log(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    );
    console.log(`STEP ${s.step_order} — ${s.title}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📜 ENIGME:\n${s.riddle_text}`);
    console.log(`\n✅ REPONSE: "${s.answer_text}"   (perso AR: ${s.ar_character_type})`);
    console.log(`✨ Texte AR sur la facade: ${s.ar_facade_text}`);
    console.log(`\n💡 INDICES (raw shape):`);
    console.log(JSON.stringify(s.hints, null, 2));
    console.log(`\n🏆 Tresor revele: ${s.ar_treasure_reward}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
