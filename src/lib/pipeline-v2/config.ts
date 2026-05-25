/**
 * CONFIG — toutes les constantes du pipeline v5 en UN SEUL endroit.
 *
 * Règle d'or : aucun magic number dans le business code. Tout vient soit
 * du payload OddballTrip, soit d'ici. Si tu veux changer un comportement,
 * tu le changes ICI, et ça se propage.
 */

export const CONFIG = {
  // ── Rayons (km) — utilisés UNIQUEMENT en fallback si payload silencieux ──
  // OddballTrip envoie normalement payload.radiusKm. Ces valeurs sont des
  // garde-fous si jamais le payload ne le précise pas.
  WALKING_DEFAULT_RADIUS_KM: 1.75, // diamètre 3.5 km
  ROADTRIP_DEFAULT_RADIUS_KM: 30, // diamètre 60 km

  // ── Stops ──
  TARGET_STOPS: 8,
  MIN_STOPS: 5, // si select renvoie moins → halt + alerte

  // ── Per-stop defaults (sauf override payload futur) ──
  VALIDATION_RADIUS_M: 30,
  BONUS_TIME_S: 30,

  // ── Perplexity ──
  // sonar = standard, rapide (5-10s), bonne qualité, peu cher
  // sonar-deep-research = approfondi (3-7 min), top qualité, cher
  // On démarre sur "sonar". Si hallucinations fréquentes → upgrade UNIQUEMENT
  // l'étape discover à "sonar-deep-research".
  PERPLEXITY_DISCOVER_MODEL: "sonar" as const,
  PERPLEXITY_TEMPERATURE: 0.1,
  PERPLEXITY_MAX_TOKENS: 6000,

  // ── Claude (Sonnet 4.5) — pour SELECT et NARRATE ──
  CLAUDE_MODEL: "claude-sonnet-4-5-20250929" as const,
  CLAUDE_TEMPERATURE: 0.3,
  CLAUDE_MAX_TOKENS: 8000,

  // ── Gemini Flash — pour TRANSLATE EN → langue client ──
  GEMINI_MODEL: "gemini-2.5-flash" as const,
  GEMINI_TEMPERATURE: 0.2,

  // ── ElevenLabs Flash v2.5 — pour AUDIO ──
  ELEVENLABS_MODEL: "eleven_flash_v2_5" as const,
  ELEVENLABS_SPEED: 1.0,
  ELEVENLABS_STABILITY: 0.5,
  ELEVENLABS_SIMILARITY_BOOST: 0.75,
  ELEVENLABS_DEFAULT_VOICE: "alFofuDn3cOwyoz1i44T", // Dallin
  ELEVENLABS_ARCHETYPE_VOICES: {
    guide_male: "alFofuDn3cOwyoz1i44T",
    guide_female: "EXAVITQu4vr4xnSDxMaL", // Bella
    scholar: "21m00Tcm4TlvDq8ikWAM", // Rachel
    monk: "nPczCjzI2devNBz1zQrb", // Adam-like
    soldier: "VR6AewLTigWG4xSOukaG", // Josh
  } as const,

  // ── Storage ──
  AUDIO_BUCKET: "audio",

  // ── Activation code ──
  CODE_VALIDITY_DAYS: 7,

  // ── Persistance ──
  /** Valeur de start_point_source pour signaler "ce game est en v5".
   *  Le cron process-pending-games doit SKIP ces rows. */
  PIPELINE_VERSION_TAG: "pipeline_v2",
} as const;

export type ArchetypeVoice = keyof typeof CONFIG.ELEVENLABS_ARCHETYPE_VOICES;
