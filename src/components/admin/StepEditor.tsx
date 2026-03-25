"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { stepSchema } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import type { GameStep } from "@/types/database";
import type { Hint } from "@/types/game";
import { t } from "@/lib/i18n";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  MapPin,
  Save,
  X,
  Loader2,
  GripVertical,
} from "lucide-react";

const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });

interface StepEditorProps {
  gameId: string;
  steps: GameStep[];
  onSave: (steps: GameStep[]) => Promise<void>;
}

interface StepFormData {
  title: string;
  riddleText: string;
  answerText: string;
  latitude: number;
  longitude: number;
  validationRadiusMeters: number;
  hasPhotoChallenge: boolean;
  bonusTimeSeconds: number;
  hints: Hint[];
}

const emptyStep: StepFormData = {
  title: "",
  riddleText: "",
  answerText: "",
  latitude: 48.8566,
  longitude: 2.3522,
  validationRadiusMeters: 30,
  hasPhotoChallenge: false,
  bonusTimeSeconds: 0,
  hints: [],
};

export function StepEditor({ gameId, steps, onSave }: StepEditorProps) {
  const [localSteps, setLocalSteps] = useState<GameStep[]>(steps);
  const [editing, setEditing] = useState<StepFormData | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30";
  const labelClass = "mb-1 block text-sm font-medium text-zinc-300";

  function moveStep(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= localSteps.length) return;
    const updated = [...localSteps];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    updated.forEach((s, i) => (s.step_order = i + 1));
    setLocalSteps(updated);
  }

  function openNewStep() {
    setEditing({ ...emptyStep });
    setEditingIndex(null);
    setErrors({});
  }

  function openEditStep(index: number) {
    const step = localSteps[index];
    setEditing({
      title: t(step.title),
      riddleText: t(step.riddle_text),
      answerText: t(step.answer_text) || "",
      latitude: step.latitude,
      longitude: step.longitude,
      validationRadiusMeters: step.validation_radius_meters,
      hasPhotoChallenge: step.has_photo_challenge,
      bonusTimeSeconds: step.bonus_time_seconds,
      hints: (step.hints as unknown as Hint[]) ?? [],
    });
    setEditingIndex(index);
    setErrors({});
  }

  function deleteStep(index: number) {
    const updated = localSteps.filter((_, i) => i !== index);
    updated.forEach((s, i) => (s.step_order = i + 1));
    setLocalSteps(updated);
    setDeleteConfirm(null);
  }

  function saveStepForm() {
    if (!editing) return;
    setErrors({});

    const result = stepSchema.safeParse(editing);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (path) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const stepData = result.data;
    const now = new Date().toISOString();

    if (editingIndex !== null) {
      // Edit existing
      const updated = [...localSteps];
      updated[editingIndex] = {
        ...updated[editingIndex],
        title: { fr: stepData.title },
        riddle_text: { fr: stepData.riddleText },
        answer_text: stepData.answerText ? { fr: stepData.answerText } : null,
        latitude: stepData.latitude,
        longitude: stepData.longitude,
        validation_radius_meters: stepData.validationRadiusMeters,
        has_photo_challenge: stepData.hasPhotoChallenge,
        bonus_time_seconds: stepData.bonusTimeSeconds,
        hints: stepData.hints as unknown as GameStep["hints"],
      };
      setLocalSteps(updated);
    } else {
      // New step
      const newStep: GameStep = {
        id: crypto.randomUUID(),
        game_id: gameId,
        step_order: localSteps.length + 1,
        title: { fr: stepData.title },
        riddle_text: { fr: stepData.riddleText },
        riddle_image: null,
        answer_text: stepData.answerText ? { fr: stepData.answerText } : null,
        latitude: stepData.latitude,
        longitude: stepData.longitude,
        validation_radius_meters: stepData.validationRadiusMeters,
        has_photo_challenge: stepData.hasPhotoChallenge,
        photo_reference: null,
        hints: stepData.hints as unknown as GameStep["hints"],
        bonus_time_seconds: stepData.bonusTimeSeconds,
        created_at: now,
      };
      setLocalSteps([...localSteps, newStep]);
    }

    setEditing(null);
    setEditingIndex(null);
  }

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!editing) return;
      setEditing({ ...editing, latitude: lat, longitude: lng });
    },
    [editing]
  );

  function addHint() {
    if (!editing) return;
    setEditing({
      ...editing,
      hints: [
        ...editing.hints,
        { order: editing.hints.length + 1, text: "" },
      ],
    });
  }

  function updateHint(index: number, text: string) {
    if (!editing) return;
    const hints = [...editing.hints];
    hints[index] = { ...hints[index], text };
    setEditing({ ...editing, hints });
  }

  function removeHint(index: number) {
    if (!editing) return;
    const hints = editing.hints.filter((_, i) => i !== index);
    hints.forEach((h, i) => (h.order = i + 1));
    setEditing({ ...editing, hints });
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await onSave(localSteps);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">
          Etapes ({localSteps.length})
        </h3>
        <div className="flex gap-2">
          <Button
            onClick={openNewStep}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Plus className="size-4" />
            Ajouter une etape
          </Button>
          <Button
            onClick={handleSaveAll}
            disabled={saving}
            variant="outline"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Sauvegarder
          </Button>
        </div>
      </div>

      {/* Steps list */}
      <div className="space-y-2">
        {localSteps
          .sort((a, b) => a.step_order - b.step_order)
          .map((step, i) => (
            <div
              key={step.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
            >
              <GripVertical className="size-4 text-zinc-600" />
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-900/40 text-xs font-bold text-emerald-400">
                {step.step_order}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-200">
                  {t(step.title)}
                </p>
                <p className="text-xs text-zinc-500">
                  <MapPin className="mr-1 inline size-3" />
                  {step.latitude.toFixed(4)}, {step.longitude.toFixed(4)} -
                  rayon {step.validation_radius_meters}m
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveStep(i, "up")}
                  disabled={i === 0}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveStep(i, "down")}
                  disabled={i === localSteps.length - 1}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEditStep(i)}
                >
                  <Save className="size-4" />
                </Button>
                {deleteConfirm === i ? (
                  <div className="flex gap-1">
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => deleteStep(i)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteConfirm(null)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteConfirm(i)}
                  >
                    <Trash2 className="size-4 text-red-400" />
                  </Button>
                )}
              </div>
            </div>
          ))}
      </div>

      {localSteps.length === 0 && !editing && (
        <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
          Aucune etape. Cliquez sur &quot;Ajouter une etape&quot; pour commencer.
        </div>
      )}

      {/* Step form */}
      {editing && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
          <h4 className="font-semibold text-zinc-100">
            {editingIndex !== null ? "Modifier l'etape" : "Nouvelle etape"}
          </h4>

          <div>
            <label className={labelClass}>Titre *</label>
            <input
              type="text"
              value={editing.title}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
              className={inputClass}
              placeholder="Nom de l'etape"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-red-400">{errors.title}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>Texte de l&apos;enigme *</label>
            <textarea
              value={editing.riddleText}
              onChange={(e) =>
                setEditing({ ...editing, riddleText: e.target.value })
              }
              className={`${inputClass} min-h-[80px] resize-y`}
              placeholder="L'enigme que le joueur devra resoudre..."
            />
            {errors.riddleText && (
              <p className="mt-1 text-xs text-red-400">{errors.riddleText}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>Reponse (optionnel)</label>
            <input
              type="text"
              value={editing.answerText}
              onChange={(e) =>
                setEditing({ ...editing, answerText: e.target.value })
              }
              className={inputClass}
              placeholder="Texte de reponse..."
            />
          </div>

          {/* Map picker */}
          <div>
            <label className={labelClass}>Coordonnees GPS</label>
            <div className="mb-2 grid grid-cols-2 gap-3">
              <div>
                <input
                  type="number"
                  step="any"
                  value={editing.latitude}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      latitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className={inputClass}
                  placeholder="Latitude"
                />
              </div>
              <div>
                <input
                  type="number"
                  step="any"
                  value={editing.longitude}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      longitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className={inputClass}
                  placeholder="Longitude"
                />
              </div>
            </div>
            <div className="h-[300px] overflow-hidden rounded-lg border border-zinc-700">
              <MapPicker
                lat={editing.latitude}
                lng={editing.longitude}
                onLocationChange={handleMapClick}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Rayon de validation (m)</label>
              <input
                type="number"
                value={editing.validationRadiusMeters}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    validationRadiusMeters: Number(e.target.value),
                  })
                }
                className={inputClass}
                min={5}
                max={500}
              />
            </div>
            <div>
              <label className={labelClass}>Bonus temps (sec)</label>
              <input
                type="number"
                value={editing.bonusTimeSeconds}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bonusTimeSeconds: Number(e.target.value),
                  })
                }
                className={inputClass}
                min={0}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasPhotoChallenge"
              checked={editing.hasPhotoChallenge}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  hasPhotoChallenge: e.target.checked,
                })
              }
              className="size-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
            />
            <label htmlFor="hasPhotoChallenge" className="text-sm text-zinc-300">
              Defi photo requis
            </label>
          </div>

          {/* Hints */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className={labelClass}>Indices</label>
              <Button variant="ghost" size="sm" onClick={addHint}>
                <Plus className="size-3" />
                Ajouter un indice
              </Button>
            </div>
            <div className="space-y-2">
              {editing.hints.map((hint, i) => (
                <div key={i} className="flex gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-400">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={hint.text}
                    onChange={(e) => updateHint(i, e.target.value)}
                    className={`${inputClass} flex-1`}
                    placeholder={`Indice ${i + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeHint(i)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={saveStepForm}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Save className="size-4" />
              {editingIndex !== null ? "Mettre a jour" : "Ajouter"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setEditingIndex(null);
              }}
            >
              <X className="size-4" />
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
