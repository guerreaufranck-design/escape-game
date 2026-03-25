"use client";

import { useState } from "react";
import { gameSchema } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X } from "lucide-react";
import type { Game } from "@/types/database";
import { t } from "@/lib/i18n";

interface GameFormProps {
  game?: Game;
  onSubmit: (data: {
    title: string;
    description?: string;
    city?: string;
    difficulty: number;
    estimatedDurationMin?: number;
    maxHintsPerStep: number;
    hintPenaltySeconds: number;
  }) => Promise<void>;
  onCancel?: () => void;
}

export function GameForm({ game, onSubmit, onCancel }: GameFormProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [title, setTitle] = useState(game ? t(game.title) : "");
  const [description, setDescription] = useState(game ? t(game.description) : "");
  const [city, setCity] = useState(game?.city ?? "");
  const [difficulty, setDifficulty] = useState(game?.difficulty ?? 3);
  const [estimatedDurationMin, setEstimatedDurationMin] = useState<string>(
    game?.estimated_duration_min?.toString() ?? ""
  );
  const [maxHintsPerStep, setMaxHintsPerStep] = useState(
    game?.max_hints_per_step ?? 3
  );
  const [hintPenaltySeconds, setHintPenaltySeconds] = useState(
    game?.hint_penalty_seconds ?? 120
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const data = {
      title,
      description: description || undefined,
      city: city || undefined,
      difficulty,
      estimatedDurationMin: estimatedDurationMin
        ? parseInt(estimatedDurationMin, 10)
        : undefined,
      maxHintsPerStep,
      hintPenaltySeconds,
    };

    const result = gameSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (path) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      await onSubmit(result.data);
    } catch {
      setErrors({ _form: "Une erreur est survenue. Veuillez reessayer." });
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30";

  const labelClass = "mb-1 block text-sm font-medium text-zinc-300";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {errors._form && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-400">
          {errors._form}
        </div>
      )}

      {/* Title */}
      <div>
        <label htmlFor="title" className={labelClass}>
          Titre *
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          placeholder="Nom du jeu"
        />
        {errors.title && (
          <p className="mt-1 text-xs text-red-400">{errors.title}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} min-h-[100px] resize-y`}
          placeholder="Description du jeu..."
        />
        {errors.description && (
          <p className="mt-1 text-xs text-red-400">{errors.description}</p>
        )}
      </div>

      {/* City */}
      <div>
        <label htmlFor="city" className={labelClass}>
          Ville
        </label>
        <input
          id="city"
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={inputClass}
          placeholder="Paris, Lyon, Marseille..."
        />
      </div>

      {/* Difficulty */}
      <div>
        <label htmlFor="difficulty" className={labelClass}>
          Difficulte
        </label>
        <select
          id="difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(Number(e.target.value))}
          className={inputClass}
        >
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>
              {d} - {["Facile", "Moyen", "Difficile", "Tres difficile", "Expert"][d - 1]}
            </option>
          ))}
        </select>
      </div>

      {/* Estimated duration */}
      <div>
        <label htmlFor="estimatedDurationMin" className={labelClass}>
          Duree estimee (minutes)
        </label>
        <input
          id="estimatedDurationMin"
          type="number"
          value={estimatedDurationMin}
          onChange={(e) => setEstimatedDurationMin(e.target.value)}
          className={inputClass}
          placeholder="60"
          min={1}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Max hints per step */}
        <div>
          <label htmlFor="maxHintsPerStep" className={labelClass}>
            Indices max / etape
          </label>
          <input
            id="maxHintsPerStep"
            type="number"
            value={maxHintsPerStep}
            onChange={(e) => setMaxHintsPerStep(Number(e.target.value))}
            className={inputClass}
            min={0}
            max={10}
          />
        </div>

        {/* Hint penalty */}
        <div>
          <label htmlFor="hintPenaltySeconds" className={labelClass}>
            Penalite indice (sec)
          </label>
          <input
            id="hintPenaltySeconds"
            type="number"
            value={hintPenaltySeconds}
            onChange={(e) => setHintPenaltySeconds(Number(e.target.value))}
            className={inputClass}
            min={0}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={loading} className="bg-emerald-600 text-white hover:bg-emerald-700">
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {game ? "Mettre a jour" : "Creer le jeu"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="size-4" />
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}
