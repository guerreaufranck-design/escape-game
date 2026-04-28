/**
 * Second sprite upload — Apr 28, 2026.
 *
 * Source : ~/Downloads/personnage/
 * Targets:
 *   3 new characters (princess, peasant, soldier) × 5 poses
 *   5 generic objects (key, parchment, potion, sword, treasure_chest)
 *
 * The new character files use a slightly different pose vocabulary
 * than the first batch:
 *   _speaking.png  →  uploaded as _talking.png   (matches ARPose type)
 *   _wielding.png  →  uploaded as _thinking.png  (matches ARPose type)
 * The other three poses (idle, pointing, surprised) are unchanged.
 *
 * Renaming happens here, in the uploader, so the bucket stays
 * consistent and the runtime sprite registry keeps a single
 * vocabulary. Idempotent: skips files already present in the bucket.
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { config } from "dotenv";

config({ path: ".env.local" });

const BUCKET = "ar-sprites";
const SOURCE_DIR = join(homedir(), "Downloads", "personnage");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Apply pose-naming rules so the bucket has a single vocabulary.
 *
 * Examples:
 *   princess_speaking.png  → princess_talking.png
 *   soldier_wielding.png   → soldier_thinking.png
 *   key.png                → key.png  (unchanged)
 */
function canonicalName(srcName: string): string {
  return srcName
    .replace(/_speaking\.png$/i, "_talking.png")
    .replace(/_wielding\.png$/i, "_thinking.png");
}

async function listExisting(): Promise<Set<string>> {
  const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) {
    console.warn(`Could not list bucket: ${error.message}`);
    return new Set();
  }
  return new Set((data || []).map((f) => f.name));
}

async function main() {
  console.log(`Source: ${SOURCE_DIR}`);

  let files: string[] = [];
  try {
    files = (await readdir(SOURCE_DIR))
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .filter((f) => !f.startsWith("."));
  } catch (err) {
    console.error(`Cannot read ${SOURCE_DIR}: ${err}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No PNG files found.");
    return;
  }

  console.log(`Found ${files.length} PNG sprites locally.`);

  const existing = await listExisting();
  console.log(`Bucket already has ${existing.size} sprite(s).`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let renamed = 0;

  for (const srcName of files.sort()) {
    const dstName = canonicalName(srcName);
    if (dstName !== srcName) renamed++;

    if (existing.has(dstName)) {
      console.log(`  ⏭  ${srcName} (already in bucket as ${dstName})`);
      skipped++;
      continue;
    }

    const localPath = join(SOURCE_DIR, srcName);
    const localStat = await stat(localPath);
    const buf = await readFile(localPath);

    const { error } = await supabase.storage.from(BUCKET).upload(dstName, buf, {
      contentType: "image/png",
      cacheControl: "31536000, immutable",
      upsert: false,
    });

    if (error) {
      console.error(`  ✗ ${srcName}: ${error.message}`);
      failed++;
      continue;
    }
    const note = dstName !== srcName ? ` (renamed → ${dstName})` : "";
    console.log(
      `  ✓ ${srcName} (${(localStat.size / 1024).toFixed(0)} KB)${note}`,
    );
    uploaded++;
  }

  console.log("");
  console.log(
    `Done — uploaded: ${uploaded} · skipped: ${skipped} · failed: ${failed} · renamed during upload: ${renamed}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
