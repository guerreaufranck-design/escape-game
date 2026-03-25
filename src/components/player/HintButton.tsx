"use client";

import { useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

interface HintButtonProps {
  sessionId: string;
  stepOrder: number;
  hintsAvailable: number;
  hintsUsed: number;
  penaltySeconds: number;
  onHintReceived: (hint: { order: number; text: string; image?: string }) => void;
}

export function HintButton({
  sessionId,
  stepOrder,
  hintsAvailable,
  hintsUsed,
  penaltySeconds,
  onHintReceived,
}: HintButtonProps) {
  const [receivedHints, setReceivedHints] = useState<
    { order: number; text: string; image?: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = hintsAvailable - hintsUsed;
  const hasHintsLeft = remaining > 0;

  async function requestHint() {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/game/${sessionId}/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepOrder }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Impossible de recuperer l'indice.");
        return;
      }

      const hint = { order: data.hintOrder, text: data.text, image: data.image };
      setReceivedHints((prev) => [...prev, hint]);
      onHintReceived(hint);
    } catch {
      setError("Erreur de connexion.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <AlertDialog>
        <AlertDialogTrigger
          className="inline-flex items-center rounded-md border border-amber-800/50 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50 hover:text-amber-200 disabled:opacity-40 px-4 py-2"
        >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="mr-2 h-4 w-4" />
            )}
            Indice
            <Badge
              variant="outline"
              className="ml-2 border-amber-700/50 text-amber-400"
            >
              {remaining}/{hintsAvailable}
            </Badge>
        </AlertDialogTrigger>

        <AlertDialogContent className="border-gray-800 bg-gray-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-50">
              Demander un indice ?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-gray-400">
              <span className="block">
                Vous avez {remaining} indice{remaining > 1 ? "s" : ""} restant
                {remaining > 1 ? "s" : ""} pour cette etape.
              </span>
              <span className="block rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
                Penalite : +{penaltySeconds} secondes ajoutees a votre temps
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={requestHint}
              className="bg-amber-700 text-white hover:bg-amber-600"
            >
              <Lightbulb className="mr-2 h-4 w-4" />
              Utiliser un indice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {receivedHints.length > 0 && (
        <div className="space-y-2">
          {receivedHints.map((hint) => (
            <div
              key={hint.order}
              className="rounded-lg border border-amber-900/30 bg-amber-950/20 p-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-medium text-amber-400">
                  Indice {hint.order}
                </span>
              </div>
              <p className="text-sm text-amber-100">{hint.text}</p>
              {hint.image && (
                <img
                  src={hint.image}
                  alt={`Indice ${hint.order}`}
                  className="mt-2 rounded-md"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
