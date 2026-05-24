#!/usr/bin/env node
/**
 * Bulk pre-validation of OddballTrip Funbooker catalog (async via Inngest).
 *
 * Usage :
 *   node scripts/bulk-create-drafts.mjs [--dry-run] [--max=N] [--from=N] [--no-poll]
 *
 * V2 ASYNC (2026-05-24) :
 *   - POST tous les drafts d'un coup (max 100 par appel) → Inngest les
 *     traite en parallèle (concurrency=5) en background
 *   - Poll /api/admin/drafts toutes les 20s pour voir les status évoluer
 *   - Affiche les stops + GPS de chaque draft dès qu'il passe "validated"
 *   - Sort quand tous les drafts sont validated OU en erreur
 *
 * Stop / resume :
 *   - Ctrl+C anytime → les drafts en cours continuent côté Inngest
 *   - Relance même cmd → skippe les drafts déjà validated (idempotent)
 *
 * Reads : /Users/franckguerreau/Documents/oddballtrip/scripts/funbooker-cities-games.json
 */
import { readFileSync } from "fs";

const ENDPOINT = "https://escape-game-indol.vercel.app/api/admin/drafts";
const SECRET = "esc_live_k7Hm9PxQr2Yw5TjN8FbA3CdE6GhI1JlO4RsU0VwX";
const CATALOG = "/Users/franckguerreau/Documents/oddballtrip/scripts/funbooker-cities-games.json";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPoll = args.includes("--no-poll");
const maxArg = args.find((a) => a.startsWith("--max="));
const fromArg = args.find((a) => a.startsWith("--from="));
const MAX = maxArg ? parseInt(maxArg.split("=")[1], 10) : Infinity;
const FROM = fromArg ? parseInt(fromArg.split("=")[1], 10) : 0;

function fr(obj, fallback = "") {
  if (!obj) return fallback;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj[0] ?? fallback;
  return obj.fr || obj.en || obj.es || fallback;
}

function capitalize(s) {
  if (!s) return s;
  return s
    .split(/[\s-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

function mapGame(g) {
  const titleFr = fr(g.title);
  const theme = titleFr.replace(/^[^—]+—\s*/, "").trim() || titleFr;
  const themeDescription = fr(g.subtitle) || fr(g.tagline);
  const introArray = g.intro_body?.fr;
  const productDescription = (Array.isArray(introArray) ? introArray[0] : introArray ?? "")
    .toString()
    .slice(0, 1500);
  const startPointText = fr(g.starting_point?.text);
  const startPointLat = g.starting_point?.lat;
  const startPointLon = g.starting_point?.lon;
  const city = capitalize(g.city);
  const country = g.country === "france" ? "France" : capitalize(g.country);
  const targetStopCount =
    g.acts_count >= 5 && g.acts_count <= 8 ? g.acts_count : 8;
  return {
    slug: g.slug,
    city,
    country,
    theme,
    themeDescription,
    productDescription,
    startPointText,
    startPointLat,
    startPointLon,
    mode: g.product_type ?? "city_game",
    targetStopCount,
    transportMode: g.transport_mode ?? "walking",
    radiusKm: g.radius_km ?? undefined,
  };
}

async function postBatch(drafts) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ drafts, runValidationNow: true }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: `non-JSON response: ${text.slice(0, 200)}` };
  }
  return { ok: res.ok, status: res.status, json };
}

async function listAllDrafts() {
  try {
    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.drafts ?? [];
  } catch {
    return [];
  }
}

async function fetchDraftStops(slug) {
  try {
    const res = await fetch(`${ENDPOINT}/${slug}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.draft ?? null;
  } catch {
    return null;
  }
}

function mapsUrl(lat, lon) {
  return `https://www.google.com/maps/place/?q=${lat},${lon}`;
}

function printStopsForVerification(draft) {
  if (!draft?.stops || !Array.isArray(draft.stops)) return;
  const diag = draft.diagnostics ?? {};
  const avg = diag.averageScore?.toFixed?.(2) ?? "?";
  console.log(`\n  ┌─ 📍 ${draft.slug}   ${draft.city}, ${draft.country}`);
  console.log(
    `  │  avg ${avg}/10  ·  T1=${diag.tier1Count ?? 0} T2=${diag.tier2Count ?? 0} T3=${diag.tier3Count ?? 0}  ·  ${draft.stops.length} stops`,
  );
  console.log(`  │`);
  console.log(`  │  START  ${draft.start_point_lat}, ${draft.start_point_lon}`);
  console.log(`  │         ${mapsUrl(draft.start_point_lat, draft.start_point_lon)}`);
  console.log(`  │`);
  for (const st of draft.stops) {
    const tier = st.tier ?? "?";
    const score = st.themeScore ?? "?";
    const lat = typeof st.lat === "number" ? st.lat.toFixed(5) : st.lat;
    const lon = typeof st.lon === "number" ? st.lon.toFixed(5) : st.lon;
    const dist = st.distanceFromStartM ? ` · ${st.distanceFromStartM}m` : "";
    console.log(`  │  ${st.step_order}. ${st.name}   [T${tier}·s${score}${dist}]`);
    console.log(`  │     ${lat}, ${lon}   ${mapsUrl(lat, lon)}`);
    if (st.rationale) {
      const r = st.rationale.length > 110 ? st.rationale.slice(0, 110) + "…" : st.rationale;
      console.log(`  │     ↳ ${r}`);
    }
    if (st.realFigure) console.log(`  │     ★ ${st.realFigure}`);
    if (st.realEvent) console.log(`  │     ⚡ ${st.realEvent}`);
    console.log(`  │`);
  }
  console.log(`  │  Pour modifier, dis-moi :`);
  console.log(`  │    « ${draft.slug}: swap 3 → <Nom> <lat,lon> »`);
  console.log(`  │    « ${draft.slug}: add <Nom> <lat,lon> @ <pos> »`);
  console.log(`  │    « ${draft.slug}: remove 5 »`);
  console.log(`  └${"─".repeat(74)}`);
}

async function main() {
  console.log(`\n🚀 Bulk pre-validation Funbooker FR (V2 ASYNC via Inngest)\n`);
  if (dryRun) console.log("🔍 DRY-RUN mode : aucun POST\n");

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const games = catalog.games ?? [];
  console.log(`📚 Catalogue : ${games.length} jeux trouvés`);

  const sliced = games.slice(FROM, FROM + MAX);
  const drafts = sliced.map(mapGame);
  const slugs = new Set(drafts.map((d) => d.slug));
  console.log(`📋 Traitement : ${drafts.length} jeux (FROM=${FROM} MAX=${MAX === Infinity ? "all" : MAX})\n`);

  if (dryRun) {
    for (const d of drafts.slice(0, 3)) {
      console.log("PAYLOAD:", JSON.stringify(d, null, 2).slice(0, 400), "...\n");
    }
    return;
  }

  // 1. POST tous les drafts en 1 appel (rapide, ~3-5s par batch de 100)
  console.log(`📤 POST de ${drafts.length} drafts vers /api/admin/drafts...`);
  const t0 = Date.now();
  const { ok, status, json } = await postBatch(drafts);
  const postDur = Math.round((Date.now() - t0) / 1000);
  if (!ok) {
    console.error(`❌ POST failed: HTTP ${status}`, JSON.stringify(json).slice(0, 300));
    process.exit(1);
  }
  console.log(`✅ POST OK in ${postDur}s — ${json.ok ?? 0} enqueued, ${json.error ?? 0} errors`);

  if (json.results) {
    const enqueueErrors = json.results.filter((r) => r.status === "error");
    if (enqueueErrors.length) {
      console.log(`\n⚠️  ${enqueueErrors.length} drafts errored à l'enqueue:`);
      for (const e of enqueueErrors) console.log(`   - ${e.slug}: ${e.error}`);
    }
  }

  if (noPoll) {
    console.log(`\n📋 Mode --no-poll : check /admin/drafts pour suivre l'évolution`);
    return;
  }

  // 2. Poll jusqu'à ce que TOUS les drafts soient validated OU en erreur
  console.log(`\n⏳ Polling toutes les 20s (les drafts arrivent un par un)...\n`);
  const seenValidated = new Set();
  const seenErrored = new Set();
  let pollCount = 0;
  const startPoll = Date.now();
  while (seenValidated.size + seenErrored.size < slugs.size) {
    pollCount++;
    const elapsed = Math.round((Date.now() - startPoll) / 60_000);
    const allDrafts = await listAllDrafts();
    const ours = allDrafts.filter((d) => slugs.has(d.slug));

    for (const d of ours) {
      if (d.status === "validated" && !seenValidated.has(d.slug)) {
        seenValidated.add(d.slug);
        const diag = d.diagnostics ?? {};
        console.log(
          `[${seenValidated.size + seenErrored.size}/${slugs.size}] ✅ ${d.slug}  (${d.city})  avg=${diag.averageScore?.toFixed?.(2) ?? "?"}/10 T1=${diag.tier1Count ?? "?"} T2=${diag.tier2Count ?? "?"} T3=${diag.tier3Count ?? "?"}${diag.fallbackUsed ? " [FALLBACK]" : ""}${diag.compactMode ? " [COMPACT]" : ""}`,
        );
        // Fetch + print stops for manual verification
        const fullDraft = await fetchDraftStops(d.slug);
        printStopsForVerification(fullDraft);
      } else if (d.validation_error && !seenErrored.has(d.slug)) {
        // Still in pending with an error
        seenErrored.add(d.slug);
        console.log(
          `[${seenValidated.size + seenErrored.size}/${slugs.size}] ❌ ${d.slug}  ERROR: ${d.validation_error?.slice(0, 200)}`,
        );
      }
    }
    if (seenValidated.size + seenErrored.size >= slugs.size) break;
    // Status report toutes les 5 polls
    if (pollCount % 5 === 0) {
      const remaining = slugs.size - seenValidated.size - seenErrored.size;
      console.log(`  ... [${elapsed}min] ${seenValidated.size} ok, ${seenErrored.size} err, ${remaining} en cours...`);
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }

  const totalDur = Math.round((Date.now() - t0) / 60_000);
  console.log(`\n═══ TERMINÉ en ${totalDur} min ═══`);
  console.log(`  ✅ OK         : ${seenValidated.size}`);
  console.log(`  ❌ Errors     : ${seenErrored.size}`);
  console.log(`\nDashboard : https://escape-game-indol.vercel.app/admin/drafts`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
