import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { data, error, count } = await supabase
    .from("error_reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("DB error:", error.message);
    return;
  }

  console.log(`Total error_reports: ${count}\n`);
  for (const r of data || []) {
    console.log(JSON.stringify(r, null, 2));
    console.log("---");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
