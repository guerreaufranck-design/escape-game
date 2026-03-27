"use client";

import { useState, useRef, useEffect } from "react";
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
import { useLocale } from "@/components/player/LocaleSelector";
import { Locale, SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { tt } from "@/lib/translations";

const FLAGS: Record<Locale, string> = {
  fr: '\u{1F1EB}\u{1F1F7}',
  en: '\u{1F1EC}\u{1F1E7}',
  de: '\u{1F1E9}\u{1F1EA}',
  es: '\u{1F1EA}\u{1F1F8}',
  it: '\u{1F1EE}\u{1F1F9}',
};

function LanguageSelect({ onSelect }: { onSelect: (l: Locale) => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 -right-20 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
          <Compass className="h-10 w-10 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Escape Game <span className="text-emerald-400">Outdoor</span>
        </h1>
        <p className="text-slate-500 text-sm">
          Seleccione / Select / Wahlen / Scegliere
        </p>
      </div>

      <div className="relative grid grid-cols-1 gap-3 w-full max-w-xs">
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            onClick={() => onSelect(l)}
            className="flex items-center gap-4 px-5 py-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800/80 transition-all duration-200 group"
          >
            <span className="text-3xl">{FLAGS[l]}</span>
            <span className="text-lg font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">
              {LOCALE_LABELS[l]}
            </span>
          </button>
        ))}
      </div>

      <footer className="absolute bottom-4 text-center text-xs text-slate-700">
        Escape Game Outdoor
      </footer>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  const [langChosen, setLangChosen] = useState(false);
  const [parts, setParts] = useState(["", "", ""]);
  const [playerName, setPlayerName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  // Check if language was already chosen in a previous visit
  useEffect(() => {
    const stored = localStorage.getItem('escape-game-locale');
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
      setLangChosen(true);
    }
  }, []);

  const code = parts.join("-");

  const handleLangSelect = (l: Locale) => {
    setLocale(l);
    setLangChosen(true);
  };

  const handlePartChange = (index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

    // Handle paste of full code (e.g. TEST-FRNK-2025)
    const fullPaste = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (fullPaste.includes("-")) {
      const pasted = fullPaste.split("-").filter(p => p.length > 0).map(p => p.replace(/[^A-Z0-9]/g, "").slice(0, 4));
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
      setError(tt('home.invalidCode', locale));
      return;
    }

    if (playerName.trim().length < 2) {
      setError(tt('home.nameTooShort', locale));
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
        setError(data.error || tt('home.activationError', locale));
        return;
      }

      router.push(`/play/${data.sessionId}`);
    } catch {
      setError(tt('home.connectionError', locale));
    } finally {
      setLoading(false);
    }
  };

  // Show language selection first
  if (!langChosen) {
    return <LanguageSelect onSelect={handleLangSelect} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <div className="absolute top-4 right-4 z-20">
        <button
          onClick={() => setLangChosen(false)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm transition-colors"
        >
          <span>{FLAGS[locale]}</span>
          <span className="hidden sm:inline text-zinc-300">{LOCALE_LABELS[locale]}</span>
          <svg className="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
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
            {tt('home.title', locale)}{" "}
            <span className="text-emerald-400">{tt('home.outdoor', locale)}</span>
          </h1>
          <p className="text-slate-500 mt-2 max-w-xs mx-auto">
            {tt('home.subtitle', locale)}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <MapPin className="h-3 w-3 mr-1" />
            {tt('home.badge.geolocation', locale)}
          </Badge>
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <Trophy className="h-3 w-3 mr-1" />
            {tt('home.badge.ranking', locale)}
          </Badge>
          <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
            <Sparkles className="h-3 w-3 mr-1" />
            {tt('home.badge.riddles', locale)}
          </Badge>
        </div>

        <Card className="bg-slate-900/80 border-slate-800 w-full max-w-sm backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-2">
              <KeyRound className="h-6 w-6 text-emerald-400" />
            </div>
            <CardTitle className="text-lg">{tt('home.enterCode', locale)}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code-0" className="text-slate-400 text-sm">
                  {tt('home.activationCode', locale)}
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
                  {tt('home.yourName', locale)}
                </Label>
                <Input
                  id="playerName"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder={tt('home.playerNamePlaceholder', locale)}
                  className="bg-slate-800 border-slate-700"
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="teamName" className="text-slate-400 text-sm">
                  <Users className="h-3 w-3 inline mr-1" />
                  {tt('home.teamName', locale)}{" "}
                  <span className="text-slate-600">{tt('home.optional', locale)}</span>
                </Label>
                <Input
                  id="teamName"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={tt('home.teamPlaceholder', locale)}
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
                    {tt('home.startAdventure', locale)}
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
          {tt('home.viewLeaderboard', locale)}
        </Button>
      </div>

      <footer className="relative text-center py-4 text-xs text-slate-700">
        Escape Game Outdoor
      </footer>
    </div>
  );
}
