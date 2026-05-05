import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateApiKey,
  generateActivationCode,
  corsHeaders,
} from "@/lib/external-auth";
import { sendCodeGenerationFailureAlert } from "@/lib/email";
import { prepareGamePackage } from "@/lib/game-package";

/**
 * Pre-generation of text + audio takes 30-60s for one new (game × lang).
 * Vercel default function timeout is 10s on Hobby, 60s on Pro. Bump to
 * 5 minutes — synchronous flow lets the merchant know everything is
 * ready before they email the customer.
 */
export const maxDuration = 300;

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

    // ─── IDEMPOTENCY by orderId ──────────────────────────────────────
    // Si oddballtrip retry (timeout HTTP, webhook Stripe re-envoyé) avec
    // le même orderId pour le même jeu, on RENVOIE LE CODE EXISTANT au
    // lieu d'en créer un nouveau. Évite les codes orphelins en DB.
    //
    // L'idempotence n'est appliquée QUE si orderId est fourni — sans
    // orderId, comportement legacy (nouveau code à chaque appel).
    let finalCode: string | null = null;
    let isIdempotentReturn = false;
    if (orderId && typeof orderId === "string" && orderId.trim()) {
      const { data: existing } = await supabase
        .from("activation_codes")
        .select("code")
        .eq("game_id", gameId)
        .eq("order_id", orderId)
        .limit(1)
        .maybeSingle();
      if (existing?.code) {
        finalCode = existing.code;
        isIdempotentReturn = true;
        console.log(
          `[external/generate-code] IDEMPOTENT return code=${finalCode} for orderId=${orderId} (already exists)`,
        );
      }
    }

    // Generate + insert only si on n'a pas trouvé de code existant.
    if (!finalCode) {
      const code = generateActivationCode(game.city);
      const { error: insertError } = await supabase
        .from("activation_codes")
        .insert({
          code,
          game_id: gameId,
          is_single_use: true,
          max_uses: 1,
          current_uses: 0,
          team_name: buyerName || null,
          buyer_email: buyerEmail,
          order_id: orderId || null,
          // expires_at stays null — set to now+8h upon activation
        });

      finalCode = code;

      if (insertError) {
        // Code collision (extremely unlikely) — retry once
        const retryCode = generateActivationCode(game.city);
        const { error: retryError } = await supabase
          .from("activation_codes")
          .insert({
            code: retryCode,
            game_id: gameId,
            is_single_use: true,
            max_uses: 1,
            current_uses: 0,
            team_name: buyerName || null,
            buyer_email: buyerEmail,
            order_id: orderId || null,
          });

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

    // ─── Pre-generation EN ARRIÈRE-PLAN ──────────────────────────────
    // AVANT : on awaitait prepareGamePackage avant de répondre. Ça
    // prenait 30-60 sec → oddballtrip timeout (HTTP fetch < 30s) →
    // retry → nouveau code créé → on s'est retrouvé avec 5 codes
    // orphelins par achat sur Rouen.
    //
    // MAINTENANT : on lance prepareGamePackage en BACKGROUND (Next.js
    // `after()` qui exécute après la réponse HTTP renvoyée). La
    // réponse part en ~1-2 sec → oddballtrip ne timeout plus → 1 seul
    // code par achat. Audios prêts ~30-60 sec après l'envoi de
    // l'email au client (qui met de toute façon plus longtemps que
    // ça avant de cliquer le lien).
    //
    // Si l'idempotence kick (code déjà existant), on relance quand
    // même prepareGamePackage en background — il sera idempotent
    // côté audio_cache (skip ce qui existe déjà) donc no-op si déjà
    // prêt, ou rattrape si la première tentative avait foiré.
    if (language) {
      after(
        prepareGamePackage(gameId, language)
          .then((result) => {
            if (result.errors.length > 0) {
              console.error(
                `[external/generate-code] background package errors for ${gameId}/${language}:`,
                result.errors,
              );
            } else {
              console.log(
                `[external/generate-code] background package done for ${gameId}/${language} — gen=${result.audioGenerated}, skip=${result.audioSkipped}, fail=${result.audioFailed}, ${Math.round(result.durationMs / 1000)}s`,
              );
            }
          })
          .catch((err) => {
            console.error(
              `[external/generate-code] background package crashed for ${gameId}/${language}:`,
              err,
            );
          }),
      );
    }
    // audioReport n'est plus disponible en sortie (background) — on
    // signale l'état via `audioPrepStatus` côté response.
    const audioPrepStatus: "queued" | "skipped" =
      language ? "queued" : "skipped";

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
        // Indique au caller (oddballtrip) si la prep audio est en
        // background (queued) ou skipped (pas de language fourni).
        // L'ancien `audio` (avec stats détaillées) n'est plus dispo
        // car le calcul se fait après la réponse — on aurait pu
        // exposer un endpoint /audio-status mais YAGNI tant que
        // oddballtrip n'en a pas besoin.
        audioPrepStatus,
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

