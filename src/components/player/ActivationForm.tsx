"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidCodeFormat } from "@/lib/code-generator";
import { useLocale } from "@/components/player/LocaleSelector";

export function ActivationForm() {
  const router = useRouter();
  const [locale] = useLocale();
  const [code, setCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleCodeChange(value: string) {
    // Remove anything that isn't alphanumeric or a dash
    let cleaned = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");

    // Auto-insert dashes at positions 4 and 9
    const digits = cleaned.replace(/-/g, "");
    let formatted = "";
    for (let i = 0; i < Math.min(digits.length, 12); i++) {
      if (i === 4 || i === 8) formatted += "-";
      formatted += digits[i];
    }

    setCode(formatted);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidCodeFormat(code)) {
      setError("Format de code invalide. Utilisez le format XXXX-XXXX-XXXX.");
      return;
    }

    if (!playerName.trim()) {
      setError("Veuillez entrer votre nom de joueur.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`/api/activate?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          playerName: playerName.trim(),
          teamName: teamName.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erreur lors de l'activation.");
        return;
      }

      router.push(`/play/${data.sessionId}`);
    } catch {
      setError("Erreur de connexion. Verifiez votre reseau.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md border-emerald-900/50 bg-gray-950/80 shadow-2xl shadow-emerald-900/20 backdrop-blur-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-800/50 bg-emerald-950/50">
          <Lock className="h-8 w-8 text-emerald-400" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight text-emerald-50">
          Entrez dans l&apos;aventure
        </CardTitle>
        <CardDescription className="text-gray-400">
          Saisissez votre code d&apos;activation pour commencer l&apos;escape
          game
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="code" className="text-emerald-200">
              Code d&apos;activation
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
              <Input
                id="code"
                placeholder="XXXX-XXXX-XXXX"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                maxLength={14}
                className="border-emerald-900/50 bg-gray-900/50 pl-10 font-mono text-lg tracking-widest text-emerald-100 placeholder:text-gray-600 focus:border-emerald-500 focus:ring-emerald-500/20"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="playerName" className="text-emerald-200">
              Nom du joueur
            </Label>
            <Input
              id="playerName"
              placeholder="Votre nom ou pseudo"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                setError(null);
              }}
              maxLength={50}
              className="border-emerald-900/50 bg-gray-900/50 text-emerald-100 placeholder:text-gray-600 focus:border-emerald-500 focus:ring-emerald-500/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamName" className="text-emerald-200">
              Nom d&apos;equipe{" "}
              <span className="text-gray-500">(optionnel)</span>
            </Label>
            <Input
              id="teamName"
              placeholder="Votre equipe"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={50}
              className="border-emerald-900/50 bg-gray-900/50 text-emerald-100 placeholder:text-gray-600 focus:border-emerald-500 focus:ring-emerald-500/20"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Activation en cours...
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Activer et commencer
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
