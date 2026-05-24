"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LiveSession {
  session_id: string;
  player_name: string;
  team_name: string | null;
  game_title: string;
  game_slug: string | null;
  game_mode: string;
  current_step: number;
  total_steps: number;
  status: string;
  started_at: string;
  last_position: {
    lat: number;
    lon: number;
    accuracy: number | null;
    captured_at: string;
    step: number | null;
  } | null;
  seconds_since_last_ping: number | null;
  next_stop: {
    step: number;
    name: string;
    lat: number;
    lon: number;
    radius: number;
  } | null;
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const tr = (d: number) => (d * Math.PI) / 180;
  const dL = tr(b.lat - a.lat);
  const dO = tr(b.lon - a.lon);
  const x = Math.sin(dL / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dO / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}min`;
}

export default function AdminSessionsLivePage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchLive = async () => {
    try {
      const res = await fetch("/api/admin/sessions/live", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data.active_sessions ?? []);
      setLastRefresh(new Date());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLive();
    const iv = setInterval(fetchLive, 15_000); // refresh toutes les 15s
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Sessions en direct</h1>
          <p className="text-sm text-zinc-500">
            Joueurs actuellement en partie · refresh auto toutes les 15s
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {lastRefresh && <span>MAJ : {lastRefresh.toLocaleTimeString()}</span>}
          <button
            onClick={fetchLive}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Erreur : {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500">Chargement…</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          Aucune session active en ce moment.
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const distanceToNext =
              s.last_position && s.next_stop
                ? haversine(
                    { lat: s.last_position.lat, lon: s.last_position.lon },
                    { lat: s.next_stop.lat, lon: s.next_stop.lon },
                  )
                : null;
            const inRadius =
              distanceToNext !== null && s.next_stop && distanceToNext <= s.next_stop.radius;
            const stale =
              s.seconds_since_last_ping !== null && s.seconds_since_last_ping > 300;
            return (
              <Link
                href={`/admin/sessions/${s.session_id}`}
                key={s.session_id}
                className={`block rounded-lg border p-4 transition-colors ${
                  inRadius
                    ? "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10"
                    : stale
                      ? "border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10"
                      : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-bold text-zinc-100">
                        {s.player_name}
                      </span>
                      {s.team_name && (
                        <span className="text-xs text-zinc-500">· {s.team_name}</span>
                      )}
                      <span className="ml-auto text-xs rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-400">
                        {s.game_mode}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-400">
                      🎮 {s.game_title}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Step {s.current_step}/{s.total_steps} ·{" "}
                      {s.next_stop ? `→ ${s.next_stop.name}` : "—"}
                    </p>
                  </div>

                  <div className="text-right space-y-1 text-xs">
                    {s.last_position ? (
                      <>
                        <p className={stale ? "text-orange-400" : "text-zinc-300"}>
                          📍 dernière position il y a{" "}
                          {formatDuration(s.seconds_since_last_ping ?? 0)}
                        </p>
                        {distanceToNext !== null && (
                          <p
                            className={
                              inRadius
                                ? "text-emerald-400 font-bold"
                                : distanceToNext > 200
                                  ? "text-orange-400"
                                  : "text-zinc-300"
                            }
                          >
                            {inRadius
                              ? `✅ DANS LE RAYON (${distanceToNext}m)`
                              : `${distanceToNext}m du prochain stop`}
                          </p>
                        )}
                        <p className="text-zinc-600 font-mono">
                          {s.last_position.lat.toFixed(5)}, {s.last_position.lon.toFixed(5)}
                        </p>
                      </>
                    ) : (
                      <p className="text-zinc-500">⏳ pas encore de position GPS</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-xs text-zinc-600 pt-4 border-t border-zinc-800">
        💡 Cliquez sur une session pour voir la carte détaillée du parcours et la trace GPS du joueur.
      </p>
    </div>
  );
}
