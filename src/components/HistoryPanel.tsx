import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { seriesGaps, type Series, type SeriesMissing } from '../utils/seriesHistory';
import { contextSentence, historicalContext } from '../utils/historicalContext';
import { PublishChartButton } from './PublishChartButton';

/**
 * Country Research > History: every figure that has a run of real observations, as a chart with
 * its source, dates and any gaps, plus each figure that has none and why. Points are drawn as
 * they came: nothing filled in, carried forward or smoothed.
 */

type SeriesListItem = Omit<Series, 'points'> & { count: number; first?: string; last?: string; latest?: number };

const FREQ_LABEL: Record<Series['freq'], string> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'yearly',
  'per pull': 'one point per saved pull',
};

function fmt(v: number | undefined, unit?: string): string {
  if (v === undefined || !Number.isFinite(v)) return 'Missing';
  const abs = Math.abs(v);
  const n = abs >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : abs >= 100 ? v.toFixed(1) : v.toFixed(2);
  return unit === '%' || unit?.startsWith('%') ? `${n}%` : n;
}

function pulledLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const HistoryPanel: React.FC<{ iso3: string; countryName: string; pick?: string | null }> = ({ iso3, countryName, pick }) => {
  const [list, setList] = useState<SeriesListItem[] | null>(null);
  const [missing, setMissing] = useState<SeriesMissing[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(pick ?? null);
  const [series, setSeries] = useState<Series | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(null);
    fetch(`/api/series/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { series: SeriesListItem[]; missing: SeriesMissing[] }) => {
        if (!live) return;
        setList(body.series || []);
        setMissing(body.missing || []);
      })
      .catch((e: Error) => live && setFailed(e.message));
    return () => {
      live = false;
    };
  }, [iso3]);

  useEffect(() => {
    if (pick) setSelected(pick);
  }, [pick]);

  // Default to the first series when nothing (or something unavailable) is picked.
  const current = useMemo(() => {
    if (!list?.length) return null;
    return list.find((s) => s.id === selected) ?? list[0];
  }, [list, selected]);
  const pickedMissing = selected && !(list || []).some((s) => s.id === selected) ? missing.find((m) => m.id === selected) : undefined;

  useEffect(() => {
    if (!current) return;
    let live = true;
    setSeries(null);
    setSeriesError(null);
    fetch(`/api/series/${encodeURIComponent(iso3)}/${encodeURIComponent(current.id)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`))))
      .then((s: Series) => live && setSeries(s))
      .catch((e: Error) => live && setSeriesError(e.message));
    return () => {
      live = false;
    };
  }, [iso3, current?.id]);

  const gaps = useMemo(() => (series ? seriesGaps(series) : []), [series]);
  const chartRef = useRef<HTMLDivElement>(null);
  const context = useMemo(() => (series ? historicalContext(series.points, series.freq) : null), [series]);

  if (failed) {
    return (
      <section className="ui-panel p-4" data-history-panel="true">
        <p className="ui-body">History could not be loaded ({failed}). The rest of the page still works.</p>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3" data-history-panel="true" data-no-stat-ref="true">
      <section className="ui-panel xl:col-span-2" data-no-provenance-overlay="true">
        <header className="ui-panel-header">
          <h2 className="ui-section-title">{current ? `${current.label}, ${countryName}` : `History for ${countryName}`}</h2>
          {current && (
            <p className="ui-label">
              {current.unit} · {FREQ_LABEL[current.freq]} · {current.source}
              {pulledLabel(current.pulledAt) ? ` · pulled ${pulledLabel(current.pulledAt)}` : ''}
            </p>
          )}
        </header>
        <div className="p-4 space-y-3">
          {list === null && <p className="ui-body">Loading…</p>}
          {list !== null && list.length === 0 && (
            <p className="ui-body">
              No figure for {countryName} has a history yet. Each figure below says why. Saved pulls build a history week by week from now on.
            </p>
          )}
          {pickedMissing && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {pickedMissing.label}: Missing. {pickedMissing.reason}.
            </p>
          )}
          {current && seriesError && <p className="text-sm text-amber-700 dark:text-amber-400">{seriesError}</p>}
          {current && !series && !seriesError && <p className="ui-body">Loading…</p>}
          {series && (
            <>
              {series.about && <p className="text-xs text-slate-500 dark:text-slate-400">{series.about}</p>}
              {context && (
                <p className="text-sm text-slate-900 dark:text-white" data-history-context="true">
                  {contextSentence(series.label, series.unit, context)}
                </p>
              )}
              <div className="h-64" data-history-chart="true" ref={chartRef}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 12 }} width={56} domain={['auto', 'auto']} />
                    <Tooltip
                      formatter={(v) => [fmt(Number(v), series.unit), series.label]}
                      labelFormatter={(label) => {
                        const d = String(label ?? '');
                        const pt = series.points.find((p) => p.date === d);
                        const extra = [pt?.note, pt?.revised].filter(Boolean).join(' · ');
                        return extra ? `${d} · ${extra}` : d;
                      }}
                    />
                    <Line type="linear" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={series.points.length <= 40} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {series.points.length} observation{series.points.length === 1 ? '' : 's'}, {series.points[0]?.date} to {series.points[series.points.length - 1]?.date}.{' '}
                {series.freq === 'per pull' && series.points.length < 3 ? 'This figure gains a point with each weekly pull. ' : ''}
                {gaps.length === 0
                  ? series.freq === 'monthly' || series.freq === 'weekly'
                    ? 'No gaps.'
                    : ''
                  : `Gaps (no observation, not filled): ${gaps.map((g) => `${g.after} to ${g.before}`).join('; ')}.`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/series/${encodeURIComponent(series.id)}.csv`} download>
                  Download this series (CSV)
                </a>
                <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/series/${encodeURIComponent(series.id)}.xlsx`} download>
                  Excel
                </a>
                <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/series.csv`} download>
                  Download every series for {countryName} (CSV)
                </a>
                <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/series.xlsx`} download>
                  Excel
                </a>
              </div>
              <PublishChartButton
                chartRef={chartRef}
                title={`${series.label}, ${countryName}`}
                subtitle={`${series.unit}, ${FREQ_LABEL[series.freq].toLowerCase()}`}
                source={series.source || current?.source || ''}
                period={`${series.points[0]?.date} to ${series.points[series.points.length - 1]?.date}`}
                fileName={`${iso3}-${series.id}`}
              />
              <details>
                <summary className="text-xs text-blue-700 dark:text-blue-300 cursor-pointer">Show the numbers</summary>
                <div className="mt-2 max-h-64 overflow-auto">
                  <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="py-1 pr-3 font-normal">Date</th>
                        <th className="py-1 pr-3 font-normal text-right">{series.unit}</th>
                        {series.points.some((p) => p.note || p.revised) && <th className="py-1 font-normal">{series.freq === 'per pull' ? 'Source that day' : 'Note'}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...series.points].reverse().map((p) => (
                        <tr key={p.date} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-1 pr-3">{p.date}</td>
                          <td className="py-1 pr-3 text-right">{fmt(p.value, series.unit)}</td>
                          {series.points.some((x) => x.note || x.revised) && <td className="py-1">{[p.note, p.revised].filter(Boolean).join(' · ')}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      </section>

      <section className="ui-panel">
        <header className="ui-panel-header">
          <h2 className="ui-section-title">Figures with a history</h2>
          <p className="ui-label">Pick one to chart it.</p>
        </header>
        <div className="p-2">
          <ul>
            {(list || []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  aria-current={current?.id === s.id ? 'true' : undefined}
                  className={`w-full text-left px-2 py-1.5 flex items-baseline justify-between gap-3 ${
                    current?.id === s.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <span className="text-sm text-slate-900 dark:text-white">{s.label}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap [font-variant-numeric:tabular-nums]">
                    {fmt(s.latest, s.unit)} · {s.last} · {s.count} pt{s.count === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <>
              <h3 className="mt-3 px-2 text-xs font-medium text-slate-500 dark:text-slate-400">No history yet</h3>
              <ul className="mt-1">
                {groupMissing(missing).map((g) => (
                  <li key={g.reason} className="px-2 py-1 text-xs" data-missing="true">
                    <span className="text-slate-700 dark:text-slate-300">{g.labels.join(', ')}</span>
                    <span className="text-amber-700 dark:text-amber-400">: Missing. {g.reason}.</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

/** One line per reason, naming every figure it applies to. */
function groupMissing(rows: { label: string; reason: string }[]): { reason: string; labels: string[] }[] {
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.reason, [...(by.get(r.reason) || []), r.label]);
  return [...by].map(([reason, labels]) => ({ reason, labels }));
}
