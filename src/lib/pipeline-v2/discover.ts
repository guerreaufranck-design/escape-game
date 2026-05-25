/**
 * DISCOVERY — Perplexity sonar standard, prompt FR naturel et riche.
 *
 * Différences clés vs v1 :
 *   - sonar (pas sonar-deep-research) → 3-5s au lieu de 5-7 min, $0.005 au
 *     lieu de $0.40
 *   - Prompt FR naturel qui forwarde TOUT le contexte buyer (themeDescription,
 *     productDescription, stops suggérés, role-play)
 *   - PAS de demande de coordonnées GPS (Google Places s'en charge,
 *     anti-hallucination)
 *   - Output : markdown structuré (intro, ordered landmarks avec énigmes,
 *     épilogue, warnings)
 *   - Parse tolérant : 6-9 landmarks acceptés, pas de throw
 */

import type { DiscoveredLandmark, DiscoveryResult, PipelineInput } from "./types";

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

/** Compose le prompt Perplexity en français naturel avec tout le contexte. */
export function buildDiscoveryPrompt(input: PipelineInput): string {
  const buyerStopsBlock =
    input.buyerStops && input.buyerStops.length > 0
      ? `\n**Landmarks suggérés par le buyer** (utilise-les en priorité si pertinents) :\n${input.buyerStops
          .map(
            (s, i) =>
              `${i + 1}. ${s.landmarkName ?? s.name ?? "(sans nom)"}${
                s.description ? ` — ${s.description.slice(0, 200)}` : ""
              }`,
          )
          .join("\n")}\n`
      : "";

  const startBlock = input.startPointText
    ? `\n**Point de départ souhaité** : ${input.startPointText}\n`
    : "";

  const langName =
    {
      fr: "français",
      en: "anglais",
      de: "allemand",
      es: "espagnol",
      it: "italien",
      pt: "portugais",
      nl: "néerlandais",
    }[input.language] ?? input.language;

  return `Je conçois un escape game outdoor à ${input.city}${input.country ? `, ${input.country}` : ""} sur le thème **"${input.theme}"**.

**Brief court du buyer** :
${input.themeDescription ?? "(non spécifié — invente quelque chose de cohérent avec le thème et la ville)"}

**Description produit / contexte role-play** :
${input.productDescription ?? "(non spécifié)"}
${buyerStopsBlock}
${startBlock}
**Mode de transport** : ${input.transportMode ?? "walking"}
**Durée cible** : ${input.estimatedDurationMin} minutes
**Difficulté** : ${input.difficulty}/5
**Mode** : ${input.mode === "city_tour" ? "audioguide enrichi sans énigme bloquante" : "escape game avec énigmes"}
**Langue de l'output ENTIÈRE** : ${langName}. Tout le contenu doit être en ${langName}, sans exception.

Donne-moi un parcours complet et CRÉDIBLE, en respectant le brief du buyer s'il a précisé des landmarks ou un angle particulier.

## Format de réponse OBLIGATOIRE (markdown structuré)

### Avertissement éditorial (optionnel)
Si le thème comporte des éléments historiquement délicats, inexacts ou problématiques (ex : événement qui n'a jamais eu lieu présenté comme fait), signale-le ici en 2-3 phrases. Sinon, écris "Aucun avertissement".

### Intro
3 à 5 phrases qui posent le thème, accrochent le joueur, l'invitent à enquêter. Ton narratif immersif, deuxième personne.

### Landmarks
Liste numérotée de **7 à 9 landmarks** dans l'**ORDRE OPTIMAL de visite** (parcours fluide à pied, pas de zigzag, montée narrative). Pour chaque landmark :

\`\`\`
N. **{Nom précis du lieu, retrouvable sur Google Maps}**
- **Titre narratif** : {titre court qui relie au thème}
- **Énigme** : {2-3 phrases. L'énigme doit être observable depuis l'extérieur — chiffre/date inscrit, nom gravé, nombre d'éléments comptables (colonnes, fenêtres, statues...). PAS de question abstraite.}
- **Réponse** : {mot ou nombre, simple, validable par saisie}
- **Indice** : {1 phrase pour débloquer si nécessaire}
- **Anecdote** : {1-2 phrases d'anecdote historique RÉELLE liée au lieu + thème}
\`\`\`

Sois précis sur le nom du lieu (assez précis pour Google Maps : "Cathédrale Saint-Florin de Vaduz" et pas juste "la cathédrale"). N'invente AUCUNE coordonnée GPS, je les vérifierai séparément.

### Épilogue
3 à 5 phrases qui clôturent l'enquête, donnent la résolution du mystère, laissent une touche finale émotionnelle.

### Question finale
Une question synthèse qui requiert d'avoir compris l'ensemble de l'enquête. Format : énigme finale + réponse + explication.
- **Énigme finale** : ...
- **Réponse finale** : ...
- **Explication** : ...

---

Commence directement par "### Avertissement éditorial". Ne mets PAS de préambule conversationnel.`;
}

/** Appel Perplexity sonar (model standard, pas deep research). */
export async function callPerplexity(prompt: string): Promise<{ content: string; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");

  const res = await fetch(PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Perplexity error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const content: string = json.choices?.[0]?.message?.content ?? "";
  const citations: string[] = json.citations ?? [];
  return { content, citations };
}

/**
 * Parse le markdown structuré renvoyé par Perplexity.
 *
 * Tolérant : si certains champs manquent pour un landmark, on garde quand
 * même le landmark avec les champs vides — la phase Structure (Claude)
 * pourra reformuler. Si moins de 5 landmarks → throw (insuffisant).
 */
export function parseDiscoveryMarkdown(markdown: string): Omit<DiscoveryResult, "citations" | "rawMarkdown"> {
  // Sections — split sur les titres niveau 3 (###)
  const sections = splitSections(markdown);

  const warning =
    sections["avertissement éditorial"]?.trim() ||
    sections["avertissement"]?.trim() ||
    undefined;
  const warningClean = warning && !/aucun/i.test(warning) ? warning : undefined;

  const intro = sections["intro"]?.trim() ?? "";
  const epilogue = sections["épilogue"]?.trim() ?? sections["epilogue"]?.trim() ?? "";

  const landmarksRaw = sections["landmarks"] ?? sections["lieux"] ?? "";
  const landmarks = parseLandmarkBlock(landmarksRaw);

  if (landmarks.length < 5) {
    throw new Error(
      `Discovery returned only ${landmarks.length} landmarks (need ≥5). Raw markdown preview: ${markdown.slice(0, 500)}`,
    );
  }

  return {
    landmarks,
    intro,
    epilogue,
    warning: warningClean,
  };
}

/** Découpe le markdown en sections par titre niveau 3 (###). */
function splitSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.split("\n");
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      sections[currentKey] = currentLines.join("\n");
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentKey = headingMatch[1].toLowerCase().trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

/** Parse le bloc landmarks : split par "N. **Name**" puis extrait champs. */
function parseLandmarkBlock(text: string): DiscoveredLandmark[] {
  const landmarks: DiscoveredLandmark[] = [];

  // Trouve toutes les positions de "N. **..."
  const headerRegex = /(?:^|\n)\s*(\d{1,2})\.\s+\*\*([^*\n]+)\*\*\s*\n/g;
  const matches: Array<{ index: number; order: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(text)) !== null) {
    matches.push({
      index: m.index + m[0].length,
      order: parseInt(m[1], 10),
      name: m[2].trim().replace(/^["'«]+|["'»]+$/g, ""),
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index - matches[i + 1].order.toString().length - 6 : text.length;
    const body = text.slice(start, end);

    landmarks.push({
      order: matches[i].order,
      name: matches[i].name,
      narrativeTitle: extractField(body, ["titre narratif", "titre"]),
      riddle: extractField(body, ["énigme"]) ?? "",
      answer: extractField(body, ["réponse"]) ?? "",
      hint: extractField(body, ["indice"]) ?? "",
      anecdote: extractField(body, ["anecdote"]) ?? "",
    });
  }

  return landmarks;
}

/** Cherche un champ "- **label** : ..." (ou variants) dans un body. */
function extractField(body: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`[-*]\\s*\\*\\*${escapeRegex(label)}\\*\\*\\s*[:\\s]+([\\s\\S]*?)(?=\\n\\s*[-*]\\s*\\*\\*|\\n\\s*\\d+\\.\\s+\\*\\*|\\n#|$)`, "i");
    const m = body.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Orchestrateur de la phase Discovery. */
export async function runDiscovery(input: PipelineInput): Promise<DiscoveryResult> {
  const prompt = buildDiscoveryPrompt(input);
  const { content, citations } = await callPerplexity(prompt);
  const parsed = parseDiscoveryMarkdown(content);
  return {
    ...parsed,
    citations,
    rawMarkdown: content,
  };
}
