import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,"")]}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const id = "69db60e3-d417-40be-b1b3-91c16cd8b56d";
const { data: g } = await s.from("games").select("*").eq("id", id).single();
console.log("=== V8 game ===");
for (const k of ["id","slug","title","city","transport_mode","start_point_lat","start_point_lon","is_published","needs_review","created_at"]) console.log(`  ${k}: ${g[k]}`);
console.log(`\n=== REVIEW_REASON FULL ===\n${g.review_reason}\n`);

const { data: steps } = await s.from("game_steps").select("step_order, name, landmark_name, latitude, longitude, answer_text").eq("game_id", id).order("step_order");
console.log(`=== ${steps?.length ?? 0} STOPS ===`);
function hav(a,b){const R=6371000;const tr=d=>d*Math.PI/180;const dL=tr(b.lat-a.lat);const dO=tr(b.lon-a.lon);const h=Math.sin(dL/2)**2+Math.cos(tr(a.lat))*Math.cos(tr(b.lat))*Math.sin(dO/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
for (const st of steps ?? []) {
  const d = hav({lat:g.start_point_lat,lon:g.start_point_lon},{lat:st.latitude,lon:st.longitude});
  console.log(`  ${st.step_order}. ${st.landmark_name || st.name}  ans=${st.answer_text}  (${Math.round(d)}m from start)`);
}
