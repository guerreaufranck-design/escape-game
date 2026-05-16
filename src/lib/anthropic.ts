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
  /** 1-3 real cultural / heritage points the player passes ON THE WAY
   * to this step. Surfaced as a separate card in the UI so players
   * can expand "things to spot on the route". */
  route_attractions: Array<{ name: string; fact: string }>;
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

6. "hints": Array of EXACTLY 3 hints, in this STRICT JSON shape:
     [
       { "order": 1, "text": "atmospheric nudge" },
       { "order": 2, "text": "where to look + tell them to open the AR camera" },
       { "order": 3, "text": "shape of the answer (no spoiler)" }
     ]
   The "order" and "text" keys are MANDATORY. Do NOT return a string
   array like ["hint"] or a bare object — that breaks the pipeline.
   The array MUST be length 3, no more, no less.

   Each hint serves a distinct purpose — together they form a
   ladder so a stuck player can climb without skipping the step:

   Hint 1 — ATMOSPHERIC NUDGE
     Re-anchors the player in the riddle's world without giving away
     the mechanism. Refers to a real visible element of the place
     (a stone, a window, a colour) without saying what to do.
     Example: "The stones themselves remember the founding century."

   Hint 2 — OPEN THE CAMERA + WHERE TO LOOK
     This is the CRITICAL one. The player likely doesn't know the
     answer is hidden in AR. This hint MUST tell them to:
       (a) open / point their camera at a SPECIFIC surface
           ("aim your phone camera at the pediment above the main
           door", "open the AR camera and slowly sweep the south
           wall left to right")
       (b) name the surface in plain words anyone can find
     Without this hint, the player thinks the answer is hidden in the
     real-world stones and never opens the camera. Game-over.

   Hint 3 — SHAPE OF THE ANSWER
     Tells what FORMAT the answer takes, never the literal value.
     Example: "It's a Roman numeral followed by a single Latin word."

   Example (good for hint 2):
     "Open your phone's camera in the AR mode and aim it at the
     carved pediment above the main entrance — the magical letters
     will materialise on the stone."

   Example (bad — too vague):
     "Look around the church."

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

14. "route_attractions": Array of EXACTLY 1-3 short cultural / heritage
    points-of-interest the player will physically pass ON THE WAY to
    this step (or right next to it). Real, factual, concrete buildings
    / statues / fountains / bakeries / plaques. NOT fictional. Each
    entry uses this STRICT JSON shape:
      [
        {
          "name": "Maison Borghi (XVIIe siecle)",
          "fact": "Balcons en fer forge classes monuments historiques, restaures en 1987."
        },
        ...
      ]
    Mandatory keys: "name" (under 60 chars) + "fact" (one sentence
    factual under 140 chars). Do NOT return a string array — that
    breaks the pipeline. The UI shows these as a small expandable
    card "Sur le chemin, ne manque pas..." above the riddle, so the
    player can slow down and observe. Step 1 has no "way to" — for
    step 1, these can be points BEHIND the player or visible from
    the starting point. Always 1-3 entries, never empty.

═══════════════════════════════════════════════════════════════════════
GAME-WIDE INVARIANTS (apply across the whole array of ${stepCount} steps)
═══════════════════════════════════════════════════════════════════════

INV-1 UNIQUE ANSWERS — every answer_text in the array MUST be unique. No
two steps share the same answer. If you find yourself producing a
duplicate, change one of them — pick a different year, a different word,
a different roman numeral.

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
Hints: 1) ${s.hints[0]?.text || "(missing)"} | 2) ${s.hints[1]?.text || "(missing)"} | 3) ${s.hints[2]?.text || "(missing)"}
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
    {"order": 1, "text": "atmospheric hint"},
    {"order": 2, "text": "practical hint — what type of object and where"},
    {"order": 3, "text": "format hint without the answer"}
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
  3. Practical instructions in ONE sentence each:
     - "Turn on your phone camera — most stops use AR"
     - "Make sure your battery is charged"
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
  5. Final beat — "Are you ready? Tap Start whenever you are."

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

STOPS (each gave the player an "indice" — the answer they typed):
${stepsList}

TASK
  Design the FINAL RIDDLE the player faces after the last stop. It must:
  1. Tie all stop answers together into ONE concept / word / short phrase
     that the player can DEDUCE from their notebook.
  2. The final answer must be SHORT (1-4 words, single number, or single
     date), case-insensitive, accent-insensitive.
  3. The player has only 2 attempts — make the riddle solvable but not
     trivial. A motivated player who paid attention should crack it.

EXAMPLES OF GOOD FINAL ANSWERS
  - The Latin phrase that ties together the 8 single-word answers
  - The year of the defining event (deduced from dates scattered across stops)
  - The full name of the figure mentioned at each stop
  - A motto / inscription common to several stops
  - A geographical concept (the river that runs under the city, the wind
    that shaped the architecture)

EXPLANATION
  Write 2-3 short paragraphs that:
  - State the answer
  - Explain WHY it's the answer (cite 2-3 stops as evidence)
  - End on a moving / inspiring beat about ${params.city} or the theme

  This explanation is played in TWO scenarios:
    A. The player got it right → as celebration + closure
    B. The player failed 2 attempts → as "here is what you missed" reveal
  Write it so both scenarios feel natural.

STYLE
  - English (translation handled downstream).
  - No Roman numerals in answer.
  - Riddle 2-4 sentences, evocative.
  - Explanation 200-300 words.

OUTPUT — strict JSON, no markdown:
{
  "riddle": "<2-4 sentences ending with a question mark>",
  "answer": "<the expected answer, lowercase, no accents — 1-4 words>",
  "explanation": "<200-300 words, plain text with \\n\\n for paragraph breaks>"
}

Output ONLY the JSON object.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.65,
    messages: [{ role: "user", content: prompt }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("generateFinalRiddle: no JSON in Claude response");
  const parsed = JSON.parse(match[0]) as FinalRiddleResult;
  if (!parsed.riddle || !parsed.answer || !parsed.explanation) {
    throw new Error(
      "generateFinalRiddle: incomplete response (missing one of riddle/answer/explanation)",
    );
  }
  return {
    riddle: parsed.riddle.trim(),
    answer: parsed.answer.trim().toLowerCase(),
    explanation: parsed.explanation.trim(),
  };
}
