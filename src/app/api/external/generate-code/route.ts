import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateApiKey,
  generateActivationCode,
  corsHeaders,
} from "@/lib/external-auth";
import { sendCodeGenerationFailureAlert } from "@/lib/email";
import { prepareGamePackage } from "@/lib/game-package";

/**
 * Pre-generation de text + audio prend 4-6 min pour un nouveau (game × lang)
 * (8 stops × 3 slots × ~5 sec ElevenLabs + traductions Claude/Gemini).
 *
 * Mode synchrone : on AWAIT la fin de prepareGamePackage avant de
 * répondre à oddballtrip → oddballtrip envoie l'email au client
 * UNIQUEMENT quand tout est en DB → expérience joueur sans latence.
 *
 * 600 sec (10 min) = marge confortable au-dessus du pire cas observé
 * (296 sec sur Rothenburg). Vercel Pro autorise 900 sec, on reste
 * sous le plafond.
 *
 * Côté oddballtrip : leur HTTP timeout sur cette route doit être
 * ≥ 10 min. Si c'est un webhook Stripe ils ont 30 min par défaut.
 */
export const maxDuration = 600;

/**
 * OPTIONS /api/external/generate-code
 * Handle CORS preflight requests.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/** Extract plain text from a title that may be a JSONB object or string */
function extractTitle(title: unknown, lang = "en"): string {
  if (typeof title === "string") {
    try {
      const parsed = JSON.parse(title);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed[lang] || parsed.en || parsed.fr || Object.values(parsed)[0] || title;
      }
    } catch {
      // Not JSON, use as-is
    }
    return title;
  }
  if (typeof title === "object" && title !== null) {
    const obj = title as Record<string, string>;
    return obj[lang] || obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(title || "");
}

/**
 * POST /api/external/generate-code
 * Called by oddballtrip.com after a purchase to generate an activation code.
 *
 * Headers:
 *   Authorization: Bearer {EXTERNAL_API_SECRET}
 *
 * Body:
 *   {
 *     gameId: string,                 // required
 *     buyerEmail: string,             // required
 *     buyerName?: string,
 *     orderId?: string,
 *     language?: string               // 2-letter ISO code (fr|en|de|es|it|pt|...|ja|ko|zh|...)
 *                                     // If provided, app pre-generates text translations + ElevenLabs audio
 *                                     // for this game in this language. Adds 30-60s to the response on the
 *                                     // first sale of a (game × language) pair (cached forever after).
 *   }
 *
 * Returns:
 *   {
 *     code: string,
 *     gameTitle: string,
 *     gameCity: string,
 *     activationUrl: string,          // includes ?lang=<language> if language was passed
 *     audio?: {
 *       prepared: boolean,
 *       generated: number,
 *       skipped: number,
 *       failed: number,
 *       durationMs: number,
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Clé API invalide ou manquante" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { gameId, buyerEmail, buyerName, orderId } = body;
    const rawLanguage =
      typeof body.language === "string" ? body.language.toLowerCase().trim() : null;
    // Accept a wider set de locale formats et normalise vers ISO 639-1
    // (2-letter base) :
    //   "fr"     → "fr"
    //   "fr-FR"  → "fr"  (BCP-47, courant Stripe + navigateurs)
    //   "fr_FR"  → "fr"
    //   "FR"     → "fr"  (toLowerCase déjà fait)
    //   "fra", "english", "" → null (rejet)
    //
    // Avant : regex strict /^[a-z]{2}$/ rejetait "fr-FR" → language=null
    // → prepareGamePackage skippé → joueur subissait lazy gen en jeu.
    const langMatch = rawLanguage
      ? rawLanguage.match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/)
      : null;
    const language = langMatch ? langMatch[1] : null;

    if (!gameId) {
      return NextResponse.json(
        { error: "Le champ gameId est requis" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!buyerEmail) {
      return NextResponse.json(
        { error: "Le champ buyerEmail est requis" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createAdminClient();

    // Verify the game exists
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, title, city")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json(
        { error: "Jeu introuvable avec cet identifiant" },
        { status: 404, headers: corsHeaders }
      );
    }

    // ─── IDEMPOTENCY ──────────────────────────────────────────────────
    // Stratégie à 2 niveaux + bypass admin :
    //   0. BYPASS : si body.forceNewCode === true, on skip toute idempotency
    //      et on crée toujours un nouveau code. Utile pour les générations
    //      MANUELLES depuis l'admin oddballtrip (pas de retour Stripe, pas
    //      d'orderId stable, et tu veux pouvoir retester sans réutiliser
    //      l'ancien code).
    //   1. PRIMAIRE : orderId si fourni — la clé canonique. Si oddballtrip
    //      retry (timeout HTTP, webhook Stripe re-envoyé) avec le même
    //      orderId, on renvoie le code existant.
    //   2. FALLBACK : si orderId absent (cas observé en prod 2026-05-07
    //      où oddballtrip poll/retry sans orderId, créant 2-4 codes par
    //      achat), on cherche un code récent (< 1h) sur (game_id, buyer_email).
    //      Couvre 99 % des retries automatiques sans pénaliser les rachats
    //      légitimes (un client qui rachète le même jeu plus d'1h après
    //      reçoit un nouveau code).
    //
    // RÉSILIENCE : si la migration 022 (colonne order_id) n'est pas
    // appliquée, on tombe direct sur le fallback (game_id, buyer_email).
    let finalCode: string | null = null;
    let isIdempotentReturn = false;
    let idempotencySource: "order_id" | "email_window" | null = null;
    let orderIdColumnAvailable = true;
    const forceNewCode = body.forceNewCode === true;
    if (forceNewCode) {
      console.log(
        `[external/generate-code] forceNewCode=true — bypass idempotency, will create a fresh code (manual admin generation)`,
      );
    }
    if (!forceNewCode && orderId && typeof orderId === "string" && orderId.trim()) {
      const { data: existing, error: lookupError } = await supabase
        .from("activation_codes")
        .select("code")
        .eq("game_id", gameId)
        .eq("order_id", orderId)
        .limit(1)
        .maybeSingle();
      if (lookupError && /column.*does not exist|order_id/i.test(lookupError.message)) {
        // Migration 022 pas encore appliquée — fallback legacy
        orderIdColumnAvailable = false;
        console.warn(
          `[external/generate-code] migration 022 not applied — column order_id missing. Falling back to (game_id, buyer_email) window.`,
        );
      } else if (existing?.code) {
        finalCode = existing.code;
        isIdempotentReturn = true;
        idempotencySource = "order_id";
        console.log(
          `[external/generate-code] IDEMPOTENT return code=${finalCode} for orderId=${orderId} (already exists)`,
        );
      }
    }

    // FALLBACK idempotency : (game_id, buyer_email) avec fenêtre 1h.
    // Ne s'active que si le check orderId n'a rien remonté ET que
    // forceNewCode n'est pas activé.
    if (!forceNewCode && !finalCode && buyerEmail) {
      const FALLBACK_WINDOW_MS = 60 * 60 * 1000; // 1h
      const since = new Date(Date.now() - FALLBACK_WINDOW_MS).toISOString();
      const { data: recent, error: fallbackError } = await supabase
        .from("activation_codes")
        .select("code, created_at")
        .eq("game_id", gameId)
        .eq("buyer_email", buyerEmail)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackError) {
        console.warn(
          `[external/generate-code] fallback idempotency lookup failed: ${fallbackError.message} — proceeding with new code`,
        );
      } else if (recent?.code) {
        finalCode = recent.code;
        isIdempotentReturn = true;
        idempotencySource = "email_window";
        console.log(
          `[external/generate-code] IDEMPOTENT FALLBACK code=${finalCode} for game=${gameId.slice(0, 8)} email=${buyerEmail} (recent code from ${recent.created_at}). orderId was ${orderId || "MISSING — oddballtrip should send a stable orderId to avoid relying on this fallback"}.`,
        );
      }
    }

    // Generate + insert only si on n'a pas trouvé de code existant.
    if (!finalCode) {
      const code = generateActivationCode(game.city);
      const insertPayload: Record<string, unknown> = {
        code,
        game_id: gameId,
        is_single_use: true,
        max_uses: 1,
        current_uses: 0,
        team_name: buyerName || null,
        buyer_email: buyerEmail,
        // expires_at stays null — set to now+8h upon activation
      };
      // N'inclut order_id que si la colonne est disponible (migration
      // 022 appliquée). Sinon Postgres rejette toute la query.
      if (orderIdColumnAvailable && orderId) {
        insertPayload.order_id = orderId;
      }
      let { error: insertError } = await supabase
        .from("activation_codes")
        .insert(insertPayload);

      // Si l'insert échoue à cause de order_id (colonne inexistante),
      // on retire le champ et on retente.
      if (insertError && /column.*order_id|order_id.*does not exist/i.test(insertError.message)) {
        console.warn(
          `[external/generate-code] order_id column missing on INSERT — retrying without it`,
        );
        delete insertPayload.order_id;
        orderIdColumnAvailable = false;
        const retry = await supabase.from("activation_codes").insert(insertPayload);
        insertError = retry.error;
      }

      finalCode = code;

      if (insertError) {
        // Code collision (extremely unlikely) — retry once with new code
        const retryCode = generateActivationCode(game.city);
        const retryPayload: Record<string, unknown> = {
          ...insertPayload,
          code: retryCode,
        };
        const { error: retryError } = await supabase
          .from("activation_codes")
          .insert(retryPayload);

        if (retryError) {
          console.error("Erreur insertion code:", retryError);
          await sendCodeGenerationFailureAlert({
            gameId,
            gameCity: game.city,
            buyerEmail,
            error: retryError.message,
            orderId,
          });
          return NextResponse.json(
            { error: "Impossible de créer le code d'activation" },
            { status: 500, headers: corsHeaders }
          );
        }
        finalCode = retryCode;
      }
    }

    // Log buyer info for traceability. On expose AUSSI la valeur brute
    // de body.language pour diagnostiquer les cas où l'opérateur amont
    // envoie un format non-standard (BCP-47 "fr-FR", "fra", "english"...)
    // qu'on ne capture pas et qui fait skipper prepareGamePackage.
    console.log(
      `[external/generate-code] code=${finalCode} game=${game.city} email=${buyerEmail} order=${orderId || "N/A"} lang=${language || "—"} raw="${body.language ?? ""}" idempotent=${isIdempotentReturn}`
    );

    // ─── Pre-generation SYNCHRONE ────────────────────────────────────
    // On AWAIT prepareGamePackage avant de répondre. oddballtrip
    // recevra la réponse uniquement quand TOUT est en DB (texts +
    // audios + traductions). Conséquence : oddballtrip envoie l'email
    // au client UNIQUEMENT quand le jeu est 100% prêt → joueur a
    // zéro latence à l'arrivée.
    //
    // Latence observée : 4-6 min. maxDuration de la route est 600s
    // (10 min) pour absorber sans risque. oddballtrip doit avoir un
    // HTTP timeout ≥ 10 min côté caller (webhook Stripe = 30 min par
    // défaut, donc OK).
    //
    // Précédente version BACKGROUND (after()) ne tenait pas — Vercel
    // tuait l'invocation avant la fin de la génération audio. Le code
    // partait au client avant que les audios soient en DB → mauvaise
    // expérience.
    let audioReport:
      | {
          prepared: boolean;
          generated: number;
          skipped: number;
          failed: number;
          durationMs: number;
        }
      | undefined;
    if (language) {
      try {
        const result = await prepareGamePackage(gameId, language);
        audioReport = {
          prepared: result.success,
          generated: result.audioGenerated,
          skipped: result.audioSkipped,
          failed: result.audioFailed,
          durationMs: result.durationMs,
        };
        if (result.errors.length > 0) {
          console.error(
            `[external/generate-code] package errors for ${gameId}/${language}:`,
            result.errors,
          );
        } else {
          console.log(
            `[external/generate-code] package done for ${gameId}/${language} — gen=${result.audioGenerated}, skip=${result.audioSkipped}, fail=${result.audioFailed}, ${Math.round(result.durationMs / 1000)}s`,
          );
        }
      } catch (err) {
        // Audio prep failure must NOT block code delivery — le joueur
        // peut toujours jouer avec Web Speech fallback. Log + continue.
        console.error(
          `[external/generate-code] package crashed for ${gameId}/${language}:`,
          err,
        );
        audioReport = {
          prepared: false,
          generated: 0,
          skipped: 0,
          failed: 0,
          durationMs: 0,
        };
      }
    }

    // Activation URL pre-fills the language so the player lands directly
    // in the right locale (no language picker step on first visit).
    const activationBase = "https://escape-game-indol.vercel.app";
    const activationUrl = language
      ? `${activationBase}?code=${finalCode}&lang=${language}`
      : `${activationBase}?code=${finalCode}`;

    return NextResponse.json(
      {
        code: finalCode,
        gameTitle: extractTitle(game.title),
        gameCity: game.city,
        activationUrl,
        // Stats détaillées de la prep audio (synchrone) : si prepared:
        // false ou failed > 0, oddballtrip peut décider de retarder
        // l'envoi de l'email ou prévenir l'admin.
        ...(audioReport && { audio: audioReport }),
        // Idempotency flag : true si le code retourné existait déjà
        // pour ce orderId (réponse à un retry du caller).
        idempotent: isIdempotentReturn,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("[external/generate-code] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500, headers: corsHeaders }
    );
  }
}

