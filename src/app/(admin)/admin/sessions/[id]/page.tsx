"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SupportMessageBox } from "@/components/admin/SupportMessageBox";

const SessionTraceMap = dynamic(
  () => import("@/components/admin/SessionTraceMapInner"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center bg-slate-900 text-slate-400 text-sm rounded-xl h-[600px]">
        Chargement de la carte…
      </div>
    ),
  },
);

interface TraceData {
  session: {
    id: string;
    player_name: string;
    team_name: string | null;
    status: string;
    current_step: number;
    total_steps: number;
    started_at: string;
    completed_at: string | null;
    total_time_seconds: number | null;
    game_title: string;
    game_slug: string | null;
    game_mode: string;
  };
  stops: Array<{
    step: number;
    name: string;
    lat: number;
    lon: number;
    radius: number;
  }>;
  trace: Array<{
    lat: number;
    lon: number;
    accuracy?: number | null;
    step?: number | null;
    t: string;
  }>;
  completions: Array<{
    step: number;
    completed_at: string;
    hints_used: number;
  }>;
}

interface ArEventsData {
  events: Array<{
    event_type: string;
    step_order: number | null;
    metadata: Record<string, unknown> | null;
    captured_at: string;
  }>;
  summary: {
    opens_per_step: Record<number, number>;
    lock_ons_per_step: Record<number, number>;
    facade_reveals_per_step: Record<number, number>;
    auto_validates: number;
    manual_validates: number;
    camera_denied: number;
    compass_denied: number;
    total_events: number;
  };
}

function formatDuration(s: number | null | undefined): string {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, "0")}`;
}

export default function AdminSessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const [data, setData] = useState<TraceData | null>(null);
  const [arData, setArData] = useState<ArEventsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = async () => {
    try {
      const [tRes, arRes] = await Promise.all([
        fetch(`/api/admin/sessions/${sessionId}/trace`, { cache: "no-store" }),
        fetch(`/api/admin/sessions/${sessionId}/ar-events`, { cache: "no-store" }),
      ]);
      if (!tRes.ok) throw new Error(`HTTP trace ${tRes.status}`);
      const d = await tRes.json();
      setData(d);
      if (arRes.ok) {
        const ar = await arRes.json();
        setArData(ar);
      }
      setLastRefresh(new Date());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    }
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const iv = setInterval(fetchData, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoRefresh]);

  if (err) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
        Erreur : {err}
      </div>
    );
  }
  if (!data) {
    return <div className="text-sm text-zinc-500">Chargement…</div>;
  }

  const { session, stops, trace, completions } = data;
  const lastPos = trace.length > 0 ? trace[trace.length - 1] : null;
  const completedCount = completions.length;
  const elapsedSec = session.completed_at
    ? session.total_time_seconds
    : Math.round(
        (Date.now() - new Date(session.started_at).getTime()) / 1000,
      );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <Link href="/admin/sessions/live" className="hover:text-zinc-300">
              ← Sessions live
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">
            {session.player_name}
            {session.team_name && (
              <span className="text-zinc-500 font-normal text-base ml-2">
                · {session.team_name}
              </span>
            )}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            🎮 {session.game_title} ·{" "}
            <span className="text-zinc-500">{session.game_mode}</span>
          </p>
        </div>
        <div className="text-right space-y-1 text-xs">
          <p
            className={`inline-block rounded-full border px-3 py-1 font-bold ${
              session.status === "active"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : session.status === "completed"
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400"
            }`}
          >
            {session.status.toUpperCase()}
          </p>
          {lastRefresh && (
            <p className="text-zinc-600">
              MAJ : {lastRefresh.toLocaleTimeString()}
            </p>
          )}
          <label className="flex items-center justify-end gap-1 text-zinc-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            auto-refresh 30s
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">Step actuel</p>
          <p className="text-lg font-bold text-zinc-100">
            {session.current_step}/{session.total_steps}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">Steps validés</p>
          <p className="text-lg font-bold text-zinc-100">
            {completedCount}/{session.total_steps}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">Durée</p>
          <p className="text-lg font-bold text-zinc-100">
            {formatDuration(elapsedSec)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">Points GPS</p>
          <p className="text-lg font-bold text-zinc-100">{trace.length}</p>
        </div>
      </div>

      {/* Support message box (admin → joueur) — tout en haut pour
          y accéder vite quand le joueur est perdu. */}
      <SupportMessageBox
        sessionId={sessionId}
        sessionActive={session.status === "active"}
      />

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-bold text-zinc-300 mb-3">
          🗺️ Trajectoire du joueur
        </h2>
        <SessionTraceMap
          stops={stops}
          trace={trace}
          completions={completions}
          currentStep={session.current_step}
          playerLastPosition={
            lastPos ? { lat: lastPos.lat, lon: lastPos.lon } : null
          }
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            Step validé
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-amber-500" />
            Step en cours
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-slate-500" />
            Step à venir
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-3 h-1 rounded-full bg-blue-500" />
            Trace joueur
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-bold text-zinc-300 mb-3">
          📍 Stops du jeu
        </h2>
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">Lieu</th>
              <th className="text-right py-2">GPS</th>
              <th className="text-right py-2">Rayon</th>
              <th className="text-right py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((s) => {
              const done = completions.find((c) => c.step === s.step);
              const current = s.step === session.current_step;
              const opens = arData?.summary.opens_per_step[s.step] ?? 0;
              const lockOns = arData?.summary.lock_ons_per_step[s.step] ?? 0;
              const reveals = arData?.summary.facade_reveals_per_step[s.step] ?? 0;
              return (
                <tr key={s.step} className="border-t border-zinc-800/60">
                  <td className="py-2 font-mono text-zinc-500">{s.step}</td>
                  <td className="py-2 text-zinc-200">
                    {s.name}
                    {arData && (
                      <span className="ml-2 text-[10px] text-zinc-500">
                        AR : {opens}× ouvert · {lockOns}× lock · {reveals}× révélé
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-zinc-500">
                    {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                  </td>
                  <td className="py-2 text-right text-zinc-500">{s.radius}m</td>
                  <td className="py-2 text-right">
                    {done ? (
                      <span className="text-emerald-400">
                        ✅ {new Date(done.completed_at).toLocaleTimeString()}
                      </span>
                    ) : current ? (
                      <span className="text-amber-400">🟡 en cours</span>
                    ) : (
                      <span className="text-zinc-600">⚪</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* AR events timeline (post-Bibinouze tracking) */}
      {arData && arData.events.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-sm font-bold text-zinc-300 mb-3">
            📷 Activité Réalité Augmentée ({arData.events.length} events)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
            <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
              <span className="text-zinc-500">Auto-validés :</span>{" "}
              <span className="text-emerald-300 font-bold">{arData.summary.auto_validates}</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
              <span className="text-zinc-500">Manual-validés :</span>{" "}
              <span className="text-amber-300 font-bold">{arData.summary.manual_validates}</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
              <span className="text-zinc-500">Caméra refusée :</span>{" "}
              <span className={arData.summary.camera_denied > 0 ? "text-red-300 font-bold" : "text-zinc-600"}>
                {arData.summary.camera_denied}
              </span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
              <span className="text-zinc-500">Compass refusé :</span>{" "}
              <span className={arData.summary.compass_denied > 0 ? "text-orange-300 font-bold" : "text-zinc-600"}>
                {arData.summary.compass_denied}
              </span>
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="text-left py-1.5">Time</th>
                  <th className="text-left py-1.5">Step</th>
                  <th className="text-left py-1.5">Event</th>
                  <th className="text-left py-1.5">Meta</th>
                </tr>
              </thead>
              <tbody>
                {arData.events.map((e, i) => {
                  const colorMap: Record<string, string> = {
                    ar_open: "text-cyan-300",
                    ar_camera_ready: "text-emerald-400",
                    ar_camera_denied: "text-red-400",
                    ar_compass_granted: "text-emerald-400",
                    ar_compass_denied: "text-orange-400",
                    ar_lock_on: "text-yellow-300",
                    ar_facade_revealed: "text-fuchsia-300",
                    ar_character_speak: "text-violet-300",
                    ar_auto_validated: "text-emerald-300 font-bold",
                    ar_manual_validated: "text-amber-300 font-bold",
                    ar_close: "text-zinc-500",
                  };
                  return (
                    <tr key={i} className="border-t border-zinc-800/40">
                      <td className="py-1 font-mono text-zinc-500">
                        {new Date(e.captured_at).toLocaleTimeString()}
                      </td>
                      <td className="py-1 text-zinc-400">{e.step_order ?? "—"}</td>
                      <td className={`py-1 ${colorMap[e.event_type] ?? "text-zinc-300"}`}>
                        {e.event_type}
                      </td>
                      <td className="py-1 text-zinc-500 font-mono text-[10px]">
                        {e.metadata ? JSON.stringify(e.metadata) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
