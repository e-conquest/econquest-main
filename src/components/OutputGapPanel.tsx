import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { OUTPUT_GAP_REFERENCES, outputGapSentence, type OutputGapResult } from '../utils/outputGap';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Output gap: the app's estimate from IMF real GDP growth,
 * three stated filters, the middle reading and the band between them. Projection years are drawn
 * dashed and say so. Not an official figure.
 */

type Reply = OutputGapResult & { iso3: string };

const sg = (v: number | undefined) => (v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

export const OutputGapPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState<'all' | '2000'>('2000');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/output-gap/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The output gap could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const data = useMemo(() => {
    if (!reply?.ok) return [];
    return reply.years
      .filter((g) => since === 'all' || Number(g.year) >= 2000)
      .map((g) => ({
        year: g.year,
        band: g.low !== undefined && g.high !== undefined ? [g.low, g.high] : undefined,
        outturn: g.projection ? undefined : g.central,
        projection: g.projection ? g.central : undefined,
        // Join the dashed projection line to the last outturn.
        ...(reply.lastOutturnYear === g.year ? { projection: g.central } : {}),
        hp100: g.hp100,
        hp625: g.hp625,
        hamilton: g.hamilton,
      }));
  }, [reply, since]);

  return (
    <section className="ui-panel" data-output-gap="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Output gap, {countryName}
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Output gap, ${countryName}`,
                  value: `${reply.latest.central >= 0 ? '+' : ''}${reply.latest.central.toFixed(2)}% of potential GDP (band ${reply.latest.low} to ${reply.latest.high})`,
                  source: reply.method,
                  asOf: reply.latest.year,
                  iso3,
                  countryName,
                  detail: reply.years.filter((g) => !g.projection).slice(-6).map((g) => `${g.year}: middle ${g.central}, HP100 ${g.hp100}, HP6.25 ${g.hp625}, Hamilton ${g.hamilton ?? 'n/a'}`),
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">How far output is above or below its trend, % of potential GDP. Estimated by the app from IMF real GDP growth; not an official figure.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.reason}.
          </p>
        )}
        {reply?.ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-output-gap-sentence="true">
              {outputGapSentence(reply)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ui-pill" aria-pressed={since === '2000'} onClick={() => setSince(since === 'all' ? '2000' : 'all')}>
                {since === 'all' ? `From ${reply.firstYear}` : 'From 2000'}
              </button>
              <button type="button" className="ui-pill" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
                {showTable ? 'Hide each method' : 'Show each method'}
              </button>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} minTickGap={16} />
                  <YAxis tick={{ fontSize: 12 }} width={40} unit="%" />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => {
                      if (Array.isArray(v)) return [`${sg(v[0])} to ${sg(v[1])}`, 'Band across methods'];
                      return [sg(v as number), String(name ?? "")];
                    }}
                  />
                  <Area dataKey="band" name="Band across methods" stroke="none" fill="#3b82f6" fillOpacity={0.15} isAnimationActive={false} />
                  <Line dataKey="outturn" name="Middle reading" stroke="#2563eb" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="projection" name="Middle reading (IMF projection years)" stroke="#2563eb" strokeDasharray="5 4" dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {showTable && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums" data-output-gap-table="true">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400">
                      <th className="py-1 pr-3">Year</th>
                      <th className="py-1 pr-3">HP λ 100</th>
                      <th className="py-1 pr-3">HP λ 6.25</th>
                      <th className="py-1 pr-3">Hamilton</th>
                      <th className="py-1 pr-3">Middle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...reply.years].reverse().slice(0, 15).map((g) => (
                      <tr key={g.year} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-3">
                          {g.year}
                          {g.projection ? ' (IMF projection)' : ''}
                        </td>
                        <td className="py-1 pr-3">{sg(g.hp100)}</td>
                        <td className="py-1 pr-3">{sg(g.hp625)}</td>
                        <td className="py-1 pr-3">{sg(g.hamilton)}</td>
                        <td className="py-1 pr-3 text-slate-900 dark:text-white">{sg(g.central)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details className="text-xs text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer">Method and sources</summary>
              <p className="mt-1">{reply.method}. Hamilton has no value in IMF projection years because it only uses the past. Filters on GDP alone are revised as new years arrive; the newest years move most.</p>
              <p className="mt-1">
                Data: {reply.source}
                {reply.pulledAt ? `, saved ${reply.pulledAt.slice(0, 10)}` : ''}; outturns {reply.firstYear} to {reply.lastOutturnYear}.
              </p>
              <ol className="mt-1 list-decimal pl-4">
                {OUTPUT_GAP_REFERENCES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </section>
  );
};
