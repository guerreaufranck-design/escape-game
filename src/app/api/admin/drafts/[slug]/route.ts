/**
 * GET    /api/admin/drafts/[slug]    → détail d'un draft (avec stops + diagnostics)
 * PATCH  /api/admin/drafts/[slug]    → modifie les stops (réordonne, ajoute, swap)
 * DELETE /api/admin/drafts/[slug]    → supprime un draft (avant fulfillment)
 *
 * PATCH body : { stops: Stop[], targetStopCount?: number, validationError?: string|null }
 *   - stops : nouveau tableau complet, le serveur ré-assigne step_order = i+1
 *   - le status est forcé à 'validated' si stops.length ≥ 5, sinon 'pending'
 *
 * Auth : admin session OR EXTERNAL_API_SECRET Bearer.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
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

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: draft, error } = await supabase
    .from("game_drafts")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json({ draft });
}

interface StopPatch {
  name?: string;
  description?: string;
  lat?: number;
  lon?: number;
  placeId?: string;
  distanceFromStartM?: number;
  types?: string[];
  rating?: number;
  themeScore?: number;
  tier?: number;
  rationale?: string;
  realFigure?: string;
  realEvent?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const supabase = createAdminClient();

  const body = (await request.json()) as {
    stops?: StopPatch[];
    targetStopCount?: number;
    validationError?: string | null;
  };

  if (!Array.isArray(body.stops)) {
    return NextResponse.json(
      { error: "Body must contain 'stops' array" },
      { status: 400 },
    );
  }

  // Validate each stop has at minimum name + lat + lon
  for (const [i, s] of body.stops.entries()) {
    if (!s.name || typeof s.lat !== "number" || typeof s.lon !== "number") {
      return NextResponse.json(
        { error: `Stop[${i}] missing name/lat/lon` },
        { status: 400 },
      );
    }
  }

  // Renumber step_order = i+1 (server is source of truth for ordering)
  const cleanStops = body.stops.map((s, i) => ({
    step_order: i + 1,
    name: s.name,
    description: s.description ?? "",
    lat: s.lat,
    lon: s.lon,
    placeId: s.placeId,
    distanceFromStartM: s.distanceFromStartM,
    types: s.types,
    rating: s.rating,
    themeScore: s.themeScore,
    tier: s.tier,
    rationale: s.rationale,
    realFigure: s.realFigure,
    realEvent: s.realEvent,
  }));

  const newStatus = cleanStops.length >= 5 ? "validated" : "pending";

  const update: Record<string, unknown> = {
    stops: cleanStops,
    status: newStatus,
    validation_error: body.validationError ?? null,
    updated_at: new Date().toISOString(),
  };
  if (newStatus === "validated") update.validated_at = new Date().toISOString();
  if (typeof body.targetStopCount === "number") {
    update.target_stop_count = body.targetStopCount;
  }

  const { error } = await supabase
    .from("game_drafts")
    .update(update)
    .eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    slug,
    status: newStatus,
    stopCount: cleanStops.length,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("game_drafts")
    .delete()
    .eq("slug", slug);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: slug });
}
