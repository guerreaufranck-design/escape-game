/**
 * Dump full content of the latest Cuenca game (all stops + GPS + narration).
 * Pass the slug as arg or it'll fetch the most recent Cuenca game.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }),
);
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const slugArg = process.argv[2];
let game;
if (slugArg) {
  const { data } = await supa.from("games").select("*").eq("slug", slugArg).single();
  game = data;
} else {
  const { data } = await supa
    .from("games")
    .select("*")
    .ilike("city", "%cuenca%")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  game = data;
}
if (!game) {
  console.log("No game found.");
  process.exit(1);
}

console.log("══════════════════════════════════════════════════════════════════");
console.log(`GAME : ${game.title}`);
console.log(`Slug : ${game.slug}`);
console.log(`City : ${game.city}`);
console.log(`Theme description : ${game.theme_description ?? "(none)"}`);
console.log(`Transport mode : ${game.transport_mode}`);
console.log(`Start point : ${game.start_point_lat}, ${game.start_point_lon}`);
console.log(`Created : ${game.created_at}`);
console.log(`is_published=${game.is_published}  needs_review=${game.needs_review}`);
if (game.review_reason) {
  console.log(`\nReview reason :\n${game.review_reason}`);
}
console.log("══════════════════════════════════════════════════════════════════\n");

const { data: steps } = await supa
  .from("game_steps")
  .select("*")
  .eq("game_id", game.id)
  .order("step_order");

function hav(a, b) {
  const R = 6371000;
  const tr = (d) => (d * Math.PI) / 180;
  const dL = tr(b.lat - a.lat);
  const dO = tr(b.lon - a.lon);
  const h =
    Math.sin(dL / 2) ** 2 +
    Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

console.log(`\n=== ${steps?.length ?? 0} STOPS ===\n`);
let prev = { lat: game.start_point_lat, lon: game.start_point_lon };
for (const s of steps ?? []) {
  const distFromStart = hav(
    { lat: game.start_point_lat, lon: game.start_point_lon },
    { lat: s.latitude, lon: s.longitude },
  );
  const hopFromPrev = hav(
    prev,
    { lat: s.latitude, lon: s.longitude },
  );
  console.log("─".repeat(70));
  console.log(`STEP ${s.step_order} — ${s.landmark_name || s.name || s.title}`);
  console.log(`  📍 GPS : ${s.latitude}, ${s.longitude}`);
  console.log(`         (copy-paste : ${s.latitude},${s.longitude})`);
  console.log(`  📏 ${Math.round(distFromStart)}m from start | ${Math.round(hopFromPrev)}m hop from previous`);
  console.log(`  🎯 Validation radius : ${s.validation_radius_meters}m`);
  console.log(`  ✨ Answer : ${s.answer_text}  (${s.answer_source})`);
  if (s.ar_facade_text) console.log(`  🪄 AR facade text : "${s.ar_facade_text}"`);
  if (s.ar_character_type) console.log(`  🎭 AR character : ${s.ar_character_type}`);

  if (s.riddle_text) {
    console.log(`\n  📜 RIDDLE :\n${s.riddle_text.split("\n").map((l) => `     ${l}`).join("\n")}`);
  }
  if (s.anecdote) {
    console.log(`\n  📖 ANECDOTE :\n${s.anecdote.split("\n").map((l) => `     ${l}`).join("\n")}`);
  }
  if (s.landmark_history) {
    const lh = typeof s.landmark_history === "string"
      ? s.landmark_history
      : JSON.stringify(s.landmark_history).slice(0, 1500);
    console.log(`\n  🏛️ LANDMARK HISTORY :\n${lh.split("\n").map((l) => `     ${l}`).join("\n")}`);
  }
  if (s.hints && Array.isArray(s.hints)) {
    console.log(`\n  💡 HINTS :`);
    for (const h of s.hints) {
      const txt = typeof h === "string" ? h : (h.text ?? JSON.stringify(h));
      const ord = typeof h === "object" && h.order !== undefined ? h.order : "•";
      console.log(`     ${ord}. ${txt}`);
    }
  }
  console.log("");
  prev = { lat: s.latitude, lon: s.longitude };
}

console.log("══════════════════════════════════════════════════════════════════");
console.log(`Total stops : ${steps?.length ?? 0}`);
console.log(`game_id : ${game.id}`);
console.log("══════════════════════════════════════════════════════════════════");
