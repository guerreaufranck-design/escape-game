/**
 * POST /api/admin/regenerate-game
 *
 * Régénère COMPLÈTEMENT un jeu existant avec le nouveau pipeline
 * Gemini-first (discovery thématique + validation Google Maps + diamètre
 * 3.5 km + narration ancrée). Conçu pour récupérer un jeu défaillant
 * (cf. incident Julien Alba 2026-05-15 — 4 hôtels picked au lieu des
 * mémoriaux de la Résistance).
 *
 * Auth: Bearer EXTERNAL_API_SECRET (même secret qu'OddballTrip — pas
 * exposé en CORS browser, appelé depuis CLI via curl).
 *
 * Body:
 *   { slug: string }   ou   { gameId: string }
 *   - resetSessions?: boolean (default true) — invalide les sessions
 *     en cours sur l'ancien jeu pour qu'elles ne soient pas orphelines.
 *
 * Réponse:
 *   {
 *     ok: true,
 *     oldGameId, newGameId, slug,
 *     stopCount,
 *     stops: [{name, lat, lon}],
 *     codesMigrated: number,
 *     sessionsReset: number,
 *     discoverySource: "gemini_thematic" | "google_places",
 *     durationSec: number,
 *     warnings: string[]
 *   }
 *
 * Flow:
 *   1. Auth + lookup ancien jeu
 *   2. Build GameTemplate depuis ses champs DB
 *   3. generateGameFromTemplate → nouveau gameId, même slug
 *   4. Atomic swap :
 *      - UPDATE games SET is_published=false WHERE id=oldId (audit)
 *      - UPDATE activation_codes SET game_id=newId WHERE game_id=oldId
 *      - UPDATE game_sessions SET status='abandoned' WHERE game_id=oldId
 *   5. Return summary
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";
import {
  generateGameFromTemplate,
  type GameTemplate,
} from "@/lib/game-pipeline";

/**
 * Authorize the request via EITHER :
 *   - Bearer EXTERNAL_API_SECRET (for CLI / scripts)
 *   - Authenticated admin session cookie (for the admin UI in the browser)
 *
 * Returns true if EITHER auth method validates.
 */
async function isAuthorized(request: NextRequest): Promise<boolean> {
  // Path 1 : Bearer EXTERNAL_API_SECRET — cheap, sync
  if (validateApiKey(request)) return true;

  // Path 2 : Admin session via Supabase auth cookies + admin_users table
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(adminRow);
  } catch {
    return false;
  }
}

// Vercel Pro : up to 800s. Pipeline réelle observée pour walking :
//   - Gemini Pro discovery + retry 503 : 30-180s (variable selon load)
//   - Patrimonial fill Pass 2 (si Pass 1 court) : 60-180s
//   - Validation Google Maps : 5-15s
//   - Claude narration 8 stops : 30-60s
//   - Claude intro + final_riddle + epilogue (parallèle) : 20-40s
//   - Insert DB + cleanup : 5s
//   TOTAL nominal : 2-4 min. Pire cas Gemini-saturé : 5-8 min.
// On met 800s (13 min) pour absorber les pires cas. La pipeline Inngest
// async (translations + audio) tourne hors de ce timeout côté Vercel.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

interface GameRow {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  city: string | null;
  difficulty: number;
  estimated_duration_min: number | null;
  cover_image: string | null;
  is_published: boolean;
  transport_mode: string | null;
  radius_km: number | null;
  recommended_days_min: number | null;
  recommended_days_max: number | null;
  needs_review: boolean | null;
}

function reconstructNarrative(game: GameRow): string {
  // Le champ `narrative` n'est pas stocké en DB — c'était un input
  // Claude au moment de la génération initiale. Pour une régénération,
  // on reconstruit un narrative synthétique à partir des champs
  // persistants. Claude va l'adapter de toute façon en phase 2.
  const desc = game.description ?? "";
  const title = game.title;
  const city = game.city ?? "the city";
  return `An outdoor walking-game adventure called "${title}", set in ${city}. ${desc}`;
}

export async function POST(request: NextRequest) {
  // Wrap the whole handler in try/catch so we ALWAYS return JSON
  // (instead of Next.js default HTML error page on uncaught throw).
  try {
    return await handleRegenerate(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[regenerate-game] uncaught:", msg);
    return NextResponse.json(
      {
        ok: false,
        error: `Exception non catchée : ${msg}`,
      },
      { status: 500 },
    );
  }
}

async function handleRegenerate(request: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();

  if (!(await isAuthorized(request))) {
    return NextResponse.json(
      { error: "Non autorisé — Bearer EXTERNAL_API_SECRET ou session admin requise" },
      { status: 401 },
    );
  }

  let body: {
    slug?: string;
    gameId?: string;
    resetSessions?: boolean;
    // MODE "CREATE FROM SCRATCH" (vision 2026-05-16 — bypass webhook
    // OddballTrip quand celui-ci est cassé). Tous les params requis pour
    // lancer la pipeline sans avoir besoin d'un game existant en DB.
    create?: {
      slug: string;
      title: string;
      city: string;
      country?: string;
      themeDescription: string;
      narrative?: string;
      difficulty?: number;
      estimatedDurationMin?: number;
      stopCount?: number;
      transportMode?: "walking" | "driving" | "mixed";
      radiusKm?: number;
      recommendedDaysMin?: number;
      recommendedDaysMax?: number;
      language?: string;
      startPointText?: string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON invalide" },
      { status: 400 },
    );
  }

  // ─── MODE CREATE — game from scratch (pas besoin de slug existant) ───
  if (body.create) {
    const c = body.create;
    if (!c.slug || !c.title || !c.city) {
      return NextResponse.json(
        { error: "create.{slug,title,city} requis" },
        { status: 400 },
      );
    }
    const tpl: GameTemplate = {
      slug: c.slug,
      city: c.city,
      country: c.country ?? inferCountryFromCity(c.city) ?? "",
      theme: c.title,
      themeDescription: c.themeDescription,
      narrative:
        c.narrative ??
        `An outdoor adventure called "${c.title}", set in ${c.city}. ${c.themeDescription}`,
      difficulty: c.difficulty ?? 3,
      estimatedDurationMin: c.estimatedDurationMin ?? 135,
      stopCount: c.stopCount ?? 8,
      transportMode: c.transportMode ?? "walking",
      radiusKm: c.radiusKm,
      recommendedDaysMin: c.recommendedDaysMin,
      recommendedDaysMax: c.recommendedDaysMax,
      language: c.language,
      startPointText: c.startPointText,
    };
    console.log(
      `[regenerate-game] CREATE mode: slug=${tpl.slug} city=${tpl.city} mode=${tpl.transportMode} stopCount=${tpl.stopCount}`,
    );
    const result = await generateGameFromTemplate(tpl);
    if (!result.success || !result.gameId) {
      return NextResponse.json(
        {
          ok: false,
          error: `Pipeline a échoué: ${result.error ?? "(no message)"}`,
          durationSec: Math.round((Date.now() - t0) / 1000),
          mode: "create",
        },
        { status: 500 },
      );
    }
    const newGameId = result.gameId;
    const supabaseLocal = createAdminClient();
    const { data: newSteps } = await supabaseLocal
      .from("game_steps")
      .select("step_order, title, latitude, longitude")
      .eq("game_id", newGameId)
      .order("step_order", { ascending: true });
    const stops = (newSteps ?? []).map((s) => ({
      order: s.step_order,
      name: typeof s.title === "string" ? s.title : JSON.stringify(s.title),
      lat: s.latitude,
      lon: s.longitude,
    }));
    return NextResponse.json({
      ok: true,
      mode: "create",
      newGameId,
      slug: tpl.slug,
      stopCount: stops.length,
      stops,
      discoverySource: result.discoverySource ?? "unknown",
      durationSec: Math.round((Date.now() - t0) / 1000),
    });
  }

  // ─── MODE REGENERATE — slug ou gameId existant requis ───
  if (!body.slug && !body.gameId) {
    return NextResponse.json(
      { error: "Fournir { slug } ou { gameId } ou { create: {...} }" },
      { status: 400 },
    );
  }

  const resetSessions = body.resetSessions !== false;
  const supabase = createAdminClient();

  // ── Étape 1 : trouver le jeu existant ──
  let oldQuery = supabase.from("games").select("*");
  if (body.gameId) {
    oldQuery = oldQuery.eq("id", body.gameId);
  } else if (body.slug) {
    oldQuery = oldQuery
      .eq("slug", body.slug)
      .order("created_at", { ascending: false });
  }
  const { data: oldGames, error: lookupError } = await oldQuery.limit(1);

  if (lookupError) {
    return NextResponse.json(
      { error: `Erreur DB lookup: ${lookupError.message}` },
      { status: 500 },
    );
  }
  if (!oldGames || oldGames.length === 0) {
    return NextResponse.json(
      { error: "Jeu non trouvé pour ce slug / gameId" },
      { status: 404 },
    );
  }

  const oldGame = oldGames[0] as GameRow;
  const warnings: string[] = [];

  if (!oldGame.slug) {
    return NextResponse.json(
      { error: "Le jeu existant n'a pas de slug — régénération impossible (lookup OddballTrip cassé)" },
      { status: 400 },
    );
  }

  console.log(
    `[regenerate-game] Found old game id=${oldGame.id} slug=${oldGame.slug} title="${oldGame.title}"`,
  );

  // ── Étape 2 : récupérer un start point texte si possible ──
  // Le startPoint est stocké soit dans le premier step (latitude/longitude)
  // soit pas du tout en DB. Pour la régénération on utilise le premier
  // stop comme proxy startPoint — c'est le point d'entrée du jeu.
  const { data: firstStep } = await supabase
    .from("game_steps")
    .select("latitude, longitude, title")
    .eq("game_id", oldGame.id)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStep) {
    warnings.push("No existing first step → pipeline will geocode from city");
  }

  // ── Étape 3 : compter stops actuels pour stopCount ──
  const { count: stopCountRow } = await supabase
    .from("game_steps")
    .select("*", { count: "exact", head: true })
    .eq("game_id", oldGame.id);
  const stopCount = stopCountRow ?? 8;

  // ── Étape 4 : construire le GameTemplate ──
  const template: GameTemplate = {
    slug: oldGame.slug,
    city: oldGame.city ?? "",
    country: "", // pas stocké en DB séparément — Claude/Gemini déduiront depuis city
    theme: oldGame.title,
    themeDescription: oldGame.description ?? "",
    narrative: reconstructNarrative(oldGame),
    difficulty: oldGame.difficulty,
    estimatedDurationMin: oldGame.estimated_duration_min ?? 90,
    coverImage: oldGame.cover_image ?? undefined,
    stopCount,
    transportMode: (oldGame.transport_mode as "walking" | "driving" | "mixed" | null) ?? "walking",
    radiusKm: oldGame.radius_km ?? undefined,
    recommendedDaysMin: oldGame.recommended_days_min ?? undefined,
    recommendedDaysMax: oldGame.recommended_days_max ?? undefined,
    startPoint: firstStep
      ? { lat: firstStep.latitude, lon: firstStep.longitude }
      : undefined,
  };

  // Le country est critique pour Gemini grounding. On essaie de le
  // déduire depuis la ville via une heuristique légère. Si introuvable,
  // on continue et Gemini fera de son mieux (en pratique Google Search
  // grounding identifie le pays par le contexte).
  if (!template.country && template.city) {
    // Pour Alba on sait : Italy. Pour les autres, fallback au premier
    // pays trouvé via Geocoding (mais coûteux). Pour ce one-shot on
    // accepte que l'utilisateur ajoute country dans le body.
    template.country = inferCountryFromCity(template.city) ?? "";
    if (!template.country) {
      warnings.push(
        `country undeducible from city="${template.city}" — Gemini will infer from grounded search`,
      );
    }
  }

  console.log(
    `[regenerate-game] Built template: slug=${template.slug} city=${template.city} country=${template.country} stopCount=${template.stopCount} startPoint=${template.startPoint ? `${template.startPoint.lat.toFixed(4)},${template.startPoint.lon.toFixed(4)}` : "(none)"}`,
  );

  // ── Étape 5 : lancer la pipeline ──
  const result = await generateGameFromTemplate(template);

  if (!result.success || !result.gameId) {
    return NextResponse.json(
      {
        ok: false,
        error: `Pipeline a échoué: ${result.error ?? "(no message)"}`,
        oldGameId: oldGame.id,
        durationSec: Math.round((Date.now() - t0) / 1000),
        warnings,
      },
      { status: 500 },
    );
  }

  const newGameId = result.gameId;

  // ── Étape 6 : swap activation_codes + sessions ──
  const { count: codesMigrated, error: codeMigrateError } = await supabase
    .from("activation_codes")
    .update({ game_id: newGameId }, { count: "exact" })
    .eq("game_id", oldGame.id);

  if (codeMigrateError) {
    warnings.push(`Failed to migrate activation_codes: ${codeMigrateError.message}`);
  }

  let sessionsReset = 0;
  if (resetSessions) {
    const { count, error: sessionResetError } = await supabase
      .from("game_sessions")
      .update({ status: "abandoned" }, { count: "exact" })
      .eq("game_id", oldGame.id)
      .in("status", ["pending", "active"]);
    sessionsReset = count ?? 0;
    if (sessionResetError) {
      warnings.push(`Failed to reset sessions: ${sessionResetError.message}`);
    }
  }

  // ── Étape 7 : unpublish l'ancien jeu (audit) ──
  await supabase
    .from("games")
    .update({ is_published: false })
    .eq("id", oldGame.id);

  // ── Étape 8 : récupérer la liste des stops du nouveau jeu pour la réponse ──
  const { data: newSteps } = await supabase
    .from("game_steps")
    .select("step_order, title, latitude, longitude")
    .eq("game_id", newGameId)
    .order("step_order", { ascending: true });

  const stops = (newSteps ?? []).map((s) => ({
    order: s.step_order,
    name: typeof s.title === "string" ? s.title : JSON.stringify(s.title),
    lat: s.latitude,
    lon: s.longitude,
  }));

  return NextResponse.json({
    ok: true,
    oldGameId: oldGame.id,
    newGameId,
    slug: template.slug,
    stopCount: stops.length,
    stops,
    codesMigrated: codesMigrated ?? 0,
    sessionsReset,
    discoverySource: result.discoverySource ?? "unknown",
    durationSec: Math.round((Date.now() - t0) / 1000),
    warnings,
  });
}

/**
 * Hardcoded city→country map for the most common OddballTrip
 * destinations. Quick fallback when the games table doesn't carry
 * country explicitly. Not exhaustive — when missing, the pipeline
 * still works because Gemini grounding resolves the country from
 * the city name via Google Search.
 */
function inferCountryFromCity(city: string): string | null {
  const c = city.trim().toLowerCase();
  // Stratégie 1 : la chaîne contient explicitement le pays
  // (cas typique du back-office "Historic center of Lyon, France").
  const explicitCountries: Array<[RegExp, string]> = [
    [/\b(france|french)\b/i, "France"],
    [/\b(italy|italia|italian|italie)\b/i, "Italy"],
    [/\b(spain|españa|spanish|espagne)\b/i, "Spain"],
    [/\b(germany|deutschland|german|allemagne)\b/i, "Germany"],
    [/\b(portugal|portuguese)\b/i, "Portugal"],
    [/\b(luxembourg)\b/i, "Luxembourg"],
    [/\b(greece|greek|grece|grèce)\b/i, "Greece"],
    [/\b(japan|nippon|japanese|japon)\b/i, "Japan"],
    [/\b(czech)\b/i, "Czech Republic"],
    [/\b(uk|united kingdom|england|english|britain|british)\b/i, "United Kingdom"],
    [/\b(belgium|belgian)\b/i, "Belgium"],
    [/\b(netherlands|holland|dutch)\b/i, "Netherlands"],
    [/\b(austria|austrian|österreich)\b/i, "Austria"],
    [/\b(switzerland|swiss|suisse)\b/i, "Switzerland"],
  ];
  for (const [rx, country] of explicitCountries) {
    if (rx.test(city)) return country;
  }

  // Stratégie 2 : lookup par nom de ville (ancien chemin, conservé pour rétrocompat).
  const map: Record<string, string> = {
    alba: "Italy",
    rome: "Italy",
    venezia: "Italy",
    venise: "Italy",
    florence: "Italy",
    cuneo: "Italy",
    paris: "France",
    rouen: "France",
    nice: "France",
    "saint-malo": "France",
    cluny: "France",
    tournus: "France",
    lyon: "France",
    lugdunum: "France",
    bordeaux: "France",
    marseille: "France",
    toulouse: "France",
    nantes: "France",
    "la rochelle": "France",
    strasbourg: "France",
    "aix-en-provence": "France",
    avignon: "France",
    beziers: "France",
    "béziers": "France",
    montpellier: "France",
    clervaux: "Luxembourg",
    berlin: "Germany",
    munich: "Germany",
    rothenburg: "Germany",
    granada: "Spain",
    sevilla: "Spain",
    seville: "Spain",
    "los cristianos": "Spain",
    girona: "Spain",
    gerone: "Spain",
    toledo: "Spain",
    "san cristóbal de la laguna": "Spain",
    "la laguna": "Spain",
    "puerto de la cruz": "Spain",
    garachico: "Spain",
    madrid: "Spain",
    barcelona: "Spain",
    aegina: "Greece",
    rhodes: "Greece",
    athens: "Greece",
    athènes: "Greece",
    prague: "Czech Republic",
    hakata: "Japan",
    fukuoka: "Japan",
    shibuya: "Japan",
    tokyo: "Japan",
    cambridge: "United Kingdom",
    london: "United Kingdom",
    londres: "United Kingdom",
  };
  // Direct hit
  if (map[c]) return map[c];
  // Substring match (la "city" peut contenir des suffixes "from X to Y")
  for (const [key, country] of Object.entries(map)) {
    if (c.includes(key)) return country;
  }
  return null;
}
