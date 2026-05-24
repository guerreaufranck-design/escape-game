#!/usr/bin/env node
/**
 * Edit stops d'un draft validé manuellement, sans re-lancer Perplexity.
 *
 * Workflow :
 *   1. GET /api/admin/drafts/<slug>  → récupère stops[]
 *   2. Apply action(s) en local
 *   3. PATCH /api/admin/drafts/<slug> avec stops[] modifié
 *
 * Usage :
 *   node scripts/edit-draft.mjs <slug> show
 *   node scripts/edit-draft.mjs <slug> add "Nom du lieu" 48.12345 2.67890 [@position]
 *   node scripts/edit-draft.mjs <slug> swap 3 "Nouveau nom" 48.12345 2.67890
 *   node scripts/edit-draft.mjs <slug> remove 5
 *   node scripts/edit-draft.mjs <slug> move 3 1                 # déplace stop 3 → position 1
 *   node scripts/edit-draft.mjs <slug> rename 4 "Nouveau nom"
 *   node scripts/edit-draft.mjs <slug> coords 4 48.12345 2.67890
 *
 * NOTE : add ajoute en fin par défaut. Pour insérer à la position N,
 *        utiliser "@N" après les coords (ex : add "Bosquet" 48.1 2.1 @3).
 */
const ENDPOINT = "https://escape-game-indol.vercel.app/api/admin/drafts";
const SECRET = "esc_live_k7Hm9PxQr2Yw5TjN8FbA3CdE6GhI1JlO4RsU0VwX";
const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${SECRET}`,
};

const [, , slug, action, ...rest] = process.argv;

if (!slug || !action) {
  console.error("Usage: node scripts/edit-draft.mjs <slug> <action> [args...]");
  console.error("Actions: show | add | swap | remove | move | rename | coords");
  process.exit(1);
}

function mapsUrl(lat, lon) {
  return `https://www.google.com/maps/place/?q=${lat},${lon}`;
}

function printStops(draft) {
  console.log(`\n┌─ ${draft.slug}   ${draft.city}, ${draft.country}`);
  console.log(`│  status=${draft.status}  ·  ${draft.stops?.length ?? 0} stops`);
  console.log(`│`);
  for (const s of draft.stops ?? []) {
    const lat = typeof s.lat === "number" ? s.lat.toFixed(5) : s.lat;
    const lon = typeof s.lon === "number" ? s.lon.toFixed(5) : s.lon;
    const tier = s.tier ?? "?";
    const score = s.themeScore ?? "?";
    console.log(`│  ${s.step_order}. ${s.name}  [T${tier}·s${score}]`);
    console.log(`│     ${lat}, ${lon}   ${mapsUrl(lat, lon)}`);
  }
  console.log(`└${"─".repeat(70)}\n`);
}

async function fetchDraft() {
  const res = await fetch(`${ENDPOINT}/${slug}`, { headers: HEADERS });
  if (!res.ok) {
    console.error(`❌ GET failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const json = await res.json();
  return json.draft;
}

async function patchDraft(stops) {
  const res = await fetch(`${ENDPOINT}/${slug}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ stops }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`❌ PATCH failed: HTTP ${res.status}`, JSON.stringify(json));
    process.exit(1);
  }
  console.log(`✅ ${slug} updated  ·  status=${json.status}  ·  ${json.stopCount} stops`);
  return json;
}

function parseFloatStrict(s) {
  const n = parseFloat(s);
  if (Number.isNaN(n)) {
    console.error(`❌ Invalid number: ${s}`);
    process.exit(1);
  }
  return n;
}

function parseIntStrict(s) {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) {
    console.error(`❌ Invalid integer: ${s}`);
    process.exit(1);
  }
  return n;
}

const draft = await fetchDraft();
const stops = [...(draft.stops ?? [])];

if (action === "show") {
  printStops(draft);
  process.exit(0);
}

if (action === "add") {
  // node ... <slug> add "Name" lat lon [@pos]
  const [name, latS, lonS, posArg] = rest;
  if (!name || !latS || !lonS) {
    console.error('Usage: ... add "Name" lat lon [@position]');
    process.exit(1);
  }
  const lat = parseFloatStrict(latS);
  const lon = parseFloatStrict(lonS);
  const newStop = {
    name,
    description: "",
    lat,
    lon,
    themeScore: 8, // default, à adjuster manuellement plus tard si besoin
    tier: 1,
    rationale: "(ajout manuel)",
  };
  let position = stops.length; // append by default
  if (posArg?.startsWith("@")) {
    position = parseIntStrict(posArg.slice(1)) - 1;
    if (position < 0 || position > stops.length) {
      console.error(`❌ Position out of range (1-${stops.length + 1})`);
      process.exit(1);
    }
  }
  stops.splice(position, 0, newStop);
  console.log(`+ adding "${name}" at position ${position + 1}`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

if (action === "swap") {
  // node ... <slug> swap N "Name" lat lon
  const [stepS, name, latS, lonS] = rest;
  if (!stepS || !name || !latS || !lonS) {
    console.error('Usage: ... swap N "Name" lat lon');
    process.exit(1);
  }
  const step = parseIntStrict(stepS);
  const idx = stops.findIndex((s) => s.step_order === step);
  if (idx < 0) {
    console.error(`❌ Stop step_order=${step} not found`);
    process.exit(1);
  }
  stops[idx] = {
    ...stops[idx],
    name,
    lat: parseFloatStrict(latS),
    lon: parseFloatStrict(lonS),
    rationale: "(swap manuel)",
  };
  console.log(`↺ swap stop ${step} → "${name}"`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

if (action === "remove") {
  // node ... <slug> remove N
  const [stepS] = rest;
  if (!stepS) {
    console.error("Usage: ... remove N");
    process.exit(1);
  }
  const step = parseIntStrict(stepS);
  const idx = stops.findIndex((s) => s.step_order === step);
  if (idx < 0) {
    console.error(`❌ Stop step_order=${step} not found`);
    process.exit(1);
  }
  const removed = stops.splice(idx, 1)[0];
  console.log(`- remove stop ${step} ("${removed.name}")`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

if (action === "move") {
  // node ... <slug> move FROM TO   (1-based)
  const [fromS, toS] = rest;
  if (!fromS || !toS) {
    console.error("Usage: ... move FROM TO");
    process.exit(1);
  }
  const from = parseIntStrict(fromS);
  const to = parseIntStrict(toS);
  const idx = stops.findIndex((s) => s.step_order === from);
  if (idx < 0) {
    console.error(`❌ Stop step_order=${from} not found`);
    process.exit(1);
  }
  if (to < 1 || to > stops.length) {
    console.error(`❌ Target position out of range (1-${stops.length})`);
    process.exit(1);
  }
  const [moved] = stops.splice(idx, 1);
  stops.splice(to - 1, 0, moved);
  console.log(`↕ move stop ${from} → position ${to}`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

if (action === "rename") {
  // node ... <slug> rename N "Nouveau nom"
  const [stepS, name] = rest;
  if (!stepS || !name) {
    console.error('Usage: ... rename N "Nouveau nom"');
    process.exit(1);
  }
  const step = parseIntStrict(stepS);
  const idx = stops.findIndex((s) => s.step_order === step);
  if (idx < 0) {
    console.error(`❌ Stop step_order=${step} not found`);
    process.exit(1);
  }
  const oldName = stops[idx].name;
  stops[idx] = { ...stops[idx], name };
  console.log(`✎ rename stop ${step} : "${oldName}" → "${name}"`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

if (action === "coords") {
  // node ... <slug> coords N lat lon
  const [stepS, latS, lonS] = rest;
  if (!stepS || !latS || !lonS) {
    console.error("Usage: ... coords N lat lon");
    process.exit(1);
  }
  const step = parseIntStrict(stepS);
  const idx = stops.findIndex((s) => s.step_order === step);
  if (idx < 0) {
    console.error(`❌ Stop step_order=${step} not found`);
    process.exit(1);
  }
  stops[idx] = {
    ...stops[idx],
    lat: parseFloatStrict(latS),
    lon: parseFloatStrict(lonS),
  };
  console.log(`📍 stop ${step} → coords ${latS}, ${lonS}`);
  await patchDraft(stops);
  printStops(await fetchDraft());
  process.exit(0);
}

console.error(`❌ Unknown action: ${action}`);
console.error("Actions: show | add | swap | remove | move | rename | coords");
process.exit(1);
