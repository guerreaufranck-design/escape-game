"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { GameForm } from "@/components/admin/GameForm";
import { StepEditor } from "@/components/admin/StepEditor";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Game, GameStep } from "@/types/database";
import { t } from "@/lib/i18n";
import {
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  ArrowLeft,
} from "lucide-react";

export default function AdminGameEditPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const [game, setGame] = useState<Game | null>(null);
  const [steps, setSteps] = useState<GameStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchGame = useCallback(async () => {
    const supabase = createClient();
    const [{ data: gameData }, { data: stepsData }] = await Promise.all([
      supabase.from("games").select("*").eq("id", gameId).single(),
      supabase
        .from("game_steps")
        .select("*")
        .eq("game_id", gameId)
        .order("step_order"),
    ]);

    setGame(gameData);
    setSteps(stepsData ?? []);
    setLoading(false);
  }, [gameId]);

  useEffect(() => {
    fetchGame();
  }, [fetchGame]);

  async function handleUpdateGame(data: {
    title: string;
    description?: string;
    city?: string;
    difficulty: number;
    estimatedDurationMin?: number;
    maxHintsPerStep: number;
    hintPenaltySeconds: number;
    coverImage?: string;
  }) {
    const res = await fetch("/api/admin/games", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: gameId, ...data }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erreur lors de la mise a jour");
    }

    await fetchGame();
  }

  async function handleTogglePublish() {
    if (!game) return;
    setPublishing(true);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ is_published: !game.is_published })
      .eq("id", gameId);
    await fetchGame();
    setPublishing(false);
  }

  async function handleDeleteGame() {
    setDeleting(true);
    const res = await fetch("/api/admin/games", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: gameId }),
    });

    if (res.ok) {
      router.push("/admin/games");
    }
    setDeleting(false);
  }

  async function handleSaveSteps(updatedSteps: GameStep[]) {
    const supabase = createClient();

    // Delete existing steps
    await supabase.from("game_steps").delete().eq("game_id", gameId);

    // Insert updated steps
    if (updatedSteps.length > 0) {
      const inserts = updatedSteps.map((s) => ({
        id: s.id,
        game_id: gameId,
        step_order: s.step_order,
        title: s.title,
        riddle_text: s.riddle_text,
        riddle_image: s.riddle_image,
        answer_text: s.answer_text,
        latitude: s.latitude,
        longitude: s.longitude,
        validation_radius_meters: s.validation_radius_meters,
        has_photo_challenge: s.has_photo_challenge,
        photo_reference: s.photo_reference,
        hints: s.hints,
        bonus_time_seconds: s.bonus_time_seconds,
      }));
      await supabase.from("game_steps").insert(inserts);
    }

    await fetchGame();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="py-20 text-center text-zinc-500">Jeu introuvable</div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/admin/games")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{t(game.title)}</h1>
            <p className="text-sm text-zinc-500">
              {game.is_published ? "Publie" : "Brouillon"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/admin/games/${gameId}/review`)}
            className="border-amber-600/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          >
            ⚡ Review qualité
          </Button>
          <Button
            variant="outline"
            onClick={handleTogglePublish}
            disabled={publishing}
          >
            {publishing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : game.is_published ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            {game.is_published ? "Depublier" : "Publier"}
          </Button>
          {deleteConfirm ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleDeleteGame}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Confirmer
              </Button>
              <Button variant="ghost" onClick={() => setDeleteConfirm(false)}>
                Annuler
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setDeleteConfirm(true)}>
              <Trash2 className="size-4 text-red-400" />
            </Button>
          )}
        </div>
      </div>

      {/* Game form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">
          Informations du jeu
        </h2>
        <GameForm game={game} onSubmit={handleUpdateGame} />
      </div>

      {/* Steps editor */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <StepEditor
          gameId={gameId}
          steps={steps}
          onSave={handleSaveSteps}
        />
      </div>
    </div>
  );
}
