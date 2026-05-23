import { config } from "dotenv";
config({ path: "/Users/franckguerreau/Documents/ESCAPE-GAME/.env.local" });
import { proposeThematicLandmarks } from "../src/lib/pipeline-landmark-proposer.ts";

const productDesc = `Béziers, July 22, 1209. The crusaders encircle the city. Within the walls, Catholics and Cathars have lived side by side for decades. The Cathars — those "sorcerers" the Church accuses of possessing forbidden knowledge — know that time is running out. The most powerful among them, a parfait known as the Sorcerer of Béziers, spent his final hours concealing a coded grimoire throughout the city.`;

const proposals = await proposeThematicLandmarks({
  city: "Beziers",
  country: "France",
  theme: "The Sorcerer and the Muggles",
  themeDescription: "Cathar sorcery and 1209 Albigensian Crusade massacre of Béziers",
  productDescription: productDesc,
  existingPoolNames: ["Théâtre Municipal", "Basilique Saint-Aphrodise", "Arènes Romaines"],
  maxProposals: 8,
});

console.log(`Claude proposed ${proposals.length} landmarks:\n`);
for (const p of proposals) {
  console.log(`  - ${p.name}`);
  console.log(`    "${p.rationale}"`);
}
