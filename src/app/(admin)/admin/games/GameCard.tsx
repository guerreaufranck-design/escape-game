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
  /** Slug du jeu — requis pour la régénération complète. Null pour les
   *  vieux jeux sans slug (création antérieure à la migration 005). */
  slug: string | null;
  title: string;
  description: string | null;
  city: string | null;
  difficulty: number;
  isPublished: boolean;
  coverImage: string | null;
  stepCount: number;
}

interface RegenerateResult {
  ok: boolean;
  newGameId?: string;
  oldGameId?: string;
  stopCount?: number;
  stops?: Array<{ order: number; name: string; lat: number; lon: number }>;
  codesMigrated?: number;
  sessionsReset?: number;
  discoverySource?: string;
  durationSec?: number;
  warnings?: string[];
  error?: string;
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
  slug,
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
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<RegenerateResult | null>(null);

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

  /**
   * Régénération COMPLÈTE du jeu via /api/admin/regenerate-game.
   *
   * Behavior (vision client 2026-05-16) :
   *   - Le jeu existant est unpublished (préservé pour audit, pas supprimé)
   *   - Un NOUVEAU jeu avec même slug est généré via pipeline patrimoine-first
   *   - Les codes activation déjà envoyés aux clients sont MIGRÉS vers le
   *     nouveau gameId — donc TOUS RESTENT VALIDES après régénération
   *   - Les sessions actives (joueur en cours) sont marquées 'abandoned'
   *     pour qu'elles ne se retrouvent pas orphelines (le joueur peut
   *     relancer son code et tomber sur le nouveau jeu)
   */
  const handleRegenerate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (regenerating || refreshing) return;
    if (!slug) {
      setRegenResult({
        ok: false,
        error:
          "Ce jeu n'a pas de slug — impossible de le régénérer (legacy avant migration 005)",
      });
      return;
    }
    const confirmed = window.confirm(
      `⚠️ RÉGÉNÉRATION COMPLÈTE de "${title}"\n\n` +
        `Cela va :\n` +
        `  • Supprimer les ${stepCount} stops actuels\n` +
        `  • Lancer le pipeline patrimoine-first (Gemini + Claude + ElevenLabs)\n` +
        `  • Générer 7-8 nouveaux stops basés sur les monuments majeurs de la ville\n` +
        `  • Migrer les codes activation existants vers le nouveau jeu (ils resteront valides)\n` +
        `  • Abandonner les sessions joueur en cours (elles devront relancer)\n\n` +
        `Durée estimée : 3-5 minutes.\n\n` +
        `Confirmer la régénération ?`,
    );
    if (!confirmed) return;
    setRegenerating(true);
    setRegenResult(null);
    setLastResult(null);
    try {
      const res = await fetch(`/api/admin/regenerate-game`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Le bouton admin appelle directement le backend authentifié par
          // session admin (cookies). L'endpoint accepte aussi le Bearer
          // EXTERNAL_API_SECRET pour les calls CLI — donc on n'envoie pas
          // de header Authorization ici, le middleware admin valide via
          // session cookie.
        },
        body: JSON.stringify({ slug, resetSessions: true }),
      });
      const data = (await res.json()) as RegenerateResult;
      if (!res.ok || !data.ok) {
        setRegenResult({
          ok: false,
          error: data.error || `HTTP ${res.status}`,
        });
      } else {
        setRegenResult(data);
        await loadHealth();
      }
    } catch (err) {
      setRegenResult({
        ok: false,
        error: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setRegenerating(false);
    }
  };

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

        {/* Refresh button — patch gaps only (hints + missing translations/audios) */}
        <button
          onClick={handleRefresh}
          disabled={refreshing || regenerating || !health}
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

        {/* Regenerate button — full pipeline rerun (patrimoine-first).
            Visible uniquement si slug présent. Distinct visuellement
            (orange) pour qu'on ne confonde pas avec le bouton bleu de
            mise à jour. Confirmation modale au clic. */}
        {slug && (
          <button
            onClick={handleRegenerate}
            disabled={regenerating || refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-700/60 bg-orange-950/40 px-2.5 py-1 text-xs font-medium text-orange-300 transition hover:border-orange-500 hover:text-orange-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Régénération complète du jeu (Gemini + Claude + ElevenLabs). Les codes activation existants restent valides."
          >
            {regenerating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {regenerating ? "Régénération…" : "Régénérer"}
          </button>
        )}
      </div>

      {/* Regenerate result — affiche le résumé du nouveau jeu ou l'erreur */}
      {regenResult && (
        <div
          className={`border-t border-zinc-800 px-5 py-3 text-xs ${
            regenResult.ok ? "bg-emerald-950/30 text-emerald-200" : "bg-red-950/30 text-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="font-semibold">
                {regenResult.ok ? "♻️ Régénération terminée" : "✗ Régénération échouée"}
                {regenResult.durationSec !== undefined && (
                  <span className="ml-2 font-normal opacity-70">
                    ({regenResult.durationSec}s)
                  </span>
                )}
              </p>
              {regenResult.ok ? (
                <>
                  <p className="opacity-80">
                    Nouveau gameId : <span className="font-mono">{regenResult.newGameId?.slice(0, 8)}…</span>
                    {" "}· {regenResult.stopCount} stops · source: {regenResult.discoverySource}
                  </p>
                  {regenResult.codesMigrated !== undefined && regenResult.codesMigrated > 0 && (
                    <p className="opacity-80">
                      ✓ {regenResult.codesMigrated} code(s) activation migré(s) (toujours valides)
                    </p>
                  )}
                  {regenResult.sessionsReset !== undefined && regenResult.sessionsReset > 0 && (
                    <p className="opacity-80">
                      ⓘ {regenResult.sessionsReset} session(s) abandonnée(s)
                    </p>
                  )}
                  {regenResult.stops && regenResult.stops.length > 0 && (
                    <details className="mt-2 opacity-90">
                      <summary className="cursor-pointer hover:text-emerald-100">
                        Voir les {regenResult.stops.length} nouveaux stops
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {regenResult.stops.map((s) => (
                          <li key={s.order} className="font-mono text-[11px]">
                            {s.order}. {s.name} · {s.lat.toFixed(4)},{s.lon.toFixed(4)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {regenResult.warnings && regenResult.warnings.length > 0 && (
                    <details className="mt-1 opacity-80">
                      <summary className="cursor-pointer">⚠ {regenResult.warnings.length} warning(s)</summary>
                      <ul className="mt-1 space-y-0.5 pl-3 text-[11px]">
                        {regenResult.warnings.map((w, i) => (
                          <li key={i}>· {w}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p className="opacity-90">{regenResult.error}</p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRegenResult(null);
              }}
              className="text-xs opacity-60 hover:opacity-100 shrink-0"
              title="Fermer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
