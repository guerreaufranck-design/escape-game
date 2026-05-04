/**
 * Coordinate sanity audit across every game in the DB.
 *
 * For each game, geocodes the city to get a city-center reference,
 * then measures the haversine distance of every step from that
 * center. Anything more than 5 km away is almost certainly an LLM
 * hallucination — the player will never reach it within an
 * advertised "walkable city tour".
 *
 * Output: a table of game × step with status (OK / WARNING /
 * CRITICAL) so the operator can decide which games to patch first.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { geocodeLocation, haversineMeters } from "../src/lib/geocode";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface StepRow {
  step_order: number;
  title: unknown;
  latitude: number;
  longitude: number;
  validation_radius_meters: number;
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

function statusOf(driftMeters: number): { tag: string; color: string } {
  if (driftMeters < 500) return { tag: "OK", color: "green" };
  if (driftMeters < 2000) return { tag: "WARNING", color: "yellow" };
  return { tag: "CRITICAL", color: "red" };
}

async function main() {
  const { data: games } = await supabase
    .from("games")
    .select("id, city, slug, title")
    .order("created_at", { ascending: true });

  if (!games?.length) {
    console.log("no games to audit");
    return;
  }

  console.log(`\n══ Auditing ${games.length} game(s) ══\n`);

  let totalSteps = 0;
  let okCount = 0;
  let warnCount = 0;
  let critCount = 0;

  for (const g of games) {
    const cityRaw = (g.city ?? "").split(",")[0]?.trim() || g.city || "";
    if (!cityRaw) {
      console.log(`── skip (no city): ${asString(g.title)}\n`);
      continue;
    }

    // Try to derive country from city string ("Tournus" → no country,
    // "Highgate, London, England" → "England"). Pass everything to the
    // geocoder; Nominatim is forgiving.
    const cityParts = (g.city ?? "").split(",").map((s: string) => s.trim());
    const country = cityParts.length > 1 ? cityParts[cityParts.length - 1] : "";

    const center = await geocodeLocation(cityRaw, "", country);
    if (!center) {
      console.log(
        `── ${asString(g.title)} (${g.city}) — could not geocode city, SKIP\n`,
      );
      continue;
    }

    console.log(`── ${asString(g.title)} (${g.city})`);
    console.log(
      `   centre ville: ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)} (${center.source})`,
    );

    const { data: steps } = await supabase
      .from("game_steps")
      .select("step_order, title, latitude, longitude, validation_radius_meters")
      .eq("game_id", g.id)
      .order("step_order");

    for (const s of (steps || []) as StepRow[]) {
      totalSteps++;
      const drift = haversineMeters(
        { lat: s.latitude, lon: s.longitude },
        { lat: center.lat, lon: center.lon },
      );
      const { tag } = statusOf(drift);
      if (tag === "OK") okCount++;
      else if (tag === "WARNING") warnCount++;
      else critCount++;

      const flag =
        tag === "CRITICAL" ? "🚨" : tag === "WARNING" ? "⚠️ " : "✓ ";
      console.log(
        `   ${flag} step ${s.step_order} (radius ${s.validation_radius_meters}m): drift ${Math.round(drift).toString().padStart(5)} m — ${asString(s.title).slice(0, 50)}`,
      );
    }
    console.log();
  }

  console.log(`══ Résumé ══`);
  console.log(`   Total étapes vérifiées : ${totalSteps}`);
  console.log(`   ✓ OK              (< 500 m)  : ${okCount}`);
  console.log(`   ⚠️  WARNING       (500m-2km) : ${warnCount}`);
  console.log(`   🚨 CRITICAL       (> 2 km)   : ${critCount}`);
  console.log();
  console.log(
    `   Probabilité que le jeu marche : ${Math.round((okCount / totalSteps) * 100)}%`,
  );
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
