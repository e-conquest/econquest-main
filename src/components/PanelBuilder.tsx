import React, { useEffect, useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';
import { DEFAULT_PANEL_FIGURES, PANEL_FIGURES, type PanelCell } from '../utils/panelTable';

/**
 * Workspace > Compare countries: pick countries and figures, see one table, download it.
 * Latest shows each figure's newest value with its source and period (Missing with the reason
 * otherwise); History downloads every observation in long format for analysis elsewhere.
 */

type Country = { iso3: string; countryName: string };

function fmt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'Missing';
  const abs = Math.abs(v);
  return abs >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : abs >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export const PanelBuilder: React.FC<{ countries: Country[] }> = ({ countries }) => {
  const [picked, setPicked] = useState<string[]>(() => countries.map((c) => c.iso3));
  const [figures, setFigures] = useState<string[]>(DEFAULT_PANEL_FIGURES);
  const [mode, setMode] = useState<'latest' | 'history'>('latest');
  const [cells, setCells] = useState<PanelCell[] | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep the picks in step when the watchlist changes.
  useEffect(() => {
    setPicked((prev) => {
      const codes = countries.map((c) => c.iso3);
      const kept = prev.filter((p) => codes.includes(p));
      return kept.length ? kept : codes;
    });
  }, [countries.map((c) => c.iso3).join(',')]);

  const query = useMemo(
    () => `countries=${encodeURIComponent(picked.join(','))}&figures=${encodeURIComponent(figures.join(','))}&mode=${mode}`,
    [picked, figures, mode]
  );

  const build = () => {
    if (!picked.length || !figures.length) return;
    setLoading(true);
    setError(null);
    fetch(`/api/panel?${query}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`))))
      .then((body: { mode: string; cells?: PanelCell[]; rowCount?: number }) => {
        setCells(body.cells ?? null);
        setRowCount(body.rowCount ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const shownFigures = PANEL_FIGURES.filter((f) => figures.includes(f.id));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const cell = (iso3: string, id: string) => cells?.find((c) => c.iso3 === iso3 && c.figureId === id);

  return (
    <section className="ui-panel" data-panel-builder="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Table2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Compare countries
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pick countries and figures for one table. Each value keeps its source and period; a missing one says why. Download it as CSV.
          </p>
        </div>
      </header>
      <div className="p-4 space-y-3">
        <fieldset>
          <legend className="ui-label mb-1">Countries</legend>
          <div className="flex flex-wrap gap-1.5">
            {countries.map((c) => (
              <label key={c.iso3} className="ui-pill inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={picked.includes(c.iso3)} onChange={() => setPicked((p) => toggle(p, c.iso3))} />
                {c.countryName}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="ui-label mb-1">Figures</legend>
          <div className="flex flex-wrap gap-1.5">
            {PANEL_FIGURES.map((f) => (
              <label key={f.id} className="ui-pill inline-flex items-center gap-1 cursor-pointer" title={f.unit}>
                <input type="checkbox" checked={figures.includes(f.id)} onChange={() => setFigures((p) => toggle(p, f.id))} />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="What to show" className="flex gap-1">
            {(['latest', 'history'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className="ui-pill">
                {m === 'latest' ? 'Latest values' : 'Full history (long format)'}
              </button>
            ))}
          </div>
          <button type="button" className="ui-btn ui-btn-primary" onClick={build} disabled={loading || !picked.length || !figures.length}>
            {loading ? 'Building…' : 'Build table'}
          </button>
          <a className={`ui-btn inline-flex ${!picked.length || !figures.length ? 'pointer-events-none opacity-50' : ''}`} href={`/api/export/panel.csv?${query}`} download>
            Download CSV
          </a>
          <a className={`ui-btn inline-flex ${!picked.length || !figures.length ? 'pointer-events-none opacity-50' : ''}`} href={`/api/export/panel.xlsx?${query}`} download>
            Download Excel
          </a>
        </div>

        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}

        {mode === 'history' && rowCount !== null && (
          <p className="ui-body">
            {rowCount} observation{rowCount === 1 ? '' : 's'} across the chosen countries and figures. Download the CSV for the full table: one row per observation, with unit, source and pull date.
          </p>
        )}

        {mode === 'latest' && cells && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-normal">Country</th>
                  {shownFigures.map((f) => (
                    <th key={f.id} className="py-1 pr-3 font-normal text-right" title={f.unit}>
                      {f.label}
                      <div className="text-xs text-slate-400">{f.unit}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {picked.map((iso3) => {
                  const name = countries.find((c) => c.iso3 === iso3)?.countryName || iso3;
                  return (
                    <tr key={iso3} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-3 text-slate-900 dark:text-white whitespace-nowrap">{name}</td>
                      {shownFigures.map((f) => {
                        const c = cell(iso3, f.id);
                        const missing = !c || c.status === 'Missing';
                        return (
                          <td
                            key={f.id}
                            className={`py-1.5 pr-3 text-right whitespace-nowrap ${missing ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}
                            title={missing ? `Missing: ${c?.reason || 'not built yet'}` : `${c!.source}${c!.period ? `, ${c!.period}` : ''}`}
                            data-missing={missing ? 'true' : undefined}
                          >
                            {missing ? 'Missing' : fmt(c!.value)}
                            {!missing && c!.period && <div className="text-xs text-slate-400">{c!.period}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Hover a value for its source; hover Missing for the reason. The CSV carries both.</p>
          </div>
        )}
      </div>
    </section>
  );
};
