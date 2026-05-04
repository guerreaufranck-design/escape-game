"use client";

/**
 * Single-game card for the admin games list. Wraps the existing
 * cover-image-and-metadata layout with two new bits of UX:
 *   - a green/yellow/red HEALTH badge fetched from
 *     /api/admin/games/[gameId]/health on mount
 *   - a 🔄 REFRESH button that calls
 *     POST /api/admin/games/[gameId]/refresh and shows the result
 *
 * The card itself remains a clickable link to the game detail page;
 * the badge and refresh button are stop-propagation islands so they
 * don't navigate when interacted with.
 */

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useCallback } from "react";
import {
  MapPin,
  Star,
  Eye,
  EyeOff,
  ChevronRight,
  ImageIcon,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
} from "lucide-react";

interface Health {
  level: "ok" | "partial" | "stale";
  summary: string;
  packagedLanguages: string[];
  issues: {
    maxHintsCapTooLow: boolean;
    stepsWithFewerThan3Hints: number[];
    languagesPackagedNotFullyTranslated: string[];
    languagesPackagedMissingAudio: string[];
  };
}

interface RefreshResult {
  ok: boolean;
  durationMs: number;
  bumpedHintsCap: boolean;
  stepsRegenerated: number[];
  hintErrors: string[];
  languagesProcessed: Array<{
    language: string;
    ok: boolean;
    audioGenerated: number;
    audioSkipped: number;
    durationMs: number;
    errors: string[];
  }>;
  before: { level: string; summary: string };
  after: { level: string; summary: string };
}

interface GameCardProps {
  gameId: string;
  title: string;
  description: string | null;
  city: string | null;
  difficulty: number;
  isPublished: boolean;
  coverImage: string | null;
  stepCount: number;
}

const BADGE_STYLES: Record<Health["level"], { bg: string; text: string; icon: typeof CheckCircle2; label: string }> = {
  ok: {
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-400",
    icon: CheckCircle2,
    label: "À jour",
  },
  partial: {
    bg: "bg-yellow-500/10 border-yellow-500/30",
    text: "text-yellow-400",
    icon: AlertCircle,
    label: "Partiel",
  },
  stale: {
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
    icon: XCircle,
    label: "Obsolète",
  },
};

export function GameCard({
  gameId,
  title,
  description,
  city,
  difficulty,
  isPublished,
  coverImage,
  stepCount,
}: GameCardProps) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<RefreshResult | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/games/${gameId}/health`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Health;
      setHealth(data);
      setHealthError(null);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : "audit failed");
    }
  }, [gameId]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (refreshing) return;
    setRefreshing(true);
    setLastResult(null);
    try {
      const res = await fetch(`/api/admin/games/${gameId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const result = (await res.json()) as RefreshResult;
      setLastResult(result);
      // Re-audit so the badge updates
      await loadHealth();
    } catch (err) {
      setLastResult({
        ok: false,
        durationMs: 0,
        bumpedHintsCap: false,
        stepsRegenerated: [],
        hintErrors: [err instanceof Error ? err.message : "unknown error"],
        languagesProcessed: [],
        before: { level: "?", summary: "?" },
        after: { level: "?", summary: "?" },
      });
    } finally {
      setRefreshing(false);
    }
  };

  const badge = health ? BADGE_STYLES[health.level] : null;
  const BadgeIcon = badge?.icon;

  return (
    <div className="group relative rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden transition hover:border-zinc-700 hover:bg-zinc-900">
      <Link href={`/admin/games/${gameId}`} className="block">
        {coverImage ? (
          <div className="relative w-full h-40 bg-zinc-800">
            <Image
              src={coverImage}
              alt={title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          </div>
        ) : (
          <div className="w-full h-28 bg-zinc-800/50 flex items-center justify-center">
            <ImageIcon className="size-8 text-zinc-700" />
          </div>
        )}
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition">
              {title}
            </h3>
            <span className="shrink-0">
              {isPublished ? (
                <Eye className="size-4 text-emerald-500" />
              ) : (
                <EyeOff className="size-4 text-zinc-600" />
              )}
            </span>
          </div>
          {description && (
            <p className="mb-3 line-clamp-2 text-sm text-zinc-500">
              {description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" />
                {city}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Star className="size-3" />
              {difficulty}/5
            </span>
            <span>
              {stepCount} etape{stepCount !== 1 ? "s" : ""}
            </span>
            <ChevronRight className="ml-auto size-4 text-zinc-600 group-hover:text-zinc-400 transition" />
          </div>
        </div>
      </Link>

      {/* Health + refresh row — sits below the metadata, NOT inside
          the link, so clicks don't navigate. */}
      <div className="border-t border-zinc-800 px-5 py-3 flex items-center justify-between gap-3">
        {/* Badge */}
        <div className="min-w-0 flex-1">
          {healthError && (
            <span className="text-xs text-zinc-500">audit indisponible</span>
          )}
          {!health && !healthError && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="size-3 animate-spin" />
              audit en cours…
            </span>
          )}
          {health && badge && BadgeIcon && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${badge.bg} ${badge.text}`}
              title={health.summary}
            >
              <BadgeIcon className="size-3.5" />
              <span>{badge.label}</span>
              {health.packagedLanguages.length > 0 && (
                <span className="text-zinc-500 font-normal">
                  · {health.packagedLanguages.length} lang
                </span>
              )}
            </div>
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing || !health}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-emerald-700 hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            health?.level === "ok"
              ? "Forcer la mise à jour (déjà à jour, peut prendre plusieurs minutes)"
              : "Mettre le jeu à jour : régénère les indices manquants et complète les traductions/audio"
          }
        >
          {refreshing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {refreshing ? "En cours…" : "Mettre à jour"}
        </button>
      </div>

      {/* Last refresh result — inline, above the card so it's seen
          without scrolling. Auto-collapses after a few seconds. */}
      {lastResult && (
        <div
          className={`border-t border-zinc-800 px-5 py-3 text-xs ${
            lastResult.ok ? "bg-emerald-950/30 text-emerald-200" : "bg-red-950/30 text-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="font-semibold">
                {lastResult.ok ? "✓ Mise à jour terminée" : "✗ Mise à jour partielle"}
                <span className="ml-2 font-normal opacity-70">
                  ({Math.round(lastResult.durationMs / 1000)}s)
                </span>
              </p>
              {lastResult.bumpedHintsCap && (
                <p className="opacity-80">• Cap d'indices bumpé à 3</p>
              )}
              {lastResult.stepsRegenerated.length > 0 && (
                <p className="opacity-80">
                  • Indices régénérés sur les étapes {lastResult.stepsRegenerated.join(", ")}
                </p>
              )}
              {lastResult.languagesProcessed.length > 0 && (
                <p className="opacity-80">
                  • Langues retraitées :{" "}
                  {lastResult.languagesProcessed
                    .map((l) =>
                      `${l.language}${l.audioGenerated > 0 ? ` (+${l.audioGenerated} mp3)` : ""}${!l.ok ? " ⚠" : ""}`,
                    )
                    .join(", ")}
                </p>
              )}
              {lastResult.hintErrors.length > 0 && (
                <p className="text-red-300">
                  • Erreurs indices : {lastResult.hintErrors.join("; ")}
                </p>
              )}
            </div>
            <button
              onClick={() => setLastResult(null)}
              className="shrink-0 text-zinc-500 hover:text-zinc-200"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
