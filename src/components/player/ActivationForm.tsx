"use client";

import { useState, useRef } from "react";
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
  const [parts, setParts] = useState(["", "", ""]);
  const [playerName, setPlayerName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  const code = parts.join("-");

  function handlePartChange(index: number, value: string) {
    // Allow alphanumeric only, uppercase
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

    // Handle paste of full code (e.g. TEST-FRNK-2025)
    const fullPaste = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (fullPaste.includes("-")) {
      const pasted = fullPaste.split("-").map(p => p.slice(0, 4));
      const newParts = [...parts];
      for (let i = 0; i < 3; i++) {
        if (pasted[i]) newParts[i] = pasted[i];
      }
      setParts(newParts);
      setError(null);
      // Focus last filled field
      const lastIdx = Math.min(pasted.filter(p => p.length > 0).length - 1, 2);
      inputRefs.current[lastIdx]?.focus();
      return;
    }

    const newParts = [...parts];
    newParts[index] = cleaned;
    setParts(newParts);
    setError(null);

    // Auto-advance to next field when 4 chars typed
    if (cleaned.length === 4 && index < 2) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePartKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace on empty field goes to previous
    if (e.key === "Backspace" && parts[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
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
            <Label htmlFor="code-0" className="text-emerald-200">
              Code d&apos;activation
            </Label>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-emerald-600" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    id={`code-${i}`}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    placeholder="XXXX"
                    value={parts[i]}
                    onChange={(e) => handlePartChange(i, e.target.value)}
                    onKeyDown={(e) => handlePartKeyDown(i, e)}
                    maxLength={4}
                    className="w-[72px] border-emerald-900/50 bg-gray-900/50 text-center font-mono text-lg tracking-wider text-emerald-100 placeholder:text-gray-600 focus:border-emerald-500 focus:ring-emerald-500/20"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="characters"
                  />
                  {i < 2 && <span className="text-lg text-emerald-600 font-bold">-</span>}
                </div>
              ))}
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
