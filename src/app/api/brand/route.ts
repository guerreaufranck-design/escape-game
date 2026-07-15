/**
 * GET /api/brand?code=XXXX-XXXX-XXXX  (ou ?slug=…)
 *
 * White-label : résout la MARQUE (nom + logo + support) à partir d'un code
 * d'activation (avant même l'activation) ou d'un slug. Permet à la page
 * d'accueil d'afficher le bon logo dès que le client arrive avec son lien.
 * Renvoie toujours une marque (défaut OddballTrip) — jamais d'erreur bloquante.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandFromSlug, DEFAULT_BRAND } from "@/lib/brand";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const slugParam = request.nextUrl.searchParams.get("slug");

    if (slugParam) {
      return NextResponse.json({ brand: brandFromSlug(slugParam) });
    }
    if (!code) {
      return NextResponse.json({ brand: DEFAULT_BRAND });
    }

    const supabase = createAdminClient();
    const { data: codeRow } = await supabase
      .from("activation_codes")
      .select("game_id")
      .eq("code", code.toUpperCase().trim())
      .maybeSingle();

    if (!codeRow?.game_id) {
      return NextResponse.json({ brand: DEFAULT_BRAND });
    }

    const { data: game } = await supabase
      .from("games")
      .select("slug")
      .eq("id", codeRow.game_id)
      .maybeSingle();

    return NextResponse.json({ brand: brandFromSlug(game?.slug) });
  } catch {
    return NextResponse.json({ brand: DEFAULT_BRAND });
  }
}
