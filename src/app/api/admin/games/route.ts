import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gameSchema } from "@/lib/validators";

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: games, error } = await supabase
      .from("games")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la récupération des jeux" },
        { status: 500 }
      );
    }

    return NextResponse.json({ games: games || [] });
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
    const parsed = gameSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      title,
      description,
      city,
      difficulty,
      estimatedDurationMin,
      maxHintsPerStep,
      hintPenaltySeconds,
      coverImage,
    } = parsed.data;

    const { data: game, error } = await supabase
      .from("games")
      .insert({
        title: { fr: title },
        description: description ? { fr: description } : null,
        city: city ?? null,
        difficulty,
        estimated_duration_min: estimatedDurationMin ?? null,
        max_hints_per_step: maxHintsPerStep,
        hint_penalty_seconds: hintPenaltySeconds,
        cover_image: coverImage ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la création du jeu" },
        { status: 500 }
      );
    }

    return NextResponse.json({ game }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, ...rest } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID du jeu requis" },
        { status: 400 }
      );
    }

    const parsed = gameSchema.safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      title,
      description,
      city,
      difficulty,
      estimatedDurationMin,
      maxHintsPerStep,
      hintPenaltySeconds,
      coverImage,
    } = parsed.data;

    const updateData: Record<string, unknown> = {
      title: { fr: title },
      description: description ? { fr: description } : null,
      city: city ?? null,
      difficulty,
      estimated_duration_min: estimatedDurationMin ?? null,
      max_hints_per_step: maxHintsPerStep,
      hint_penalty_seconds: hintPenaltySeconds,
    };

    if (coverImage !== undefined) {
      updateData.cover_image = coverImage || null;
    }

    const { data: game, error } = await supabase
      .from("games")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Erreur lors de la mise a jour du jeu" },
        { status: 500 }
      );
    }

    return NextResponse.json({ game });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
