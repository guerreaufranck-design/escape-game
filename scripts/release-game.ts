/**
 * Lève le flag `needs_review` sur un jeu après que l'opérateur l'a
 * inspecté (et corrigé si besoin via edit-step + republish-game).
 *
 * Une fois le flag levé, oddballtrip libère automatiquement l'envoi
 * du code activation au client.
 *
 * Usage :
 *   npx tsx scripts/release-game.ts <slug-or-id>
 */
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
  const gameRef = process.argv[2];
  if (!gameRef) {
    console.error(
      "Usage: npx tsx scripts/release-game.ts <slug-or-id>",
    );
    process.exit(1);
  }

  const isUuid = /^[0-9a-f]{8}-/i.test(gameRef);
  const { data: game, error: gErr } = await sb
    .from("games")
    .select("id, slug, title, city, needs_review, review_reason")
    .eq(isUuid ? "id" : "slug", gameRef)
    .single();
  if (gErr || !game) {
    console.error(`Game not found: ${gameRef}`);
    process.exit(1);
  }

  console.log(`Game: "${game.title}" (${game.slug}) — id ${game.id}`);
  console.log(`City: ${game.city}`);
  console.log(`Current state:`);
  console.log(`  needs_review = ${game.needs_review}`);
  console.log(`  review_reason = ${game.review_reason ?? "(null)"}`);

  if (!game.needs_review) {
    console.log(`\n✓ Game is already released (needs_review=false). Nothing to do.`);
    return;
  }

  const { error: updErr } = await sb
    .from("games")
    .update({
      needs_review: false,
      review_reason: null,
    })
    .eq("id", game.id);
  if (updErr) {
    console.error(`Update failed: ${updErr.message}`);
    process.exit(1);
  }

  console.log(`\n✓ Game released — needs_review set to FALSE.`);
  console.log(`  oddballtrip can now emit the activation code to the client.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
