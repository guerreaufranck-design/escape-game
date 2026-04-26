"use client";

/**
 * Admin Review page — for each step of a generated game, the admin can
 * rate it (👍 / 👎) and leave a comment. Negative feedback is later
 * injected into future generation prompts as RAG to nudge Claude away
 * from patterns that didn't work.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, ThumbsDown, ArrowLeft, Save, Loader2, Check } from "lucide-react";

interface Step {
  id: string;
  step_order: number;
  title: string;
  riddle_text: string;
  answer_text: string;
  answer_source?: string;
  hints: { order: number; text: string }[];
  anecdote: string;
}

interface Feedback {
  id?: string;
  step_id: string;
  rating: number; // -1 | 0 | 1
  comment?: string | null;
}

interface GameInfo {
  id: string;
  title: string;
  city: string;
}

export default function AdminGameReviewPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const [game, setGame] = useState<GameInfo | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [feedbackByStep, setFeedbackByStep] = useState<Record<string, Feedback>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Fetch game
        const gameRes = await fetch(`/api/admin/games?id=${gameId}`);
        const gameData = await gameRes.json();
        const found = (gameData.games || []).find((g: GameInfo) => g.id === gameId);
        setGame(found || null);

        // Fetch steps
        const stepsRes = await fetch(`/api/admin/games/${gameId}/steps`);
        const stepsData = await stepsRes.json();
        setSteps(stepsData.steps || []);

        // Fetch existing feedback
        const fbRes = await fetch(`/api/admin/feedback?gameId=${gameId}`);
        const fbData = await fbRes.json();
        const map: Record<string, Feedback> = {};
        (fbData.feedback || []).forEach((f: Feedback) => {
          map[f.step_id] = f;
        });
        setFeedbackByStep(map);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [gameId]);

  function setRating(stepId: string, rating: number) {
    setFeedbackByStep((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] || { step_id: stepId, rating: 0 }), rating },
    }));
  }

  function setComment(stepId: string, comment: string) {
    setFeedbackByStep((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] || { step_id: stepId, rating: 0 }), comment },
    }));
  }

  async function save(step: Step) {
    const fb = feedbackByStep[step.id];
    if (!fb) return;
    setSavingId(step.id);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: step.id,
          gameId,
          rating: fb.rating,
          comment: fb.comment || null,
          city: game?.city,
          theme: game?.title,
          answerSource: step.answer_source,
        }),
      });
      if (res.ok) {
        setSavedId(step.id);
        setTimeout(() => setSavedId(null), 2000);
      }
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-8">
        <div className="text-center">
          <p className="mb-4">Jeu introuvable</p>
          <Button onClick={() => router.push("/admin/games")} variant="outline">
            Retour
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          onClick={() => router.push(`/admin/games/${gameId}`)}
          className="mb-4 text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour au jeu
        </Button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Review — {game.title}</h1>
          <p className="text-slate-400 text-sm">
            {game.city} · {steps.length} étapes
          </p>
          <p className="mt-3 text-xs text-amber-300/70 italic">
            ⚡ Les feedbacks 👎 servent à améliorer les prompts de génération futurs sur des thèmes/villes similaires.
          </p>
        </div>

        <div className="space-y-4">
          {steps.map((step) => {
            const fb = feedbackByStep[step.id] || { step_id: step.id, rating: 0 };
            return (
              <Card
                key={step.id}
                className={`bg-slate-900 ${
                  fb.rating === 1
                    ? "border-emerald-500/40"
                    : fb.rating === -1
                      ? "border-rose-500/40"
                      : "border-slate-800"
                }`}
              >
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>
                      Étape {step.step_order} — {step.title}
                    </span>
                    {step.answer_source === "virtual_ar" && (
                      <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">
                        virtual_ar
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1 text-sm">
                    <p className="text-slate-300">
                      <span className="text-slate-500">Énigme : </span>
                      {step.riddle_text}
                    </p>
                    <p className="text-amber-300">
                      <span className="text-slate-500">Réponse : </span>
                      <span className="font-mono font-bold">{step.answer_text}</span>
                    </p>
                    <p className="text-slate-400 text-xs italic mt-2">
                      <span className="text-slate-500">Anecdote : </span>
                      {step.anecdote}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant={fb.rating === 1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRating(step.id, fb.rating === 1 ? 0 : 1)}
                      className={
                        fb.rating === 1
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "border-slate-700"
                      }
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                      Bien
                    </Button>
                    <Button
                      variant={fb.rating === -1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRating(step.id, fb.rating === -1 ? 0 : -1)}
                      className={
                        fb.rating === -1
                          ? "bg-rose-600 hover:bg-rose-700"
                          : "border-slate-700"
                      }
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                      Pas bien
                    </Button>
                  </div>

                  <Textarea
                    placeholder={
                      fb.rating === -1
                        ? "Pourquoi ? (sera utilisé pour améliorer les prochains jeux similaires)"
                        : "Commentaire optionnel"
                    }
                    value={fb.comment || ""}
                    onChange={(e) => setComment(step.id, e.target.value)}
                    className="bg-slate-800 border-slate-700 text-sm"
                    rows={2}
                  />

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => save(step)}
                      disabled={savingId === step.id || fb.rating === 0}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {savingId === step.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : savedId === step.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Enregistré
                        </>
                      ) : (
                        <>
                          <Save className="h-3.5 w-3.5 mr-1" />
                          Enregistrer
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
