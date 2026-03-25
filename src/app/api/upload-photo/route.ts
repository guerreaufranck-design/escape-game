import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("sessionId") as string | null;
    const stepOrderStr = formData.get("stepOrder") as string | null;

    if (!file || !sessionId || !stepOrderStr) {
      return NextResponse.json(
        { error: "Fichier, sessionId et stepOrder sont requis" },
        { status: 400 }
      );
    }

    const stepOrder = parseInt(stepOrderStr, 10);
    if (isNaN(stepOrder) || stepOrder < 1) {
      return NextResponse.json(
        { error: "stepOrder invalide" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Le fichier doit être une image" },
        { status: 400 }
      );
    }

    // Limit file size to 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Le fichier ne doit pas dépasser 10 Mo" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Verify session exists
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    // Generate unique file path
    const ext = file.name.split(".").pop() || "jpg";
    const filePath = `${sessionId}/${stepOrder}/${Date.now()}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("player-photos")
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Erreur lors de l'upload de la photo" },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("player-photos")
      .getPublicUrl(filePath);

    const photoUrl = urlData.publicUrl;

    // Update step_completion with photo URL
    await supabase
      .from("step_completions")
      .update({ photo_url: photoUrl })
      .eq("session_id", sessionId)
      .eq("step_order", stepOrder);

    return NextResponse.json({ photoUrl });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
