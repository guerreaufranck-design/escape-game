import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

import { ui } from "../src/lib/translations";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const expectedKeys = Object.keys(ui).sort();

  for (const lang of ["pt"]) {
    const { data } = await supabase
      .from("ui_translations_cache")
      .select("translation_key")
      .eq("language", lang);
    const present = new Set((data || []).map((r) => r.translation_key));
    const missing = expectedKeys.filter((k) => !present.has(k));
    console.log(`\n${lang}: ${missing.length} clés manquantes`);
    for (const k of missing) {
      const en = ui[k]?.en || ui[k]?.fr || "";
      console.log(`  - ${k.padEnd(35)} | EN: ${en.slice(0, 80)}${en.length > 80 ? "…" : ""}`);
    }
  }
}

main();
