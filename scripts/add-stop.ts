/**
 * Insère un nouveau stop dans un game existant. Décale automatiquement
 * les step_order suivants si --position est avant la fin. Le stop créé
 * a du contenu placeholder — utilise edit-step ensuite pour remplir.
 *
 * Usage :
 *   npx tsx scripts/add-stop.ts <game-id-or-slug> \
 *     --landmark="Phare Saint-Mathieu" --lat=48.3299 --lon=-4.7709 \
 *     [--position=3] [--title="Le gardien du phare"]
 *
 * Effet : retourne le step-id généré pour pouvoir l'éditer ensuite.
 *   npx tsx scripts/edit-step.ts <new-step-id> riddle_text "..."
 *   npx tsx scripts/edit-step.ts <new-step-id> answer_text "..."
 *   ...
 *   npx tsx scripts/republish-game.ts <slug>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";

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
  const landmark = getArg("landmark");
  const latStr = getArg("lat");
  const lonStr = getArg("lon");
  const positionStr = getArg("position");
  const title = getArg("title") ?? `[NEW STOP — ${landmark ?? "TBD"}]`;

  if (!gameRef || !landmark || !latStr || !lonStr) {
    console.error(
      "Usage: npx tsx scripts/add-stop.ts <game-id-or-slug> --landmark=\"...\" --lat=... --lon=... [--position=N] [--title=\"...\"]",
    );
    process.exit(1);
  }
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error(`lat/lon must be numbers, got lat=${latStr} lon=${lonStr}`);
    process.exit(1);
  }

  // Resolve game by id OR slug
  const isUuid = /^[0-9a-f]{8}-/i.test(gameRef);
  const { data: game, error: gErr } = await sb
    .from("games")
    .select("id, slug, title")
    [isUuid ? "eq" : "eq"](isUuid ? "id" : "slug", gameRef)
    .single();
  if (gErr || !game) {
    console.error(`Game not found: ${gameRef}`);
    process.exit(1);
  }

  // Get current step count
  const { data: existingSteps } = await sb
    .from("game_steps")
    .select("id, step_order, title")
    .eq("game_id", game.id)
    .order("step_order");
  const stepCount = existingSteps?.length ?? 0;
  console.log(
    `Game "${game.title}" (${game.slug}) currently has ${stepCount} stops`,
  );

  // Determine insertion position
  const position = positionStr
    ? Number(positionStr)
    : stepCount + 1;
  if (!Number.isFinite(position) || position < 1 || position > stepCount + 1) {
    console.error(
      `Invalid --position=${positionStr}. Must be 1..${stepCount + 1}.`,
    );
    process.exit(1);
  }

  // Shift existing step_orders >= position
  if (position <= stepCount) {
    const toShift = (existingSteps ?? []).filter(
      (s) => s.step_order >= position,
    );
    console.log(`Shifting ${toShift.length} step(s) +1 to make room at position ${position}`);
    // Two-pass to avoid unique constraint violations: bump by +1000 then -999
    for (const s of toShift) {
      await sb
        .from("game_steps")
        .update({ step_order: s.step_order + 1000 })
        .eq("id", s.id);
    }
    for (const s of toShift) {
      await sb
        .from("game_steps")
        .update({ step_order: s.step_order + 1 })
        .eq("id", s.id);
    }
  }

  // Insert the new stop with placeholder content
  const newStepId = uuidv4();
  const stub = {
    id: newStepId,
    game_id: game.id,
    step_order: position,
    title,
    landmark_name: landmark,
    riddle_text: "[TODO — remplir via edit-step riddle_text]",
    answer_text: "TODO",
    ar_facade_text: "TODO",
    latitude: lat,
    longitude: lon,
    validation_radius_meters: 35,
    hints: [
      { order: 1, text: "[TODO hint 1 — atmospheric nudge]" },
      { order: 2, text: "[TODO hint 2 — open the AR camera]" },
      { order: 3, text: "[TODO hint 3 — answer shape]" },
    ],
    anecdote: "[TODO — remplir via edit-step anecdote]",
    bonus_time_seconds: 0,
    has_photo_challenge: false,
    answer_source: "virtual_ar",
    ar_character_type: "guide_male", // default OddballTrip — change via edit-step si slam-dunk
    ar_character_dialogue: "[TODO — remplir via edit-step ar_character_dialogue]",
    ar_treasure_reward: "[TODO — remplir via edit-step ar_treasure_reward]",
    route_attractions: [],
  };
  const { error: insErr } = await sb.from("game_steps").insert(stub);
  if (insErr) {
    console.error(`Insert failed: ${insErr.message}`);
    process.exit(1);
  }

  console.log(
    `\n✓ New stop inserted at position ${position}/${stepCount + 1}\n` +
      `  step_id : ${newStepId}\n` +
      `  landmark: ${landmark}\n` +
      `  GPS     : ${lat}, ${lon}\n\n` +
      `Next steps :\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} title "Titre poétique"\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} riddle_text "L'énigme..."\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} answer_text "MOTMAGIQUE"\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} anecdote "Fait historique..."\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} hints '[{"order":1,"text":"..."},{"order":2,"text":"..."},{"order":3,"text":"..."}]'\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} ar_character_dialogue "Voix du personnage..."\n` +
      `  npx tsx scripts/edit-step.ts ${newStepId} ar_treasure_reward "Description du trésor..."\n` +
      `  npx tsx scripts/republish-game.ts ${game.slug} --language=fr`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
