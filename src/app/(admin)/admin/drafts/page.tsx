"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Draft {
  id: string;
  slug: string;
  city: string;
  country: string;
  theme: string;
  mode: string;
  status: string;
  target_stop_count: number;
  start_point_lat: number | null;
  start_point_lon: number | null;
  diagnostics: {
    averageScore?: number;
    tier1Count?: number;
    tier2Count?: number;
    tier3Count?: number;
    fallbackUsed?: boolean;
    compactMode?: boolean;
  } | null;
  validated_at: string | null;
  fulfilled_at: string | null;
  fulfilled_game_id: string | null;
  validation_error: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "border-zinc-700 bg-zinc-800 text-zinc-300",
  validated: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  fulfilling: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  fulfilled: "border-blue-500/40 bg-blue-500/10 text-blue-300",
};

export default function AdminDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const res = await fetch("/api/admin/drafts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDrafts(data.drafts ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, []);

  const filtered = filter === "all" ? drafts : drafts.filter((d) => d.status === filter);

  const counts = {
    all: drafts.length,
    pending: drafts.filter((d) => d.status === "pending").length,
    validated: drafts.filter((d) => d.status === "validated").length,
    fulfilling: drafts.filter((d) => d.status === "fulfilling").length,
    fulfilled: drafts.filter((d) => d.status === "fulfilled").length,
  };

  const handleDelete = async (slug: string) => {
    if (!confirm(`Supprimer le draft "${slug}" ?`)) return;
    try {
      await fetch(`/api/admin/drafts/${slug}`, { method: "DELETE" });
      fetchAll();
    } catch (e) {
      alert(`Échec : ${e instanceof Error ? e.message : "erreur"}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Drafts pré-validés</h1>
          <p className="text-sm text-zinc-500">
            Catalogue de jeux pré-validés (landmarks + GPS) — narration générée à la vente
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          Refresh auto 30s
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Erreur : {err}
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).map(([key, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
              filter === key
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {key} ({count})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          Aucun draft {filter !== "all" && `avec statut "${filter}"`}.
          <br />
          <span className="text-xs">
            Crée des drafts via{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
              POST /api/admin/drafts
            </code>
            .
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const isReady = d.status === "validated";
            const isDone = d.status === "fulfilled";
            const score = d.diagnostics?.averageScore;
            return (
              <div
                key={d.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-bold text-zinc-100 truncate">
                        {d.theme}
                      </span>
                      <span className="text-xs text-zinc-500">
                        · {d.city}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${STATUS_STYLES[d.status] ?? STATUS_STYLES.pending}`}
                      >
                        {d.status}
                      </span>
                      <span className="text-[10px] text-zinc-600 ml-auto">
                        {d.mode}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-zinc-500 mb-2">{d.slug}</p>

                    {isReady && d.diagnostics && (
                      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-400">
                        <span>
                          🎯 Score moyen :{" "}
                          <span
                            className={
                              (score ?? 0) >= 5
                                ? "text-emerald-300 font-bold"
                                : (score ?? 0) >= 3
                                  ? "text-amber-300 font-bold"
                                  : "text-red-300 font-bold"
                            }
                          >
                            {score?.toFixed(2)}/10
                          </span>
                        </span>
                        <span>
                          T1: {d.diagnostics.tier1Count} · T2:{" "}
                          {d.diagnostics.tier2Count} · T3:{" "}
                          {d.diagnostics.tier3Count}
                        </span>
                        {d.diagnostics.fallbackUsed && (
                          <span className="text-orange-300">⚠️ Fallback</span>
                        )}
                        {d.diagnostics.compactMode && (
                          <span className="text-fuchsia-300">🏛️ Compact</span>
                        )}
                      </div>
                    )}

                    {d.validation_error && (
                      <p className="text-xs text-red-300 mt-1">
                        ❌ Erreur : {d.validation_error.slice(0, 200)}
                      </p>
                    )}

                    {isDone && d.fulfilled_game_id && (
                      <p className="text-xs text-blue-300 mt-1">
                        ✅ Vendu et généré → {" "}
                        <Link
                          href={`/admin/games/${d.fulfilled_game_id}`}
                          className="underline hover:text-blue-200"
                        >
                          voir le jeu produit
                        </Link>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 text-right">
                    <p className="text-[10px] text-zinc-600">
                      Créé {new Date(d.created_at).toLocaleDateString()}
                    </p>
                    {!isDone && (
                      <button
                        onClick={() => handleDelete(d.slug)}
                        className="text-[10px] text-red-400 hover:text-red-300 hover:underline"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs">
        <summary className="cursor-pointer font-bold text-zinc-300 hover:text-zinc-100">
          📘 Comment créer un draft
        </summary>
        <pre className="mt-3 overflow-x-auto rounded bg-black/40 p-3 text-zinc-300">{`curl -X POST https://escape-game-indol.vercel.app/api/admin/drafts \\
  -H "Authorization: Bearer $EXTERNAL_API_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "drafts": [
      {
        "slug": "le-secret-roi-louis-xv-versailles",
        "city": "Versailles",
        "country": "France",
        "theme": "Le Secret du Roi Louis XV",
        "themeDescription": "Une intrigue au cœur du château royal",
        "startPointText": "Place d'\\''Armes, Versailles",
        "mode": "city_game"
      }
    ],
    "runValidationNow": true
  }'`}</pre>
        <p className="mt-2 text-zinc-500">
          Max 10 drafts par appel (pré-val = 5-10 min/jeu). À étaler côté caller en batches.
        </p>
      </details>
    </div>
  );
}
