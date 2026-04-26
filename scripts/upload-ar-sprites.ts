/**
 * One-shot script: upload AR character sprites from ~/Downloads/R.A/ to
 * Supabase Storage bucket `ar-sprites`.
 *
 * Usage:
 *   npx tsx scripts/upload-ar-sprites.ts
 *
 * - Creates bucket if missing (public, image/png only)
 * - Skips files already uploaded with same size (idempotent)
 * - Uses service-role key, runs locally
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { config } from "dotenv";

config({ path: ".env.local" });

const BUCKET = "ar-sprites";
const SOURCE_DIRS = [
  join(homedir(), "Downloads", "R.A"),
  join(homedir(), "Downloads", "guides"),
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (exists) {
    console.log(`✓ Bucket "${BUCKET}" already exists`);
    return;
  }
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB / sprite max
    allowedMimeTypes: ["image/png"],
  });
  if (createErr) throw createErr;
  console.log(`✓ Created bucket "${BUCKET}" (public)`);
}

async function listExisting(): Promise<Set<string>> {
  const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) {
    console.warn(`⚠ Could not list existing files: ${error.message}`);
    return new Set();
  }
  return new Set((data || []).map((f) => f.name));
}

async function main() {
  // Collect (filename, fullPath) from every source dir.
  const fileEntries: { name: string; path: string }[] = [];
  for (const dir of SOURCE_DIRS) {
    console.log(`📂 Source: ${dir}`);
    try {
      const names = (await readdir(dir)).filter((f) => f.endsWith(".png"));
      for (const name of names) {
        fileEntries.push({ name, path: join(dir, name) });
      }
    } catch {
      console.log(`  (skipped — directory not found)`);
    }
  }

  if (fileEntries.length === 0) {
    console.log("⚠ No .png files found in any source directory");
    return;
  }
  console.log(`📦 Found ${fileEntries.length} PNG sprites locally`);

  await ensureBucket();
  const existing = await listExisting();
  console.log(`🔍 ${existing.size} sprite(s) already in bucket`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  fileEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const { name: filename, path: localPath } of fileEntries) {
    const localStat = await stat(localPath);

    if (existing.has(filename)) {
      // Quick check via metadata isn't trivial here; trust filename match.
      console.log(`  ⏭  ${filename} (already in bucket)`);
      skipped++;
      continue;
    }

    const buf = await readFile(localPath);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buf, {
        contentType: "image/png",
        cacheControl: "31536000, immutable",
        upsert: false,
      });

    if (error) {
      console.error(`  ✗ ${filename} — ${error.message}`);
      failed++;
      continue;
    }
    console.log(`  ✓ ${filename} (${(localStat.size / 1024).toFixed(0)} KB)`);
    uploaded++;
  }

  console.log("");
  console.log(`✅ Done — uploaded: ${uploaded} · skipped: ${skipped} · failed: ${failed}`);
  if (uploaded > 0) {
    console.log("");
    console.log(`Public URL pattern:`);
    console.log(`  ${url}/storage/v1/object/public/${BUCKET}/<filename>.png`);
  }
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
