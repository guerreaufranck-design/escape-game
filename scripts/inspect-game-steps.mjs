import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,"")]}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: g } = await s.from("games").select("*").eq("id", "68c84e48-631f-4787-b5b9-16658eddc04d").single();
console.log("game start:", g.start_point_lat, g.start_point_lon);
console.log("transport_mode:", g.transport_mode);

// Print ALL columns of game_steps for any debug field
const { data: steps, error } = await s.from("game_steps").select("*").eq("game_id", g.id).order("step_order");
if (error) { console.log("err:", error); process.exit(1); }
console.log(`\n${steps?.length ?? 0} steps:\n`);
for (const st of steps ?? []) {
  console.log(`step ${st.step_order}: ${st.name}`);
  console.log(`  landmark_name: ${st.landmark_name}`);
  console.log(`  lat=${st.latitude}, lon=${st.longitude}`);
  console.log(`  answer_text=${st.answer_text} answer_source=${st.answer_source}`);
  console.log(`  validation_radius_m=${st.validation_radius_meters}`);
}

// Look for any extra debug stored elsewhere (e.g., metadata)
const { data: errReps } = await s.from("error_reports").select("*").gte("created_at", new Date(Date.now()-3600_000).toISOString()).limit(5);
console.log(`\nerror_reports (last hour): ${errReps?.length ?? 0}`);
if (errReps?.length) for (const e of errReps) console.log(`  ${e.created_at}: ${JSON.stringify(e).slice(0,200)}`);
