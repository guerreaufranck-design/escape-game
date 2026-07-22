"use client";

import { useState } from "react";

export interface AdminReview {
  id: string;
  rating: number;
  review_text: string | null;
  player_name: string | null;
  language: string | null;
  brand_key: string | null;
  is_public: boolean;
  status: string;
  created_at: string;
  game_title: string;
  game_city: string | null;
  game_slug: string | null;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-500">
      {"★".repeat(n)}
      <span className="text-slate-300">{"★".repeat(5 - n)}</span>
    </span>
  );
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await fetch("/api/admin/reviews", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...body }),
  });
  return res.ok;
}

function Row({ r, onChange }: { r: AdminReview; onChange: (u: Partial<AdminReview>) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (body: Partial<AdminReview>) => {
    setBusy(true);
    if (await patch(r.id, body)) onChange(body);
    setBusy(false);
  };
  return (
    <tr className="border-b border-slate-200">
      <td className="px-3 py-2 whitespace-nowrap"><Stars n={r.rating} /></td>
      <td className="px-3 py-2 max-w-md">
        <p className="text-sm text-slate-800">{r.review_text || <span className="text-slate-400">(sans texte)</span>}</p>
        <p className="text-xs text-slate-500">
          {r.player_name || "Anonyme"} · {r.game_title}{r.game_city ? ` · ${r.game_city}` : ""} · {new Date(r.created_at).toLocaleDateString("fr-FR")} · {r.brand_key}
        </p>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-center">
        {r.is_public ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Public</span>
        ) : (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Privé · {r.status}</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right">
        <div className="inline-flex gap-2">
          {!r.is_public && r.status !== "handled" && (
            <button disabled={busy} onClick={() => act({ status: "handled" })} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50">Traité</button>
          )}
          {!r.is_public && r.status !== "archived" && (
            <button disabled={busy} onClick={() => act({ status: "archived" })} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50">Archiver</button>
          )}
          {r.is_public && (
            <button disabled={busy} onClick={() => act({ is_public: false })} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">Dépublier</button>
          )}
          {r.game_slug && (
            <a href={`/avis/${r.game_slug}`} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Page ↗</a>
          )}
        </div>
      </td>
    </tr>
  );
}

export function ReviewsAdmin({ initial }: { initial: AdminReview[] }) {
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<"todo" | "public" | "all">("todo");

  const update = (id: string, u: Partial<AdminReview>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...u } : r)));

  const todo = rows.filter((r) => !r.is_public && r.status === "new");
  const publics = rows.filter((r) => r.is_public);
  const shown = tab === "todo" ? todo : tab === "public" ? publics : rows;

  const Tab = ({ id, label, n }: { id: typeof tab; label: string; n: number }) => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
    >
      {label} <span className="opacity-70">({n})</span>
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Tab id="todo" label="À traiter" n={todo.length} />
        <Tab id="public" label="Publics" n={publics.length} />
        <Tab id="all" label="Tous" n={rows.length} />
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Aucun avis ici.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Avis</th>
                <th className="px-3 py-2 text-center">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.id} r={r} onChange={(u) => update(r.id, u)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
