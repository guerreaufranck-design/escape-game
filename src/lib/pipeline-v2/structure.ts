/**
 * STRUCTURE — Convertit le DiscoveryResult + GeocodeResult en StructuredGame
 * prêt pour insertion DB.
 *
 * Rôle : enrichir chaque stop avec les champs DB qui n'ont pas été produits
 * par Perplexity (ar_character_type, ar_character_dialogue, ar_facade_text,
 * ar_treasure_reward, landmarkHistory) via UN seul appel Claude.
 *
 * Claude reçoit :
 *   - le markdown Perplexity (contexte narratif complet)
 *   - les landmarks géocodés (nom, GPS, place_id)
 *   - le brief buyer
 *   → renvoie JSON structuré conforme à StructuredGame
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  DiscoveryResult,
  GeocodeResult,
  PipelineInput,
  StructuredGame,
  StructuredStop,
} from "./types";

const MODEL = "claude-sonnet-4-5-20250929";

/** Choix de l'archétype AR pour un stop, basé sur landmark + thème. */
function pickArCharacterType(landmarkName: string, theme: string): string {
  const n = (landmarkName + " " + theme).toLowerCase();
  if (/cathédrale|église|chapelle|monastère|abbaye|prière|sanctuaire|spiritualité/.test(n)) return "monk";
  if (/musée|archive|bibliothèque|landtag|gouvernement|administration|scolaire/.test(n)) return "scholar";
  if (/château|fort|citadelle|bastion|guerre|régiment|militaire|bataille/.test(n)) return "soldier";
  if (/pont|fontaine|place|jardin|park|parc|rue/.test(n)) return "guide_male";
  return "guide_female"; // default narrateur warm
}

/** Construit le prompt Claude pour structurer le jeu. */
function buildStructurePrompt(
  input: PipelineInput,
  discovery: DiscoveryResult,
  geocode: GeocodeResult,
): string {
  const stopsContext = geocode.geocoded
    .map(
      (st) =>
        `Stop ${st.order} — "${st.name}" (GPS vérifié: ${st.lat}, ${st.lon}, place_id: ${st.placeId})
   - Titre narratif Perplexity: ${st.narrativeTitle ?? "(absent)"}
   - Énigme Perplexity: ${st.riddle}
   - Réponse attendue: ${st.answer}
   - Indice: ${st.hint}
   - Anecdote: ${st.anecdote}`,
    )
    .join("\n\n");

  return `Tu es chargé de structurer un escape game outdoor en JSON conforme au schéma DB.

## Contexte
- Ville: ${input.city}${input.country ? `, ${input.country}` : ""}
- Thème: ${input.theme}
- Brief buyer: ${input.themeDescription ?? "(non spécifié)"}
- Role-play: ${input.productDescription ?? "(non spécifié)"}
- Langue cible: ${input.language}

## Narration Perplexity (à utiliser comme source de vérité narrative)

### Intro
${discovery.intro}

### Stops géocodés
${stopsContext}

### Épilogue
${discovery.epilogue}

${discovery.warning ? `### ⚠️ Avertissement éditorial Perplexity\n${discovery.warning}\n` : ""}

## Ta mission

Produis UN OBJET JSON unique conforme à ce schéma exact :

\`\`\`json
{
  "meta": {
    "title": "string — titre du jeu en ${input.language}",
    "description": "string — 1-2 phrases pour la fiche produit",
    "intro": "string — narration intro (3-5 phrases, ton immersif)",
    "epilogue": "string — narration épilogue (3-5 phrases)",
    "epilogueTitle": "string — titre court de l'épilogue",
    "finalRiddleText": "string — énigme finale qui requiert d'avoir compris l'enquête",
    "finalAnswer": "string — réponse à l'énigme finale (mot ou nombre)",
    "finalAnswerExplanation": "string — explication 2-3 phrases"
  },
  "stops": [
    {
      "step_order": 1,
      "title": "string — titre narratif du stop (Format: 'Nom du lieu — Titre narratif')",
      "landmarkName": "string — nom canonique du lieu",
      "latitude": number,
      "longitude": number,
      "placeId": "string",
      "riddle": "string — énigme observable depuis l'extérieur, 2-3 phrases",
      "answer": "string — réponse simple (MAJUSCULES pour les mots, chiffre pour les nombres)",
      "hints": [{ "text": "string — indice si bloqué", "order": 1 }],
      "anecdote": "string — anecdote historique RÉELLE, 2-3 phrases",
      "arCharacterType": "string — un de: guide_male, guide_female, scholar, monk, soldier",
      "arCharacterDialogue": "string — ce que dit le personnage AR en immersion (1-2 phrases)",
      "arFacadeText": "string — le mot ou nombre qui apparaît en AR sur la façade (= la réponse)",
      "arTreasureReward": "string — description de la récompense virtuelle obtenue après scan AR",
      "landmarkHistory": { "${input.language}": "string — histoire du lieu, 2-3 phrases" },
      "validationRadiusMeters": 30,
      "bonusTimeSeconds": 30
    }
  ]
}
\`\`\`

## Règles strictes

1. **Langue** : TOUT le contenu en ${input.language}. Aucun mot dans une autre langue.
2. **arFacadeText** = la réponse en MAJUSCULES (ou le nombre).
3. **answer** = la même valeur, en MAJUSCULES si lettres.
4. **landmarkName** = le nom géographique précis du landmark (que Google Maps reconnaît).
5. **title** = format "Landmark — Sous-titre narratif" pour clarté UX.
6. **arCharacterType** : choisis selon le lieu (église → monk, archive → scholar, château → soldier...).
7. **arCharacterDialogue** : voix immersive, ton de l'archétype, 1-2 phrases qui mènent au mot AR.
8. **arTreasureReward** : un objet symbolique (parchemin, médaillon, livre...) lié à la narration.
9. **Stops geocodés disponibles** : ${geocode.geocoded.length}. Utilise CES stops, dans l'ordre déjà donné. Ne change pas l'ordre.

Réponds UNIQUEMENT avec le JSON, sans préambule ni explication.`;
}

/** Appel Claude pour structurer. */
export async function runStructure(
  input: PipelineInput,
  discovery: DiscoveryResult,
  geocode: GeocodeResult,
): Promise<StructuredGame> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = buildStructurePrompt(input, discovery, geocode);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON (parfois Claude wrappe dans ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude structure response not parseable: ${text.slice(0, 300)}`);

  let parsed: StructuredGame;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Claude structure JSON parse failed: ${e instanceof Error ? e.message : "unknown"} — preview: ${jsonMatch[0].slice(0, 300)}`);
  }

  // Enrich avec archétypes par défaut si Claude n'a pas choisi
  parsed.stops = parsed.stops.map((s) => ({
    ...s,
    arCharacterType: s.arCharacterType || pickArCharacterType(s.landmarkName, input.theme),
    validationRadiusMeters: s.validationRadiusMeters ?? 30,
    bonusTimeSeconds: s.bonusTimeSeconds ?? 30,
  }));

  parsed.sourceLanguage = input.language;

  // Sanity check : on doit avoir au moins 5 stops
  if (!Array.isArray(parsed.stops) || parsed.stops.length < 5) {
    throw new Error(`Structured game has only ${parsed.stops?.length ?? 0} stops`);
  }

  return parsed;
}

/** Helper exporté pour pickArCharacterType (réutilisable). */
export { pickArCharacterType };
