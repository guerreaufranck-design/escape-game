/**
 * Anthropic Claude API client for creative game content generation
 * Uses Claude Sonnet for riddle creation, narrative, and formatting
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ResearchedLocation, VerifiedThemeContext } from "./perplexity";
import { getRelevantNegativeFeedback, formatFeedbackForPrompt } from "./feedback-memory";
import { buildCharacterSelectionGuidance } from "./ar-sprites";
import { type GameGenre, DEFAULT_GENRE } from "./game-genres";
import {
  buildGenreRiddleOverlay,
  buildGenreEpilogueOverlay,
} from "./genre-templates";
import { WEAK_ANSWERS, KNOWN_FAKE_TOKENS } from "./answer-blacklists";

export interface GeneratedStep {
  title: string;
  latitude: number;
  longitude: number;
  validation_radius_meters: number;
  riddle_text: string;
  answer_text: string;
  hints: { order: number; text: string }[];
  /**
   * Full patrimonial history of the place — INDEPENDENT of the game's
   * theme. 2-3 paragraphs: who built it and when, why it matters in
   * the city, what makes it worth visiting. Played as the FIRST
   * narration card after the player finds the AR clue, BEFORE the
   * thematic anecdote.
   *
   * Powers the "you didn't just walk, you learned" experience demanded
   * by the customer (vision 2026-05-16, post-incident Julien).
   */
  landmark_history: string;
  anecdote: string;
  bonus_time_seconds: number;
  /** How the player discovers the answer — "physical" (real inscription) or
   * "virtual_ar" (AR overlay reveals it). Derived from the source location. */
  answer_source: "physical" | "virtual_ar";
  // ---- AR layer (rendered at runtime by the player UI) -------------------
  /** Character archetype that "speaks" when player locks on target. Must
   * match a key in AR_CHARACTERS or be "default". */
  ar_character_type: string;
  /** Short atmospheric line the character whispers to the player (1-2
   * sentences). Sets the mood, doesn't spoil the answer. */
  ar_character_dialogue: string;
  /** 1-3 evocative words that "appear" magically on the building's façade
   * when the player locks on target. For virtual_ar steps, this IS the
   * answer reveal. For physical steps, it's a thematic word (e.g. "VERITAS",
   * "DECRETO", "1532") that primes the right inscription on the real wall. */
  ar_facade_text: string;
  /** Description of the treasure object revealed by the AR camera once the
   * step is solved (e.g. "a silver key engraved with a galleon"). 1
   * sentence — themed to the step's narrative. */
  ar_treasure_reward: string;
  /** 3-4 real cultural / heritage / quirky / viewpoint points the
   * player passes ON THE WAY to this step. Surfaced as a separate card
   * in the UI ("Sur le chemin, ne manque pas...") so players can slow
   * down and observe. Enriched 2026-05-17 with category + distance +
   * GPS to make the card scannable + clickable for navigation. */
  route_attractions: Array<{
    name: string;
    fact: string;
    /** Bucket pour styling UI + filtering : heritage (monument,
     *  église), viewpoint (panorama, place), quirky (anecdote
     *  insolite, statue inattendue), food (boulangerie iconique,
     *  café historique), nature (parc, jardin). */
    category?: "heritage" | "viewpoint" | "quirky" | "food" | "nature";
    /** Distance approximative en mètres depuis ce stop. Aide le
     *  joueur à savoir si c'est un crochet de 50m ou de 500m. */
    distance_m?: number;
    /** Coords optionnelles. Quand présentes, le UI peut afficher un
     *  bouton "ouvrir dans Maps" / "Navigate" pour ce sous-point. */
    lat?: number;
    lon?: number;
  }>;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Generate escape game steps from verified research data
 * Claude creates immersive riddles around pre-verified answers
 */
export async function generateGameSteps(
  city: string,
  country: string,
  theme: string,
  narrative: string,
  difficulty: number,
  locations: ResearchedLocation[],
  genre: GameGenre = DEFAULT_GENRE,
  verifiedContext?: VerifiedThemeContext,
): Promise<GeneratedStep[]> {
  // RAG: pull lessons from past admin thumbs-down feedback on similar contexts
  let feedbackBlock = "";
  try {
    const feedback = await getRelevantNegativeFeedback({ city, theme, limit: 8 });
    feedbackBlock = formatFeedbackForPrompt(feedback);
    if (feedbackBlock) {
      console.log(
        `[generateGameSteps] Injecting ${feedback.length} lessons from past feedback`,
      );
    }
  } catch (err) {
    console.warn(
      `[generateGameSteps] Could not fetch feedback memory: ${err instanceof Error ? err.message : err}`,
    );
  }
  const client = getAnthropicClient();

  // Format locations for the prompt — include answerSource so Claude can
  // adapt the riddle tone (physical = "read the engraved year", virtual_ar
  // = "the wall will whisper a sign when you point your camera").
  const locationsText = locations
    .map(
      (loc, i) => `Location ${i + 1}: ${loc.name}
- GPS: ${loc.latitude}, ${loc.longitude}
- What to observe: ${loc.whatToObserve}
- ANSWER: ${loc.answer}
- Answer type: ${loc.answerType}
- Answer source: ${loc.answerSource ?? "physical"} ${loc.answerSource === "virtual_ar" ? "(AR-only: riddle must hint at activating AR camera)" : "(physical: riddle must say where to look on the real monument)"}
- Source: ${loc.source}
- Theme link: ${loc.themeLink || "N/A"}${
        loc.patrimonialRole
          ? `
- 🏛️ FULL PATRIMONIAL HISTORY (independent of theme): ${loc.patrimonialRole}${loc.citation ? ` (Source: ${loc.citation})` : ""}`
          : ""
      }${
        loc.thematicRole
          ? `
- 🎭 THEMATIC CONNECTION: ${loc.thematicRole}`
          : ""
      }${
        loc.poiCategory
          ? `
- Category: ${loc.poiCategory}`
          : ""
      }`
    )
    .join("\n\n");

  // Detect whether the discovery pipeline gave us per-stop documented
  // history. If yes, we instruct Claude to ANCHOR landmark_history on
  // the documented patrimonial role and the anecdote on the thematic
  // connection (post-2026-05-16 patrimoine-first flow). If no, we fall
  // back to the historical "fiction libre DANS le thème" mode (legacy).
  const hasThematicAnchors = locations.some((l) => l.patrimonialRole);

  const stepCount = Math.min(locations.length, 8);

  const genreOverlay = buildGenreRiddleOverlay(genre);

  // Build verified-facts block from Perplexity Deep Research, if available.
  // These facts MUST be cited in anecdotes (real figures, real dates,
  // sourced URLs). Riddle protagonists stay FICTIONAL ANONYMOUS.
  const verifiedFactsBlock = (() => {
    if (!verifiedContext) return "";
    const hasContent =
      verifiedContext.iconicSites.length > 0 ||
      verifiedContext.realFigures.length > 0 ||
      verifiedContext.events.length > 0 ||
      verifiedContext.localTraditions.length > 0;
    if (!hasContent) return "";
    const sites = verifiedContext.iconicSites
      .map(
        (s, i) =>
          `  ${i + 1}. **${s.name}**${s.locationHint ? ` (${s.locationHint})` : ""} — ${s.significance}\n     Sources: ${s.sources.join(", ")}`,
      )
      .join("\n");
    const figures = verifiedContext.realFigures
      .map(
        (f, i) =>
          `  ${i + 1}. **${f.name}**${f.lifespan ? ` (${f.lifespan})` : ""} — ${f.role}\n     Sources: ${f.sources.join(", ")}`,
      )
      .join("\n");
    const events = verifiedContext.events
      .map(
        (e, i) =>
          `  ${i + 1}. **${e.date}** — ${e.description}\n     Sources: ${e.sources.join(", ")}`,
      )
      .join("\n");
    const traditions = verifiedContext.localTraditions
      .map((t, i) => `  ${i + 1}. ${t.description}\n     Sources: ${t.sources.join(", ")}`)
      .join("\n");
    return `
═══════════════════════════════════════════════════════════════════════
VERIFIED FACTS (from Perplexity Deep Research, with source URLs)
═══════════════════════════════════════════════════════════════════════
You MUST use these facts as ANCHORS. Anecdotes are NOT a place for
imagination — they are factual ground from which the fictional riddle
draws its credibility.

ICONIC SITES (prioritize these if they match input locations):
${sites || "  (none)"}

REAL HISTORICAL FIGURES (USE THESE NAMES — see strict rule below):
${figures || "  (none)"}

DATED EVENTS (USE THESE YEARS — see strict rule below):
${events || "  (none)"}

LOCAL TRADITIONS (mention in anecdote when relevant):
${traditions || "  (none)"}

═══════════════════════════════════════════════════════════════════════
STRICT USAGE RULES (FOLLOW EXACTLY)
═══════════════════════════════════════════════════════════════════════

RULE 1 — REAL FIGURES IN ANECDOTE
  Each anecdote field MUST cite at least ONE real historical figure
  from the list above WHEN at least one figure is provided. Use their
  full name + lifespan + role. DO NOT invent fictional names like
  "Brother Augustin", "Master strategist", "Captain Mendoza" when a
  REAL person from the list fits the context. The fiction lives in
  the riddle — the anecdote belongs to history.

  Example BAD (when verified figures are provided):
    "Brother Augustin fled this abbey in 1790 carrying secret plans..."
  Example GOOD:
    "Dom Antoine de Besse (1731-1812), the last abbot of Cluny, was
     forced to flee in 1790 when revolutionary forces arrived. (Source:
     Britannica)"

RULE 2 — FICTIONAL PROTAGONIST IN RIDDLE ONLY
  The riddle's narrator/protagonist remains FICTIONAL ANONYMOUS:
  "the watchman who saw it", "the abbot's secretary", "the merchant's
  daughter". NEVER put fictional words/actions in the mouth of a
  real named person — this is libel risk + Gemini translation refusal.
  REAL figures = ANECDOTE. FICTIONAL voices = RIDDLE.

RULE 3 — DATED EVENTS DRIVE MAGIC WORDS
  When using a year as answer_text or ar_facade_text:
  → Use the EXACT year from the verified events list when one fits the stop's theme.
  → DO NOT use approximate years that "feel period-appropriate".
  → Use ARABIC NUMERALS ONLY ("1628", not "MDCXXVIII"). See rule 3b.

╔═══════════════════════════════════════════════════════════════════════╗
║ RULE 3b — ROMAN NUMERALS ARE TOTALLY FORBIDDEN (NO EXCEPTION)          ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║ Roman numerals are FORBIDDEN in ALL fields, including answer_text     ║
║ and ar_facade_text. NO EXCEPTION.                                     ║
║                                                                       ║
║ Two reasons (both fatal) :                                            ║
║   1. ElevenLabs TTS reads "MMXXVI" as "M-M-X-X-V-I" letter-by-letter, ║
║      which makes ZERO sense audio-side. The player hears garbage.     ║
║   2. Year mismatches between riddle-narration and Roman-numeral-      ║
║      encoded answer create validator failures (roman_date_drift)     ║
║      that cannot be auto-repaired with confidence.                    ║
║                                                                       ║
║ FORBIDDEN PATTERN (will be REJECTED by post-validator) :              ║
║   "answer_text": "MDCXXVIII"      ✗                                   ║
║   "ar_facade_text": "MCMXLIV"     ✗                                   ║
║   ANY string matching /^[MDCLXVI]{2,}$/ in those 2 fields             ║
║                                                                       ║
║ USE INSTEAD — pick the MOST DRAMATIC option among :                   ║
║                                                                       ║
║   A. LATIN THEMATIC WORDS (preferred — exotic, narrable, varied) :    ║
║      VERITAS, FIDES, AURUM, LIBERTAS, MARE, GLORIA, VIRTUS, PAX,      ║
║      CARITAS, MEMENTO, IMPERIUM, REGINA, MAGNUM, VICTORIA, etc.       ║
║      → BUT vary them across stops. Don't repeat the same word.        ║
║                                                                       ║
║   B. ARABIC YEAR ("1628", "1789", "1944") :                           ║
║      Easy to narrate, easy to fact-check, accepted by ElevenLabs.     ║
║                                                                       ║
║   C. FRENCH/SPANISH/THEME-LANGUAGE WORDS :                            ║
║      CORSAIRE, RÉSISTANCE, TRÉSOR, SECRET, BAROUDEUR, etc.            ║
║                                                                       ║
║   D. SHORT PROPER NAMES (real or fictional, ≤ 12 chars) :             ║
║      PHEIDON, GRIMAUD, MORTEMER, LAFITTE, etc.                        ║
║                                                                       ║
║   E. SHORT SYMBOLS / NUMBERS (uppercase) :                            ║
║      "VII" (only as single ordinal like a king's number — OK), "42", ║
║      "ALPHA", "OMEGA"                                                 ║
║      → Even here, prefer A/B/C/D options.                             ║
║                                                                       ║
║ DOUBLE-CHECK : before writing answer_text or ar_facade_text, ask     ║
║ yourself : "if ElevenLabs reads this aloud, will it sound natural ?"  ║
║ If not, use a Latin word or arabic year instead.                      ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝

RULE 4 — SOURCE CITATION
  Anecdotes ending with parenthetical source : "(Source: Wikipedia)"
  or "(Source: Britannica)" — for player credibility.

RULE 5 — DISTRIBUTION
  If you have N verified figures and ${stepCount} stops, distribute the
  figures across stops: each anecdote anchors on a DIFFERENT verified
  figure when possible. Don't repeat the same figure on every stop.

╔═══════════════════════════════════════════════════════════════════════╗
║ RULE 6 — TTS-FRIENDLY TEXT (2026-05-16, ElevenLabs compat)            ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║ ElevenLabs reads text letter-by-letter when it sees abbreviations.    ║
║ "400 av JC" becomes "quatre cents A V J C" — INCOMPRÉHENSIBLE.        ║
║                                                                       ║
║ ALL fields meant for TTS (riddle_text, anecdote, landmark_history,    ║
║ ar_character_dialogue, ar_treasure_reward) MUST be SPELLED OUT :      ║
║                                                                       ║
║ FORBIDDEN              →  USE INSTEAD                                 ║
║ ──────────────────────────────────────────                            ║
║ "av JC", "av. J.-C."   →  "avant Jésus-Christ" / "before Christ"      ║
║ "apr JC", "ap. J.-C."  →  "après Jésus-Christ" / "after Christ"       ║
║ "av notre ère"         →  "avant notre ère"                           ║
║ "ap notre ère"         →  "après notre ère"                           ║
║ "siècle" abbrev "s."   →  "siècle" en toutes lettres                  ║
║ "Mr." / "Mme." / "Dr." →  "Monsieur" / "Madame" / "Docteur"           ║
║ "St." / "Ste."         →  "Saint" / "Sainte" (or local equivalent)    ║
║ "n°" / "no."           →  "numéro"                                    ║
║ "etc." final           →  "et cetera" écrit en toutes lettres OR drop ║
║ "km", "m", "cm"        →  "kilomètres", "mètres", "centimètres"       ║
║ "h" pour heure         →  "heures" / "hours"                          ║
║ "AD" / "BC"            →  "anno Domini" / "before Christ" or "BCE/CE" ║
║ "vs."                  →  "contre" / "versus"                         ║
║ "Tps", "Mvt"           →  pas d'abréviations métier obscures          ║
║                                                                       ║
║ ROMAN NUMERALS (déjà couvert RULE 3b) : convertir en chiffres arabes  ║
║ OU épeler en mot ordinal lisible (e.g. "twelfth century" plutôt       ║
║ que "12th century" ou "XIIème siècle").                               ║
║                                                                       ║
║ PRINCIPE GÉNÉRAL : si une humaine devant ton texte lit "A V J C" au   ║
║ lieu de "avant Jésus-Christ", c'est un échec. Écris comme tu          ║
║ parlerais à voix haute.                                               ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
═══════════════════════════════════════════════════════════════════════

`;
  })();

  // Block injected when discovery gave us per-stop documented history
  // (Gemini-first flow, 2026-05-15+). Forces Claude to anchor each
  // anecdote on the real historical role of that specific place rather
  // than invent fiction. Empty when the legacy Google-Places fallback
  // ran instead.
  const thematicAnchorsBlock = hasThematicAnchors
    ? `
═══════════════════════════════════════════════════════════════════════
PER-STOP DOCUMENTED HISTORY (anchor anecdotes here — DO NOT INVENT)
═══════════════════════════════════════════════════════════════════════
Some locations above include a "📜 DOCUMENTED HISTORICAL ROLE" field.
That field comes from sourced research (with citation). For those stops:

  → The anecdote MUST be grounded in that documented role.
  → DO NOT invent a fictional history "compatible with the theme" when
    the real history is provided. If the role says the building was a
    partisan study centre, the anecdote talks about the partisan study
    centre, not about a Roman watchtower.
  → You may compress, dramatize, or rephrase for the audio guide, but
    you may not contradict or replace the documented facts.
  → The fiction lives ONLY in the riddle (the AR scene, the magical
    word, the protagonist's voice) — never in the anecdote.

This is the single most important rule of the 2026-05-15 quality bar.
It is what separates "we sent the player to a real Resistance memorial"
from "we sent the player to a hotel with an invented Resistance story".
═══════════════════════════════════════════════════════════════════════
`
    : "";

  const prompt = `${genreOverlay}${verifiedFactsBlock}${thematicAnchorsBlock}You are an expert AR-tour designer. The product is half escape-game, half audio-guided heritage walk: the player physically walks between historical locations in ${city}, ${country}, and at each stop their phone reveals — IN AUGMENTED REALITY — a magical short answer painted on the facade. Solving the game = walking the city + reading what only the AR can show.

I am giving you ${locations.length} researched locations. Your job is to select the best ${stepCount} that form a SAFE WALKING ROUTE (no major roads to cross, all stops within ~10 minutes' walk of each other, ideally a coherent neighbourhood) and craft a single coherent narrative around them.

═══════════════════════════════════════════════════════════════════════
ABSOLUTE RULES (read twice)
═══════════════════════════════════════════════════════════════════════
A. EVERY step is "virtual_ar". The answer is NEVER a real inscription on
   the building. The answer is what the AR overlay magically reveals to
   the player when they point their phone at the facade. You have full
   creative liberty: a year, a Latin/Spanish/local-language word, a
   number, a roman numeral — pick the most dramatic + thematic option.

B. The riddle does NOT ask the player to read something off the wall.
   It tells them to GO to the place, OBSERVE the surroundings, and
   INVITES them to use their AR camera to make the secret appear.

C. The riddle IS the tour. Weave in REAL touristic / cultural / historical
   pointers about what the player is walking past on the way to the next
   stop. ("As you turn down Calle X, you'll pass the 16th-century
   wrought-iron balconies of the Borghi house — pause and notice the
   crest above the door...")

D. The answer_text field must contain ONLY the short answer. NEVER a
   sentence. Copy it EXACTLY as provided.

E. RIDDLE STRUCTURE VARIETY — across the ${stepCount} stops, you MUST
   use DIFFERENT opening structures. NEVER repeat the same beat from
   stop to stop. Required mix (use at least 3 of these 6 patterns):

   1. SENSORY OPENER : "The smell of incense still clings to these
      walls..." / "Listen — can you hear the bells?" (concrete sensory
      detail anchoring the player)
   2. RHETORICAL QUESTION : "Why did the abbot leave that night?" /
      "What did the merchant know that cost him his life?"
   3. DATE + EVENT : "May 16, 1770. The young Austrian dauphine knelt..."
      (specific date + event from verifiedContext if available)
   4. WHISPERED QUOTE : "'I have seen the storm,' the watchman wrote in
      his final entry..." (quoted phrase, fictional anonymous source)
   5. HYPOTHETICAL : "Imagine these stones in 1281, when the first
      Mongol sail appeared on the horizon..."
   6. PARADOX / IRONY : "The same hands that built this fortress
      against pirates would later open its gates to Napoleon..."

   FORBIDDEN : opening 2+ stops with the same pattern (e.g. all stops
   starting with "It was [date] when..." → BANNED). Reviewer will reject.

F. RIDDLE PROTAGONIST DIVERSITY — the fictional anonymous protagonist
   varies across stops. Examples : "the watchman", "the abbess's
   secretary", "the cabin boy", "the merchant's daughter", "the
   apprentice scribe", "the gatekeeper's wife". NEVER reuse the same
   archetype twice in the same game. Each stop = different POV.

G. CROSS-STOP CALLBACKS — narrative cohesion is the difference between
   "this was ONE story" and "this was 7 independent puzzles". Players
   re-buy the FORMER, not the latter. Rules:

   G.1 Stops 2 through ${stepCount} MUST each contain AT LEAST ONE
       explicit textual callback to a PRIOR stop. The callback lives
       in the anecdote OR the riddle_text (NOT only in ar_facade_text).
       Examples of callbacks :
         • "The same Cathar sigil you uncovered at the first stop now
            reappears, carved deeper, above this doorway."
         • "Remember the date the watchman whispered at Stop 2 ? That
            year is no coincidence here either."
         • "The abbess's secretary's daughter — yes, the one who fled
            on Stop 3 — was last seen on this very square."
   G.2 Each callback must reference a DIFFERENT prior stop when there
       are enough prior stops (don't keep referencing Stop 1 forever).
       Spread the resonance so threads accumulate.
   G.3 The FINAL stop MUST contain at LEAST TWO callbacks weaving
       earlier threads into the climactic reveal. This is what makes
       players feel the build-up paid off.
   G.4 Callbacks ARE NOT spoilers : refer to what HAPPENED in the
       earlier riddle/anecdote — never re-reveal the prior ar_facade
       answer. Keep mystery layered.
   G.5 Track callbacks in your output by mentioning the prior stop by
       its title (e.g., "as at the Cathédrale of Stop 1...") OR by a
       distinctive landmark/figure/object from that prior stop. Vague
       "earlier in your journey" doesn't count.

   COMPETITOR CONTEXT (motivation) : Questo's #4 grievance is "rupture
   de la cohérence narrative" — energy spent on puzzles that don't
   connect. We FIX that by REQUIRING the threads. This is the single
   biggest player-retention lever (sell-to-same-customer-twice = the
   only sustainable economics).

GAME PARAMETERS:
- City: ${city}, ${country}
- Theme: ${theme}
- Narrative: ${narrative}
- Difficulty: ${difficulty}/5
- Steps: ${stepCount}
- Language: English (auto-translated at runtime by the app)

═══════════════════════════════════════════════════════════════════════
FOR EACH OF THE ${stepCount} STEPS, create a JSON object with:
═══════════════════════════════════════════════════════════════════════

1. "title": Evocative, mysterious — max 8 words.

2. "latitude" + "longitude": EXACTLY the coordinates from the location
   data below. Do not round, do not nudge, do not "improve". These
   coordinates have been authoritatively geocoded against Google Places
   / Nominatim from a real landmark name; any deviation introduces
   metres of error that break GPS-based step validation in the field.
   Treat these numbers as immutable INPUT — you copy them, you don't
   reason about them.

3. "validation_radius_meters": 25-50. Smaller for tight squares, larger for
   open plazas.

4. "riddle_text": 5-7 sentences. STRUCTURE en 3 mouvements brefs —
   POETIC d'abord, FACTUEL ensuite, ACTION-CALL succinct.

   AUTO-CALIBRATION DU TON — pour CHAQUE stop, juge d'abord :
   Le bâtiment a-t-il un lien DIRECT avec le thème du jeu ?
     • OUI (ex. château WWII pour un thème Battle of the Bulge,
       cathédrale 12e pour un thème médiéval) → mode GROUNDED :
       narration ancrée sur faits historiques DOCUMENTÉS du lieu
       (date, événement, personnage réel).
     • NON (bâtiment moderne dans un thème antique, bibliothèque
       contemporaine dans un thème pré-conquête, immeuble 1990s
       dans un thème médiéval) → mode SPÉCULATIF (ghost mode) :
       narration assumée comme IMAGINAIRE — le bâtiment moderne
       devient un PORTAIL vers le passé, pas un site historique
       lui-même. Exemples :
         "Aujourd'hui c'est une bibliothèque vitrée. Mais imagine :
          il y a 600 ans, ici se dressait le centre du village
          guanche d'Achimencey. Ferme les yeux. Sens le sable,
          écoute les chants tribaux qui montaient du feu sacré."
         "Cette plaza moderne pavée recouvre ce qui fut autrefois
          le marché aux poissons. Les pierres ne se souviennent
          de rien — mais l'âme du lieu, peut-être."
       Anachronisme ASSUMÉ et POÉTIQUE, pas inventé sans nuance.

   (a) NARRATIVE STORY (2-3 sentences) — Vivid micro-story tied to
       the place AND the game theme. Past tense, in-character,
       sensory detail. Vary the rhythm between steps : some open
       on suspense ("It was three in the morning when..."), some on
       a sensory detail ("The smell of incense still clung to..."),
       some on a question ("Why did the abbot leave that night ?").
       AVOID the same "X stood here, did Y" template at every step.

       En mode SPÉCULATIF (bâtiment ne match pas le thème), commence
       par "Imagine...", "Ferme les yeux et vois...", "Laisse ces
       murs modernes s'effacer..." — le joueur sait qu'on l'invite
       à voyager dans le temps, pas qu'on lui sert du faux historique.

   (b) THEN vs NOW BRIDGE (1-2 sentences) — Anchor le passé au
       présent. Comment ce lieu a évolué, ce que le joueur peut
       observer aujourd'hui. C'est le beat "audioguide" qui
       transforme l'énigme en marche patrimoniale.

   (c) ACTION-CALL — UNE SEULE phrase courte qui invite à observer
       avec l'AR. PAS de tutoriel verbeux ("appuie sur le grand
       bouton violet" est ÉCRIT 8 FOIS = casse l'immersion).
       Le tutoriel détaillé est dans l'app, hors riddle.

       FORMATS ACCEPTÉS — varie d'un stop à l'autre :
         • "Approche-toi de la porte principale, puis ouvre l'AR :
            quelque part, les lettres se matérialisent."
         • "Trouve l'angle où le soleil frappe la façade et lance
            la Réalité Augmentée."
         • "Place-toi face au tympan. La caméra te montrera ce
            que les pierres cachent depuis huit siècles."
         • "Active l'AR depuis le centre du parvis."

       INTERDIT : "tap the large purple 'Open Augmented Reality'
       button at the bottom of your screen, then slowly sweep
       everything..." — verbeux, répétitif, sort le joueur de
       l'immersion. UNE phrase courte, c'est tout.

       NEVER name "the north facade" / "the carved lion" / "the
       wooden studded door". Keep the destination generic ("at the
       church", "in front of the tower") — la découverte est le
       reward du joueur, pas une checklist.

   VARIÉTÉ NARRATIVE OBLIGATOIRE — sur ${stepCount} stops :
     - Au moins UN stop ouvre par un dialogue ou une question
     - Au moins UN stop révèle un détail historique inattendu
       qui contredit légèrement la première impression
     - Le stop ${stepCount} (final) doit contenir une RÉVÉLATION
       qui recontextualise les 7 précédents — un twist narratif,
       pas juste "you found all the clues" générique.

5. "answer_text": ONLY the short evocative answer. A year, a roman
   numeral, ONE word. NEVER a sentence. NEVER the literal string
   "AUTO" — that's a placeholder telling YOU to invent something,
   it's NOT a valid answer to ship to the player.
   - If the location data provides a concrete answer (a year, a
     specific word — anything that is NOT "AUTO" and NOT empty),
     copy it EXACTLY.
   - If the answer field reads "AUTO" or is empty, you MUST INVENT
     a thematic AR answer right now: a year (preferably tied to a
     real historical event about this landmark — e.g. 1944 for a
     WW2 memorial, 1066 for a Norman site), a Latin / local-language
     word that fits the theme, a Roman numeral, or a 1-2-word phrase.
     The string "AUTO" is FORBIDDEN as an output. Must be ALL CAPS or
     Title Case for readability when it materialises on the AR
     facade. Max 25 characters total.

6. "hints": Array of EXACTLY 1 hint, in this STRICT JSON shape:
     [
       { "order": 1, "text": "where to point the AR camera" }
     ]
   The "order" and "text" keys are MANDATORY. The array MUST be
   length 1.

   Decision history 2026-05-17 : the previous 3-hint ladder
   (atmospheric / camera-pointing / answer-shape) was reduced to 1
   because :
     - The AR scan reveals the answer mechanically — there is no
       intellectual puzzle that needs progressive hints
     - The "atmospheric nudge" hint was redundant with riddle_text
     - The "shape of the answer" hint outright gave away the answer
       (e.g. "Latin word for sea, four letters" → trivially MARE)
     - The "where to point the camera" hint is the ONLY one with real
       gameplay value : without it, players unfamiliar with AR don't
       know to open the camera and get stuck

   So the surviving hint is the CRITICAL one — OPEN THE CAMERA +
   WHERE TO LOOK. This hint MUST tell the player to:
     (a) open / point their camera at a SPECIFIC surface
         ("aim your phone camera at the pediment above the main
         door", "open the AR camera and slowly sweep the south wall
         left to right")
     (b) name the surface in plain words anyone can find

   Example (good):
     "Open your phone's camera in the AR mode and aim it at the
     carved pediment above the main entrance — the magical letters
     will materialise on the stone."

   Example (bad — too vague):
     "Look around the church."

   Example (bad — gives away answer):
     "Latin word for crown, six letters."

   Example (bad — spoils the answer):
     "Scan the wall, the answer is 1532."

   Hints are unlocked at a small time penalty. Never reveal the
   literal answer. Keep each hint under 200 characters.

7. "landmark_history": 2-3 paragraphs (4-7 sentences total) telling the
   PATRIMONIAL story of this place — who built it and when, why it
   matters in the city, what makes it worth standing in front of —
   INDEPENDENTLY of the game's theme. This is what every decent local
   guide would tell a tourist. It transforms the walk into a visit.

   CRITICAL — base this on the "🏛️ FULL PATRIMONIAL HISTORY" anchor
   provided in the location data when present. Use it verbatim as fact,
   you may rephrase/dramatize for audio narration but DO NOT invent.
   When no anchor is provided, write from your own training-data
   knowledge of the city — facts only, no hedging.

   Played as the FIRST narration card after the player finds the AR
   clue. The anecdote (next field) comes AFTER and ties this lieu to
   the theme.

8. "anecdote": 1-2 sentences (short, punchy) that connect THIS specific
   place to the game's theme. The thematic-narrator's voice. May reference
   the "🎭 THEMATIC CONNECTION" anchor when provided. For purely
   patrimonial stops where there's no real theme link, the anecdote is
   the narrator's transition — a one-liner that ties the lieu to the
   broader story you're telling across all stops. Never invent fake
   thematic facts about a place that doesn't really link to the theme.

8. "bonus_time_seconds": 0 for easy stops, 30-60 for harder ones.

9. "answer_source": ALWAYS the literal string "virtual_ar". Every step.

10. "ar_character_type": The character archetype that materialises in AR
    when the player arrives. Drives the sprite that's rendered. Follow
    the selection procedure STRICTLY — DO NOT default to one or two
    characters across the whole game.
${buildCharacterSelectionGuidance(stepCount)}

11. "ar_character_dialogue": A short atmospheric line (1-2 sentences MAX,
    under 180 chars) the character whispers to the player. SET THE MOOD,
    tease the riddle, but NEVER state the answer. First-person, in
    character. Examples — monk: "I have guarded these stones since before
    your grandfather's grandfather drew breath..."; corsair ghost: "The
    sea took my body, but the harbour holds my secret still..."

12. "ar_facade_text": MUST equal answer_text converted to UPPERCASE,
    EXACTLY. No extra words, no decoration, no "PLATFORM IX" when the
    answer is "IX". The string the player sees on the facade in AR is
    the literal letters they will type into the notebook — they MUST
    match after a case-insensitive + whitespace comparison. Under 30
    characters.

13. "ar_treasure_reward": One sentence describing the magical object that
    appears when the step is solved (e.g. "A silver key engraved with a
    galleon and a crescent moon"). Pure flavour, themed to the narrative
    beat. Under 130 chars.

14. "route_attractions": Array of EXACTLY 3-4 real, concrete points-of-
    interest the player will physically pass or see ON THE WAY to this
    step (or right next to it). Real buildings / statues / fountains /
    bakeries / plaques / viewpoints. NOT fictional. Each entry uses
    this ENRICHED JSON shape (schema updated 2026-05-17) :
      [
        {
          "name": "Maison Borghi (XVIIe siecle)",
          "fact": "Balcons en fer forge classes monuments historiques.",
          "category": "heritage",
          "distance_m": 80,
          "lat": 43.5234,
          "lon": 5.1234
        },
        ...
      ]

    MANDATORY keys :
      - "name"  (under 60 chars)
      - "fact"  (one factual sentence under 140 chars)
      - "category" — bucket pour le UI : doit être EXACTEMENT l'une
        des 5 valeurs suivantes :
          • "heritage"  — monument, église, fortification, plaque
          • "viewpoint" — panorama, place, point de vue, terrasse
          • "quirky"    — détail insolite, anecdote, statue inattendue
          • "food"      — boulangerie iconique, café historique, marché
          • "nature"    — parc, jardin, fontaine, arbre remarquable
      - "distance_m" — entier en mètres depuis le stop. Approximatif
        mais réaliste : 50 pour "juste à côté", 200 pour "petit
        crochet", 500 max (au-delà ça n'est plus "sur le chemin")

    OPTIONAL keys :
      - "lat" / "lon" — décimal coords si tu les connais avec confiance
        depuis Wikipedia / Google Maps. Si pas sûr, OMETS le champ
        plutôt que d'inventer (le UI affichera juste le nom + fact).

    UI : carte expandable "Sur le chemin, ne manque pas...". Le UI
    groupe les attractions par catégorie avec une icone et un bouton
    "Navigate" si lat/lon présents.

    QUALITÉ : varie les catégories (au moins 2 différentes sur les 3-4
    entries). Évite la monotonie type "4 églises". Pioche du local /
    quirky / food en mélange avec le heritage pur. Step 1 n'a pas de
    "way to" → pour step 1, ces points sont BEHIND the player ou
    visible from the starting point. Toujours 3-4 entries, jamais
    moins.

═══════════════════════════════════════════════════════════════════════
GAME-WIDE INVARIANTS (apply across the whole array of ${stepCount} steps)
═══════════════════════════════════════════════════════════════════════

INV-1 UNIQUE ANSWERS — CRITICAL, ENFORCED BY POST-VALIDATOR

Every answer_text in the array of ${stepCount} steps MUST be UNIQUE.
NEVER use the same word twice. If you instinctively chose AURUM for
two different "gold-themed" stops, REWRITE ONE — pick a synonym, a
specific aspect, or a related concept (e.g. one stop becomes AURUM,
the other becomes DIVITIAE / TESORO / OPULENTIA / SPLENDOR / REGIA…).

VERIFICATION STEP — BEFORE writing the JSON output :
  1. List all ${stepCount} answer_text values you plan to use
  2. Check : are they all DISTINCT ?
  3. If any duplicate, change one immediately

This rule has been violated in past games (2 stops with AURUM each).
The final-riddle generator REFUSES to work with duplicate indices and
throws a build error. Don't let it happen.

INV-2 CHARACTER DIVERSITY — across the ${stepCount} steps you MUST use at
least ${Math.min(5, stepCount)} DISTINCT ar_character_type values from the
catalogue. Repeating the same character on consecutive steps is
forbidden. If your first draft has the same character ≥3 times, rewrite
the offenders with a different archetype that still fits the site type.

INV-3 NO TIGHT THEME LOOP — across the ${stepCount} answers, vary the
TYPE: some years, some Latin / local-language single words, some roman
numerals. Aim for ~50% mix at minimum.

NARRATIVE REQUIREMENTS:
- Step 1: Hook the player. Begin with excitement and intrigue. Set the
  tone of the walk: "you're about to discover X corner of this city".
- Middle steps: Build tension. Each step references the previous
  discovery AND introduces what the player will physically see on the
  way to the next one.
- Step ${stepCount} (final): Land the story. Convergence + reveal.
- Tone: mysterious + poetic + historically grounded.
- THE PLAYER IS WALKING. Riddles must feel like a tour, not a quiz.

VERIFIED LOCATIONS WITH GAME-READY ANSWERS:

${locationsText}

Return ONLY a valid JSON array of EXACTLY ${stepCount} objects, no additional text, no commentary, no markdown formatting.${feedbackBlock}`;

  // 8192 tokens is more than enough for 8 steps × ~700 tokens each (riddle
  // 6-9 sentences + 4 AR fields + 3 hints + anecdote). The previous 4096
  // ceiling was getting truncated mid-JSON on 8-stop games with the new
  // longer prompt — Claude returned malformed JSON because its budget ran
  // out before closing the array. claude-sonnet-4 supports up to 64k
  // output, so 8192 is comfortable + cheap.
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    // 2026-05-16 — bumped to 12288 to absorb the new landmark_history
    // field (2-3 paragraphs per stop ≈ +300 tokens × 8 stops = +2400).
    // claude-sonnet-4 supports up to 64k output, so we still have margin.
    max_tokens: 12288,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  // Defensive: log when we're close to / at the cap so future spikes are
  // visible without staring at JSON parse errors.
  const stopReason = message.stop_reason;
  if (stopReason === "max_tokens") {
    console.warn(
      `[generateGameSteps] Claude hit max_tokens=8192. Output likely truncated; JSON parse may fail. Consider raising the cap or shortening the prompt.`,
    );
  }

  // Extract text from response
  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse JSON from response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Could not extract JSON from Claude response");
  }

  const steps = JSON.parse(jsonMatch[0]) as GeneratedStep[];

  if (!Array.isArray(steps) || steps.length < stepCount) {
    throw new Error(
      `Expected ${stepCount} steps (matching ${locations.length} input locations), got ${steps?.length || 0}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // POST-PROCESS — BAN ROMAN NUMERALS (HARD)
  // ────────────────────────────────────────────────────────────────────
  // Claude knows the rule (cf. prompt RULE 3b) but parfois pond quand
  // même des Romans dans answer_text / ar_facade_text. Causes :
  //   - ElevenLabs lit "MDCXXVIII" letter-by-letter → audio garbage
  //   - Drift entre date riddle (1563) et facade (1628) → validator KO
  //
  // Politique : on REMPLACE tout Roman numeral détecté par sa valeur
  // arabe (MDCXXVIII → 1628). Si le riddle text contient le Roman aussi
  // on le remplace pareil. Si Claude a écrit "1628" en arabe ailleurs
  // dans le riddle (typique), tout sera cohérent.
  //
  // Si la substitution est ambiguë (le Roman ne correspond pas à un
  // year crédible) on logge un warning mais on garde la conversion —
  // le post-validator pipeline-validators.ts ne vérifie PLUS le drift.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;
    step.answer_text = sanitizeRomanNumeralField(
      step.answer_text,
      stepNum,
      "answer_text",
    );
    step.ar_facade_text = sanitizeRomanNumeralField(
      step.ar_facade_text,
      stepNum,
      "ar_facade_text",
    );
    // Riddle / anecdote / character / treasure : on remplace les Romans
    // EMBEDDED (genre "in MCMXCIV the king..." → "in 1994 the king...")
    // par leur valeur arabe. Ces fields sont narrés par ElevenLabs.
    step.riddle_text = replaceRomansEmbedded(step.riddle_text);
    step.anecdote = replaceRomansEmbedded(step.anecdote);
    if (step.ar_character_dialogue) {
      step.ar_character_dialogue = replaceRomansEmbedded(step.ar_character_dialogue);
    }
    if (step.ar_treasure_reward) {
      step.ar_treasure_reward = replaceRomansEmbedded(step.ar_treasure_reward);
    }
    if (Array.isArray(step.hints)) {
      for (const h of step.hints) {
        if (h.text) h.text = replaceRomansEmbedded(h.text);
      }
    }
  }

  // Validate that answers match the original research (best-effort warn)
  const locationAnswers = new Set(locations.map((l) => String(l.answer)));
  for (const step of steps) {
    if (!locationAnswers.has(String(step.answer_text))) {
      console.warn(
        `Warning: answer "${step.answer_text}" not found in original research data`
      );
    }
  }

  return steps;
}

// ============================================================================
//  ROMAN NUMERAL SANITIZERS (post-Claude hard guard)
// ============================================================================

/** Détecte si un string est ENTIÈREMENT un Roman numeral. Permissif sur
 *  les strings courts (≤ 2 chars) pour ne pas faux-positifer sur "I"
 *  (1ère personne anglaise) ou "II"/"III" qui peuvent légitimement
 *  apparaître en ordinaux ("Henri II"). */
function isPureRomanNumeral(s: string): boolean {
  const trimmed = s.trim().toUpperCase();
  if (trimmed.length < 3) return false; // I, II → laissé tel quel
  return /^[MDCLXVI]+$/.test(trimmed);
}

/** Décode un Roman numeral en valeur arabe. Retourne null si invalide. */
function decodeRomanNumeral(s: string): number | null {
  const values: Record<string, number> = {
    M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1,
  };
  const upper = s.trim().toUpperCase();
  let total = 0;
  let prev = 0;
  for (let i = upper.length - 1; i >= 0; i--) {
    const v = values[upper[i]];
    if (v === undefined) return null;
    total += v < prev ? -v : v;
    prev = v;
  }
  return total;
}

/** Si le field complet EST un Roman numeral, le convertir en arabe (ex.
 *  "MDCXXVIII" → "1628"). Sinon laisser tel quel. */
function sanitizeRomanNumeralField(
  value: string,
  stepOrder: number,
  fieldName: string,
): string {
  if (!value) return value;
  if (isPureRomanNumeral(value)) {
    const decoded = decodeRomanNumeral(value);
    if (decoded !== null && decoded > 0 && decoded < 4000) {
      const arabic = String(decoded);
      console.warn(
        `[generateGameSteps] Step ${stepOrder}: sanitized Roman "${value}" → "${arabic}" in ${fieldName} (ElevenLabs-compat fix)`,
      );
      return arabic;
    }
    console.warn(
      `[generateGameSteps] Step ${stepOrder}: detected Roman-like "${value}" in ${fieldName} but failed to decode — leaving as-is`,
    );
  }
  return value;
}

/** Remplace toute occurrence isolée de Roman numeral (≥ 3 chars, M/D/C
 *  uniquement entourés de espaces/ponctuation) par son équivalent arabe.
 *
 *  Exemples convertis :
 *    "In MCMXCIV the king..." → "In 1994 the king..."
 *    "From MDCXXVIII to MDCXXX..." → "From 1628 to 1630..."
 *
 *  Préserve "Henri II", "Louis XIV" car les patterns ordinaux post-noms
 *  propres sont OK (ElevenLabs gère "Henri II" comme "Henri deux"). */
function replaceRomansEmbedded(text: string): string {
  if (!text) return text;
  // Regex : capture les mots ENTIÈRE faits de MDCLXVI (≥ 3 chars).
  // Limite : on ne touche pas aux II/III/IV/V/VI/VII/VIII/IX qui sont
  // souvent des ordinaux légitimes ("Henri II", "Louis XIV").
  return text.replace(/\b[MDCLXVI]{3,}\b/g, (match) => {
    // Skip si le pattern n'est pas vraiment un Roman pur (false positive
    // sur acronymes comme "VIM", "MIX", etc. qui contiennent autre chose)
    if (!/^[MDCLXVI]+$/.test(match)) return match;
    // Skip si le pattern est probablement un ordinal court (XIV, XV, etc.)
    if (match.length <= 4 && !/^M|^D|^C[CDM]/.test(match)) return match;
    const decoded = decodeRomanNumeral(match);
    if (decoded !== null && decoded >= 100 && decoded < 4000) {
      console.warn(
        `[generateGameSteps] Embedded Roman "${match}" → "${decoded}" (ElevenLabs-compat)`,
      );
      return String(decoded);
    }
    return match;
  });
}

// ===========================================================================
// CITY TOUR GENERATION (S9 — 2026-05-19)
// ===========================================================================
//
// Génère le contenu narratif pour le mode city_tour (audioguide enrichi).
// Différences fondamentales vs generateGameSteps :
//   - Pas d'énigme ni d'answer : le joueur n'a rien à résoudre
//   - encyclopedic_text remplace riddle_text — 200-300 mots narration riche
//   - Tonalité "audioguide chaleureux", pas "escape game mystérieux"
//   - Pas de hints, pas de ar_treasure_reward (le tour ne récompense pas
//     un puzzle résolu, l'enrichissement est la récompense)
//   - architectural_focus + cultural_connection : nouveaux champs pour
//     guider l'observation et tisser le parcours
//
// Le squelette du parcours (locations, GPS, validation_radius) reste
// IDENTIQUE au mode escape — on réutilise la même discovery, on change
// juste la couche narrative. C'est ce qui permet à un même slug d'être
// vendu en escape OU en tour (futur : both).

/**
 * Schema produit par generateTourSteps.
 * Différent de GeneratedStep — pas d'answer, pas de hints, narration
 * riche au lieu de riddle énigmatique.
 */
export interface GeneratedTourStep {
  title: string;
  latitude: number;
  longitude: number;
  validation_radius_meters: number;
  /**
   * Le cœur du mode tour : 200-300 mots de narration audioguide
   * structurés en 4 mouvements (Anchor → Story → Observation →
   * Connection). C'est ce texte qui est lu par ElevenLabs et affiché
   * à chaque stop. Il REMPLACE riddle_text de l'escape — le joueur
   * tour n'a pas d'énigme, juste cette narration immersive.
   */
  encyclopedic_text: string;
  /**
   * Histoire patrimoniale du lieu (2-3 paragraphes). Même rôle qu'en
   * escape mais peut être plus dense en tour (le joueur veut tout
   * savoir, pas juste un teaser).
   */
  landmark_history: string;
  /**
   * Anecdote courte (1-2 sentences) — un détail mémorable qui reste
   * en tête après le tour. Pas thématique au sens escape, juste
   * un "bonus knowledge" qui fait sourire.
   */
  anecdote: string;
  /**
   * NOUVEAU — Ce que le joueur doit OBSERVER précisément maintenant.
   * 1-2 phrases concrètes : "Regardez la corniche au-dessus du
   * portail — vous y verrez les blasons des trois familles qui ont
   * financé la chapelle." Affiché en complément de l'audio dans une
   * petite carte "À observer" sur l'écran du stop.
   */
  architectural_focus: string;
  /**
   * NOUVEAU — Lien narratif avec les autres stops du parcours. 1-2
   * phrases qui tissent la cohérence : "Vous retrouverez ce motif
   * d'étoile à six branches sur la fontaine du stop suivant — c'est
   * la signature des bâtisseurs de la guilde de Saint-Jean." Sert
   * à donner du sens au parcours global, pas une suite de stops
   * indépendants.
   */
  cultural_connection: string;
  /**
   * Personnage AR — identique à l'escape mais avec un dialogue plus
   * "guide" qu'énigmatique. Le perso introduit le lieu, ne tease
   * pas un puzzle.
   */
  ar_character_type: string;
  ar_character_dialogue: string;
  /**
   * Route attractions inchangées — même UX que l'escape : "sur le
   * chemin, ne manque pas...".
   */
  route_attractions: Array<{
    name: string;
    fact: string;
    category?: "heritage" | "viewpoint" | "quirky" | "food" | "nature";
    distance_m?: number;
    lat?: number;
    lon?: number;
  }>;
}

/**
 * Génère N steps en mode city_tour. Réutilise le verifiedContext et les
 * patrimonialAnchors fournis par la discovery (Gemini-first flow) — c'est
 * la même couche de recherche pour les deux modes, c'est ce qui garantit
 * que les deux produits soient ancrés sur les mêmes faits documentés.
 *
 * Cible audio : ~90 secondes par stop = 200-300 mots français.
 * Total parcours 8-15 stops = 12-22 min d'audio.
 *
 * Coût : ~$0.06 par jeu (légèrement plus que escape car prompts plus
 * longs et output plus dense). 2× plus en audio ElevenLabs car ~3×
 * plus de chars à vocaliser.
 */
export async function generateTourSteps(
  city: string,
  country: string,
  theme: string,
  narrative: string,
  locations: ResearchedLocation[],
  genre: GameGenre = DEFAULT_GENRE,
  verifiedContext?: VerifiedThemeContext,
  maxStops: number = 15,
): Promise<GeneratedTourStep[]> {
  void genre; // genre overlay non utilisé en tour (la tonalité est uniforme audioguide)

  // RAG : pull lessons from past feedback (même mécanique que l'escape).
  let feedbackBlock = "";
  try {
    const feedback = await getRelevantNegativeFeedback({ city, theme, limit: 8 });
    feedbackBlock = formatFeedbackForPrompt(feedback);
    if (feedbackBlock) {
      console.log(
        `[generateTourSteps] Injecting ${feedback.length} lessons from past feedback`,
      );
    }
  } catch (err) {
    console.warn(
      `[generateTourSteps] Could not fetch feedback memory: ${err instanceof Error ? err.message : err}`,
    );
  }
  const client = getAnthropicClient();

  // Tour mode : stop count variable selon la richesse de la ville.
  // On prend ce que la discovery a trouvé (jusqu'à maxStops), mais au
  // moins 6 stops pour que le parcours ait du sens narratif.
  const stepCount = Math.max(6, Math.min(locations.length, maxStops));

  // Locations text — même format que l'escape, mais avec un focus
  // patrimonial plutôt que "answer-oriented".
  const locationsText = locations
    .map(
      (loc, i) => `Location ${i + 1}: ${loc.name}
- GPS: ${loc.latitude}, ${loc.longitude}
- What to observe: ${loc.whatToObserve}
- Source: ${loc.source}${
        loc.patrimonialRole
          ? `
- 🏛️ FULL PATRIMONIAL HISTORY (use as PRIMARY anchor): ${loc.patrimonialRole}${loc.citation ? ` (Source: ${loc.citation})` : ""}`
          : ""
      }${
        loc.thematicRole
          ? `
- 🎭 THEMATIC CONNECTION: ${loc.thematicRole}`
          : ""
      }${
        loc.poiCategory
          ? `
- Category: ${loc.poiCategory}`
          : ""
      }`,
    )
    .join("\n\n");

  // Verified facts block — identique à l'escape, mais le rôle change :
  // en tour, ces faits sont la MATIÈRE PRINCIPALE de la narration,
  // pas juste un ancrage pour anecdote.
  const verifiedFactsBlock = (() => {
    if (!verifiedContext) return "";
    const hasContent =
      verifiedContext.iconicSites.length > 0 ||
      verifiedContext.realFigures.length > 0 ||
      verifiedContext.events.length > 0 ||
      verifiedContext.localTraditions.length > 0;
    if (!hasContent) return "";
    const sites = verifiedContext.iconicSites
      .map((s, i) => `  ${i + 1}. ${s.name}${s.locationHint ? ` (${s.locationHint})` : ""} — ${s.significance}`)
      .join("\n");
    const figures = verifiedContext.realFigures
      .map((f, i) => `  ${i + 1}. ${f.name}${f.lifespan ? ` (${f.lifespan})` : ""} — ${f.role}`)
      .join("\n");
    const events = verifiedContext.events
      .map((e, i) => `  ${i + 1}. ${e.date} — ${e.description}`)
      .join("\n");
    const traditions = verifiedContext.localTraditions
      .map((t, i) => `  ${i + 1}. ${t.description}`)
      .join("\n");
    return `
═══════════════════════════════════════════════════════════════════════
VERIFIED FACTS (use these as the PRIMARY content of your narration)
═══════════════════════════════════════════════════════════════════════
In TOUR MODE, these facts are not just anchors — they are the MEAT of
each encyclopedic_text. Cite full names, exact dates, real events.
The tour mode promises "deep knowledge", so deliver it.

ICONIC SITES:
${sites || "  (none)"}

REAL HISTORICAL FIGURES (cite by full name + lifespan + role):
${figures || "  (none)"}

DATED EVENTS (cite exact years, NEVER round to "around X"):
${events || "  (none)"}

LOCAL TRADITIONS (weave into narration where relevant):
${traditions || "  (none)"}

═══════════════════════════════════════════════════════════════════════
`;
  })();

  const prompt = `${verifiedFactsBlock}You are a master audioguide writer. Your job: craft an immersive, knowledge-rich audio tour of ${city}, ${country}, around the theme "${theme}".

This is NOT an escape game. There are NO riddles to solve, NO answers to find, NO time pressure. The player walks at their own pace, listens to your narration at each stop (90 seconds of audio per stop), observes what you point out, and connects the dots between locations.

Your tone: warm, knowledgeable, intimate. Like the best local guide who happens to be passionate about history but never lectures. Concrete details, not abstract claims. Specific names and dates, not "around the 14th century". The player wants to feel SMARTER and MORE CONNECTED to the place after listening to you.

═══════════════════════════════════════════════════════════════════════
ABSOLUTE RULES
═══════════════════════════════════════════════════════════════════════

A. NO RIDDLES, NO PUZZLES, NO QUESTIONS-WITH-ANSWERS. The player has
   nothing to "find". Don't write "what does the inscription say?" —
   write "the inscription, carved in 1574, reads HOC OPVS FECIT".

B. CONCRETE OVER GENERIC. "In 1374, the Black Death had just claimed
   one-third of the city's residents, and the council voted to build
   this fountain as a public-health measure" beats "this fountain has
   medieval origins".

C. NAMES + DATES + EVENTS, ALWAYS. Use the verified figures and events
   above. If you don't have a real figure for a stop, prefer omission
   over fabrication ("the builders" rather than "Maître Gaspard").

D. AUDIO-FIRST. Every word will be read aloud by ElevenLabs in French.
   Spell out abbreviations ("avant Jésus-Christ" not "av JC"),
   "kilomètres" not "km", "Saint Pierre" not "St Pierre", convert
   roman numerals to arabic ("XIVe siècle" → "quatorzième siècle"
   or "1340s"). Read your text aloud mentally before submitting.

E. PARCOURS COHERENCE. Each stop is part of a journey. Reference what
   came before ("au stop précédent, vous avez vu le blason de la
   famille X — vous le retrouverez ici sur le linteau") and tease what's
   ahead ("dans quelques minutes, nous découvrirons comment ce même
   architecte a réinventé le campanile…"). This is what makes a tour
   greater than the sum of its stops.

F. NO LATIN / GREEK / LOCAL WORDS as the "magic answer". This isn't an
   escape game. If you cite a Latin phrase that exists on the building,
   translate it inline: "the inscription reads 'TEMPVS FVGIT' — 'time
   flees'". The player learns, they don't decode.

TOUR PARAMETERS:
- City: ${city}, ${country}
- Theme angle: ${theme}
- Narrative arc: ${narrative}
- Steps: ${stepCount}
- Language: French (final TTS will narrate in French; translations to
  other languages handled downstream by Gemini)
- Audio target per stop: ~90 seconds = 200-300 French words

═══════════════════════════════════════════════════════════════════════
FOR EACH STOP, produce a JSON object with these fields:
═══════════════════════════════════════════════════════════════════════

1. "title": Evocative, 4-8 words. Avoid "L'énigme de…" / "Le mystère de…"
   (escape vibes). Prefer "La fontaine des pestiférés" / "Le balcon des
   amants" / "Les marques du tailleur de pierre". Concrete + intriguing.

2. "latitude", "longitude": COPY EXACTLY from the location data. Do not
   round, do not improve. Coordinates are immutable input.

3. "validation_radius_meters": 25-50m. Larger for plazas, smaller for
   precise monuments.

4. "encyclopedic_text": THE CORE FIELD — 200-300 words, in French, in
   FOUR distinct movements. This is your audioguide narration.

   MOVEMENT 1 — ANCHOR (40-60 words):
     Plant the player in front of the place. State what you see and
     when it was built. Set the historical scene.
     Example: "Vous voici devant la Maison des Têtes, construite en
     1532 par Antoine de Vaucanson, riche marchand de soie. Au
     XVIe siècle, cette maison était la plus opulente du quartier —
     ses fenêtres à meneaux et ses sculptures rivalisaient avec les
     hôtels particuliers de Lyon."

   MOVEMENT 2 — STORY (100-150 words):
     The real narrative. A specific event, a real person, a key date.
     Cite verified figures. Tell ONE story well rather than ten facts
     in a row. The player should feel like they're hearing a secret
     a real local guide would share.
     Example: "En septembre 1572, alors que les massacres de la
     Saint-Barthélemy faisaient rage à Paris, Antoine de Vaucanson —
     huguenot convaincu — cacha trois pasteurs dans la cave qui
     s'étend encore sous vos pieds. Pendant onze nuits, ils dormirent
     parmi les tonneaux de vin, nourris par la cuisinière de la
     maison, Marguerite Brun, dont le nom apparaît dans les registres
     paroissiaux de l'année suivante. Quand la situation se calma,
     les pasteurs partirent par les souterrains qui rejoignaient
     l'ancienne abbaye Saint-Pierre — souterrains que vous découvrirez
     au stop quatre de ce parcours."

   MOVEMENT 3 — OBSERVATION (40-60 words):
     Direct the player's eye to something specific. They're standing
     RIGHT THERE — make them notice what they'd miss otherwise.
     Example: "Levez les yeux vers le premier étage : voyez les six
     têtes sculptées au-dessus des fenêtres. Trois portent la barbe,
     trois sont rasées. Ce sont les six fils d'Antoine, les barbus
     représentant ceux qui sont morts à la guerre, les autres ceux
     qui lui ont survécu."

   MOVEMENT 4 — CONNECTION (30-50 words):
     Tie this stop to the broader parcours. Reference a past stop
     OR tease a future one. Builds the tour as one cohesive story.
     Example: "Au prochain stop, vous découvrirez l'église réformée
     dans laquelle Antoine de Vaucanson fut finalement enterré —
     une église que les autorités catholiques laissèrent debout
     contre toute attente. Une histoire de pierre, de foi et de
     tolérance forcée."

   TOTAL : 4 mouvements = ~250 mots. Lis ton texte à voix haute avant
   de soumettre. Si ça dure plus de 110 secondes en français à débit
   normal, coupe.

5. "landmark_history": 2-3 paragraphs (5-8 sentences total) — l'histoire
   patrimoniale du lieu hors de la narration audio. Sert pour la version
   texte affichée à côté de l'audio. Quand un anchor "🏛️ FULL
   PATRIMONIAL HISTORY" est fourni dans les locations, use it as primary
   source. Sinon, fais avec ton training data — mais factuel, pas hedgé.

6. "anecdote": 1-2 phrases (sous 200 chars). Un détail mémorable que le
   joueur retiendra 6 mois plus tard. Pas pédagogique, pas thématique
   au sens escape. Juste "ah ouais, c'est cool ça". Exemple : "La
   cuisinière Marguerite Brun fut payée 3 livres pour son silence —
   l'équivalent d'un an de salaire."

7. "architectural_focus": 1-2 phrases CONCRÈTES (sous 200 chars). Pointe
   l'oeil du joueur vers UN détail visuel précis qu'il peut voir
   maintenant. Pas "regardez le bâtiment". Plutôt "regardez les six
   têtes sculptées au-dessus des fenêtres du premier étage : trois
   ont la barbe."

8. "cultural_connection": 1-2 phrases (sous 200 chars). Lien narratif
   avec un autre stop du parcours. Doit créer une attente ou
   recontextualiser ce qui précède. Exemple : "Vous retrouverez la
   même croix huguenote sur le portail du stop suivant — c'est la
   signature d'Antoine et des trois familles qui le protégèrent."
   Sur step 1 : référence un stop futur. Sur step ${stepCount} :
   referme la boucle avec le stop 1.

9. "ar_character_type": archetype du guide AR. Sélectionne dans le
   catalogue selon la procédure ci-dessous. Le perso "incarne" le
   lieu — un moine pour une église, un marchand pour une halle, etc.
${buildCharacterSelectionGuidance(stepCount)}

10. "ar_character_dialogue": 1-2 phrases (sous 180 chars). Le perso
    parle au joueur en première personne, en français. Tonalité
    GUIDE bienveillant, pas mystérieuse. Exemple (un marchand) :
    "Bienvenue dans ma maison, étranger. Laissez-moi vous raconter
    ce que ces murs ont vu en l'an 1572…"

11. "route_attractions": 3-4 entries — IDENTIQUE au mode escape.
    Same JSON shape :
      [
        {
          "name": "Maison Borghi (XVIIe siècle)",
          "fact": "Balcons en fer forgé classés monuments historiques.",
          "category": "heritage",
          "distance_m": 80,
          "lat": 43.5234,
          "lon": 5.1234
        },
        ...
      ]
    MANDATORY: name, fact, category, distance_m. category ∈
    {heritage, viewpoint, quirky, food, nature}. Vary categories
    across the 3-4 entries (no "4 churches"). lat/lon optional but
    welcome if you're confident.

═══════════════════════════════════════════════════════════════════════
GAME-WIDE INVARIANTS
═══════════════════════════════════════════════════════════════════════

INV-T1 NARRATIVE ARC. Step 1 sets the scene + introduces the
recurring thread. Middle steps deepen and complicate. Step ${stepCount}
closes the loop — references step 1, provides a sense of completion.

INV-T2 CHARACTER DIVERSITY. Across ${stepCount} steps, use at least
${Math.min(5, stepCount)} distinct ar_character_type values. No
character on consecutive steps.

INV-T3 VARIED OPENERS. Each encyclopedic_text Movement 1 must open
differently. Don't start each stop with "Vous voici devant…". Mix
in: "Levez les yeux : …", "1532. Une année charnière…", "Cette
fontaine, à l'apparence si banale aujourd'hui, …", "Si vous écoutez
attentivement, …".

INV-T4 NO ABBREVIATIONS in any TTS field. encyclopedic_text,
landmark_history, anecdote, architectural_focus, cultural_connection,
ar_character_dialogue — all must be spelled out for ElevenLabs.

VERIFIED LOCATIONS:

${locationsText}

Return ONLY a valid JSON array of EXACTLY ${stepCount} objects, no additional text, no commentary, no markdown formatting.${feedbackBlock}`;

  // Tour outputs are longer than escape (encyclopedic_text 200-300 words
  // vs riddle 5-7 sentences). Budget 1000-1200 tokens per stop ×
  // ${stepCount} = up to ~20k tokens for 15 stops. Cap at 24k to be safe.
  //
  // STREAMING REQUIRED — bug rapporté Montpellier 2026-05-20 :
  // L'Anthropic SDK refuse `client.messages.create()` non-streaming
  // quand max_tokens est élevé, parce que la requête peut dépasser
  // les 10 min de timeout HTTP. Erreur observée :
  //   "Streaming is required for operations that may take longer
  //    than 10 minutes."
  // → On bascule sur `client.messages.stream(...)` + `finalMessage()`
  // qui accumule tous les chunks et retourne le message complet une
  // fois la stream fermée. Aucun changement côté output parsing.
  // Cf. https://github.com/anthropics/anthropic-sdk-typescript#long-requests
  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 24000,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });
  const message = await stream.finalMessage();

  const stopReason = message.stop_reason;
  if (stopReason === "max_tokens") {
    console.warn(
      `[generateTourSteps] Claude hit max_tokens=24000. Output likely truncated; JSON parse may fail. Consider raising the cap or reducing stop count.`,
    );
  }

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Could not extract JSON from Claude response (tour)");
  }

  const steps = JSON.parse(jsonMatch[0]) as GeneratedTourStep[];

  if (!Array.isArray(steps) || steps.length < Math.max(6, stepCount - 1)) {
    throw new Error(
      `Expected ~${stepCount} tour steps (matching ${locations.length} input locations), got ${steps?.length || 0}`,
    );
  }

  console.log(
    `[generateTourSteps] Generated ${steps.length} tour steps for ${city} (theme: ${theme})`,
  );

  return steps;
}

// ===========================================================================
// VALIDATION (Claude #2 — auto-correction layer)
// ===========================================================================

export interface ValidationIssue {
  step_index: number; // 0-based index in the steps array
  problem: string;
  severity: "minor" | "major" | "blocking";
  suggestion: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Second-pass critic. Reads what the first Claude generated and flags problems
 * that would degrade the player experience: too-easy answers, factually
 * questionable anecdotes, riddles that contradict the answer, etc.
 *
 * Returns ok=true if the game is good as-is, otherwise a list of problematic
 * steps with concrete suggestions for regeneration.
 *
 * Cost: ~$0.04 per validation call. Worth it: catches ~50% of bad outputs
 * before they reach the player.
 */
export async function validateGeneratedSteps(params: {
  steps: GeneratedStep[];
  city: string;
  theme: string;
  narrative: string;
}): Promise<ValidationResult> {
  const client = getAnthropicClient();

  const stepsBlock = params.steps
    .map(
      (s, i) =>
        `STEP ${i + 1} — "${s.title}"
GPS: ${s.latitude}, ${s.longitude}
Riddle: ${s.riddle_text}
ANSWER: "${s.answer_text}"
Source: ${s.answer_source}
Hint: ${s.hints[0]?.text || "(missing)"}
Anecdote: ${s.anecdote}`,
    )
    .join("\n\n---\n\n");

  const prompt = `You are a strict QA reviewer for an outdoor escape game. Your job is to flag problems BEFORE the game ships to a paying customer.

CONTEXT
City: ${params.city}
Theme: ${params.theme}
Narrative: ${params.narrative}

GAME TO REVIEW (${params.steps.length} steps):

${stepsBlock}

YOUR JOB
Spot real problems only. Don't be picky on style. Flag a step ONLY if at least one of these is true:

1. ANSWER QUALITY:
   - Answer is too obvious (e.g. asking for the city's own name as the answer)
   - Answer doesn't match the riddle question
   - For "physical" answer_source: answer is implausible to actually be inscribed/visible at the location
   - Answer contains explanation, sentence, or more than 3 words (it must be terse: a year, a number, or 1-2 words)

2. RIDDLE / INSTRUCTIONS:
   - Riddle directly states the answer (spoiler)
   - Riddle's instructions don't match the answer_source ("look at the carved year" while answer_source is virtual_ar, or vice-versa)
   - Riddle is so generic it could apply to ANY building

3. FACTUAL:
   - Anecdote contains an obvious historical error
   - Date/figure in the anecdote contradicts the answer

4. FLOW:
   - Two consecutive steps have identical answers
   - Step makes no sense without the previous one (broken narrative continuity)

RULES
- If everything is good: return {"ok": true, "issues": []}
- A step can have multiple issues; combine them into one entry
- Severity:
   "blocking" = customer would refund (factually wrong, broken)
   "major"    = customer would complain (boring, too easy, confusing)
   "minor"    = nice-to-have polish (style, tone)
- Suggestion must be ACTIONABLE: explain what to change so the regeneration prompt can fix it.

OUTPUT — strict JSON, no markdown:

{
  "ok": false,
  "issues": [
    {
      "step_index": 0,
      "problem": "Answer 'PARIS' is the city's own name — too obvious",
      "severity": "major",
      "suggestion": "Replace with a year, a name on a plaque, or a count of architectural features specific to this exact monument"
    }
  ]
}

Return ONLY this JSON object. No commentary.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.1, // low temp — we want deterministic critic
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(
      `[validator] No JSON in response. Defaulting to ok=true. Raw: ${responseText.substring(0, 200)}`,
    );
    return { ok: true, issues: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ValidationResult;
    return {
      ok: parsed.ok ?? false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch (err) {
    console.warn(
      `[validator] JSON parse failed. Defaulting to ok=true. Err: ${err instanceof Error ? err.message : err}`,
    );
    return { ok: true, issues: [] };
  }
}

/**
 * Regenerate a single step that was flagged by the validator.
 * Receives the original step + the validator's feedback + the source location.
 * Returns a fixed step that addresses the feedback.
 */
export async function regenerateStep(params: {
  brokenStep: GeneratedStep;
  issue: ValidationIssue;
  location: ResearchedLocation;
  city: string;
  theme: string;
  narrative: string;
  stepNumber: number;
  totalSteps: number;
  /** Genre du jeu — nécessaire pour que le step regénéré garde la
   *  tonalité (AR character, mot magique). Sans ça, un regen retombe
   *  par défaut sur les biais historical et casse l'homogénéité narrative. */
  genre?: GameGenre;
}): Promise<GeneratedStep> {
  const client = getAnthropicClient();
  const genreOverlay = buildGenreRiddleOverlay(params.genre ?? DEFAULT_GENRE);

  // Détecte le cas où la "réponse confirmée" est en réalité le
  // placeholder "AUTO" (ResearchedLocation issue d'un parcours
  // intent-first). Dans ce cas, on NE LOCK PAS la réponse — on
  // demande explicitement à Claude d'INVENTER un mot thématique.
  // Sinon le regen retourne aussi "AUTO" littéral et le bug se
  // réplique au lieu d'être corrigé (cf. test Rouen Rollon).
  const answerIsPlaceholder =
    !params.location.answer ||
    params.location.answer.toUpperCase().trim() === "AUTO";

  const answerInstruction = answerIsPlaceholder
    ? `INVENT a single thematic answer that fits the theme "${params.theme}" and the location. Output it as UPPERCASE Latin word, year, Roman numeral, or evocative single word. NEVER output the literal string "AUTO" — that's a placeholder, not an answer. Examples: VERITAS, MCMXIV, IGNIS, AURUM, REQUIESCAT.`
    : `Use exactly: "${params.location.answer}"`;

  const answerLine = answerIsPlaceholder
    ? `"answer_text": "<your invented thematic answer, UPPERCASE, NEVER 'AUTO'>"`
    : `"answer_text": "${params.location.answer}"`;

  const prompt = `${genreOverlay}You wrote step ${params.stepNumber}/${params.totalSteps} of an outdoor escape game in ${params.city} (theme: ${params.theme}). A reviewer flagged a problem and you must rewrite this step.

ORIGINAL STEP (the one to fix):
- Title: ${params.brokenStep.title}
- Riddle: ${params.brokenStep.riddle_text}
- Answer: ${params.brokenStep.answer_text}
- Source: ${params.brokenStep.answer_source}

REVIEWER FEEDBACK:
Problem: ${params.issue.problem}
Severity: ${params.issue.severity}
What to change: ${params.issue.suggestion}

LOCATION DATA (use exactly):
- Name: ${params.location.name}
- GPS: ${params.location.latitude}, ${params.location.longitude}
- Observable detail: ${params.location.whatToObserve}
- Answer instruction: ${answerInstruction}
- Answer type: ${params.location.answerType}
- Answer source: ${params.location.answerSource ?? "physical"}

Rewrite this single step as a JSON object with the same shape as before:
{
  "title": "evocative short title (max 8 words)",
  "latitude": ${params.location.latitude},
  "longitude": ${params.location.longitude},
  "validation_radius_meters": 30,
  "riddle_text": "immersive riddle 4-6 sentences (DO NOT name the answer; describe where to look)",
  ${answerLine},
  "hints": [
    {"order": 1, "text": "where to point the AR camera — name the SPECIFIC visible surface (pediment / colonnade / door / etc.) and tell them to open AR mode"}
  ],
  "landmark_history": "2-3 paragraphs telling the patrimonial story of the place — who built it and when, why it matters in the city, what makes it worth visiting (theme-independent)",
  "anecdote": "1-2 sentences connecting this lieu to the game's theme",
  "bonus_time_seconds": 0,
  "answer_source": "virtual_ar",
  "ar_character_type": "one of: knight, witch, monk, sailor, detective, ghost, default — pick the most thematic",
  "ar_character_dialogue": "1-2 sentence atmospheric line whispered to the player, in character, no spoilers (under 180 chars)",
  "ar_facade_text": "1-3 evocative UPPERCASE words that materialise on the façade (under 30 chars)",
  "ar_treasure_reward": "1-sentence description of the magical treasure revealed once solved (under 130 chars)"
}

Address the reviewer's feedback explicitly. Output ONLY the JSON object, no commentary, no markdown.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `regenerateStep: no JSON in response: ${responseText.substring(0, 200)}`,
    );
  }
  return JSON.parse(jsonMatch[0]) as GeneratedStep;
}

// ===========================================================================
// EPILOGUE GENERATION
// ===========================================================================

export interface GeneratedEpilogue {
  title: string;
  text: string;
}

/**
 * Generate a narrative epilogue that plays on the results page after the
 * player enters the final code (or gives up). The goal is to give the player
 * a real reward: a cohesive, memorable, true-story revelation that ties all
 * the step anecdotes into one narrative.
 *
 * Style: storyteller, historically rich, emotional, ~300-500 words, 4-6
 * paragraphs. Written in English here; the app translates to 32 languages
 * via Gemini on demand.
 */
export async function generateEpilogue(params: {
  city: string;
  country: string;
  theme: string;
  narrative: string;
  difficulty: number;
  steps: GeneratedStep[];
  genre?: GameGenre;
}): Promise<GeneratedEpilogue> {
  const client = getAnthropicClient();

  const stepsRecap = params.steps
    .map(
      (s, i) =>
        `Step ${i + 1} — ${s.title}
  Answer player discovered: ${s.answer_text}
  Historical anecdote told to player: ${s.anecdote}`,
    )
    .join("\n\n");

  const genreOverlay = buildGenreEpilogueOverlay(params.genre ?? DEFAULT_GENRE);

  const prompt = `${genreOverlay}You are a master storyteller writing the EPILOGUE of an outdoor escape game adventure that the player has just completed in ${params.city}, ${params.country}.

GAME THEME: ${params.theme}
GAME NARRATIVE: ${params.narrative}

THE STEPS THE PLAYER JUST SOLVED (chronological):

${stepsRecap}

YOUR JOB:
Write a magnificent epilogue that the player sees on their results screen. This is their REAL REWARD — not points, not a badge. It's a revelation of the TRUE STORY behind their quest, weaving together every anecdote they discovered.

REQUIREMENTS:

1. **Title** — a short, evocative French-style title (max 6 words), in English. Examples of the right vibe:
   - "The Corsair's Living Legacy"
   - "The Cathedral's Silent Witness"
   - "What the Stones Never Told"

2. **Text** — 4-6 paragraphs (300-500 words total), in the style of a historical storyteller revealing a long-kept secret. Structure:
   - Paragraph 1: Congratulate the player warmly, acknowledge they now hold the "full truth"
   - Paragraphs 2-4: Weave the anecdotes together. Reveal the deeper connection between the stops. Explain WHY each date/name/number was significant. Uncover what happened AFTER the events the player witnessed through the riddles — the legacy, the consequences, the aftermath that history books rarely tell.
   - Final paragraph: A closing thought that elevates the experience. A fact about the place today that the player can verify themselves. A meaningful quote or philosophical reflection that ties the theme back to universal human experience.

3. **Tone**:
   - Warm, personal, "tu" when addressing the player (in French translation later)
   - Historical precision — every fact must be TRUE (cross-reference the anecdotes given above)
   - Evocative, poetic, not dry
   - Emotional at times — this is the "dessert" of the meal, as the client said

4. **RULES**:
   - NEVER invent facts not implied by the anecdotes above
   - NEVER use clichés ("congratulations on your journey", "you did it!", "well done, hero!")
   - NEVER reference the game mechanics (score, timer, points, level)
   - NEVER say "in this game" or "in this adventure" — speak as if telling a real story
   - Reference the player naturally (no formal "dear adventurer", just "toi" in French feel)
   - Do NOT use Markdown. Plain text only. Use line breaks between paragraphs.

OUTPUT FORMAT — strict JSON:

{
  "title": "Your evocative English title here",
  "text": "Paragraph 1.\\n\\nParagraph 2.\\n\\nParagraph 3.\\n\\nParagraph 4.\\n\\nFinal paragraph."
}

Return ONLY this JSON object. No commentary, no markdown wrapping.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Extract the JSON object from the response (robust to any leading/trailing text)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `generateEpilogue: no JSON found in Claude response: ${responseText.substring(0, 200)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedEpilogue;
  if (!parsed.title || !parsed.text) {
    throw new Error(
      `generateEpilogue: parsed JSON missing title/text: ${JSON.stringify(parsed).substring(0, 200)}`,
    );
  }

  return parsed;
}

export interface AdaptedNarrative {
  /** Pitch court réutilisé sur la fiche produit (~120-180 chars). */
  themeDescription: string;
  /** Narration intégrale (~600-900 chars), le contexte que le joueur lit avant de démarrer. */
  narrative: string;
  /** Un titre poétique par stop, dans l'ordre du nouveau parcours. */
  stops: Array<{
    /** Nom poétique côté joueur ("Le Sanctuaire des Cloches"). */
    name: string;
    /** Phrase courte qui aide Claude #1 ensuite à écrire l'énigme — anecdote / chose à observer. */
    description: string;
  }>;
}


/**
 * Choix curé par Claude des N meilleurs landmarks parmi une liste de
 * candidats RÉELS issus de Google Places. Inverse du flow Perplexity-
 * first : au lieu d'inventer des noms et d'espérer les géocoder, on
 * part de la liste exhaustive Google (toujours géocodée sub-10m), et
 * on demande à Claude de SÉLECTIONNER les N qui collent le mieux au
 * thème.
 *
 * Avantage : tous les choix sont GARANTIS géocodables. Impossible de
 * publier un jeu avec moins de N stops si Google a au moins N candidats
 * dans la zone (cas standard pour toute ville urbaine ou site
 * archéologique référencé).
 */
export async function pickThematicLandmarksFromList(params: {
  theme: string;
  themeDescription: string;
  narrative: string;
  /** Candidats Google Places nearbysearch — tous géocodables, tous
   *  dans la zone. Claude choisit les N meilleurs parmi cette liste. */
  candidates: Array<{
    name: string;
    types: string[];
    address?: string;
    rating?: number;
    distanceM: number;
    /** Coords GPS pour que Claude puisse estimer les distances
     *  inter-candidats et garantir un parcours marchable upfront. */
    lat: number;
    lon: number;
  }>;
  /** Combien de stops à retourner (typiquement 8). */
  needed: number;
  /** Distance max entre 2 stops consécutifs en mètres. Claude reçoit
   *  cette contrainte EXPLICITEMENT dans le prompt et l'utilise pour
   *  filtrer ses choix AVANT que la pipeline en aval ne le fasse. */
  maxInterStopM: number;
  /** Distance MIN entre 2 stops (universel, tous jeux) — évite les
   *  "twin stops" type bibliothèque + centre culturel à 16m qui font
   *  doublon dans les yeux du joueur. Adaptatif au stopCount :
   *  jeu court = écart MIN plus grand pour vraie couverture. */
  minInterStopM: number;
  /**
   * Mode d'accessibilité demandé par l'opérateur :
   *   - `any` (défaut) : aucune contrainte, Claude pick librement.
   *   - `free` : interdiction de picker un POI dont l'accès demande
   *              un ticket payant (musée, monument ticketé, tour
   *              d'observation, jardin payant). Le joueur doit pouvoir
   *              jouer 100% depuis la voie publique. Les sites payants
   *              seront utilisés en upsell cross-sell post-jeu.
   */
  accessibility?: "free" | "any";
  /**
   * Sites pré-curatés par OddballTrip (Perplexity Deep Research, 1ère
   * passe). Claude reçoit ces noms comme HINTS de priorité : si l'un
   * d'eux apparaît dans les candidats Google (matching sur nom partiel),
   * il a un boost thématique. Si pas dans les candidats Google, pas
   * grave — Claude n'est PAS forcé de les inclure.
   *
   * Cas typique : OddballTrip a curé "Plage Omaha Beach", "Cimetière
   * de Colleville-sur-Mer", "Pointe du Hoc". Google retourne aussi des
   * 100+ POIs aléatoires dans 30 km. Sans hints, Claude pourrait
   * choisir des POIs hors-thème (un golf, un musée local non WWII).
   * Avec les seedSiteNames, Claude SAIT que ces 3 sites sont les
   * références éditoriales, et bias ses choix vers eux + leur écosystème.
   */
  seedSiteNames?: string[];
}): Promise<{
  selectedIndices: number[];
  rationale: string;
}> {
  const client = getAnthropicClient();

  if (params.candidates.length === 0) {
    return { selectedIndices: [], rationale: "no candidates provided" };
  }

  const candidatesBlock = params.candidates
    .map((c, i) => {
      const meta = [
        `lat=${c.lat.toFixed(5)},lon=${c.lon.toFixed(5)}`,
        `types=[${c.types.slice(0, 3).join(", ")}]`,
        `${Math.round(c.distanceM)}m from start`,
        c.rating ? `rating=${c.rating.toFixed(1)}` : null,
        c.address ? `addr="${c.address}"` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `[${i}] ${c.name} — ${meta}`;
    })
    .join("\n");

  const seedSitesHint = params.seedSiteNames?.length
    ? `

═══════════════════════════════════════════════════════════════════
PRIORITÉ ÉDITORIALE — SITES PRÉ-CURATÉS PAR L'OPÉRATEUR
═══════════════════════════════════════════════════════════════════

L'opérateur OddballTrip a déjà identifié ces sites comme RÉFÉRENCES
éditoriales pour ce roadtrip (1ère passe Perplexity Deep Research) :

${params.seedSiteNames.map((n, i) => `  ${i + 1}. ${n}`).join("\n")}

Si TU TROUVES ces sites (ou leurs équivalents proches) dans la liste
de candidats Google ci-dessus :
  → DONNE-LEUR LA PRIORITÉ. Ce sont des piliers narratifs validés,
    le client OddballTrip s'attend à les voir dans son parcours.
  → Match flexible : "Plage Omaha Beach" peut matcher "Omaha Beach
    Memorial" ou "WN62 Bunker" qui sont sur la même plage.

Si certains seed sites NE SONT PAS dans la liste Google :
  → Pas grave, ne les force pas. C'est probable que Google ne les
    indexe pas séparément. Choisis les meilleurs candidats restants
    en respectant le thème.

Ne te limite PAS aux seed sites : si Google a 50 candidats et l'opérateur
n'en a curé que 5, complète avec 3-4 autres choix thématiquement
pertinents pour atteindre stopCount.
═══════════════════════════════════════════════════════════════════
`
    : "";

  const accessibilityRule = params.accessibility === "free"
    ? `

═══════════════════════════════════════════════════════════════════
EXCLUSION RULE — ACCESSIBILITÉ "FREE" (NON-NÉGOCIABLE)
═══════════════════════════════════════════════════════════════════

L'opérateur a marqué ce jeu en mode "free access" : le joueur doit
pouvoir TERMINER tout le parcours SANS PAYER d'entrée. Tu DOIS écarter
tout candidat dont l'accès au public demande un ticket :
  • Musées (sauf si la place devant le bâtiment fait sens depuis la rue)
  • Galeries d'art payantes
  • Monuments ticketés (cathédrales avec billet, tours d'observation)
  • Jardins/parcs payants, châteaux dont l'intérieur est seul ouvert
  • Tout site indiqué "museum" ou "art_gallery" dans ses types Google

Préfère systématiquement :
  • Places, squares, monuments visibles de la rue
  • Églises ouvertes au public sans billet
  • Façades historiques, statues, fontaines
  • Mairies, bibliothèques accessibles librement
  • Parcs publics, sentiers

Si tu hésites (le candidat POURRAIT être payant ou gratuit), SACRIFIE-LE :
mieux vaut un parcours 100% sûr en accès libre.
═══════════════════════════════════════════════════════════════════
`
    : "";

  const prompt = `You are curating an outdoor escape game. ALL the landmarks below are REAL, GEOCODED Google Places within walking distance of a chosen starting point. Your job: pick the ${params.needed} that fit the theme best AND form a coherent walking parcours.

LOCKED CONTEXT:
- Theme: "${params.theme}"
- Pitch: ${params.themeDescription}
- Narrative (player intro):
${params.narrative}${seedSitesHint}${accessibilityRule}

CANDIDATES (all real, all in walking zone, indexed) — chaque ligne contient lat/lon pour que tu puisses calculer les distances entre candidats :
${candidatesBlock}

═══════════════════════════════════════════════════════════════════
CONTRAINTES SPATIALES (NON-NÉGOCIABLES)
═══════════════════════════════════════════════════════════════════

Le joueur doit pouvoir aller à pied du stop 1 → 2 → 3 → ... SANS :
  • MAX : qu'il y ait deux stops consécutifs distants de plus de ${params.maxInterStopM}m.
  • MIN : que deux stops soient distants de MOINS de ${params.minInterStopM}m
    (sinon ils sont sur le MÊME bâtiment ou dans le MÊME mouchoir
    de poche — le joueur a l'impression de tourner en rond et de
    payer pour des doublons).

Pour estimer la distance entre 2 candidats à partir de lat/lon (degrés
décimaux) :
  Δlat = lat2 - lat1     (1° lat ≈ 111 km partout)
  Δlon = lon2 - lon1     (1° lon ≈ 111 km × cos(lat) — pour 49°N
                          c'est ~73 km, pour 38°N ~88 km)
  distance ≈ √((Δlat × 111000)² + (Δlon × 73000)²)

  Exemple : (49.367, 10.183) → (49.370, 10.180)
    Δlat = 0.003 → 333 m, Δlon = 0.003 → 220 m
    distance ≈ √(333² + 220²) ≈ 400 m  ← OK, dans [${params.minInterStopM}m, ${params.maxInterStopM}m]

PROCÉDURE OBLIGATOIRE — applique-la mentalement :
1. Identifie les CLUSTERS géographiques de candidats (groupes serrés
   < ${params.minInterStopM}m entre eux). Chaque cluster compte pour
   UN SEUL stop potentiel — choisis le meilleur du cluster, élimine
   les autres.
2. Choisis un ENSEMBLE THÉMATIQUEMENT COHÉRENT de ${params.needed}
   clusters distincts (un par stop) — tous dans une zone marchable
   d'environ ${params.maxInterStopM * 2}m de diamètre.
3. Si un candidat thématiquement génial est ISOLÉ (>${params.maxInterStopM}m
   du reste), SACRIFIE-LE.
4. Vérifie : pour chaque paire de tes picks, la distance estimée
   doit être DANS [${params.minInterStopM}m, ${params.maxInterStopM}m].

EXEMPLE CONCRET — DOUBLONS À ÉVITER :
   • Bibliothèque municipale + Centre culturel à 16m → 1 SEUL stop
     (même bâtiment de fait, peu importe leurs Google place_id distincts)
   • Église + Plaza devant l'église à 20m → 1 SEUL stop (l'église
     OU la plaza, pas les deux)
   • 3 boutiques sur la même place à 30m → 1 SEUL stop
   La règle d'or : un joueur qui marche 20m entre 2 stops = arnaque.

YOUR TASK:
- Select EXACTLY ${params.needed} indices from the list.
- Tous tes picks doivent former un cluster walkable (cf. contrainte
  ci-dessus, ${params.maxInterStopM}m max entre voisins consécutifs
  une fois ordonnés).
- Theme fit : NATURE/ERA/HISTORICAL ROLE plausibly threadable dans
  la narration. Inclusif : un square / church / city hall sans lien
  thématique direct mais bonne époque = OK.
- Préfère les landmarks bien notés (rating ≥ 4.0) à choix égal.
- Variété : évite ${params.needed} sites du même type (8 églises = ennuyeux).

YOU MUST RETURN ${params.needed} INDICES respectant la contrainte
walkability. La liste a ${params.candidates.length} entrées — il y a
souvent plusieurs clusters géographiques possibles. Choisis le cluster
le plus thématiquement riche.

OUTPUT — strict JSON, no markdown, no preamble:
{
  "selectedIndices": [0, 3, 5, 7, 12, 18, 22, 27],
  "rationale": "1-2 sentence explanation of how the picks fit the theme and form a coherent parcours."
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(
      `[pickThematicLandmarksFromList] no JSON in response: ${responseText.substring(0, 200)} — falling back to top-${params.needed} by distance`,
    );
    return {
      selectedIndices: Array.from(
        { length: Math.min(params.needed, params.candidates.length) },
        (_, i) => i,
      ),
      rationale: "fallback (LLM response unparseable)",
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    selectedIndices?: number[];
    rationale?: string;
  };

  const indices = Array.isArray(parsed.selectedIndices)
    ? parsed.selectedIndices.filter(
        (i) => Number.isInteger(i) && i >= 0 && i < params.candidates.length,
      )
    : [];

  // Dédup
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const i of indices) {
    if (!seen.has(i)) {
      seen.add(i);
      unique.push(i);
    }
  }

  // Cap au needed
  const capped = unique.slice(0, params.needed);

  // Si Claude a renvoyé moins que needed, on complète avec les
  // candidats par ordre de distance (les plus proches du startPoint).
  if (capped.length < params.needed) {
    for (let i = 0; i < params.candidates.length && capped.length < params.needed; i++) {
      if (!seen.has(i)) {
        seen.add(i);
        capped.push(i);
      }
    }
  }

  return {
    selectedIndices: capped,
    rationale: parsed.rationale ?? "(no rationale)",
  };
}

/**
 * Adapte le scénario quand des stops ont été remplacés par auto-discovery.
 *
 * Pourquoi ça existe : le pipeline GPS-first commence par géocoder les
 * landmarkName fournis par oddballtrip. Quand certains sont introuvables
 * (LLM amont qui invente "Église Saint-Cunibert" alors qu'elle n'existe
 * pas, ou un sentier nommé d'après la mauvaise rivière), on les remplace
 * par des POIs réels découverts via Google Places nearbysearch. La
 * narration originale était écrite autour des landmarks invalides — on
 * la régénère pour qu'elle fasse sens autour des nouveaux lieux.
 *
 * Le THÈME et le TITRE ne changent pas (c'est ce que le client a acheté).
 * Seuls la description / le scénario / les noms poétiques sont réécrits.
 */
export async function adaptNarrativeForReplacedStops(params: {
  city: string;
  country: string;
  theme: string;
  /** Narration originale, sert d'inspiration tonale. Peut être ignorée
   *  si trop éloignée des nouveaux stops. */
  originalNarrative: string;
  /** Stops dans l'ordre final du parcours (1 → N). */
  finalStops: Array<{
    /** Nom réel du POI ("Église Saints-Cosme-et-Damien"). */
    landmarkName: string;
    /** Types Google ou catégorie ("church", "tourist_attraction"…). */
    types?: string[];
    /** Adresse / quartier si dispo, aide Claude à situer. */
    address?: string;
    /** Si stop hérité (non remplacé), le nom poétique original. Sert
     *  d'ancre pour ne pas tout réécrire inutilement. */
    keptPoeticName?: string;
    /** Description originale du stop (operator-provided), si conservée. */
    keptDescription?: string;
    /** True ssi ce stop a été ajouté par auto-discovery. */
    isReplacement: boolean;
  }>;
}): Promise<AdaptedNarrative> {
  const client = getAnthropicClient();

  const stopsBlock = params.finalStops
    .map((s, i) => {
      const flag = s.isReplacement ? "(NEW — replacement)" : "(kept from original)";
      const hints = [
        s.types?.length ? `types: ${s.types.slice(0, 4).join(", ")}` : null,
        s.address ? `address: ${s.address}` : null,
        s.keptPoeticName ? `original poetic name: "${s.keptPoeticName}"` : null,
        s.keptDescription ? `original description: ${s.keptDescription}` : null,
      ]
        .filter(Boolean)
        .join("\n     ");
      return `${i + 1}. ${s.landmarkName} ${flag}${hints ? `\n     ${hints}` : ""}`;
    })
    .join("\n\n");

  const prompt = `You are writing the SCENARIO of an outdoor escape game. The list of physical stops (real GPS locations) is ALREADY FIXED — selected upstream by a geometric algorithm for walkability + dispersion. Your job is to weave a creative fiction THAT FITS THE GIVEN THEME using these specific locations as plot anchors.

═══════════════════════════════════════════════════════════════════
  DESIGN PHILOSOPHY — READ CAREFULLY
═══════════════════════════════════════════════════════════════════

The player's experience :
1. Riddles, characters, anecdotes, and AR clues are ALL revealed in
   Augmented Reality on the player's phone. They are NOT pre-existing
   physical plaques or signs.
2. → You can INVENT freely what the AR reveals at each location.
3. → Each stop's "theme link" can be REAL (if known history exists)
   OR FICTIONAL (you invent a thematic backstory). The player can't
   tell the difference.

═══════════════════════════════════════════════════════════════════
  RULES — what you MUST do and MUST NOT do
═══════════════════════════════════════════════════════════════════

✅ MUST :
- Keep the THEME consistent across all stops. If theme is "Corsairs of
  La Rochelle", every stop's fiction must fit a corsair / pirate /
  17th-century-naval-resistance universe. If theme is "Druids", every
  stop fits the druid universe. Tone, vocabulary, plot all reinforce
  the theme.
- Use the GIVEN locations in the GIVEN order. Don't reorder. Don't drop.
- For each stop, find SOMETHING to anchor the fiction on : the building's
  function (church, museum, fountain, plaza), its architecture, an era
  it evokes, or simply its physical setting.
- Make the narrative threading FEEL coherent — even if you invent, make
  it BELIEVABLE within the theme. Continuity across stops matters.

❌ MUST NOT :
- Wander off-theme. A modern park in a "Corsairs" game becomes "the
  hidden meeting ground where corsairs once divided their spoils" —
  NOT "where children play soccer today".
- Stay within real history for every stop. If a location has no real
  thematic link, INVENT one that fits the theme. The escape game IS
  fiction — players sign up for that experience.
- Force a thematic link onto a location it really can't carry. If a
  given stop is, say, a contemporary supermarket, GIVE IT a fictional
  thematic role (e.g. "the secret entrance to the corsair tunnels") —
  don't refuse to use it just because the real-world building doesn't
  fit.
- Refuse a stop. Every stop in the list MUST appear in your output.

═══════════════════════════════════════════════════════════════════
  CONTEXT — locked inputs
═══════════════════════════════════════════════════════════════════

- City: ${params.city}, ${params.country}
- Theme (LOCKED — never deviate): "${params.theme}"
- Original narrative (for tone reference only — its plot may not match
  the new stop list, you can discard plot points):
${params.originalNarrative}

═══════════════════════════════════════════════════════════════════
  THE DEFINITIVE STOP LIST (in walking order, locked, do NOT reorder)
═══════════════════════════════════════════════════════════════════

${stopsBlock}

═══════════════════════════════════════════════════════════════════
  YOUR JOB
═══════════════════════════════════════════════════════════════════

1. \`themeDescription\` (120-180 chars, 1-2 sentences) — product-page
   pitch. Mentions city + theme.

2. \`narrative\` (600-900 chars) — the intro the player reads before
   starting. Threads the exact stops in order. Coherent quest /
   conspiracy / secret-to-uncover that fits the theme. Reference the
   real venues by generic noun ("the old church", "the harbour
   tower") — players don't see Google names.

3. For each stop, output :
   - \`name\` — poetic / evocative title in English (3-7 words) for the
     UI card. Must SOUND like it fits the theme (e.g. for Corsair theme
     "The Smuggler's Sanctuary", "Harbor of the Lost Fleet"; for Druid
     theme "Whisper of the Sacred Oak", "Stone of the Forgotten Rite").
   - \`description\` — 1-2 sentences anchoring the riddle on a real or
     invented thematic detail of the location, in the theme's universe.
     This guides the next Claude stage that writes the AR content.

═══════════════════════════════════════════════════════════════════
  OUTPUT FORMAT — strict JSON, no markdown
═══════════════════════════════════════════════════════════════════

{
  "themeDescription": "…",
  "narrative": "…",
  "stops": [
    { "name": "…", "description": "…" }
    ${"// one entry per stop, in the same order as above"}
  ]
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `adaptNarrativeForReplacedStops: no JSON in Claude response: ${responseText.substring(0, 200)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as AdaptedNarrative;

  if (!parsed.themeDescription || !parsed.narrative || !Array.isArray(parsed.stops)) {
    throw new Error(
      `adaptNarrativeForReplacedStops: parsed JSON missing fields: ${JSON.stringify(parsed).substring(0, 200)}`,
    );
  }
  if (parsed.stops.length !== params.finalStops.length) {
    throw new Error(
      `adaptNarrativeForReplacedStops: expected ${params.finalStops.length} stops, got ${parsed.stops.length}`,
    );
  }
  for (const s of parsed.stops) {
    if (!s.name?.trim() || !s.description?.trim()) {
      throw new Error(
        `adaptNarrativeForReplacedStops: stop with empty name/description: ${JSON.stringify(s)}`,
      );
    }
  }

  return parsed;
}

// ═════════════════════════════════════════════════════════════════════════
// PATRIMOINE-FIRST UX BLOCKS — 2026-05-16
// Intro speech + final riddle + epilogue conditionnel — narrative shell
// that turns a sequence of stops into a guided city-discovery experience.
// ═════════════════════════════════════════════════════════════════════════

export interface IntroSpeechResult {
  /** The guide's opening monologue — played before stop 1. */
  text: string;
}

/**
 * Generate the guide's intro speech, played BEFORE the first stop.
 *
 * Tone: a friendly knowledgeable city guide welcoming the player.
 * Content (in order):
 *   1. Salutation + introduction du guide
 *   2. Présentation du jeu : ville + thème (fil rouge narratif)
 *   3. Pratique : 1h30-3h30 selon le rythme, 7 jours pour finir, batterie chargée, AR
 *   4. Philosophie : "vous allez découvrir des lieux du patrimoine — tous ne
 *      sont pas directement liés au thème car le temps efface les traces,
 *      mais tous valent la visite"
 *   5. Call-to-action : "appuyez sur Commencer"
 *
 * Returns a single English text. Translation handled separately by the
 * translation pipeline (Claude/Gemini) for non-English audiences.
 */
export async function generateIntroSpeech(params: {
  title: string;
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  estimatedDurationMin: number;
  stopCount: number;
}): Promise<IntroSpeechResult> {
  const client = getAnthropicClient();
  const prompt = `You are scripting the opening monologue of an outdoor walking game guide.

GAME
  Title: "${params.title}"
  City: ${params.city}, ${params.country}
  Theme: ${params.theme}
  Theme description: ${params.themeDescription}
  Stops: ${params.stopCount}
  Estimated duration: 1h30 - 3h30 depending on player pace

TASK
  Write the guide's opening speech the player hears BEFORE the first stop.
  Spoken in audio by a friendly knowledgeable city guide. Warm, welcoming,
  setting expectations.

REQUIRED CONTENT (in this order, weave naturally):
  1. Greet the player + introduce yourself as "your OddballTrip guide"
  2. State you'll accompany them through ${params.city}, telling the
     story of its past around the theme "${params.theme}".
  3. Practical instructions in ONE sentence each. CRITICAL — explain
     that AR is used THROUGHOUT THE WHOLE GAME, not just at each stop :
     - "Augmented Reality is at the heart of this game from start to
        finish — keep your camera open as you walk : it acts as your
        compass, shows you the distance and direction to the next
        location, and reveals the hidden secret once you arrive."
     - "Make sure your battery is charged — the camera is running
        most of the time."
     - "This adventure takes between 1h30 and 3h30 depending on your pace"
     - "Don't panic if you can't finish today — you have 7 days to complete it"
  4. Philosophy (CRITICAL — this manages player expectations and prevents
     the 'we just walked' frustration):
     "On your tour you'll discover ${params.stopCount} of the city's
     most significant buildings and places. Not all of them will be
     DIRECTLY linked to "${params.theme}" — time passes, traces fade,
     and what's still standing is the patrimony of the city more than
     just one episode. Our goal is to take you to places of real value
     for the city's history and beauty, and tell you a story that ties
     them together."
  5. Final beat — "Are you ready? Tap Démarrer / Start whenever you are."

STYLE
  - English. Spoken-word friendly (no bullet points, no headings).
  - 250-350 words total.
  - Conversational, slightly poetic but not pompous.
  - Address the player directly as "you".
  - No emojis, no Roman numerals.

OUTPUT — strict JSON, no markdown:
{
  "text": "<the full speech as one string with paragraph breaks via \\n\\n>"
}

Output ONLY the JSON object.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    temperature: 0.6,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("generateIntroSpeech: no JSON in Claude response");
  const parsed = JSON.parse(match[0]) as { text: string };
  if (!parsed.text || parsed.text.length < 100) {
    throw new Error(
      `generateIntroSpeech: text too short or missing (${parsed.text?.length ?? 0} chars)`,
    );
  }
  return { text: parsed.text.trim() };
}

export interface FinalRiddleResult {
  /** The riddle text the player sees on the final page. */
  riddle: string;
  /** The expected answer — lowercase, accent-stripped, trimmed. */
  answer: string;
  /** The "voilà pourquoi" explanation, played after success OR after
   *  2 failed attempts. */
  explanation: string;
}

/**
 * Generate the final game-wide riddle that combines the per-stop
 * answers into a single climactic question. The player gets 2 attempts.
 *
 * Design philosophy:
 *   - The final answer is a CONCEPT, a WORD, or a SHORT PHRASE that
 *     emerges from the individual stop answers — not a literal
 *     concatenation of them. Examples:
 *       - 8 answer words → 1 latin phrase
 *       - 8 dates → the year of a defining event
 *       - 8 names → the name of the leader they all served
 *   - The riddle is one short question (2-3 sentences) asking the
 *     player to deduce this concept from their notebook.
 *   - The explanation is 2-3 paragraphs that closes the narrative
 *     loop: explains WHY this is the answer, how each stop contributed,
 *     and ends on a moving / inspiring beat about the city or the theme.
 */
export async function generateFinalRiddle(params: {
  title: string;
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  steps: Array<{
    stepOrder: number;
    title: string;
    answer: string;
    anecdote: string;
  }>;
}): Promise<FinalRiddleResult> {
  const client = getAnthropicClient();
  const stepsList = params.steps
    .map(
      (s) =>
        `Stop ${s.stepOrder}: "${s.title}" — answer="${s.answer}" — anecdote="${s.anecdote.slice(0, 200)}"`,
    )
    .join("\n");

  const prompt = `You are designing the final puzzle of an outdoor walking game in ${params.city}.

GAME
  Title: "${params.title}"
  Theme: ${params.theme}
  Theme description: ${params.themeDescription}

STOPS (each gave the player a one-word "indice" they typed into their notebook):
${stepsList}

═══════════════════════════════════════════════════════════════════════
TASK — Generate a final riddle + answer + explanation
═══════════════════════════════════════════════════════════════════════

THE FINAL ANSWER MUST BE DERIVABLE FROM THE INDICES VIA A CLEAR,
EXPLICIT MECHANISM. Pick exactly ONE mechanism from the list below
and apply it RIGOROUSLY. Do NOT mix mechanisms. Do NOT invent loose
"renaissance"-style associations.

ACCEPTED MECHANISMS (pick ONE) :

  M1 — ACROSTIC : the first letter of each indice (taken in stop order)
       spells the answer.
       Example : indices = [VERITAS, ALBA, LIBERTAS, LUX, EROS] → "VALLE"

       STRICT RULES FOR M1 (read carefully — past games failed here) :
       a) EVERY indice MUST start with an A-Z LETTER. If any indice is a
          number (e.g. "1248", "43", "177") OR starts with a non-letter
          character, M1 is FORBIDDEN. Use M2, M3, or M4 instead.
       b) The resulting word MUST be a REAL recognizable word in
          Latin/French/English/Spanish/Italian OR a real proper noun
          (city, person, named concept). NEVER output a meaningless
          string like "FAVAGIS", "CSSACFMV", or any concatenation that
          doesn't resolve to a known word — those are AUTOMATIC FAILURES.
       c) BEFORE finalizing, write the letters in order and check:
          "Does this spell a real word ?" If no, switch to M2/M3/M4.

  M2 — COMMON CONCEPT : all (or most) indices are FACETS of one named
       thing. The answer is that thing's most canonical name.
       Example : indices about light + sun + dawn + golden + warmth →
                 answer = "SOLEIL" (or the local-language equivalent).
       Requires : you can write a sentence linking ≥ 4 indices directly
                  to that one named answer, no metaphorical leap needed.

  M3 — CONTAINED CITY / PERSON / EVENT NAME : the indices, when taken
       together, all point to the historical/cultural identity of
       a place, person, or named event. The answer IS that name.
       Example : indices = [LUGUS, VERITAS, ARENA, MEMORIA, FIDES] all
                 tied to ${params.city}'s ancient identity → answer is
                 the city's ROMAN NAME (e.g. "LUGDUNUM" for Lyon,
                 "AQUAE SEXTIAE" for Aix-en-Provence, "ALBA POMPEIA"
                 for Alba).
       Requires : the indices form a thematic web around that single
                  named target, AND that name is short (1-3 words).

  M4 — KEY YEAR / NUMBER : the indices span a defining event and the
       answer is the year of that event (4 digits).
       Example : indices = [REVOLT, BLANDINA, MARTYRDOM, CHRISTIAN, …]
                 in a Roman persecution context → answer = "177".

DERIVATION CHECKLIST (apply BEFORE choosing the answer)
  ☐ Are ALL ${params.steps.length} indices UNIQUE ? (no duplicates like
    AURUM appearing twice — that's a generation bug upstream, but
    if you see it, REJECT the puzzle and STOP. Output a JSON error
    instead of a final riddle.)
  ☐ Can I explain why ≥ 4 of the ${params.steps.length} indices point
    to the answer using my chosen mechanism, in ONE clear sentence each ?
  ☐ Is the answer 1-3 words OR a 3-4 digit number ?
  ☐ If M1 acrostic : do ALL indices start with letters A-Z (no numbers) ?
    AND do the first letters spell a REAL word/name (not a random
    string like "FAVAGIS" or "CSSACFMV") ?
  ☐ Is the answer a name a typical player could RECOGNIZE (not a niche
    Latin neologism, not a fake-sounding constructed word) ?
  ☐ Have I AVOIDED loose poetic associations like "renaissance",
    "harmony", "eternal" — generic words that fit ANY theme ?

If you cannot tick all 6 boxes, REVISE your answer until you can.

INDICE UNIQUENESS CHECK (do this FIRST)
  List the ${params.steps.length} indices : ${params.steps.map(s => s.answer).join(", ")}
  Are they all UNIQUE ? If you spot a duplicate, output this JSON instead :
    { "error": "duplicate_indices", "details": "<which indice repeats>" }
  This signals to the pipeline that the stops generation was buggy and
  should be re-run. Do NOT try to "make do" with duplicates.

EXAMPLES of strong final answers (different mechanisms, different games)
  - "LUGDUNUM" (M3 — Lyon's Roman name, when indices all point to its
    foundation, gods, arenas, sacred sites)
  - "BLANDINE" (M3 — when indices all relate to the 177 AD Christian
    martyrs of Lyon)
  - "ARTHUR" (M3 — when indices are sword, lake, round table, merlin)
  - "1492" (M4 — when indices relate to discovery, queen Isabella,
    Andalusia, ocean, Cordoba)
  - "VICTOIRE" (M2 — when indices are flame, courage, hope, freedom,
    return, all aspects of Liberation)
  - "ROSE" (M1 acrostic — indices spelling R-O-S-E in stop order)

EXAMPLES of WEAK answers (NEVER produce these)
  - "renaissance" — too generic, fits any old European city
  - "harmonie" — abstract, no real derivation
  - "destinée" — empty poetry
  - Any English word ending in -ity / -ness / -hood that abstracts away
    from concrete facts

EXPLANATION
  Write 2-3 short paragraphs that :
  1. STATE the answer clearly.
  2. Walk through the derivation : "The first indice X means..., the
     second Y points to..., together they reveal Z." Cite at least 4
     stops by their indice value.
  3. End with a moving beat about ${params.city} or the theme.

  Played in TWO scenarios :
    A. Player got it right → celebration + closure
    B. Player failed 2 attempts → "here is what you missed" reveal
  Write so both scenarios feel natural.

STYLE
  - English (translation handled downstream).
  - No Roman numerals in answer.
  - Riddle 2-4 sentences, evocative, ending with a question mark.
  - Explanation 200-300 words.

OUTPUT — strict JSON, no markdown :
{
  "mechanism": "M1" | "M2" | "M3" | "M4",
  "derivation_check": "<one-sentence proof that ≥ 4 indices link to the answer>",
  "riddle": "<2-4 sentences ending with a question mark>",
  "answer": "<the expected answer, lowercase, no accents — 1-3 words OR a number>",
  "explanation": "<200-300 words, plain text with \\n\\n for paragraph breaks>"
}

Output ONLY the JSON object.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    // Temperature lowered to 0.25 for the final riddle. Higher values
    // produced too-creative leaps ("renaissance" for Lugdunum where
    // indices clearly pointed to LUGDUNUM itself). We want consistency
    // and rigor here, not poetic flair.
    temperature: 0.25,
    messages: [{ role: "user", content: prompt }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("generateFinalRiddle: no JSON in Claude response");
  const parsed = JSON.parse(match[0]) as Partial<FinalRiddleResult> & {
    mechanism?: string;
    derivation_check?: string;
    error?: string;
    details?: string;
  };

  // 1. Claude a explicitement signalé un problème en amont (duplicate indices)
  if (parsed.error) {
    throw new Error(
      `generateFinalRiddle: Claude refused to generate (${parsed.error}: ${parsed.details ?? ""}). Stops should be regenerated upstream.`,
    );
  }

  if (!parsed.riddle || !parsed.answer || !parsed.explanation) {
    throw new Error(
      "generateFinalRiddle: incomplete response (missing one of riddle/answer/explanation)",
    );
  }

  console.log(
    `[generateFinalRiddle] mechanism=${parsed.mechanism ?? "?"} answer="${parsed.answer}" derivation="${parsed.derivation_check ?? "(missing)"}"`,
  );

  const normalizedAnswer = parsed.answer.trim().toLowerCase();

  // 2. Garde-fou mots vagues "any-theme-fits" — liste partagée avec
  // le post-publish validator (cf. answer-blacklists.ts).
  if (WEAK_ANSWERS.has(normalizedAnswer)) {
    throw new Error(
      `generateFinalRiddle: weak generic answer "${parsed.answer}" rejected (mechanism=${parsed.mechanism}). The pipeline should retry or skip the final riddle.`,
    );
  }

  // 3. Garde-fou acrostic foireux : pour un answer SHORT en lettres uniquement,
  // on vérifie que ces lettres = premières lettres des indices dans l'ordre.
  // Bug observé Séville (2026-05-16) : answer="favagis" formé de F-1-A-V-A-G-I-S
  // où le "1" venait du nombre "1248" (impossible en acrostic) + AURUM dupliqué.
  if (
    parsed.mechanism === "M1" &&
    /^[a-zà-ÿ]{2,}$/i.test(normalizedAnswer) &&
    normalizedAnswer.length === params.steps.length
  ) {
    const firstLetters = params.steps
      .map((s) => (s.answer || "").trim().charAt(0).toLowerCase())
      .join("");
    if (firstLetters !== normalizedAnswer) {
      throw new Error(
        `generateFinalRiddle: M1 acrostic mismatch — expected first letters "${firstLetters}" but got answer "${normalizedAnswer}". The mechanism is broken.`,
      );
    }
    // Vérifier qu'aucun indice ne commence par un chiffre
    const hasNumericIndice = params.steps.some((s) =>
      /^\d/.test((s.answer || "").trim()),
    );
    if (hasNumericIndice) {
      throw new Error(
        `generateFinalRiddle: M1 acrostic forbidden when some indices are numbers (1248, 177, etc.). Should have picked M3 or M4.`,
      );
    }
  }

  // 4. Garde-fou "fake latin word" : néologismes inventés par Claude
  // qui ressemblent à du latin (favagis, geverus, etc.). Liste partagée
  // avec le post-publish validator.
  if (KNOWN_FAKE_TOKENS.has(normalizedAnswer)) {
    throw new Error(
      `generateFinalRiddle: fake-latin token "${parsed.answer}" rejected (known constructed neologism).`,
    );
  }

  // 5. Sanity check sur explanation : doit citer ≥ 4 indices pour prouver
  // la dérivation. Si Claude n'arrive pas à citer 4 indices, l'answer
  // est probablement faible.
  const explanationLower = parsed.explanation.toLowerCase();
  const indicesCited = params.steps.filter((s) =>
    s.answer && explanationLower.includes(s.answer.toLowerCase()),
  ).length;
  if (indicesCited < 4) {
    throw new Error(
      `generateFinalRiddle: explanation cites only ${indicesCited}/${params.steps.length} indices — derivation is too thin. Re-roll.`,
    );
  }

  return {
    riddle: parsed.riddle.trim(),
    answer: normalizedAnswer,
    explanation: parsed.explanation.trim(),
  };
}
