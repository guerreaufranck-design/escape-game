/**
 * Templates narratifs par genre, injectés dans les prompts Claude
 * (`generateGameSteps` + `generateEpilogue`).
 *
 * Chaque template définit la tonalité, le style des mots magiques,
 * le biais AR character, et le cadrage de l'épilogue. Les stops eux-
 * mêmes (Google Places + curation Claude) sont indépendants du genre :
 * le même set de POIs Aegina peut être joué `historical`, `mystery`,
 * `fantasy`. La fiction est une couche narrative posée sur la même
 * géographie.
 *
 * MVP : ~10 lignes de directives par genre, en surcouche du prompt
 * existant. Pas de réécriture des règles ABSOLUTES (radius, AR,
 * coords, hints structure) — seul le ton change.
 */

import type { GameGenre } from "./game-genres";

export interface GenreTemplate {
  /** Label humain pour les logs et le header de prompt. */
  label: string;
  /** Promesse client (1 ligne) — ce que le joueur achète. */
  promise: string;
  /** Bloc de directives injecté dans `generateGameSteps`. */
  riddleDirectives: string;
  /** Bloc de directives injecté dans `generateEpilogue`. */
  epilogueDirectives: string;
}

export const GENRE_TEMPLATES: Record<GameGenre, GenreTemplate> = {
  historical: {
    label: "Historical",
    promise: "Discover the true history that unfolded here.",
    riddleDirectives: `- TONE: documentary, grounded, evocative — like a passionate historian guide.
- EACH STOP anchors on a real, datable, factual event tied to the location. If the building post-dates the theme, use the speculative-mode framing ("imagine — six centuries ago, on this very ground...").
- MAGIC WORD STYLE: Latin words (VERITAS, FIDES, AURUM), 4-digit years (1789, 1944), Roman numerals (MCMXIV), single proper names from the era. Avoid invented runes / spy code names.
- AR CHARACTER BIAS: monk, peasant, knight, sailor, soldier — pick what fits the era of the location. AVOID witch / princess / ghost / detective (off-genre).
- ANECDOTE: stand-alone historical fact, MUST be cross-checkable. Cite era, dates, named persons.`,
    epilogueDirectives: `- FRAME: a long-kept historical revelation that ties all stops into one true story-arc the player just walked through.
- TONE: erudite, warm, like a museum curator unveiling a rare archive document.`,
  },

  mystery: {
    label: "Mystery / Polar",
    promise: "Solve the case — clues, witnesses, suspects.",
    riddleDirectives: `- TONE: tense, noir, suspect-and-clue. The player is a detective on the case.
- EACH STOP = a clue, a witness, a crime scene, a hideout, or a suspect's home. Reuse hotels / shops / offices WITHOUT FEAR — they ARE the polar grammar (a hotel is a witness, a café is a meeting point).
- MAGIC WORD STYLE: dossier numbers (DOSSIER-7, M-12), suspect surnames (KOVAC, ROCHE, TANNER), evidence words (ALIBI, TÉMOIN, RANSOM, MOBILE). Latin / Roman numerals are OFF-genre — replace with case codes.
- AR CHARACTER BIAS: detective ALWAYS for at least half the stops. Optionally ghost (the victim) or sailor (a witness from the docks).
- ANECDOTE: a real local crime, smuggling tale, or fait-divers from this city if one fits; otherwise a real period detail (police-archive practice, contemporary criminology, cold case).`,
    epilogueDirectives: `- FRAME: the case is closed. Reveal who did it, why, and what each stop's clue meant in the chain of evidence.
- TONE: detective wrap-up — the final monologue of a Maigret, a Sherlock, a Columbo. Calm, methodical, one human beat at the end.`,
  },

  fantasy: {
    label: "Fantastique",
    promise: "Live a magical adventure — dragons, spells, hidden realms.",
    riddleDirectives: `- TONE: epic, mythic, Tolkien/Narnia-coded. The city overlays a hidden magical realm visible only to the player.
- EACH STOP = a magical site (a dragon's perch, a witch's lair, an elven gate, a cursed library, a forge of the dwarves). Recast the real building's function ("this museum is in fact the Hall of the Forgotten King").
- MAGIC WORD STYLE: invented runes / elven words (1-2 syllables, evocative: AELRA, VORIN, MITHRAEL), names of magical beasts, single-word spells (LUMOS-style). Years and Latin are OFF-genre.
- AR CHARACTER BIAS: knight, witch, princess — at least 4 of these distributed across the game. Avoid soldier / detective (off-genre).
- ANECDOTE: a real local legend, folklore, or medieval superstition tied to this place — keep it factually framed ("locals from the 14th c. believed...").`,
    epilogueDirectives: `- FRAME: the prophecy is fulfilled. The hidden realm anchors back into the city as the player walks away.
- TONE: bardic, lyrical, like a Celtic oral storyteller closing a saga around a fire.`,
  },

  romance: {
    label: "Romantique",
    promise: "Reconstruct a love story rooted in the city.",
    riddleDirectives: `- TONE: lyrical, tender, period-romantic (Hugo, Rostand, Brontë). Two lovers' paths crossed at each stop.
- EACH STOP = a place that witnessed a moment of the romance (the first glance, the secret letter, the duel, the elopement, the parting, the reunion).
- MAGIC WORD STYLE: lover names (HÉLOÏSE, ABÉLARD), dates of meeting (1342, 1789), single evocative words (TOUJOURS, AMOR, FIDÈLE, JURÉ), or initials carved on a tree.
- AR CHARACTER BIAS: princess, peasant, monk (the confessor) — at least 2 distinct lovers' archetypes used across the game.
- ANECDOTE: a real local love story (verifiable couple, marriage record, novel set here) if one fits; else a romantic period-detail (love-letter customs, secret balcony codes, contraband marriages).`,
    epilogueDirectives: `- FRAME: the lovers' fate, told with elegance — reunited, parted, immortalised.
- TONE: lyrical, like the closing pages of a 19th-c. classic novel; one tear, one breath.`,
  },

  supernatural: {
    label: "Surnaturel / Fantômes",
    promise: "Follow the city's hauntings and urban legends.",
    riddleDirectives: `- TONE: chilling, whispered, candle-lit. The city is haunted; each stop has a presence.
- EACH STOP = a haunting site — a death scene, a cursed house, a phantom's last appearance, a place where time slips.
- MAGIC WORD STYLE: spirit names, whispered single words (REQUIESCAT, ANIMA, MANES, UMBRA), death dates (1721), or the ghost's first name in capital script.
- AR CHARACTER BIAS: ghost ALWAYS for at least half the stops. Witch or monk as secondary. NEVER detective / sailor / soldier (breaks the mood).
- ANECDOTE: a real local ghost story, suicide-archive, or supernatural folklore tied to this place — most cities have at least one, surface it.`,
    epilogueDirectives: `- FRAME: the spirit's truth is revealed; the haunting is explained, not exorcised. The city remains haunted but the player understands.
- TONE: melancholic, gothic, like the closing of a M. R. James or Shirley Jackson tale.`,
  },

  espionnage: {
    label: "Espionnage",
    promise: "Decode a modern intrigue — codes, safehouses, double agents.",
    riddleDirectives: `- TONE: cold, technical, late 20th-c. spy-thriller (le Carré, Deighton). Each stop = a tradecraft moment.
- EACH STOP = a dead drop, a brush pass, a safehouse, a surveillance post, an exfiltration point. Hotels and cafés are CORE LOCATIONS — not to be filtered out.
- MAGIC WORD STYLE: code names (FOX-7, NIGHTHAWK, BURNED), 4-digit cipher grids (4471, 0023), agent aliases (KOVAC, TANNER, ASSET-9). Latin / poetry are OFF-genre.
- AR CHARACTER BIAS: detective and soldier preferred. Optionally sailor for cold-war port-city ops. AVOID witch / princess (off-genre).
- ANECDOTE: a real local cold-war episode, cipher-history detail, or military-intelligence tidbit — Berlin, Vienna, Lisbon, France's Atlantic ports all have rich material.`,
    epilogueDirectives: `- FRAME: the mission is closed. The agent's debrief reveals the operation's codename, the asset's fate, the geopolitical stakes.
- TONE: clinical — like a declassified file's executive summary, with one human note at the end.`,
  },

  cinema: {
    label: "Cinéma",
    promise: "Walk in the footsteps of films shot here.",
    riddleDirectives: `- TONE: cinephile, fan-letter, with a wink at iconic films. Each stop = a shooting location or a referenced scene.
- EACH STOP links to a real or plausibly-real film tied to this place. If you don't know one, invent a plausible homage ("imagine the camera tracking from this corner...").
- MAGIC WORD STYLE: film titles (CASABLANCA, METROPOLIS), iconic lines (REDRUM, ROSEBUD), director surnames (HITCHCOCK, KUROSAWA), one evocative noun from the film. Latin / spy codes are OFF-genre.
- AR CHARACTER BIAS: ghost (the auteur), detective (noir-genre films), princess (period-drama films) — vary across the genres of the films cited.
- ANECDOTE: a real local filming-history detail (which film, which director, which year) if you have one; else a real cultural film-fact about the city's cinema scene.`,
    epilogueDirectives: `- FRAME: the player has walked through a curated cinematic montage of the city. The credits roll.
- TONE: enthusiastic film-archive curator's voice-over, with one final critical insight.`,
  },

  fairytale: {
    label: "Conte de fées",
    promise: "Step into a fairytale — princesses, witches, kingdoms.",
    riddleDirectives: `- TONE: warm, child-friendly, magical, like Perrault or the Brothers Grimm. Each stop = a fairytale beat.
- EACH STOP's site is reimagined as a fairytale element (a market = the kingdom's bazaar, a church = the cathedral of the prince, a park = the enchanted forest, a city wall = the dragon's keep).
- MAGIC WORD STYLE: magical objects (SLIPPER, MIRROR, SPINDLE, ROSE), single magical names (RAPUNZEL, AURORA, MERLIN), or one evocative word (ENCHANTED, MIDNIGHT, CRYSTAL).
- AR CHARACTER BIAS: princess, witch, knight — at least 3 distinct of these across the game. AVOID detective / soldier / ghost (off-genre, too dark for this register).
- ANECDOTE: a real folkloric / fairytale connection of the place (originated a famous tale, inspired a Disney film, has a local legend); else a real history-fact framed warmly for a young audience.`,
    epilogueDirectives: `- FRAME: the moral of the tale, with the player as the hero who saw the kingdom from the inside.
- TONE: a warm storytelling close, like a parent finishing a bedtime tale.`,
  },
};

/** Récupère le template d'un genre. Garantit non-null grâce au record exhaustif. */
export function getGenreTemplate(genre: GameGenre): GenreTemplate {
  return GENRE_TEMPLATES[genre];
}

/**
 * Construit le bloc d'overlay narratif à prepend au prompt
 * `generateGameSteps`. Cadre Claude AVANT les détails de format.
 */
export function buildGenreRiddleOverlay(genre: GameGenre): string {
  const t = GENRE_TEMPLATES[genre];
  return `═══════════════════════════════════════════════════════════════════════
GENRE: ${t.label} — ${t.promise}
═══════════════════════════════════════════════════════════════════════
${t.riddleDirectives}

These genre directives apply to riddle_text, answer_text, ar_character_type,
ar_character_dialogue, ar_facade_text, ar_treasure_reward, and anecdote.
They override the historical-default tone hints in the detailed rules below
when there is a conflict (e.g. magic word style, AR character bias).
═══════════════════════════════════════════════════════════════════════
`;
}

/**
 * Bloc d'overlay pour `generateEpilogue` — frame + ton.
 */
export function buildGenreEpilogueOverlay(genre: GameGenre): string {
  const t = GENRE_TEMPLATES[genre];
  return `═══════════════════════════════════════════════════════════════════════
GENRE: ${t.label} — ${t.promise}
═══════════════════════════════════════════════════════════════════════
${t.epilogueDirectives}
═══════════════════════════════════════════════════════════════════════
`;
}
