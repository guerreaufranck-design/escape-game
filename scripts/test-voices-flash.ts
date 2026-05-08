/**
 * One-shot : génère 4 samples MP3 (1 par voix candidate) en utilisant
 * le modèle Flash 2.5, sur un extrait réel d'un de tes riddles.
 *
 * Tu écoutes les 4 fichiers, tu choisis celle qui te plaît, on bascule.
 *
 * Usage :
 *   npx tsx scripts/test-voices-flash.ts
 *
 * Output :
 *   ./voice-samples/sample-adam.mp3
 *   ./voice-samples/sample-brian.mp3
 *   ./voice-samples/sample-antoni.mp3
 *   ./voice-samples/sample-arnold.mp3
 */
import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

for (const rel of [".env.local", "../.env.local", "../../.env.local", "../../../.env.local", "../../../../.env.local"]) {
  const p = resolve(process.cwd(), rel);
  if (existsSync(p)) { config({ path: p, override: true }); break; }
}

// Texte de test : extrait réel d'un riddle de ton catalogue, en français
// (vu que Multilingual v2.5 supporte 32 langues, on test direct en FR)
const SAMPLE_TEXT = `En cette nuit fatidique de novembre 1790, le frère gardien
s'agenouilla devant l'autel humble de cette chapelle de colline, ses mains
tremblantes serrant le secret le plus précieux de l'abbaye. Les feux
révolutionnaires brûlaient en contrebas dans Cluny, mais ici, dans ce
sanctuaire, il grava son premier message crypté dans la pierre sacrée.`;

const VOICES = [
  { name: "adam", id: "pNInz6obpgDQGcFmaJgB", desc: "Male deep mature, narratif" },
  { name: "brian", id: "nPczCjzI2devNBz1zQrb", desc: "Male deep calme, audiobook narrator" },
  { name: "antoni", id: "ErXwobaYiN019PkySvjV", desc: "Male warm friendly, modéré" },
  { name: "arnold", id: "VR6AewLTigWG4xSOukaG", desc: "Male strong autoritaire, dramatique" },
];

const MODEL = "eleven_flash_v2_5"; // ← Flash 2.5 multilingual (vrai ID ElevenLabs)

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY missing in .env.local");
    process.exit(1);
  }

  const outDir = resolve(process.cwd(), "voice-samples");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`Génération de 4 samples avec modèle ${MODEL}...\n`);
  console.log(`Texte : "${SAMPLE_TEXT.slice(0, 80)}..."\n`);

  for (const v of VOICES) {
    process.stdout.write(`  ${v.name.padEnd(8)} (${v.desc}) ... `);
    const t0 = Date.now();
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${v.id}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: SAMPLE_TEXT,
            model_id: MODEL,
            voice_settings: {
              stability: 0.6,
              similarity_boost: 0.75,
              speed: 1.0,
            },
          }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        console.log(`ÉCHEC (${res.status}) — ${err.slice(0, 100)}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const path = resolve(outDir, `sample-${v.name}.mp3`);
      writeFileSync(path, buf);
      const ms = Date.now() - t0;
      console.log(`OK ${(buf.length / 1024).toFixed(0)}KB en ${ms}ms`);
    } catch (err) {
      console.log(`THREW : ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n✓ Samples générés dans : ${outDir}/`);
  console.log(`\nÉcoute-les dans l'ordre :`);
  console.log(`  open ${outDir}/sample-brian.mp3       (mon préféré pour escape game)`);
  console.log(`  open ${outDir}/sample-adam.mp3`);
  console.log(`  open ${outDir}/sample-antoni.mp3`);
  console.log(`  open ${outDir}/sample-arnold.mp3`);
}

main().catch((e) => { console.error(e); process.exit(1); });
