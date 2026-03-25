"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Game } from "@/types/database";
import { t } from "@/lib/i18n";
import {
  Loader2,
  Zap,
  Copy,
  ClipboardList,
  Check,
} from "lucide-react";

interface CodeGeneratorProps {
  games: Game[];
}

export function CodeGenerator({ games }: CodeGeneratorProps) {
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [count, setCount] = useState(10);
  const [isSingleUse, setIsSingleUse] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30";
  const labelClass = "mb-1 block text-sm font-medium text-zinc-300";

  async function handleGenerate() {
    if (!gameId) return;
    setLoading(true);
    setError("");
    setGeneratedCodes([]);

    try {
      const body: Record<string, unknown> = {
        gameId,
        count,
        isSingleUse,
      };
      if (teamName) body.teamName = teamName;
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la generation");
      }

      const data = await res.json();
      setGeneratedCodes(data.codes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode(code: string, index: number) {
    await navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(generatedCodes.join("\n"));
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
        <h3 className="font-semibold text-zinc-100">Generer des codes</h3>

        <div>
          <label className={labelClass}>Jeu *</label>
          <select
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            className={inputClass}
          >
            <option value="">Selectionner un jeu</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {t(g.title)} ({g.city ?? "sans ville"})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Nombre de codes</label>
            <input
              type="number"
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(1, Math.min(500, Number(e.target.value)))
                )
              }
              className={inputClass}
              min={1}
              max={500}
            />
          </div>
          <div>
            <label className={labelClass}>Nom d&apos;equipe (optionnel)</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className={inputClass}
              placeholder="Equipe Alpha"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Expiration (optionnel)</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isSingleUse"
            checked={isSingleUse}
            onChange={(e) => setIsSingleUse(e.target.checked)}
            className="size-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
          />
          <label htmlFor="isSingleUse" className="text-sm text-zinc-300">
            Usage unique
          </label>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <Button
          onClick={handleGenerate}
          disabled={loading || !gameId}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          Generer {count} code{count > 1 ? "s" : ""}
        </Button>
      </div>

      {/* Generated codes list */}
      {generatedCodes.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-zinc-100">
              Codes generes ({generatedCodes.length})
            </h3>
            <Button variant="outline" size="sm" onClick={copyAll}>
              {allCopied ? (
                <Check className="size-3 text-emerald-400" />
              ) : (
                <ClipboardList className="size-3" />
              )}
              {allCopied ? "Copie !" : "Copier tout"}
            </Button>
          </div>
          <div className="max-h-[400px] space-y-1 overflow-y-auto">
            {generatedCodes.map((code, i) => (
              <div
                key={code}
                className="flex items-center justify-between rounded-lg bg-zinc-800/60 px-3 py-2"
              >
                <code className="font-mono text-sm text-emerald-400">
                  {code}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copyCode(code, i)}
                >
                  {copiedIndex === i ? (
                    <Check className="size-3 text-emerald-400" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
