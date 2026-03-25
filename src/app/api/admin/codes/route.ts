import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateCodesSchema } from "@/lib/validators";
import { generateCodes } from "@/lib/code-generator";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");

    let query = supabase
      .from("activation_codes")
      .select("*")
      .order("created_at", { ascending: false });

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    const { data: codes, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la récupération des codes" },
        { status: 500 }
      );
    }

    return NextResponse.json({ codes: codes || [] });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const parsed = generateCodesSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { gameId, count, isSingleUse, maxUses, teamName, expiresAt } =
      parsed.data;

    // Verify game exists
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json(
        { error: "Jeu introuvable" },
        { status: 404 }
      );
    }

    // Generate unique codes
    const codes = generateCodes(count);

    // Get current user for created_by
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Insert codes into database
    const codesToInsert = codes.map((code) => ({
      code,
      game_id: gameId,
      is_single_use: isSingleUse,
      max_uses: maxUses,
      team_name: teamName ?? null,
      expires_at: expiresAt ?? null,
      created_by: user?.id ?? null,
    }));

    const { data: insertedCodes, error: insertError } = await supabase
      .from("activation_codes")
      .insert(codesToInsert)
      .select();

    if (insertError) {
      return NextResponse.json(
        { error: "Erreur lors de la génération des codes" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { codes: insertedCodes || [] },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
