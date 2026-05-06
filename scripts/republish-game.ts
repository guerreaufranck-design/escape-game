/**
 * Re-pre-génère audios + traductions pour un jeu après édition manuelle
 * (cf. edit-step.ts / add-stop.ts qui invalident le cache mais ne
 * regénèrent pas).
 *
 * Usage :
 *   npx tsx scripts/republish-game.ts <slug-or-id> [--language=fr]
 *   npx tsx scripts/republish-game.ts <slug-or-id> --languages=fr,en,de
 *
 * Effet :
 *   1. Wipe complet audio_cache + translations_cache du jeu (au cas où
 *      des éditions précédentes auraient laissé du résiduel).
 *   2. Appelle prepareGamePackage(gameId, lang) pour chaque langue
 *      demandée. ElevenLabs + Claude/Gemini regénèrent.
 *   3. À la fin : audios prêts en DB → 0 latence pour le joueur au
 *      démarrage de la session.
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

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const gameRef = process.argv[2];
  if (!gameRef) {
    console.error(
      "Usage: npx tsx scripts/republish-game.ts <slug-or-id> [--language=fr] [--languages=fr,en]",
    );
    process.exit(1);
  }

  const isUuid = /^[0-9a-f]{8}-/i.test(gameRef);
  const { data: game, error: gErr } = await sb
    .from("games")
    .select("id, slug, title")
    .eq(isUuid ? "id" : "slug", gameRef)
    .single();
  if (gErr || !game) {
    console.error(`Game not found: ${gameRef}`);
    process.exit(1);
  }

  console.log(`Game: "${game.title}" (${game.slug}) — id ${game.id}`);

  // Determine languages to regen
  const single = getArg("language");
  const multi = getArg("languages");
  const languages = (multi ? multi.split(",") : single ? [single] : ["fr"])
    .map((l) => l.trim().toLowerCase())
    .filter((l) => /^[a-z]{2}$/.test(l));
  if (languages.length === 0) {
    console.error("No valid languages. Use --language=fr or --languages=fr,en");
    process.exit(1);
  }
  console.log(`Languages to re-prepare: ${languages.join(", ")}`);

  // Wipe stale cache for the whole game
  const { data: steps } = await sb
    .from("game_steps")
    .select("id")
    .eq("game_id", game.id);
  const stepIds = (steps ?? []).map((s) => s.id);
  const r1 = await sb
    .from("audio_cache")
    .delete({ count: "exact" })
    .eq("game_id", game.id);
  const r2 = stepIds.length
    ? await sb
        .from("translations_cache")
        .delete({ count: "exact" })
        .in("source_id", stepIds)
    : { count: 0 };
  console.log(
    `Cleared: audio_cache=${r1.count ?? 0} row(s), translations_cache=${r2.count ?? 0} row(s)`,
  );

  // Re-pre-generate per language
  // We import prepareGamePackage from the lib at runtime to avoid pulling
  // Next.js context — it's a pure async function operating on DB + APIs.
  const { prepareGamePackage } = await import("../src/lib/game-package");
  for (const lang of languages) {
    const t0 = Date.now();
    console.log(`\n→ prepareGamePackage(${game.id}, "${lang}") ...`);
    try {
      const result = await prepareGamePackage(game.id, lang);
      const ms = Date.now() - t0;
      if (result.success) {
        console.log(
          `  ✓ done in ${Math.round(ms / 1000)}s — generated=${result.audioGenerated}, skipped=${result.audioSkipped}, failed=${result.audioFailed}`,
        );
      } else {
        console.warn(
          `  ⚠ returned errors: ${result.errors?.join("; ") ?? "(none listed)"}`,
        );
      }
    } catch (err) {
      console.error(
        `  ✗ threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `\n✓ Republish complete. Game is ready to play in ${languages.join(", ")} with the new content.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
