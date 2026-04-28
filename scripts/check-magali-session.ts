/**
 * Diagnostic — what is the Magali (malou.fontaine75@gmail.com) session
 * actually doing? She's reportedly stuck at step 3/8 after 4 hours.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  // Find Magali's activation code
  const { data: codes } = await supabase
    .from("activation_codes")
    .select("*")
    .ilike("buyer_email", "malou.fontaine75@gmail.com")
    .order("created_at", { ascending: false });

  console.log(`\n=== activation_codes for malou.fontaine75@gmail.com ===`);
  for (const c of codes || []) {
    console.log(JSON.stringify(c, null, 2));
  }

  if (!codes || codes.length === 0) {
    console.log("No code found for that email.");
    return;
  }

  // Find the session(s) tied to her code
  const codeId = codes[0].id;
  const { data: sessions } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("activation_code_id", codeId)
    .order("created_at", { ascending: false });

  console.log(`\n=== game_sessions for code ${codes[0].code} ===`);
  for (const s of sessions || []) {
    console.log(JSON.stringify(s, null, 2));
  }

  if (!sessions || sessions.length === 0) {
    console.log("No session yet — she hasn't activated the code or there's a DB sync issue.");
    return;
  }

  // Per-step progress
  const sessionId = sessions[0].id;
  const { data: completions } = await supabase
    .from("step_completions")
    .select("*")
    .eq("session_id", sessionId)
    .order("step_order", { ascending: true });

  console.log(`\n=== step_completions for session ${sessionId} ===`);
  for (const sc of completions || []) {
    console.log(
      `  step ${sc.step_order}: completed_at=${sc.completed_at}, time=${sc.time_seconds}s, hints=${sc.hints_used}, penalty=${sc.penalty_seconds}s, distance=${sc.distance_meters}m`,
    );
  }

  // Hint usage
  const { data: hintUses } = await supabase
    .from("hint_uses")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  console.log(`\n=== hint_uses for session ${sessionId} ===`);
  for (const h of hintUses || []) {
    console.log(`  step ${h.step_order} hint #${h.hint_index} at ${h.created_at}`);
  }

  // Time math
  if (sessions[0].started_at) {
    const startedMs = new Date(sessions[0].started_at).getTime();
    const elapsedMin = Math.round((Date.now() - startedMs) / 60_000);
    console.log(`\n📊 Started ${elapsedMin} minutes ago.`);
    console.log(`📊 Current step: ${sessions[0].current_step} / ${sessions[0].total_steps}`);
    console.log(`📊 Status: ${sessions[0].status}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
