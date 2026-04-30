import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  for (const lang of ["zh", "ko", "th", "vi", "id", "ja"]) {
    const { count } = await supabase
      .from("ui_translations_cache")
      .select("*", { count: "exact", head: true })
      .eq("language", lang);
    console.log(`${lang}: ${count} keys`);
  }
}

main();
