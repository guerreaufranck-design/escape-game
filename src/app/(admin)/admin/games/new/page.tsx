"use client";

import { useRouter } from "next/navigation";
import { GameForm } from "@/components/admin/GameForm";

export default function AdminNewGamePage() {
  const router = useRouter();

  async function handleSubmit(data: {
    title: string;
    description?: string;
    city?: string;
    difficulty: number;
    estimatedDurationMin?: number;
    maxHintsPerStep: number;
    hintPenaltySeconds: number;
  }) {
    const res = await fetch("/api/admin/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erreur lors de la creation");
    }

    const { id } = await res.json();
    router.push(`/admin/games/${id}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Nouveau jeu</h1>
        <p className="text-sm text-zinc-500">
          Creez un nouvel escape game outdoor
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <GameForm
          onSubmit={handleSubmit}
          onCancel={() => router.push("/admin/games")}
        />
      </div>
    </div>
  );
}
