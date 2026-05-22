/**
 * API Route: POST /api/generate-game
 *
 * Triggers the full game generation pipeline:
 * Perplexity (research) → Claude (creation) → Supabase (storage)
 *
 * Can be called by:
 * - Admin dashboard (manual generation)
 * - Stripe webhook (automatic on purchase)
 * - External API with auth
 *
 * Body: {
 *   city: string,
 *   country: string,
 *   theme: string,
 *   themeDescription: string,
 *   narrative: string,
 *   difficulty?: number (1-5, default 3),
 *   estimatedDurationMin?: number (default 90),
 *   coverImage?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateGameFromTemplate,
  type GameTemplate,
} from "@/lib/game-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPipelineFailureAlert, sendNeedsReviewAlert } from "@/lib/email";
import { parseGenre } from "@/lib/game-genres";
import { inngest } from "@/lib/inngest-client";
import { validateOddballtripContract } from "@/lib/oddballtrip-contract";

// Pipeline can take 5-13 minutes (Perplexity deep research + Gemini Pro
// grounded research + patrimonial fill + multiple Claude calls + audio).
// 2026-05-16 — bumped 600 → 800 (Vercel Pro max) après timeout Aegina.
export const maxDuration = 800;

export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    // Verify authorization
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    body = await request.json();
    console.log("[GenerateGame] Received body:", JSON.stringify({
      city: body.city, country: body.country, theme: body.theme,
      hasThemeDesc: !!body.themeDescription, hasNarrative: !!body.narrative,
      stopsCount: body.stops?.length, slug: body.slug,
      hasCallback: !!body.callbackUrl,
      hasStartPoint: !!body.startPoint,
      language: body.language || "(none)",
      buyerEmail: body.buyerEmail || "N/A",
      accessibility: body.accessibility || "(default any)",
      transportMode: body.transportMode || "(default walking)",
      radiusKm: body.radiusKm ?? "(default per mode)",
      recommendedDays:
        typeof body.recommendedDaysMin === "number" || typeof body.recommendedDaysMax === "number"
          ? `${body.recommendedDaysMin ?? "?"}-${body.recommendedDaysMax ?? "?"}d`
          : "(walking)",
      seedSitesCount: Array.isArray(body.roadtripSeedSites) ? body.roadtripSeedSites.length : 0,
      // 2026-05-20 — log mode pour débug dual-SKU (audioguide vs escape).
      // Quand OddballTrip envoie mode='city_tour' on doit le voir ici ;
      // si "(MISSING from payload)" → leur conditional spread n'a pas
      // fired et la pipeline tombe en default city_game.
      mode: body.mode ?? "(MISSING from payload)",
    }));

    // ──────────────────────────────────────────────────────────────
    // Contract validation (2026-05-21) — Zod schema + soft warnings.
    // Hard errors return 400 with structured details. Soft warnings
    // are LOGGED + returned in the 202 response so OddballTrip dev
    // can see drift over time without their pipeline being blocked.
    // ──────────────────────────────────────────────────────────────
    const contractCheck = validateOddballtripContract(body);
    if (!contractCheck.ok) {
      console.error(
        `[GenerateGame] CONTRACT VIOLATION: ${contractCheck.errors?.length ?? 0} errors`,
        contractCheck.errors,
      );
      return NextResponse.json(
        {
          error:
            "Contract validation failed. Inspect `errors` for the specific fields.",
          errors: contractCheck.errors,
        },
        { status: 400 },
      );
    }
    if (contractCheck.warnings.length > 0) {
      console.warn(
        `[GenerateGame] ⚠ CONTRACT WARNINGS (${contractCheck.warnings.length}) — pipeline tolerates but OddballTrip should fix:`,
        contractCheck.warnings,
      );
    }

    // Validate required fields (legacy explicit check, kept as defensive
    // belt-and-suspenders after Zod already enforced presence).
    const { city, country, theme, themeDescription, narrative } = body;

    if (!city || !country || !theme || !themeDescription || !narrative) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          required: [
            "city",
            "country",
            "theme",
            "themeDescription",
            "narrative",
          ],
        },
        { status: 400 }
      );
    }

    // Parse predefined stops from oddballtrip. The new contract adds
    // an optional `landmarkName` field per stop — the real building
    // name used by the pipeline to fetch authoritative GPS coords
    // (sub-10 m via Google Places). When missing, the pipeline falls
    // back to geocoding `name`, which works only when `name` happens
    // to be a real, findable landmark (likely fails on poetic names).
    const stops = Array.isArray(body.stops)
      ? body.stops
          .filter((s: { name?: string }) => s?.name?.trim())
          .map(
            (s: {
              name: string;
              landmarkName?: string;
              description?: string;
            }) => ({
              name: s.name.trim(),
              landmarkName: s.landmarkName?.trim() || undefined,
              description: s.description?.trim() || "",
            }),
          )
      : undefined;

    // Point de départ du parcours. CONTRAT: oddballtrip dispose du
    // startPoint dans chaque fiche de jeu et DOIT le transmettre.
    // Post-refonte Phase 12 (2026-05-07), TOUTES les fiches DB ont un
    // startPoint correct géocodé sub-degré. La validation ci-dessous
    // rejette précocement les payloads malformés.
    //
    // Accepte plusieurs formats au cas où l'amont varie :
    //   { lat, lon } | { latitude, longitude } | { lat, lng }
    let startPoint: { lat: number; lon: number } | undefined;
    if (body.startPoint && typeof body.startPoint === "object") {
      const sp = body.startPoint as Record<string, unknown>;
      const lat = typeof sp.lat === "number" ? sp.lat : typeof sp.latitude === "number" ? sp.latitude : null;
      const lon = typeof sp.lon === "number" ? sp.lon : typeof sp.longitude === "number" ? sp.longitude : typeof sp.lng === "number" ? sp.lng : null;
      if (lat !== null && lon !== null) {
        // Validation pre-discovery : reject 400 sur lat/lon hors range
        // ou null-island absurde (lat=0,lon=0 hors zone Greenwich).
        // Coupe net les payloads cassés AVANT de payer Perplexity/Claude.
        const isPrimeMeridianGreenwich =
          lon === 0 && lat >= 51.45 && lat <= 51.5;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return NextResponse.json(
            {
              error: "Invalid startPoint coords (lat or lon out of range)",
              startPoint: { lat, lon },
            },
            { status: 400 },
          );
        }
        if ((lat === 0 || lon === 0) && !isPrimeMeridianGreenwich) {
          return NextResponse.json(
            {
              error: "Invalid startPoint coords (null-island 0,0 likely a bug — only Greenwich Royal Observatory is allowed at lon=0)",
              startPoint: { lat, lon },
            },
            { status: 400 },
          );
        }
        startPoint = { lat, lon };
      } else {
        console.warn(
          `[GenerateGame] ⚠ body.startPoint provided but missing lat/lon (got keys: ${Object.keys(sp).join(",")}) — ignoring, fallback to first geocoded stop`,
        );
      }
    } else {
      console.warn(
        `[GenerateGame] ⚠ MISSING startPoint in payload — oddballtrip must transmit { startPoint: { lat, lon } } on every request. Falling back to first geocoded operator stop, which is approximate.`,
      );
    }

    // Description textuelle du checkpoint envoyée par oddballtrip — accepte
    // plusieurs noms de champs pour robustesse (en attendant un contrat
    // unifié). Le pipeline géocode ce texte comme source d'autorité PRÉCISE
    // (parvis, fontaine, place exacte) avant de tomber sur le city center.
    const startPointText: string | undefined = (() => {
      const candidates = [
        body.startPointText,
        body.startPointDescription,
        body.meetingPoint,
        body.checkpoint,
        body.meetingLocation,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim().length > 0) return c.trim();
      }
      return undefined;
    })();

    const template: GameTemplate = {
      slug:
        body.slug ||
        `${city.toLowerCase().replace(/\s+/g, "-")}-${theme.toLowerCase().replace(/\s+/g, "-")}`,
      city,
      country,
      theme,
      themeDescription,
      narrative,
      difficulty: body.difficulty || 3,
      estimatedDurationMin: body.estimatedDuration || body.estimatedDurationMin || 90,
      coverImage: body.coverImage || null,
      startPointText,
      // body.stops est silencieusement ignoré par le pipeline intent-first
      // (cf. game-pipeline.ts) — on le passe quand même au template pour
      // que le log "ignored" se déclenche dans la pipeline et que oddballtrip
      // voit qu'on a reçu mais pas utilisé.
      stops,
      startPoint,
      // stopCount : combien de landmarks Perplexity doit produire.
      //
      // 2026-05-13 — FORCE 9 par défaut. Avant, on prenait body.stops?.length
      // en fallback ce qui revenait à 6 pour les fiches OddballTrip qui
      // envoient encore le legacy `stops[]` array avec 6 entrées.
      // Résultat observé : Cambridge 6 stops, Aegina 6, Lugdunum 6,
      // Alcázar 6 — TOUS au plancher au lieu du sweet spot 9.
      //
      // Désormais : body.stops[] est SILENCIEUSEMENT IGNORÉ pour la
      // détermination du stopCount (il l'était déjà pour la discovery,
      // cf. game-pipeline.ts). Seul body.stopCount EXPLICITE peut
      // forcer une valeur autre que 9.
      //
      // La pipeline clamp ensuite [6, 9] dans game-pipeline.ts.
      // Le widening progressif (1x, 1.5x, 2.5x) tente d'atteindre 9
      // même sur zones sparses avant de redescendre vers le floor 6.
      stopCount:
        typeof body.stopCount === "number"
          ? body.stopCount
          : 9,
      // language : code ISO 2 lettres ("fr", "en", "de"...). Si présent,
      // le pipeline pré-génère TOUS les audios + traductions dans cette
      // langue après l'insert DB. Si absent, log warning + lazy gen
      // pendant la session (latence joueur).
      //
      // Accepte ISO 639-1 + BCP-47 + locale variants :
      //   "fr"     → "fr"
      //   "fr-FR"  → "fr"  (Stripe / browsers)
      //   "fr_FR"  → "fr"
      //   "FR"     → "fr"
      // Tout le reste → undefined → fallback warning + lazy gen.
      language: (() => {
        if (typeof body.language !== "string") return undefined;
        const m = body.language.toLowerCase().trim().match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/);
        return m ? m[1] : undefined;
      })(),
      // genre : tonalité narrative choisie par l'opérateur (historical,
      // fantasy, mystery, romance, supernatural, espionnage, cinema,
      // fairytale). Fallback `historical` si absent ou invalide. MVP en
      // mémoire — pas de col DB ; cf. game-genres.ts.
      genre: parseGenre(body.genre),
      // accessibility : "free" force la pipeline à exclure les POIs
      // payants (musées, galeries) du parcours, pour fiches "balade
      // gratuite Klook" et marché price-sensitive. Tout autre valeur
      // (incluant absent) → "any" (comportement historique).
      // Stripped si valeur invalide pour éviter qu'oddballtrip envoie
      // accidentellement "true"/"yes" et que la pipeline surface une
      // erreur cryptique. cf. game-pipeline.ts pour la logique.
      accessibility: body.accessibility === "free" ? "free" : "any",
      // S9 (2026-05-18) — type de produit :
      //   "city_game" (default) : escape game classique
      //   "city_tour"          : audioguide enrichi (Lume — narration
      //                          encyclopédique, AR conservée pour
      //                          orientation, pas d'énigmes ni code final)
      // OddballTrip/Lume peuvent désormais distinguer leurs catalogues
      // au moment de la commande.
      mode: body.mode === "city_tour" ? "city_tour" : "city_game",
      // ── ROADTRIP (contrat OddballTrip 2026-05-10) ────────────────
      // Tous les champs ci-dessous sont rétrocompat : si absents ou si
      // transportMode === "walking", la pipeline tourne EXACTEMENT
      // comme avant. Pas de changement sur les fiches walking actives.
      transportMode: (() => {
        const m = body.transportMode;
        return m === "driving" || m === "mixed" ? m : "walking";
      })(),
      radiusKm: (() => {
        const r = body.radiusKm;
        if (typeof r !== "number" || r <= 0) return undefined;
        // Hard cap 60 km : au-delà, le narratif ne tient plus (région
        // entière, joueur perd le fil thématique). On clip au passage
        // pour éviter qu'un payload cassé (radiusKm: 9999) corrompe
        // toute la discovery.
        return Math.min(r, 60);
      })(),
      recommendedDaysMin:
        typeof body.recommendedDaysMin === "number" && body.recommendedDaysMin >= 1
          ? Math.min(body.recommendedDaysMin, 14)
          : undefined,
      recommendedDaysMax:
        typeof body.recommendedDaysMax === "number" && body.recommendedDaysMax >= 1
          ? Math.min(body.recommendedDaysMax, 14)
          : undefined,
      roadtripSeedSites: Array.isArray(body.roadtripSeedSites)
        ? body.roadtripSeedSites
            .filter((s: { name?: string; access?: string }) =>
              s?.name?.trim() &&
              (s.access === "libre" || s.access === "payant" || s.access === "mixte"))
            .map((s: {
              name: string;
              access: "libre" | "payant" | "mixte";
              lat?: number;
              lon?: number;
              note?: string;
            }) => ({
              name: s.name.trim(),
              access: s.access,
              lat: typeof s.lat === "number" ? s.lat : undefined,
              lon: typeof s.lon === "number" ? s.lon : undefined,
              note: s.note?.trim() || undefined,
            }))
        : undefined,
    };

    // Note (2026-05-07) : les 3 maps d'override hardcodées (genre,
    // stopCount, startPoint) ont été supprimées suite à la refonte
    // Phase 12 d'oddballtrip qui produit désormais des fiches avec
    // les bons champs. La validation runtime (cluster centroid post-
    // discovery) attrape les cas exceptionnels en posant le flag
    // `games.needs_review` plutôt qu'en patchant à l'aveugle.

    // Idempotency : 2 cas couverts.
    //
    // CAS 1 — game publié (ANY age) :
    //   Customer rachète une même fiche → on retourne le game existant
    //   sans regen. Économise ~$2 + 10 min par achat répété.
    //
    // CAS 2 — game NON publié récent (< 1h) :
    //   OddballTrip retry sur le même slug pendant la fenêtre de
    //   génération → on retourne l'in-flight game. Évite les duplicates
    //   en pipeline. Observé Alcazar 12/05 (6 duplicates en 17 min,
    //   ~$10 brûlés).
    //
    // BUG ANTÉRIEUR (corrigé maintenant) :
    //   Le premier fix utilisait `gte(created_at, now - 1h)` SEUL, ce
    //   qui excluait les games publiés > 1h → relance d'un game déjà
    //   publié il y a 15h. Observé 13/05 08:08 sur splendeurs-de-l-alcazar.
    const supabase = createAdminClient();
    const recentCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // S9 (2026-05-19) — Idempotency MODE-AWARE.
    //
    // Bug rapporté Montpellier audioguide : OddballTrip utilise le MÊME
    // slug pour la variante escape ET la variante audioguide d'un même
    // parcours physique (cf. leur dev : "même slug, même parcours
    // physique, même table generated_games"). Sans le filtre mode dans
    // l'idempotency, une commande city_tour pour un slug déjà publié
    // en city_game retournait l'ID escape existant → joueur recevait
    // un escape game alors qu'il avait acheté un audioguide.
    //
    // Fix : on filtre désormais sur (slug, mode). Deux jeux peuvent
    // donc coexister pour le même slug à condition d'être de modes
    // différents. La table games n'a PAS de UNIQUE(slug) constraint
    // (cf. migration 005), donc rien ne bloque cette coexistence.
    const targetMode = template.mode ?? "city_game";

    // Case 1: published game of any age (priority), SAME mode
    const { data: publishedMatch } = await supabase
      .from("games")
      .select("id, is_published, created_at")
      .eq("slug", template.slug)
      .eq("mode", targetMode)
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(1);

    // Case 2: unpublished but recent game (anti-retry-storm), SAME mode
    const { data: recentUnpublished } = !publishedMatch?.[0]
      ? await supabase
          .from("games")
          .select("id, is_published, created_at")
          .eq("slug", template.slug)
          .eq("mode", targetMode)
          .eq("is_published", false)
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .limit(1)
      : { data: null };

    const existingGame = publishedMatch?.[0] || recentUnpublished?.[0];
    if (existingGame) {
      console.log(`[GenerateGame] Game already exists for slug "${template.slug}" + mode=${targetMode} → ${existingGame.id} (is_published=${existingGame.is_published}, created ${existingGame.created_at}) — returning existing instead of generating duplicate.`);

      // Still send callback so oddballtrip can process pending purchases
      if (body.callbackUrl) {
        try {
          await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && { Authorization: `Bearer ${body.callbackSecret}` }),
            },
            body: JSON.stringify({ gameId: existingGame.id, slug: template.slug }),
          });
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      return NextResponse.json(
        {
          success: true,
          gameId: existingGame.id,
          alreadyExists: true,
          message: `Game "${template.slug}" already exists`,
        },
        { status: 200 }
      );
    }

    // ════════════════════════════════════════════════════════════════
    // PIPELINE DISPATCH — sync (legacy) vs async (Inngest, recommended)
    // ════════════════════════════════════════════════════════════════
    //
    // Vision 2026-05-16 (post-Aegina timeout) : pour éviter que Vercel
    // ne kill la fonction à 800s alors que Gemini+Claude+ElevenLabs
    // tournent encore, on passe l'exécution dans Inngest qui n'a pas
    // de timeout function-level.
    //
    // Si USE_INNGEST_BUILD=true :
    //   - Emit "game/build.requested" → buildGameDurable consume
    //     (run generateGameFromTemplate + auto-emit "game/generate.requested"
    //      pour la post-insert pipeline)
    //   - Endpoint retourne 200 OK immédiat avec status="queued"
    //   - OddballTrip continue de poller find-game (déjà leur pattern)
    //
    // Si USE_INNGEST_BUILD!=true (legacy) :
    //   - Run generateGameFromTemplate inline (timeout 800s Vercel)
    //   - Path historique conservé pour rollback rapide
    if (process.env.USE_INNGEST_BUILD === "true") {
      try {
        await inngest.send({
          name: "game/build.requested",
          data: {
            slug: template.slug,
            title: template.theme,
            city: template.city,
            country: template.country,
            themeDescription: template.themeDescription,
            narrative: template.narrative,
            difficulty: template.difficulty,
            estimatedDurationMin: template.estimatedDurationMin,
            stopCount: template.stopCount,
            genre: template.genre,
            language: template.language,
            transportMode: template.transportMode,
            radiusKm: template.radiusKm,
            recommendedDaysMin: template.recommendedDaysMin,
            recommendedDaysMax: template.recommendedDaysMax,
            startPointText: template.startPointText,
            startPointLat: template.startPoint?.lat,
            startPointLon: template.startPoint?.lon,
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
            callbackUrl: body.callbackUrl,
            callbackSecret: body.callbackSecret,
            accessibility: template.accessibility,
            // S9 (2026-05-18) — propagate mode to durable pipeline
            mode: template.mode,
            // Sprint 6.2bis (2026-05-22) — persist OddballTrip's verbatim
            // payload for post-incident debugging. Strip nothing —
            // RLS already restricts games table to admins.
            originalPayload: body as Record<string, unknown>,
          },
        });
        console.log(
          `[GenerateGame] ASYNC mode: emitted game/build.requested for slug=${template.slug}. Returning 200 queued.`,
        );
        return NextResponse.json(
          {
            success: true,
            status: "queued",
            slug: template.slug,
            message:
              "Generation queued — game will appear when ready. Poll /api/external/find-game by slug.",
            // (2026-05-21) Soft contract warnings — OddballTrip dev
            // should monitor this array and fix drift on their side.
            // The pipeline tolerates these for backward compat.
            contract_warnings: contractCheck.warnings,
          },
          { status: 202 },
        );
      } catch (err) {
        console.error(
          `[GenerateGame] inngest.send for game/build.requested FAILED: ${err instanceof Error ? err.message : err}. Falling back to sync path.`,
        );
        // fall through to legacy sync path
      }
    }

    // Legacy sync path — Lambda 1: discovery + insert with is_published=false
    const result = await generateGameFromTemplate(template);

    if (result.success) {
      // ════════════════════════════════════════════════════════════
      // CHAIN INTO LAMBDA 2 — fire-and-forget finalize-game
      // ════════════════════════════════════════════════════════════
      // Lambda 2 runs prepareGamePackage + validator + auto-repair +
      // is_published flip in its own 600s budget. We trigger it via
      // fetch WITHOUT awaiting — this lambda returns to OddballTrip
      // immediately while the new lambda continues processing.
      //
      // OddballTrip polls find-game until is_published=true → only
      // then receives 200 → only then creates the activation code.
      // Race condition impossible.
      if (result.gameId) {
        // ════════════════════════════════════════════════════════════
        // FEATURE FLAG : USE_INNGEST
        // ════════════════════════════════════════════════════════════
        // - "true"  → nouveau chemin Inngest (durable, retries auto,
        //             dead letter, observabilité dashboard)
        // - autre   → ancien chemin chained lambdas (fire-and-forget)
        //
        // Migration progressive : on flippe à "true" en prod après
        // validation du sanity check end-to-end, on observe pendant
        // 24h sur le dashboard Inngest, on rollback en flippant à
        // "false" si jamais un problème. Aucune redéploiement requis
        // pour le rollback (Vercel env vars hot-reload).
        if (process.env.USE_INNGEST === "true") {
          console.log(
            `[GenerateGame] Sending Inngest event game/generate.requested for gameId=${result.gameId}`,
          );
          try {
            await inngest.send({
              name: "game/generate.requested",
              data: {
                gameId: result.gameId,
                slug: template.slug,
                language: template.language,
                city: template.city,
                theme: template.theme,
                narrative: template.narrative,
                genre: template.genre,
                buyerEmail: body.buyerEmail,
                orderId: body.orderId,
                callbackUrl: body.callbackUrl,
                callbackSecret: body.callbackSecret,
              },
            });
            console.log(
              `[GenerateGame] Inngest event sent — finalize will run durably`,
            );
          } catch (err) {
            // Si Inngest.send échoue (rare : Inngest Cloud down),
            // le jeu est inséré en DB mais finalize ne tournera pas.
            // Le cron `recoverStuckGames` (toutes les 5 min) ré-amorce
            // l'event pour ce gameId au bout de 30 min, donc on récupère.
            // On log warn mais on ne re-throw pas — Lambda 1 a quand
            // même produit le jeu, OddballTrip va le polléer.
            console.error(
              `[GenerateGame] inngest.send failed (heartbeat cron will recover): ${err instanceof Error ? err.message : err}`,
            );
          }
        } else {
          // ──────────────────────────────────────────────────────────
          // ANCIEN CHEMIN — chained lambdas via fire-and-forget HTTP
          // ──────────────────────────────────────────────────────────
          const baseUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
            new URL(request.url).origin;
          const finalizeUrl = `${baseUrl}/api/internal/finalize-game`;
          console.log(`[GenerateGame] Triggering Lambda 2 (fire-and-forget): ${finalizeUrl}`);
          // Fire-and-forget avec Promise.race pour garantir que la
          // requête HTTP est BIEN ENVOYÉE avant que Vercel kill cette
          // lambda. Sans ça (bug observé Lugdunum V5 11/05), Vercel
          // termine la lambda dès le return, avant même que le TCP
          // handshake vers Lambda 2 soit fait → Lambda 2 jamais appelée.
          //
          // Stratégie : on lance le fetch en background, on race contre
          // un setTimeout(2000). Dans 2s :
          //   - SOIT la requête HTTP est entièrement complétée
          //     (Lambda 2 a renvoyé une réponse)
          //   - SOIT le TCP + envoi du body sont terminés et Lambda 2
          //     est en train de traiter (on reçoit pas la réponse mais
          //     ça ne nous bloque pas — Lambda 2 vit indépendamment)
          // Dans les 2 cas Lambda 2 est lancée et continuera son travail
          // dans son propre processus, même si Lambda 1 meurt.
          const fetchPromise = fetch(finalizeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${expectedSecret}`,
            },
            body: JSON.stringify({
              gameId: result.gameId,
              language: template.language,
              city: template.city,
              theme: template.theme,
              narrative: template.narrative,
              genre: template.genre,
              slug: template.slug,
              buyerEmail: body.buyerEmail,
              orderId: body.orderId,
              callbackUrl: body.callbackUrl,
              callbackSecret: body.callbackSecret,
            }),
          }).catch((err) => {
            console.error(
              `[GenerateGame] Lambda 2 trigger failed: ${err instanceof Error ? err.message : err}`,
            );
          });
          await Promise.race([
            fetchPromise,
            new Promise((r) => setTimeout(r, 2000)),
          ]);
          console.log(`[GenerateGame] Lambda 2 trigger initiated (race timeout 2s)`);
        }
      }

      // (was: send callback + needs_review email here. Now Lambda 2 does
      // both at the end of its own work, with the FINAL needsReview status.)
      // Send callback to oddballtrip if provided (must await on Vercel serverless)
      if (body.callbackUrl) {
        console.log(`[GenerateGame] Sending callback to ${body.callbackUrl}`);
        try {
          const cbRes = await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && {
                Authorization: `Bearer ${body.callbackSecret}`,
              }),
            },
            body: JSON.stringify({
              success: true,
              gameId: result.gameId,
              slug: body.slug || template.slug,
              stepsCount: result.steps,
              // Flag de review : posé par le pipeline quand la sanity-
              // check post-discovery détecte une anomalie (cluster
              // centroid > 5 km du startPoint). oddballtrip DOIT tenir
              // l'envoi du code activation au client tant que l'opérateur
              // n'a pas inspecté/corrigé via dump-game + edit-step.
              ...(result.needsReview
                ? { needsReview: true, reviewReason: result.reviewReason }
                : {}),
              // CANONIQUE intent-first : la liste des landmarks réels
              // qui ont été utilisés pour générer le jeu (issue de
              // Perplexity + Google Places, sub-10m). oddballtrip DOIT
              // s'en servir pour rafraîchir la fiche produit, sinon
              // la page indexée diverge de l'expérience jouée.
              ...(result.landmarks?.length
                ? { landmarks: result.landmarks }
                : {}),
              // Le scénario adapté aux landmarks réels (themeDescription
              // + narrative + noms poétiques par stop). Toujours présent
              // sauf si l'adaptation Claude a planté (graceful degrad).
              // À utiliser pour rafraîchir la fiche produit côté
              // commerce — sinon le client achète X et joue Y.
              ...(result.adaptedNarrative
                ? {
                    narrativeChanged: true,
                    adaptedNarrative: result.adaptedNarrative,
                  }
                : {}),
              // Audit non-actionnable : candidats Perplexity rejetés
              // pour cause de géocodage ou walkability. Affichage
              // optionnel pour l'opérateur, ne nécessite aucune action.
              ...(result.droppedStops?.length
                ? { droppedStops: result.droppedStops }
                : {}),
            }),
          });
          console.log(`[GenerateGame] Callback response: ${cbRes.status} ${cbRes.statusText}`);
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Alerte needs_review : si la sanity-check post-discovery a flaggé
      // ce jeu, on prévient l'opérateur AVANT que le code activation
      // soit envoyé au client. Email non-bloquant.
      if (result.needsReview && result.gameId && result.reviewReason) {
        try {
          await sendNeedsReviewAlert({
            gameId: result.gameId,
            slug: template.slug,
            city: template.city,
            theme: template.theme,
            reviewReason: result.reviewReason,
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
          });
        } catch (alertErr) {
          console.error(
            `[GenerateGame] needs_review alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
          );
        }
      }

      // Email STOPS_DROPPED retiré : dans l'architecture Google-first,
      // les "drops" (candidats Google non-pickés par Claude) sont en
      // réalité juste les non-sélectionnés — ce sont des choix, pas
      // des échecs. Avec 60 candidats Google et stopCount=8, on a
      // mathématiquement 52 "non-pickés" qui ne sont pas un problème.
      // L'email "52 stops dropped — game published with 8 stops
      // instead of 8" était trompeur. Si un VRAI problème survient
      // (walkability filter drop, geocoding fail), il est remonté
      // dans le callback comme `droppedStops` pour audit, mais ne
      // déclenche plus d'email d'alerte (qui spammait pour rien).

      // If stops were auto-replaced, fire a notification email so the
      // sales team knows the product page must be updated to match the
      // regenerated narrative. The game IS published — this is not a
      // failure, just an operational handover.
      if (result.replacedStops?.length) {
        try {
          await sendPipelineFailureAlert({
            city,
            country,
            theme,
            slug: template.slug,
            error: `${result.replacedStops.length} stop(s) auto-replaced via Google Places — narrative regenerated, product page must be refreshed.`,
            errorCode: "STOPS_REPLACED",
            replacedStops: result.replacedStops.map((r) => ({
              original: r.original,
              replacement: r.replacement,
            })),
            adaptedNarrative: result.adaptedNarrative,
            durationSeconds: Math.round((result.durationMs || 0) / 1000),
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
          });
        } catch (alertErr) {
          console.error(
            `[GenerateGame] Replaced-stops alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
          );
        }
      }

      return NextResponse.json(
        {
          success: true,
          gameId: result.gameId,
          steps: result.steps,
          durationSeconds: Math.round((result.durationMs || 0) / 1000),
          researchDurationMs: result.researchDurationMs,
          creationDurationMs: result.creationDurationMs,
          message: `Game "${theme}" in ${city} created successfully`,
          ...(result.needsReview
            ? { needsReview: true, reviewReason: result.reviewReason }
            : {}),
          ...(result.droppedStops?.length
            ? { droppedStops: result.droppedStops }
            : {}),
          ...(result.replacedStops?.length
            ? {
                narrativeChanged: true,
                replacedStops: result.replacedStops,
                adaptedNarrative: result.adaptedNarrative,
              }
            : {}),
        },
        { status: 201 }
      );
    } else {
      console.error("[GenerateGame] Pipeline failed:", result.error);

      // Send failure alert email to admin (CC: oddballtrip ops if
      // ODDBALLTRIP_ALERT_EMAIL is set). Threads through the
      // structured errorCode + failedLandmarks so the email body
      // shows the operator the exact list of names to fix.
      await sendPipelineFailureAlert({
        city,
        country,
        theme,
        slug: template.slug,
        error: result.error || "Unknown pipeline error",
        errorCode: result.errorCode,
        failedLandmarks: result.failedLandmarks,
        durationSeconds: Math.round((result.durationMs || 0) / 1000),
        buyerEmail: body.buyerEmail,
        orderId: body.orderId,
        startPoint: template.startPoint,
        stopCount: template.stopCount,
      });

      // Send failure callback to OddballTrip so it can handle the
      // client. Structured payload so oddballtrip can switch on the
      // errorCode (notably GEOCODING_FAILED → show the operator the
      // failedLandmarks to fix and resubmit).
      if (body.callbackUrl) {
        try {
          await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && { Authorization: `Bearer ${body.callbackSecret}` }),
            },
            body: JSON.stringify({
              success: false,
              slug: template.slug,
              errorCode: result.errorCode ?? "INTERNAL_ERROR",
              error: result.error,
              ...(result.failedLandmarks?.length
                ? { failedLandmarks: result.failedLandmarks }
                : {}),
            }),
          });
        } catch (cbErr) {
          console.error(`[GenerateGame] Failure callback failed: ${cbErr instanceof Error ? cbErr.message : cbErr}`);
        }
      }

      return NextResponse.json(
        {
          success: false,
          errorCode: result.errorCode ?? "INTERNAL_ERROR",
          error: result.error,
          ...(result.failedLandmarks?.length
            ? { failedLandmarks: result.failedLandmarks }
            : {}),
          durationSeconds: Math.round((result.durationMs || 0) / 1000),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("[GenerateGame] Unexpected error:", errorMessage);

    // Send alert even for unexpected errors
    await sendPipelineFailureAlert({
      city: body?.city || "Unknown",
      country: body?.country || "Unknown",
      theme: body?.theme || "Unknown",
      slug: body?.slug || "unknown",
      error: errorMessage,
      buyerEmail: body?.buyerEmail,
      orderId: body?.orderId,
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
