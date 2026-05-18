/**
 * AR Sprite registry — source of truth for which character sprites are
 * available in the Supabase `ar-sprites` bucket and how to map them to
 * URLs.
 *
 * Used by:
 *  - the player UI (`ARCharacterSpeaker`) to render the right PNG per pose
 *  - the generation pipeline prompt to constrain Claude's character pick
 *
 * As we ship more sprites, just append new entries here — the rest of the
 * stack picks them up automatically.
 */
export type ARPose =
  | "idle"
  | "talking"
  | "pointing"
  | "thinking"
  | "surprised";

export const AR_POSES: ARPose[] = [
  "idle",
  "talking",
  "pointing",
  "thinking",
  "surprised",
];

/**
 * Catalogue of character types that have a complete 5-pose sprite set
 * uploaded. The pipeline must only pick from this list.
 *
 * `bestFor` lists the SITE TYPES + KEYWORDS that strongly match this
 * archetype. They're the primary signal Claude uses when picking. Always
 * prefer SITE TYPE over secondary theme (e.g. a corsair buried in a
 * monastery is still a "monk" location because the building is religious).
 *
 * `avoid` lists situations where this character is a wrong fit even
 * though it might superficially sound right.
 */
export const AR_CHARACTERS = [
  {
    type: "knight",
    description:
      "armoured medieval knight or crusader, royal/military authority figure",
    bestFor:
      "CASTLES, FORTRESSES, ARMOURIES, BATTLEFIELDS, ROYAL PALACES, COLONIAL GOVERNORS' RESIDENCES, MILITARY ORDERS, COURTHOUSES OF MEDIEVAL/COLONIAL ERA, ramparts, watchtowers with military function",
    avoid:
      "religious sites (use monk), maritime sites (use sailor), modern buildings",
  },
  {
    type: "witch",
    description: "mystic crone, sorceress or alchemist",
    bestFor:
      "PLAGUE MEMORIALS, INQUISITION SITES, BURNING-PLACE PLAZAS, ALCHEMICAL/HERBALIST HERITAGE, FOLKLORE LANDMARKS, sites of persecutions, occult legends, sites tied to magic or curses, witch trials, apothecaries",
    avoid:
      "neutral churches (use monk), military sites (use knight), hauntings without magic theme (use ghost)",
  },
  {
    type: "monk",
    description: "robed religious figure (Christian, Buddhist, etc.)",
    bestFor:
      "CHURCHES, CATHEDRALS, ABBEYS, MONASTERIES, CONVENTS, SANCTUARIES, CHAPELS, RELIQUARIES, SEMINARIES, scriptoriums, religious heritage of any era. CRITICAL: a religious building always wins this slot, even if a corsair is buried there or a treasure is hidden inside.",
    avoid: "secular sites with only superficial religious symbolism",
  },
  {
    type: "sailor",
    description: "naval officer, mariner, harbourmaster, corsair captain",
    bestFor:
      "PORTS, HARBOURS, DOCKS, MARINAS, LIGHTHOUSES, FAROS, MUELLES, SHIPYARDS, NAVAL ARSENALS, CORSAIRS' HOUSES, CAPTAINS' RESIDENCES, FISH MARKETS, customs houses, maritime museums, naval heroes' monuments. Use this on any port-city step that's about sea trade or corsairs.",
    avoid:
      "religious tombs of corsairs (use monk for the building, NOT sailor), inland fortifications (use knight)",
  },
  {
    type: "detective",
    description: "Victorian / early-20c sleuth in trench coat or top hat",
    bestFor:
      "1850-1940 MYSTERIES, NOIR ATMOSPHERES, URBAN CRIME LEGENDS of that era, detective stories, true-crime monuments, espionage sites, art-nouveau/art-deco buildings tied to a mystery",
    avoid: "anything pre-1850 or post-1950, religious sites, ports",
  },
  {
    type: "ghost",
    description: "spectral apparition of a deceased figure",
    bestFor:
      "TOMBS, CEMETERIES, MAUSOLEUMS, CRYPTS, OSSUARIES, ABANDONED RUINS, BATTLEFIELD MEMORIALS, sites of tragic deaths, haunted hotels, ancestor cults. Use sparingly — only when the step's PRIMARY signal is death or haunting, not just because someone famous died nearby.",
    avoid:
      "religious buildings where a famous person is buried (use monk), corsair sites (use sailor unless the SITE itself is a tomb)",
  },
  {
    type: "princess",
    description: "noble lady in court dress, regal but approachable",
    bestFor:
      "ROYAL PALACES, COURT YARDS, DUCAL RESIDENCES, NOBLE HÔTEL PARTICULIERS, BALL ROOMS, ROSE GARDENS, ROMANTIC LEGENDS, sites tied to courtly love, dynasty stories, queens / duchesses / dauphines. Also great for fairy-tale UNESCO old-towns.",
    avoid:
      "military / war sites (use knight or soldier), religious sites (use monk), anything modern",
  },
  {
    type: "peasant",
    description: "common villager / artisan in working clothes",
    bestFor:
      "MARKET SQUARES, TRADITIONAL BAKERIES, MILLS, FORGES, TANNERIES, PEASANT FARMHOUSES, OLD VILLAGE WELLS, FOLKLORE SITES, places about everyday medieval/early-modern life. Strong choice when the riddle's tone is grounded, rural, communal.",
    avoid:
      "royal / noble settings (use princess or knight), religious sites (use monk)",
  },
  {
    type: "soldier",
    description: "modern-era soldier in 19c-WW2 uniform",
    bestFor:
      "WAR MEMORIALS, MILITARY MUSEUMS, BARRACKS, HISTORIC TRENCHES, RESISTANCE SITES, COMMAND POSTS, BATTLE-OF-THE-BULGE LOCATIONS, COLD-WAR BUNKERS, post-1750 to mid-20c military heritage. Best fit for WW1 / WW2 / Resistance themes.",
    avoid:
      "medieval combat (use knight), maritime sites (use sailor), religious / royal sites",
  },
  // Added 2026-05-17 — 4 new sprites uploaded by user :
  {
    type: "scholar",
    description:
      "Renaissance/medieval intellectual in robe, holding manuscript or quill",
    bestFor:
      "LIBRARIES, UNIVERSITIES, OBSERVATORIES, ANATOMY THEATRES, ACADEMIES, SCRIPTORIA, PRINTING-PRESS HERITAGE, BOTANICAL GARDENS, SCIENTIFIC LANDMARKS, philosophy / humanism sites, Renaissance bookshops, places tied to a historical thinker / inventor (Galileo, Erasmus, Pasteur, etc.). Fills a gap : was previously a hard-default site type.",
    avoid:
      "religious worship sites without academic dimension (use monk), pure military (use knight or soldier)",
  },
  {
    type: "roman",
    description: "Roman patrician or legionary in toga or armour",
    bestFor:
      "ROMAN RUINS, FORUMS, AMPHITHEATRES, AQUEDUCTS, ROMAN BATHS (thermae), ROMAN VILLAS, MOSAIC FLOORS, TRIUMPHAL ARCHES, MILESTONE STONES, anywhere with documented Roman heritage (Lyon-Lugdunum, Arles, Lugo, Mérida, Bath, Trier, Aquincum, Volubilis). Strong for ancient sites that monk/knight can't cover.",
    avoid:
      "Greek antiquity (use default — no Greek archetype yet), medieval ruins on Roman foundations where the medieval layer dominates (use monk or knight)",
  },
  {
    type: "viking",
    description: "Norse warrior or seafarer with axe / horn / longship motif",
    bestFor:
      "VIKING BURIAL MOUNDS, RUNESTONES, LONGSHIP MUSEUMS, NORDIC FORTRESSES, DRAKKAR PORTS, JELLING-STYLE MONUMENTS, sites tied to Norse exploration (Newfoundland L'Anse aux Meadows, Dublin viking heritage, Normandy founder sites). Niche but a strong slam-dunk match.",
    avoid:
      "post-Christianisation Scandinavian sites (use monk), maritime sites without Norse connection (use sailor)",
  },
  {
    type: "beggar",
    description:
      "ragged urban poor of medieval/early-modern era, often outside cathedral or hospital",
    bestFor:
      "HÔTEL-DIEU / OLD HOSPITALS, ALMSHOUSES, SOUP-KITCHENS, COUR DES MIRACLES neighbourhoods, MEDIEVAL CITY GATES (where beggars congregated), POVERTY-ERA MEMORIALS, DICKENSIAN-STYLE LANES, sites tied to specific famous paupers or saints of the poor. Rare match but evocative.",
    avoid:
      "rural sites (use peasant), generic markets (use peasant), modern poverty (use default)",
  },
] as const;

/**
 * Decorative AR objects (single-image sprites, no pose set).
 * These can be composited into the AR scene as treasure reveals,
 * inventory items, or success-modal flair. They are NOT placed into
 * the character speaker — that's character-only.
 */
export const AR_OBJECTS = [
  { type: "key", description: "ornate key" },
  { type: "parchment", description: "rolled / sealed manuscript" },
  { type: "potion", description: "glowing alchemical bottle" },
  { type: "sword", description: "ceremonial sword" },
  { type: "treasure_chest", description: "wooden bound-iron chest" },
] as const;

export type ARObjectType = (typeof AR_OBJECTS)[number]["type"];

/** URL builder for decorative AR objects (single-image sprites). */
export function getObjectUrl(type: ARObjectType): string {
  return `${BUCKET_BASE}/${type}.png`;
}

export type ARCharacterType = (typeof AR_CHARACTERS)[number]["type"];

/** Fallback characters used when no thematic match exists. */
export const AR_FALLBACK_CHARACTERS = ["guide_male", "guide_female"] as const;
export type ARFallbackCharacter = (typeof AR_FALLBACK_CHARACTERS)[number];

/** Every character (themed + fallback) that has sprites in the bucket. */
export const ALL_AR_CHARACTERS: readonly string[] = [
  ...AR_CHARACTERS.map((c) => c.type),
  ...AR_FALLBACK_CHARACTERS,
];

const BUCKET_BASE =
  "https://sijpbarxxcdkodhfrdyx.supabase.co/storage/v1/object/public/ar-sprites";

/**
 * Characters dont on sait que toutes les poses du `ARPose` enum sont
 * disponibles dans le bucket. Pour les autres, on garde idle + talking
 * uniquement (les 2 utilisées en pratique par `ARCharacterSpeaker.tsx`)
 * et on fallback à `idle` si une autre pose est demandée. Évite les
 * 404 silencieux quand un nouveau character n'a pas l'ensemble complet.
 */
const CHARACTERS_WITH_FULL_POSE_SET: ReadonlySet<string> = new Set([
  "knight",
  "witch",
  "monk",
  "sailor",
  "detective",
  "ghost",
  "princess",
  "peasant",
  "soldier",
  "guide_male",
  "guide_female",
]);

/** Poses uploaded for every character (legacy + new). */
const UNIVERSAL_POSES: ReadonlySet<ARPose> = new Set([
  "idle",
  "talking",
  "pointing",
  "surprised",
]);

/**
 * Build the public URL for a given character + pose.
 * If the character isn't in the catalogue, falls back to `guide_male`.
 * If the character is in the catalogue but the requested pose isn't
 * known to be uploaded (e.g. `thinking` for the 4 new characters
 * added 2026-05-17), falls back to `idle` to avoid 404.
 */
export function getSpriteUrl(
  characterType: string | null | undefined,
  pose: ARPose = "idle",
): string {
  const type =
    characterType && ALL_AR_CHARACTERS.includes(characterType)
      ? characterType
      : "guide_male";
  // If the character is from the post-2026-05-17 batch (no thinking
  // pose uploaded), serve `idle` instead of a 404 URL.
  const safePose =
    CHARACTERS_WITH_FULL_POSE_SET.has(type) || UNIVERSAL_POSES.has(pose)
      ? pose
      : "idle";
  return `${BUCKET_BASE}/${type}_${safePose}.png`;
}

/**
 * Picks a fallback guide based on a stable seed (e.g. step id) so the
 * same step always renders the same guide rather than flickering.
 */
export function pickFallbackGuide(seed: string): ARFallbackCharacter {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AR_FALLBACK_CHARACTERS[Math.abs(hash) % AR_FALLBACK_CHARACTERS.length];
}

/**
 * Format the character catalogue for a Claude prompt. Each entry includes
 * la description, les sites/thèmes qui matchent le mieux, et les pièges
 * à éviter.
 */
export function formatCharactersForPrompt(): string {
  const lines = AR_CHARACTERS.map(
    (c) =>
      `  - "${c.type}" — ${c.description}\n      best for: ${c.bestFor}\n      avoid: ${c.avoid}`,
  ).join("\n");
  return `AVAILABLE THEMED CHARACTER TYPES (use ONLY when there's a SLAM-DUNK match):\n${lines}\n\nDEFAULT (use 90% of the time):\n  - "default" — neutral OddballTrip guide (homme ou femme, le runtime choisit). C'est la valeur PAR DÉFAUT à utiliser dès qu'il y a le moindre doute.`;
}

/**
 * Build the full character-selection block for a Claude prompt.
 *
 * IMPORTANT (changement 2026-05-05) : on inverse la logique. Avant on
 * forçait de la "diversité" et un thème à chaque stop, ce qui produisait
 * des matches absurdes (monk au Parthénon classique grec, princess pour
 * les Caryatides, peasant au temple d'Héphaïstos). Maintenant on demande
 * à Claude de choisir "default" (guide OddballTrip) PAR DÉFAUT, et de
 * passer à un personnage thématique UNIQUEMENT quand le match est
 * EVIDENT et UNIVOQUE.
 *
 * Rationale opérateur : le catalogue de personnages thématiques est
 * volontairement limité (9 archétypes), et la plupart des sites du monde
 * ne tombent dans aucune de ces catégories. Plutôt que de forcer un
 * peasant pour Hadrian's Library faute de mieux, on met le guide neutre
 * — moins de friction immersive pour le joueur.
 */
export function buildCharacterSelectionGuidance(stepCount: number): string {
  return `CHARACTER SELECTION — RÈGLE NOUVELLE (priorité au "default") :

VALEUR PAR DÉFAUT : "default" (= guide OddballTrip neutre).
Tu écris "default" pour TOUS les stops sauf si la règle SLAM-DUNK ci-dessous s'applique.

RÈGLE SLAM-DUNK pour passer à un personnage thématique :
Tu ne sors du "default" QUE SI le SITE TYPE + ÉRA correspond DIRECTEMENT et SANS DOUTE à un personnage du catalogue ci-dessous. Si tu hésites une seconde, tu mets "default".

Exemples qui justifient un personnage thématique :
  - Site = château fortifié médiéval → "knight"
  - Site = cathédrale catholique du 13e siècle → "monk"
  - Site = phare ou port marchand → "sailor"
  - Site = bûcher/place d'inquisition documentée → "witch"
  - Site = champ de bataille WWII / monument GI → "soldier"
  - Site = cimetière / mausolée / catacombes → "ghost"

Exemples qui DOIVENT rester "default" :
  - Site archéologique grec antique (ne match aucun personnage du catalogue : pas de moine ni chevalier dans la Grèce de Périclès) → "default"
  - Musée moderne (Acropolis Museum, Louvre, Beaux-Arts) → "default"
  - Place publique générique / bâtiment civique récent → "default"
  - Théâtre antique (Dionysos) — aucun de nos personnages n'est un acteur grec → "default"
  - Bibliothèque (Hadrian, BNF) — pas de "scholar" dans le catalogue → "default"
  - Synagogue / mosquée / temple bouddhiste si on n'a que "monk" qui est trop christianocentré → "default"

PRINCIPE GUIDANT : il vaut mieux 8 stops avec "default" qu'un seul stop avec un personnage qui n'a rien à voir. Le guide neutre n'aliène personne ; un mauvais match casse l'immersion.

PAS de mandat de diversité. Tu peux mettre "default" sur les ${stepCount} stops si rien ne match clairement.

${formatCharactersForPrompt()}`;
}
