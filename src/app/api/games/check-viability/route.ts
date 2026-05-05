/**
 * API Route: POST /api/games/check-viability
 *
 * Endpoint léger (~3-5 sec) qui valide AVANT publication qu'un couple
 * (city, startPoint, theme) peut effectivement produire un escape game
 * marchable de 8 stops. À appeler depuis le back-office oddballtrip
 * dès que l'opérateur saisit/sélectionne un thème, pour éviter de
 * publier une fiche produit dont le pipeline va rejeter la génération
 * au moment de l'achat.
 *
 * Vérifications (en cascade, retour précoce sur premier échec) :
 *   1. startPoint fourni et valide.
 *   2. city ne contient pas " AND " ou " et " (multi-zones interdites).
 *   3. Densité Google Places dans 1 km du startPoint ≥ 8 monuments.
 *      (Si 1 km est trop strict, on élargit à 2 km en backup.)
 *   4. (Optionnel, si theme fourni) Perplexity propose ≥ 6 candidats.
 *
 * Body :
 * {
 *   city: string,
 *   country: string,
 *   startPoint: { lat, lon },
 *   theme?: string,
 *   themeDescription?: string,
 *   narrative?: string
 * }
 *
 * Réponse :
 * {
 *   viable: boolean,
 *   reasons: string[],            // explications opérateur-friendly
 *   monumentCount1km: number,
 *   monumentCount2km: number,
 *   thematicCandidates?: number,  // si theme fourni
 *   recommendation?: string       // suggestion textuelle
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { countNearbyMonuments } from "@/lib/geocode";
import { discoverThematicLandmarks } from "@/lib/perplexity";

// Léger : 1-2 appels Google + 1 appel Perplexity optionnel = 5-10 sec
export const maxDuration = 30;

/** Seuil de densité minimale dans 1 km autour du startPoint pour
 *  qu'un parcours ait des chances de publier. 8 monuments dans 1 km
 *  garantit qu'on en trouvera au moins 8 thématiques dans 2 km. */
const MIN_MONUMENTS_1KM = 8;

/** Seuil minimum dans 2 km — si on tombe sous ça, c'est un site sparse
 *  (rural battle field, banlieue résidentielle) → no-go. */
const MIN_MONUMENTS_2KM = 12;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;
    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const reasons: string[] = [];

    // --- 1. Validation startPoint ---
    let startPoint: { lat: number; lon: number } | undefined;
    if (body.startPoint && typeof body.startPoint === "object") {
      const sp = body.startPoint as Record<string, unknown>;
      const lat =
        typeof sp.lat === "number"
          ? sp.lat
          : typeof sp.latitude === "number"
            ? sp.latitude
            : null;
      const lon =
        typeof sp.lon === "number"
          ? sp.lon
          : typeof sp.longitude === "number"
            ? sp.longitude
            : typeof sp.lng === "number"
              ? sp.lng
              : null;
      if (lat !== null && lon !== null) {
        startPoint = { lat, lon };
      }
    }

    if (!startPoint) {
      return NextResponse.json(
        {
          viable: false,
          reasons: [
            "startPoint manquant ou invalide. Format requis : { lat: number, lon: number }",
          ],
        },
        { status: 400 },
      );
    }

    // --- 2. Validation city (pas multi-zones) ---
    const city = typeof body.city === "string" ? body.city : "";
    const cityLower = city.toLowerCase();
    if (
      cityLower.includes(" and ") ||
      cityLower.includes(" & ") ||
      cityLower.match(/,\s*\w+\s+\w+\s+[,]/) // pattern "X, Y, Z" suspect
    ) {
      reasons.push(
        `Le champ city contient deux zones distinctes : "${city}". Choisis UN SEUL quartier ou site (ex. "Plaka, Athens" — pas "Plaka and Monastiraki, Athens").`,
      );
    }

    // --- 3. Densité Google Places ---
    console.log(
      `[CheckViability] Counting monuments around ${startPoint.lat.toFixed(4)},${startPoint.lon.toFixed(4)}`,
    );
    const [count1km, count2km] = await Promise.all([
      countNearbyMonuments(startPoint, 1_000),
      countNearbyMonuments(startPoint, 2_000),
    ]);

    if (count1km.total < MIN_MONUMENTS_1KM) {
      reasons.push(
        `Densité monumentale insuffisante : ${count1km.total} monuments dans 1 km autour du startPoint (minimum recommandé : ${MIN_MONUMENTS_1KM}). Cette zone est trop éparse pour un escape game à pied. Choisis un quartier plus dense ou un site archéologique compact.`,
      );
    }
    if (count2km.total < MIN_MONUMENTS_2KM) {
      reasons.push(
        `Même en élargissant à 2 km, seuls ${count2km.total} monuments sont indexés. C'est probablement un site rural ou un quartier résidentiel — pas viable pour un escape game outdoor.`,
      );
    }

    // --- 4. Validation thématique (optionnelle) ---
    let thematicCandidates: number | undefined;
    if (body.theme && body.themeDescription && body.narrative) {
      try {
        const candidates = await discoverThematicLandmarks({
          city,
          country: body.country || "Unknown",
          theme: body.theme,
          themeDescription: body.themeDescription,
          narrative: body.narrative,
          startPoint,
          needed: 8,
          excludeNames: [],
        });
        thematicCandidates = candidates.length;
        if (thematicCandidates < 6) {
          reasons.push(
            `Perplexity ne trouve que ${thematicCandidates} landmarks thématiquement liés à "${body.theme}" dans cette zone (minimum requis : 6, idéalement 8). Soit le thème est trop spécifique pour ce site, soit le site n'a pas de lien historique fort avec ce thème. Choisis un thème mieux ancré sur ce quartier.`,
          );
        }
      } catch (err) {
        console.warn(
          `[CheckViability] Perplexity check failed (non-blocking): ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const viable = reasons.length === 0;
    const recommendation = viable
      ? `Zone validée : ${count1km.total} monuments dans 1 km, ${count2km.total} dans 2 km. Tu peux publier la fiche en confiance.`
      : `Zone NON viable. Corrige les points ci-dessus avant de publier la fiche produit.`;

    return NextResponse.json(
      {
        viable,
        reasons,
        monumentCount1km: count1km.total,
        monumentCount2km: count2km.total,
        monumentCount1kmByType: count1km.byType,
        ...(thematicCandidates !== undefined ? { thematicCandidates } : {}),
        recommendation,
      },
      { status: viable ? 200 : 422 },
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[CheckViability] Unexpected error:", errorMessage);
    return NextResponse.json(
      { viable: false, reasons: [errorMessage] },
      { status: 500 },
    );
  }
}
