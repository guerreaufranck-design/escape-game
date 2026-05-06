/**
 * Édite un champ d'un game_step et invalide les caches audio/traductions
 * affectés. Permet la phase de review manuelle entre la génération du
 * jeu et le démarrage par le joueur.
 *
 * Usage :
 *   npx tsx scripts/edit-step.ts <step-id> <field> <value>
 *   npx tsx scripts/edit-step.ts <step-id> hints '[{"order":1,"text":"..."},...]'
 *
 * Champs éditables (whitelist) :
 *   title, riddle_text, answer_text, ar_facade_text, ar_character_type,
 *   ar_character_dialogue, ar_treasure_reward, anecdote, hints,
 *   validation_radius_meters, latitude, longitude, bonus_time_seconds
 *
 * Effets de bord automatiques :
 *   - answer_text édité → ar_facade_text aligné en uppercase
 *   - champs textuels édités → DELETE audio_cache (game_id) + translations_cache (source_id)
 *   - lat/lon édité → warning radar (vérification visuelle requise)
 *
 * Après édition : `npx tsx scripts/republish-game.ts <slug>` pour ré-pre-gen audio.
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

const EDITABLE_TEXT_FIELDS = new Set([
  "title",
  "riddle_text",
  "answer_text",
  "ar_facade_text",
  "ar_character_type",
  "ar_character_dialogue",
  "ar_treasure_reward",
  "anecdote",
]);
const EDITABLE_NUMERIC_FIELDS = new Set([
  "validation_radius_meters",
  "latitude",
  "longitude",
  "bonus_time_seconds",
]);
const EDITABLE_JSON_FIELDS = new Set(["hints"]);

const ALL_EDITABLE = new Set([
  ...EDITABLE_TEXT_FIELDS,
  ...EDITABLE_NUMERIC_FIELDS,
  ...EDITABLE_JSON_FIELDS,
]);

async function main() {
  const [, , stepId, field, ...valueParts] = process.argv;
  const value = valueParts.join(" ");

  if (!stepId || !field || !value) {
    console.error(
      "Usage: npx tsx scripts/edit-step.ts <step-id> <field> <value>\n" +
        `Editable fields: ${[...ALL_EDITABLE].sort().join(", ")}`,
    );
    process.exit(1);
  }

  if (!ALL_EDITABLE.has(field)) {
    console.error(
      `Field "${field}" not in whitelist. Editable: ${[...ALL_EDITABLE].sort().join(", ")}`,
    );
    process.exit(1);
  }

  const { data: step, error: getErr } = await sb
    .from("game_steps")
    .select("id, game_id, step_order, title, answer_text, ar_facade_text")
    .eq("id", stepId)
    .single();

  if (getErr || !step) {
    console.error(`Step not found: ${stepId}`);
    process.exit(1);
  }

  console.log(
    `Found step ${step.step_order} ("${step.title}") in game ${step.game_id}`,
  );

  // Build the update payload
  const update: Record<string, unknown> = {};
  if (EDITABLE_NUMERIC_FIELDS.has(field)) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      console.error(`Field "${field}" expects a number, got: "${value}"`);
      process.exit(1);
    }
    update[field] = n;
  } else if (EDITABLE_JSON_FIELDS.has(field)) {
    try {
      update[field] = JSON.parse(value);
    } catch (e) {
      console.error(`Field "${field}" expects JSON, parse error: ${e}`);
      process.exit(1);
    }
  } else {
    update[field] = value;
  }

  // answer_text → ar_facade_text alignment (the runtime checks this)
  if (field === "answer_text") {
    const upper = value.toUpperCase();
    update.ar_facade_text = upper;
    console.log(`  → also setting ar_facade_text = "${upper}" (uppercase rule)`);
  } else if (field === "ar_facade_text") {
    if (value.toUpperCase() !== value) {
      console.warn(
        `  ⚠ ar_facade_text "${value}" is not uppercase — runtime expects uppercase. Fix manually if needed.`,
      );
    }
    if (step.answer_text && step.answer_text.toUpperCase() !== value.toUpperCase()) {
      console.warn(
        `  ⚠ ar_facade_text "${value}" doesn't match answer_text "${step.answer_text}" uppercase. Player won't be able to type the correct answer.`,
      );
    }
  }

  // Run the update
  const { error: updErr } = await sb
    .from("game_steps")
    .update(update)
    .eq("id", stepId);
  if (updErr) {
    console.error(`Update failed: ${updErr.message}`);
    process.exit(1);
  }
  console.log(`✓ Updated game_steps.${field} = ${JSON.stringify(update[field]).slice(0, 80)}`);
  if (update.ar_facade_text !== undefined && field === "answer_text") {
    console.log(`✓ Updated game_steps.ar_facade_text = "${update.ar_facade_text}"`);
  }

  // Invalidate caches for content fields
  const TEXT_AFFECTING = new Set([
    "title",
    "riddle_text",
    "answer_text",
    "ar_facade_text",
    "ar_character_dialogue",
    "ar_treasure_reward",
    "anecdote",
    "hints",
  ]);
  if (TEXT_AFFECTING.has(field)) {
    const r1 = await sb
      .from("audio_cache")
      .delete({ count: "exact" })
      .eq("game_id", step.game_id);
    const r2 = await sb
      .from("translations_cache")
      .delete({ count: "exact" })
      .eq("source_id", stepId);
    console.log(
      `✓ Cache invalidated: audio=${r1.count ?? 0} row(s) (whole game), translations=${r2.count ?? 0} row(s) (this step)`,
    );
    console.log(
      `\nNext: npx tsx scripts/republish-game.ts <slug> [--language=fr]  to re-pre-generate audio + translations.`,
    );
  }

  if (field === "latitude" || field === "longitude") {
    console.warn(
      `\n⚠ GPS coord modified — verify visually on a map. The radar uses these coords with validation_radius_meters=${step.step_order ? "(check step)" : "?"} for player tracking.`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
