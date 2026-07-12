/**
 * PERSIST v5 — fonctions DB séparées, une par étape Inngest.
 *
 * Chaque fonction est :
 *   - idempotente (peut être rejouée sans casser)
 *   - rapide (< 5s — pas de logique métier)
 *   - cleanly typée
 *
 * Le but : chaque step.run() dans build-game-v2.ts appelle UNE de ces
 * fonctions. Pas de mélange avec discover/geocode/select/narrate.
 */

import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config";
import type {
  AudioResult,
  GeocodedLandmark,
  PipelineInput,
  StructuredGame,
  TranslationResult,
} from "./types";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key);
}

// ─────────────────────────────────────────────────────────────
// STEP 0 — Draft lookup (skip discover/geocode/select si trouvé)
// ─────────────────────────────────────────────────────────────

/**
 * Cherche un draft `validated` pour ce slug. Si présent → on saute
 * Perplexity discover (~10s + ~$0.005), Google geocode (~30s + ~$0.02/landmark),
 * et Claude select (~30s + ~$0.01). Économie nette : ~1-2 min + ~$0.50/vente.
 *
 * Stratégie alignée sur V1 (game-pipeline.ts:1014-1049) :
 *   - Filtre status = 'validated' + stops non vide + count ≥ MIN_STOPS
 *   - Verrouille (status → 'fulfilling') pour éviter qu'un 2e acheteur
 *     consomme le même draft pendant qu'on traite celui-ci
 *
 * Retourne :
 *   - null  : pas de draft → pipeline normale (discover/geocode/select)
 *   - object : draft trouvé → on utilise stops directement
 */
export async function loadValidatedDraft(slug: string): Promise<{
  draftId: string;
  stops: GeocodedLandmark[];
  editorialWarning?: string;
  selectionRationale?: string;
} | null> {
  const s = getClient();
  const { data: draft, error } = await s
    .from("game_drafts")
    .select("id, slug, stops, diagnostics")
    .eq("slug", slug)
    .eq("status", "validated")
    .maybeSingle();

  if (error) {
    console.warn(`[v5 loadValidatedDraft] lookup error for ${slug}: ${error.message}`);
    return null;
  }
  if (!draft) return null;

  const rawStops = Array.isArray(draft.stops) ? draft.stops : [];
  if (rawStops.length < CONFIG.MIN_STOPS) {
    console.warn(
      `[v5 loadValidatedDraft] draft ${slug} a seulement ${rawStops.length} stops (min ${CONFIG.MIN_STOPS}) — ignored`,
    );
    return null;
  }

  // Lock the draft to prevent concurrent consumption.
  // Note : si la vente échoue plus tard, ce draft reste en 'fulfilling' —
  // un opérateur peut le remettre en 'validated' manuellement. Pour l'instant
  // pas d'auto-unlock pour éviter qu'un retry Inngest le ré-utilise en boucle.
  const { error: lockErr } = await s
    .from("game_drafts")
    .update({ status: "fulfilling", updated_at: new Date().toISOString() })
    .eq("id", draft.id);
  if (lockErr) {
    console.warn(`[v5 loadValidatedDraft] lock failed for ${slug}: ${lockErr.message} — using draft anyway`);
  }

  // Convert draft.stops (DB schema) → GeocodedLandmark[] (pipeline schema)
  type RawStop = {
    step_order?: number;
    name?: string;
    description?: string;
    rationale?: string | null;
    lat?: number;
    lon?: number;
    placeId?: string;
    types?: string[];
    distanceFromStartM?: number;
  };
  const stops: GeocodedLandmark[] = rawStops.map((raw, i) => {
    const r = raw as RawStop;
    return {
      order: r.step_order ?? i + 1,
      name: r.name ?? `Stop ${i + 1}`,
      googleName: r.name ?? `Stop ${i + 1}`,
      narrativeTitle: r.rationale ?? r.description ?? "",
      riddle: "",    // narrate écrira
      answer: "",    // narrate écrira
      hint: "",      // narrate écrira
      anecdote: "",  // narrate écrira
      sources: [],
      lat: typeof r.lat === "number" ? r.lat : 0,
      lon: typeof r.lon === "number" ? r.lon : 0,
      placeId: r.placeId ?? "",
      formattedAddress: "",
      placeTypes: Array.isArray(r.types) ? r.types : [],
      distanceFromStartM: r.distanceFromStartM ?? 0,
    };
  });

  const diag = (draft.diagnostics ?? {}) as Record<string, unknown>;
  return {
    draftId: draft.id as string,
    stops,
    editorialWarning: typeof diag.editorialWarning === "string" ? diag.editorialWarning : undefined,
    selectionRationale: typeof diag.selectionRationale === "string" ? diag.selectionRationale : undefined,
  };
}

/**
 * Marque le draft comme `fulfilled` après que la vente a réussi (game published).
 * Si la vente échoue, le draft reste en 'fulfilling' pour intervention manuelle.
 *
 * Aligné sur V1 (game-pipeline.ts:2449) qui utilise status='fulfilled' +
 * fulfilled_at + fulfilled_game_id. La row reste pour audit/analytics
 * (combien de ventes par slug) mais n'est plus réutilisée.
 */
export async function markDraftConsumed(draftId: string, gameId: string): Promise<void> {
  const s = getClient();
  const { error } = await s
    .from("game_drafts")
    .update({
      status: "fulfilled",
      fulfilled_at: new Date().toISOString(),
      fulfilled_game_id: gameId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId);
  if (error) {
    console.warn(`[v5 markDraftConsumed] failed for ${draftId}: ${error.message}`);
  }
}

/**
 * Libère un draft `fulfilling` en cas d'échec de la pipeline en aval.
 * Permet à un retry futur (ou à l'opérateur) de retenter.
 */
export async function releaseDraft(draftId: string): Promise<void> {
  const s = getClient();
  await s
    .from("game_drafts")
    .update({ status: "validated", updated_at: new Date().toISOString() })
    .eq("id", draftId);
}

// ─────────────────────────────────────────────────────────────
// STEP 1 — Insert empty game (avant tout)
// ─────────────────────────────────────────────────────────────

/** Crée une ligne games minimale avec is_published=false + start_point_source=pipeline_v2.
 *  Le cron process-pending-games doit IGNORER les rows avec ce flag.
 *  Note (2026-05-26) : si startPoint est encore le placeholder (0,0)
 *  parce qu'on attend la résolution textuelle, on écrit NULL pour ne
 *  pas polluer la DB. persistMasterEN écrira la vraie valeur (= stop 1)
 *  après select. */
export async function insertEmptyGame(input: PipelineInput): Promise<string> {
  const s = getClient();
  const isPlaceholderStart =
    !input.startPoint ||
    (input.startPoint.lat === 0 && input.startPoint.lon === 0);
  const { data, error } = await s
    .from("games")
    .insert({
      slug: input.slug,
      title: input.theme,
      description: input.themeDescription ?? "(en cours de génération via pipeline v5)",
      city: input.city,
      difficulty: input.difficulty,
      estimated_duration_min: input.estimatedDurationMin,
      mode: input.mode,
      transport_mode: input.transportMode,
      radius_km: input.radiusKm,
      start_point_lat: isPlaceholderStart ? null : input.startPoint.lat,
      start_point_lon: isPlaceholderStart ? null : input.startPoint.lon,
      start_point_text: input.startPointText ?? null,
      start_point_source: CONFIG.PIPELINE_VERSION_TAG,
      is_published: false,
      needs_review: false,
      original_payload: input.originalPayload,
      product_description: input.productDescription ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertEmptyGame: ${error.message}`);
  return data.id as string;
}

// ─────────────────────────────────────────────────────────────
// STEP 5 — Persist master EN (game meta + game_steps)
// ─────────────────────────────────────────────────────────────

export async function persistMasterEN(
  gameId: string,
  input: PipelineInput,
  game: StructuredGame,
): Promise<void> {
  const s = getClient();

  // 1. UPDATE games meta
  // Mandat 2026-05-26 : start_point_* persisté = stops[0]. Le joueur PWA
  // voit "votre point de départ = [stop 1]" — cohérence totale (avant on
  // pouvait avoir un start affiché à 30 km du stop 1 dans le PWA).
  const stop1 = game.stops[0];
  const updatePayload: Record<string, unknown> = {
    title: game.meta.title,
    description: game.meta.description,
    intro_speech: game.meta.intro,
    epilogue_title: game.meta.epilogueTitle,
    epilogue_text: game.meta.epilogue,
    final_riddle_text: game.meta.finalRiddleText,
    final_answer: game.meta.finalAnswer,
    final_answer_explanation: game.meta.finalAnswerExplanation,
    updated_at: new Date().toISOString(),
  };
  // 2026-05-31 : 3 indices progressifs pour la méta-énigme (anti-blocage).
  // Si la migration 043 n'est pas encore appliquée, on retombe sur un
  // INSERT sans cette colonne (retry catch). Le jeu marche quand même.
  if (Array.isArray(game.meta.finalRiddleHints) && game.meta.finalRiddleHints.length === 3) {
    updatePayload.final_riddle_hints = game.meta.finalRiddleHints;
  }
  if (stop1?.latitude && stop1?.longitude) {
    updatePayload.start_point_lat = stop1.latitude;
    updatePayload.start_point_lon = stop1.longitude;
    updatePayload.start_point_text = stop1.landmarkName ?? input.startPointText ?? null;
  }

  let { error: gErr } = await s
    .from("games")
    .update(updatePayload)
    .eq("id", gameId);

  // Resilience : si final_riddle_hints n'existe pas (migration 043 pas
  // encore appliquée), on retry sans cette colonne. Le jeu reste jouable
  // (UI PWA tombera sur les fallback hints client-side si besoin).
  if (gErr && /column.*final_riddle_hints|final_riddle_hints.*does not exist/i.test(gErr.message)) {
    console.warn(
      `[v5 persist] Migration 043 not applied — final_riddle_hints column missing. Retrying update without it.`,
    );
    delete updatePayload.final_riddle_hints;
    const retry = await s.from("games").update(updatePayload).eq("id", gameId);
    gErr = retry.error;
  }
  if (gErr) throw new Error(`persistMasterEN games update: ${gErr.message}`);

  // 2. DELETE then INSERT game_steps (idempotent)
  const { error: dErr } = await s.from("game_steps").delete().eq("game_id", gameId);
  if (dErr) throw new Error(`persistMasterEN delete steps: ${dErr.message}`);

  const rows = game.stops.map((stop) => ({
    game_id: gameId,
    step_order: stop.step_order,
    title: stop.title,
    landmark_name: stop.landmarkName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    riddle_text: stop.riddle,
    answer_text: stop.answer,
    hints: stop.hints,
    anecdote: stop.anecdote,
    ar_character_type: stop.arCharacterType,
    ar_character_dialogue: stop.arCharacterDialogue,
    ar_facade_text: stop.arFacadeText,
    ar_treasure_reward: stop.arTreasureReward,
    landmark_history: stop.landmarkHistory,
    route_attractions: stop.routeAttractions ?? [],
    validation_radius_meters: stop.validationRadiusMeters,
    bonus_time_seconds: stop.bonusTimeSeconds,
    answer_source: "virtual_ar",
  }));

  const { error: iErr } = await s.from("game_steps").insert(rows);
  if (iErr) throw new Error(`persistMasterEN insert steps: ${iErr.message}`);
}

// ─────────────────────────────────────────────────────────────
// STEP 6/7 — Persist translation (langue client si != EN)
// ─────────────────────────────────────────────────────────────

/**
 * Upsert translations_cache pour la langue cible.
 *
 * Schéma DB réel (vérifié 2026-05-26) :
 *   - source_id      UUID (= gameId pour game-level, = step.id pour step-level,
 *                          ou synthétique `hint-{gameId}-{stepOrder}-{idx}` pour hints)
 *   - source_table   "games" | "game_steps"
 *   - source_field   colonne DB ("title", "description", "intro_speech",
 *                                "epilogue_title", "epilogue_text",
 *                                "final_riddle_text", "final_answer",
 *                                "final_answer_explanation",
 *                                "landmark_name", "riddle_text", "anecdote",
 *                                "ar_character_dialogue", "ar_treasure_reward",
 *                                "landmark_history", "hint_text")
 *   - language       ISO 639-1
 *   - translated_text
 *   - mode           (legacy, optionnel)
 *
 * onConflict : "source_id,source_field,language"
 *
 * Ce format est ce que `translateGameField` / `translateStepFields` /
 * `prepareGamePackage` lisent côté player API (cacheOnly: true).
 * Avant 2026-05-26 cette fonction écrivait dans `game_id,step_order,
 * field,text` (colonnes inexistantes) → silent failure → cache vide
 * pour les drafts → joueur voyait EN. Fix : aligner sur le vrai schéma.
 *
 * Pour le mapping field V5 → colonne DB on s'aligne sur les conventions
 * lues dans game-package.ts (référence canonique).
 */

/** Mapping V5 meta key → colonne DB games */
const META_FIELD_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  intro: "intro_speech",
  epilogue: "epilogue_text",
  epilogue_title: "epilogue_title",
  final_riddle_text: "final_riddle_text",
  final_answer: "final_answer",
  final_answer_explanation: "final_answer_explanation",
};

export async function persistTranslation(
  gameId: string,
  translation: TranslationResult,
): Promise<void> {
  const s = getClient();

  // EN est la langue source — pas besoin de la cacher. Le player API
  // lit games/game_steps directement pour EN, et translate-service.ts
  // skip translations_cache pour targetLang === "en" (lignes 72-74).
  if (translation.language === "en") return;

  // Fetch step IDs (UUID) by step_order — nécessaire pour source_id step-level
  const { data: steps, error: stepsErr } = await s
    .from("game_steps")
    .select("id, step_order")
    .eq("game_id", gameId)
    .order("step_order");
  if (stepsErr) throw new Error(`persistTranslation fetch steps: ${stepsErr.message}`);
  const stepIdByOrder = new Map<number, string>();
  for (const st of steps ?? []) stepIdByOrder.set(st.step_order, st.id);

  type Write = {
    source_id: string;
    source_table: "games" | "game_steps";
    source_field: string;
    text: string;
  };
  const writes: Write[] = [];

  // ── Game-level (source_table=games, source_id=gameId) ──
  for (const [v5Key, dbField] of Object.entries(META_FIELD_MAP)) {
    const text = (translation.meta as Record<string, unknown>)[
      v5Key === "epilogue_title" ? "epilogueTitle"
      : v5Key === "final_riddle_text" ? "finalRiddleText"
      : v5Key === "final_answer" ? "finalAnswer"
      : v5Key === "final_answer_explanation" ? "finalAnswerExplanation"
      : v5Key
    ];
    if (typeof text !== "string" || !text.trim()) continue;
    writes.push({ source_id: gameId, source_table: "games", source_field: dbField, text });
  }

  // ── Meta-finale hints (2026-05-31) — chaque hint dans translations_cache ──
  // Pattern aligné sur les hints de stop : 1 row par hint, source_field
  // "final_riddle_hint_0", "_1", "_2". Le player API peut les lire pour
  // afficher progressivement entre les 2 tentatives.
  const metaHints = (translation.meta as { finalRiddleHints?: unknown }).finalRiddleHints;
  if (Array.isArray(metaHints)) {
    for (let i = 0; i < metaHints.length && i < 3; i++) {
      const h = metaHints[i];
      if (typeof h !== "string" || !h.trim()) continue;
      writes.push({
        source_id: gameId,
        source_table: "games",
        source_field: `final_riddle_hint_${i}`,
        text: h,
      });
    }
  }

  // ── Step-level (source_table=game_steps, source_id=step UUID) ──
  for (const stop of translation.stops) {
    const stepId = stepIdByOrder.get(stop.step_order);
    if (!stepId) {
      console.warn(`[v5 persist] step_order ${stop.step_order} not found in DB — skip translation`);
      continue;
    }
    const stepWrites: Array<[string, string]> = [
      ["title", stop.title],
      ["landmark_name", stop.landmarkName],
      ["riddle_text", stop.riddle],
      ["anecdote", stop.anecdote],
      ["ar_character_dialogue", stop.arCharacterDialogue],
      ["ar_treasure_reward", stop.arTreasureReward],
    ];
    for (const [field, text] of stepWrites) {
      if (typeof text !== "string" || !text.trim()) continue;
      writes.push({ source_id: stepId, source_table: "game_steps", source_field: field, text });
    }

    // ── Hint synthetic (source_id = hint-{gameId}-{stepOrder}-{idx}) ──
    // V5 produit un seul hint par stop dans le TranslationResult, donc idx=0.
    // Pattern aligné sur game-package.ts ligne 325 (`hint-${gameId}-${step_order}-${idx}`).
    if (typeof stop.hint === "string" && stop.hint.trim()) {
      writes.push({
        source_id: `hint-${gameId}-${stop.step_order}-0`,
        source_table: "game_steps",
        source_field: "hint_text",
        text: stop.hint,
      });
    }
  }

  let okCount = 0;
  let errCount = 0;
  const errors: string[] = [];
  for (const w of writes) {
    const { error } = await s.from("translations_cache").upsert(
      {
        source_id: w.source_id,
        source_table: w.source_table,
        source_field: w.source_field,
        language: translation.language,
        translated_text: w.text,
      },
      { onConflict: "source_id,source_field,language" },
    );
    if (error) {
      errCount++;
      if (errors.length < 3) errors.push(`${w.source_field}/${w.source_table}: ${error.message}`);
    } else okCount++;
  }
  if (errCount > 0) {
    console.warn(
      `[v5 persist] translations_cache (${translation.language}): ${okCount} ok, ${errCount} errors. First: ${errors.join(" | ")}`,
    );
  } else {
    console.log(`[v5 persist] translations_cache (${translation.language}): ${okCount} entries written`);
  }
}

// ─────────────────────────────────────────────────────────────
// STEP 8 — Persist audios (chemin Storage + cache)
// ─────────────────────────────────────────────────────────────

export async function persistAudios(gameId: string, audio: AudioResult): Promise<void> {
  const s = getClient();
  let errors = 0;
  for (const f of audio.files) {
    const { error } = await s.from("audio_cache").upsert(
      {
        game_id: gameId,
        step_order: f.stepOrder || null,
        language: audio.language,
        slot: f.slot,
        storage_path: f.storagePath,
        public_url: f.publicUrl,
        byte_size: f.duration ? null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_id,step_order,language,slot" },
    );
    if (error) errors++;
  }
  if (errors > 0) console.warn(`[v5 persist] audio_cache : ${errors} errors`);
}

// ─────────────────────────────────────────────────────────────
// STEP 9 — Create activation code (idempotent)
// ─────────────────────────────────────────────────────────────

/**
 * Crée un code activation pour ce game ET ce buyer — IDEMPOTENT.
 *
 * Avant 2026-05-26 : insertion brute sans order_id / buyer_email.
 * Conséquence : OddballTrip appelait ensuite `/api/external/generate-code`
 * dont l'idempotency check (orderId + buyerEmail) ne trouvait PAS le code
 * V5 (puisque ces colonnes étaient NULL) → un 2ème code était créé pour
 * le même achat (cf Bouillon 26/05 : L-HE-YS6R-8XYS V5 + BOUI-GTUG-PJS3
 * external). Le client recevait celui d'OddballTrip, le V5 restait
 * orphelin en DB → pollution + risque de confusion opérateur.
 *
 * Fix : on aligne EXACTEMENT sur la logique de `external/generate-code`
 *   1. Si orderId fourni → check (game_id, order_id). Si existe → return.
 *   2. Sinon, fallback (game_id, buyer_email) dans 1h. Si existe → return.
 *   3. Sinon → insert avec order_id + buyer_email pour que le PROCHAIN
 *      appel (OddballTrip après notre callback) trouve ce code et le
 *      renvoie au lieu d'en créer un nouveau.
 */
export async function createActivationCode(
  gameId: string,
  input: PipelineInput,
): Promise<string> {
  const s = getClient();

  // ── 1. Idempotency par orderId (clé canonique) ──
  if (input.orderId) {
    const { data: existing, error: lookupErr } = await s
      .from("activation_codes")
      .select("code")
      .eq("game_id", gameId)
      .eq("order_id", input.orderId)
      .limit(1)
      .maybeSingle();
    // Si la colonne order_id n'existe pas (migration 022 pas appliquée),
    // on tombera dans le catch — on continue vers le fallback email.
    if (!lookupErr && existing?.code) {
      console.log(
        `[v5 createActivationCode] IDEMPOTENT return code=${existing.code} (orderId=${input.orderId})`,
      );
      return existing.code;
    }
  }

  // ── 2. Fallback idempotency par (game_id, buyer_email) dans 1h ──
  if (input.buyerEmail) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent, error: fbErr } = await s
      .from("activation_codes")
      .select("code, created_at")
      .eq("game_id", gameId)
      .eq("buyer_email", input.buyerEmail)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!fbErr && recent?.code) {
      console.log(
        `[v5 createActivationCode] IDEMPOTENT FALLBACK code=${recent.code} (email=${input.buyerEmail}, recent=${recent.created_at})`,
      );
      return recent.code;
    }
  }

  // ── 3. Pas de code existant → on en crée un. ──
  // Le préfixe = 4 chars du slug pour traçabilité (ex: BOUI-, AGRI-...).
  const cityPart = input.slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
  const r1 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const r2 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const code = `${cityPart}-${r1}-${r2}`;
  const expires = new Date(Date.now() + CONFIG.CODE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const payload: Record<string, unknown> = {
    code,
    game_id: gameId,
    team_name: input.buyerEmail?.split("@")[0] ?? "Buyer",
    expires_at: expires.toISOString(),
    is_single_use: true,
    max_uses: 1,
    buyer_email: input.buyerEmail ?? null,
  };
  // N'ajoute order_id que si présent — résilient si la colonne n'existe
  // pas (migration 022). Si l'INSERT échoue à cause de order_id, on
  // retire et on retente une fois.
  if (input.orderId) payload.order_id = input.orderId;

  let { error } = await s.from("activation_codes").insert(payload);

  if (error && /column.*order_id|order_id.*does not exist/i.test(error.message)) {
    console.warn(
      `[v5 createActivationCode] order_id column missing — retry without it (migration 022 not applied)`,
    );
    delete payload.order_id;
    const retry = await s.from("activation_codes").insert(payload);
    error = retry.error;
  }
  if (error && /column.*buyer_email|buyer_email.*does not exist/i.test(error.message)) {
    console.warn(
      `[v5 createActivationCode] buyer_email column missing — retry without it`,
    );
    delete payload.buyer_email;
    const retry = await s.from("activation_codes").insert(payload);
    error = retry.error;
  }
  if (error) throw new Error(`createActivationCode: ${error.message}`);

  console.log(
    `[v5 createActivationCode] CREATED code=${code} for gameId=${gameId.slice(0, 8)} order=${input.orderId ?? "—"} email=${input.buyerEmail ?? "—"}`,
  );
  return code;
}

// ─────────────────────────────────────────────────────────────
// STEP 10 — Publish game
// ─────────────────────────────────────────────────────────────

export async function publishGame(gameId: string): Promise<void> {
  const s = getClient();
  const { error } = await s
    .from("games")
    .update({ is_published: true, needs_review: false, updated_at: new Date().toISOString() })
    .eq("id", gameId);
  if (error) throw new Error(`publishGame: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────
// STEP 11 — Callback OddballTrip
// ─────────────────────────────────────────────────────────────

export async function notifyOddballTrip(
  input: PipelineInput,
  gameId: string,
  code: string,
): Promise<void> {
  if (!input.callbackUrl || !input.callbackSecret) return;
  try {
    const res = await fetch(input.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.callbackSecret}`,
      },
      body: JSON.stringify({
        slug: input.slug,
        gameId,
        code,
        orderId: input.orderId,
        language: input.language,
      }),
    });
    if (!res.ok) {
      console.warn(`[v5 callback] OddballTrip non-2xx: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[v5 callback] failed (non-blocking): ${e instanceof Error ? e.message : "?"}`);
  }
}

// ─────────────────────────────────────────────────────────────
// HALT — set needs_review on game (en cas d'échec de l'un des steps)
// ─────────────────────────────────────────────────────────────

export async function haltForReview(gameId: string, reason: string): Promise<void> {
  const s = getClient();
  await s
    .from("games")
    .update({
      is_published: false,
      needs_review: true,
      review_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
}
