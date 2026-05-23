/**
 * Watch ALL new game inserts in DB.
 *
 * Polls games table every 20s for any new row created in the last 30 min.
 * Emits one line per new game observed (state CHANGE).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }),
);
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const seen = new Set();
let iter = 0;
const startTs = new Date(Date.now() - 5 * 60_000).toISOString();
console.log(`[watch-all] starting — looking back to ${startTs}`);

while (iter++ < 90) {
  const { data, error } = await supa
    .from("games")
    .select("id, slug, title, city, transport_mode, created_at, is_published, needs_review, review_reason")
    .gte("created_at", startTs)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.log(`[watch-all] err: ${error.message}`);
  } else {
    for (const g of data ?? []) {
      const key = `${g.id}::${g.is_published}::${g.needs_review}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(
          `[watch-all] NEW STATE id=${g.id} slug=${g.slug} city=${g.city} pub=${g.is_published} review=${g.needs_review} mode=${g.transport_mode} created=${g.created_at}`,
        );
        if (g.review_reason) {
          console.log(`           reason: ${g.review_reason.slice(0, 300)}`);
        }
      }
    }
  }

  await new Promise((r) => setTimeout(r, 20_000));
}
console.log(`[watch-all] iters exhausted`);
