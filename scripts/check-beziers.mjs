import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
    })
);

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supa
  .from("games")
  .select("id, slug, title, city, created_at, is_published, needs_review, review_reason")
  .ilike("city", "%beziers%")
  .order("created_at", { ascending: false });

if (error) {
  console.error("ERROR", error);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
console.log(`\nTotal: ${data.length} game(s)`);
