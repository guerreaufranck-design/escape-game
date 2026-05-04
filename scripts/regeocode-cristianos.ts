/**
 * Re-geocode every step of Los Cristianos with the new geocoder so the
 * coords match the real landmarks. Used after the field test surfaced
 * a ~280 m drift on step 1 (sanctuary at 28.05, -16.718 vs the actual
 * church at 28.052297, -16.717347).
 *
 * Conservative — only overrides when the geocode result is high
 * confidence AND the drift is > 30 m. Logs every step so the operator
 * can sanity-check before assuming it's right.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { geocodeLocation, haversineMeters } from "../src/lib/geocode";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Step 1 has no real building name in the data — Claude wrote a
// fictional "Sacred Ground". The user confirmed by foot that step 1
// is meant to be the central church. We pin it explicitly.
// Steps 2-5 are looked up from their step title via the geocoder.
const FORCED_LANDMARKS: Record<number, string> = {
  1: "Iglesia de Nuestra Señora del Carmen",
  // 2-5: derived from step title automatically below.
};

interface StepRow {
  id: string;
  step_order: number;
  title: unknown;
  latitude: number;
  longitude: number;
}

function asString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, string>;
    return o.en || o.fr || Object.values(o)[0] || "";
  }
  return String(v);
}

async function main() {
  const { data: g } = await supabase
    .from("games")
    .select("id, city")
    .ilike("city", "%cristianos%")
    .single();
  if (!g) {
    console.error("Los Cristianos game not found");
    process.exit(1);
  }
  const city = "Los Cristianos";
  const country = "Spain";
  console.log(`Re-geocoding ${city}, ${country} (game ${g.id})\n`);

  const { data: steps } = await supabase
    .from("game_steps")
    .select("id, step_order, title, latitude, longitude")
    .eq("game_id", g.id)
    .order("step_order");

  for (const s of (steps || []) as StepRow[]) {
    const titleStr = asString(s.title);
    const landmark = FORCED_LANDMARKS[s.step_order] ?? titleStr;
    console.log(`── step ${s.step_order} ────────────────────────`);
    console.log(`   title: ${titleStr}`);
    console.log(`   geocoding query: "${landmark}"`);
    console.log(`   current: ${s.latitude}, ${s.longitude}`);

    const geo = await geocodeLocation(landmark, city, country);
    if (!geo) {
      console.log(`   → no geocode result, KEEP existing\n`);
      continue;
    }
    const drift = haversineMeters(
      { lat: s.latitude, lon: s.longitude },
      { lat: geo.lat, lon: geo.lon },
    );
    console.log(`   geocoded: ${geo.lat}, ${geo.lon}`);
    console.log(`   source: ${geo.source}, confidence: ${geo.confidence}`);
    console.log(`   drift: ${Math.round(drift)} m`);
    console.log(`   match: ${geo.displayName}`);

    if (drift <= 30) {
      console.log(`   → within 30 m tolerance, KEEP existing\n`);
      continue;
    }

    // Override
    const { error } = await supabase
      .from("game_steps")
      .update({ latitude: geo.lat, longitude: geo.lon })
      .eq("id", s.id);
    if (error) {
      console.log(`   → UPDATE FAILED: ${error.message}\n`);
    } else {
      console.log(`   → UPDATED ✓\n`);
    }
  }

  console.log("\nDone. Re-run audit-tournus-game.ts (or the Cristianos one) to verify.");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
