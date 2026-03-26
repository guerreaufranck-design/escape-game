"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  MapPin,
  Trophy,
  Compass,
  Loader2,
  User,
  Users,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { isValidCodeFormat } from "@/lib/code-generator";
import { useLocale, LocaleSelector } from "@/components/player/LocaleSelector";

export default function HomePage() {
  const router = useRouter();
  const [locale] = useLocale();
  const [parts, setParts] = useState(["", "", ""]);
  const [playerName, setPlayerName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  const code = parts.join("-");

  const handlePartChange = (index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

    // Handle paste of full code (e.g. TEST-FRNK-2025)
    const fullPaste = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (fullPaste.includes("-")) {
      const pasted = fullPaste.split("-").map(p => p.replace(/[^A-Z0-9]/g, "").slice(0, 4));
      const newParts = [...parts];
      for (let i = 0; i < 3; i++) {
        if (pasted[i]) newParts[i] = pasted[i];
      }
      setParts(newParts);
      setError(null);
      const lastIdx = Math.min(pasted.filter(p => p.length > 0).length - 1, 2);
      inputRefs.current[lastIdx]?.focus();
      return;
    }

    const newParts = [...parts];
    newParts[index] = cleaned;
    setParts(newParts);
    setError(null);

    if (cleaned.length === 4 && index < 2) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePartKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && parts[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidCodeFormat(code)) {
      setError("Format de code invalide (XXXX-XXXX-XXXX)");
      return;
    }

    if (playerName.trim().length < 2) {
      setError("Entrez votre nom (min. 2 caracteres)");
      return;
    }

    setLoading(true);
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

      if (!res.ok || data.error) {
        setError(data.error || "Erreur d'activation");
        return;
      }

      router.push(`/play/${data.sessionId}`);
    } catch {
      setError("Erreur de connexion au serveur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <div className="absolute top-4 right-4 z-20">
        <LocaleSelector />
      </div>
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 -right-20 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
            <Compass className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Escape Game{" "}
            <span className="text-emerald-400">Outdoor</span>
          </h1>
          <p className="text-slate-500 mt-2 max-w-xs mx-auto">
            Explorez, resolvez, triomphez. L&apos;aventure vous attend dehors.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <MapPin className="h-3 w-3 mr-1" />
            Geolocalisation
          </Badge>
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <Trophy className="h-3 w-3 mr-1" />
            Classement
          </Badge>
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <Sparkles className="h-3 w-3 mr-1" />
            Enigmes
          </Badge>
        </div>

        <Card className="bg-slate-900/80 border-slate-800 w-full max-w-sm backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-2">
              <KeyRound className="h-6 w-6 text-emerald-400" />
            </div>
            <CardTitle className="text-lg">Entrez votre code</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code-0" className="text-slate-400 text-sm">
                  Code d&apos;activation
                </Label>
                <div className="flex items-center justify-center gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        id={`code-${i}`}
                        ref={(el) => { inputRefs.current[i] = el; }}
                        value={parts[i]}
                        onChange={(e) => handlePartChange(i, e.target.value)}
                        onKeyDown={(e) => handlePartKeyDown(i, e)}
                        placeholder="XXXX"
                        className="bg-slate-800 border-slate-700 text-center text-lg font-mono tracking-wider uppercase placeholder:text-slate-600 w-[80px]"
                        maxLength={4}
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="characters"
                        autoFocus={i === 0}
                      />
                      {i < 2 && <span className="text-lg text-slate-500 font-bold">-</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="playerName" className="text-slate-400 text-sm">
                  <User className="h-3 w-3 inline mr-1" />
                  Votre nom
                </Label>
                <Input
                  id="playerName"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Votre nom de joueur"
                  className="bg-slate-800 border-slate-700"
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="teamName" className="text-slate-400 text-sm">
                  <Users className="h-3 w-3 inline mr-1" />
                  Nom d&apos;equipe{" "}
                  <span className="text-slate-600">(optionnel)</span>
                </Label>
                <Input
                  id="teamName"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Nom de votre equipe"
                  className="bg-slate-800 border-slate-700"
                  maxLength={50}
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-12"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Lancer l&apos;aventure
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Button
          variant="ghost"
          className="mt-6 text-slate-500 hover:text-slate-300"
          onClick={() => router.push("/leaderboard")}
        >
          <Trophy className="h-4 w-4 mr-2" />
          Voir le classement general
        </Button>
      </div>

      <footer className="relative text-center py-4 text-xs text-slate-700">
        Escape Game Outdoor
      </footer>
    </div>
  );
}
