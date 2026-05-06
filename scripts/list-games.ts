/**
 * Quick list of published games — slug + city + theme. Used to pick
 * candidates for the genre-overrides MVP test.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Cherche .env.local dans le cwd, puis remonte jusqu'à 4 niveaux —
// nécessaire pour lancer depuis une worktree git où .env.local vit
// au root du projet principal.
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
  const { data, error } = await sb
    .from("games")
    .select("slug, city, title, created_at")
    .eq("is_published", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  for (const g of data ?? []) {
    console.log(
      `${g.created_at?.slice(0, 10)}  ${g.city.padEnd(20)}  ${g.slug.padEnd(60)}  ${g.title}`,
    );
  }
  console.log(`\nTotal: ${data?.length ?? 0} published games`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
