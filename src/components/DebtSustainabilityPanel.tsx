import React, { useEffect, useMemo, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { Landmark } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DsaOutcome, ScenarioId } from '../utils/debtSustainability';
import type { DebtFanOutcome } from '../utils/debtFan';
import type { CostedOptionsOutcome } from '../utils/costedOptions';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Debt sustainability: public debt dynamics on IMF figures,
 * what drove past changes, and stated stress scenarios five years out. A view on stated
 * assumptions, not a forecast or an IMF DSA.
 */

type Reply = DsaOutcome & { iso3: string; sentence?: string; fan?: DebtFanOutcome & { sentence?: string }; options?: CostedOptionsOutcome };

const COLOURS: Record<ScenarioId, string> = {
  imf: '#0f172a',
  baseline: '#2563eb',
  historical: '#64748b',
  growth: '#d97706',
  primary: '#059669',
  interest: '#7c3aed',
  combined: '#e11d48',
};

const f1 = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(1));
const sg1 = (v: number | undefined) => (v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`);

export const DebtSustainabilityPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/debt-sustainability/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The debt view could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const data = useMemo(() => {
    if (!reply?.ok) return [];
    const years = new Map<string, Record<string, number | string>>();
    for (const h of reply.history.slice(-8)) years.set(h.year, { year: h.year, outturn: h.debt });
    for (const s of reply.scenarios) {
      for (const p of s.path) {
        const row = years.get(p.year) || { year: p.year };
        row[s.id] = p.debt;
        years.set(p.year, row);
      }
    }
    return [...years.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)));
  }, [reply]);

  return (
    <section className="ui-panel" data-dsa="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Debt sustainability, {countryName}
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Debt sustainability, ${countryName}`,
                  value: reply.sentence,
                  source: reply.method,
                  asOf: reply.lastOutturnYear,
                  iso3,
                  countryName,
                  detail: [
                    ...reply.scenarios.map((s) => `${s.label}: ${s.end}% of GDP by ${s.path[s.path.length - 1].year}`),
                    ...(reply.rMinusG !== undefined ? [`r - g (10-year average): ${reply.rMinusG} pts`] : []),
                  ].slice(0, 8),
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">Government debt, % of GDP: the IMF path, a baseline on the IMF's inputs, and stated stress scenarios. Research, not validated advice.</p>
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
            <p className="text-sm text-slate-900 dark:text-white" data-dsa-sentence="true">
              {reply.sentence}
            </p>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm tabular-nums">
              <div>
                <dt className="ui-label">Debt {reply.lastOutturnYear}</dt>
                <dd className="text-slate-900 dark:text-white">{f1(reply.debtNow)}% of GDP</dd>
              </div>
              <div title="Real effective interest rate less real growth, last ten years' averages">
                <dt className="ui-label">r − g (10-year average)</dt>
                <dd className="text-slate-900 dark:text-white">{reply.rMinusG === undefined ? 'Missing' : `${sg1(reply.rMinusG)} pts`}</dd>
              </div>
              <div>
                <dt className="ui-label">Debt-stabilising primary balance</dt>
                <dd className="text-slate-900 dark:text-white">{reply.stabilisingPb === undefined ? 'Missing' : `${sg1(reply.stabilisingPb)}% of GDP`}</dd>
              </div>
              <div>
                <dt className="ui-label">IMF projected primary balance</dt>
                <dd className="text-slate-900 dark:text-white">{reply.projectedPb === undefined ? 'Missing' : `${sg1(reply.projectedPb)}% of GDP`}</dd>
              </div>
            </dl>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={40} unit="%" domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: unknown) => `${f1(v as number)}% of GDP`} />
                  <Line dataKey="outturn" name="Outturn" stroke="#0f172a" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {reply.scenarios.map((s) => (
                    <Line
                      key={s.id}
                      dataKey={s.id}
                      name={s.label}
                      stroke={COLOURS[s.id]}
                      strokeDasharray={s.id === 'imf' ? '2 3' : s.id === 'baseline' ? undefined : '5 4'}
                      strokeWidth={s.id === 'baseline' || s.id === 'imf' ? 2 : 1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              {reply.scenarios.map((s) => (
                <li key={s.id}>
                  <span style={{ color: COLOURS[s.id] }}>■</span> <span className="text-slate-900 dark:text-white">{s.label}</span>, {f1(s.end)}% by {s.path[s.path.length - 1].year}: {s.about}
                </li>
              ))}
            </ul>
            {reply.fan && (
              <div className="space-y-2" data-dsa-fan="true">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">Fan chart: debt under past shocks <ValidationBadge id="debt_fan" /></h3>
                {!reply.fan.ok && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                    Missing: {reply.fan.reason}.
                  </p>
                )}
                {reply.fan.ok && (
                  <>
                    <p className="text-sm text-slate-700 dark:text-slate-200">{reply.fan.sentence}</p>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={reply.fan.years.map((y) => ({ year: y.year, outer: [y.p10, y.p90], inner: [y.p25, y.p75], p50: y.p50 }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} width={40} unit="%" domain={['auto', 'auto']} />
                          <Tooltip formatter={(v: unknown) => (Array.isArray(v) ? `${f1(v[0])}-${f1(v[1])}% of GDP` : `${f1(v as number)}% of GDP`)} />
                          <Area dataKey="outer" name="10th-90th percentile" stroke="none" fill="#2563eb" fillOpacity={0.15} isAnimationActive={false} />
                          <Area dataKey="inner" name="25th-75th percentile" stroke="none" fill="#2563eb" fillOpacity={0.3} isAnimationActive={false} />
                          <Line dataKey="p50" name="Median" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Method: {reply.fan.method} Shocks drawn from {reply.fan.sample.n} years ({reply.fan.sample.from}-{reply.fan.sample.to}).
                      {reply.fan.probAboveBaseline !== undefined ? ` ${Math.round(reply.fan.probAboveBaseline * 100)}% of paths end above the baseline.` : ''} A spread built from past shocks, centred on the IMF's inputs; not a forecast.
                    </p>
                  </>
                )}
              </div>
            )}
            {reply.options && (
              <div className="space-y-2" data-dsa-options="true">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">Costed options: tightening or loosening the primary balance <ValidationBadge id="costed_options" /></h3>
                {!reply.options.ok && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                    Missing: {reply.options.reason}.
                  </p>
                )}
                {reply.options.ok && (
                  <>
                    <table className="w-full text-xs tabular-nums">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400">
                          <th className="py-1 pr-3 font-medium">Option</th>
                          <th className="py-1 pr-3 font-medium text-right">Debt {reply.options.horizonYear}, % GDP</th>
                          <th className="py-1 pr-3 font-medium text-right">vs baseline, pts</th>
                          <th className="py-1 font-medium text-right">Output lost, % (low-high multiplier)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-0.5 pr-3">Baseline (IMF inputs)</td>
                          <td className="py-0.5 pr-3 text-right">{f1(reply.options.baselineEnd)}</td>
                          <td className="py-0.5 pr-3 text-right">—</td>
                          <td className="py-0.5 text-right">—</td>
                        </tr>
                        {reply.options.options.map((o) => (
                          <tr key={o.option.id} className="border-t border-slate-100 dark:border-slate-800" data-option={o.option.id}>
                            <td className="py-0.5 pr-3">
                              {o.option.label}
                              {o.denominatorEffect ? <span className="text-amber-700 dark:text-amber-400" title="With the high multiplier, debt/GDP is higher than the baseline in year 1: lower output shrinks the denominator faster than the saving cuts debt."> (debt up in year 1)</span> : null}
                            </td>
                            <td className="py-0.5 pr-3 text-right">{f1(o.endLow)}-{f1(o.endHigh)}</td>
                            <td className="py-0.5 pr-3 text-right">{sg1(o.vsBaselineLow)} to {sg1(o.vsBaselineHigh)}</td>
                            <td className="py-0.5 text-right">{f1(o.outputCostLow)}-{f1(o.outputCostHigh)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Multiplier {reply.options.multiplier.low}-{reply.options.multiplier.high} ({reply.options.multiplier.source}). Method: {reply.options.method} Negative output lost means output gained (loosening). Stated options on stated assumptions, not a forecast or a recommendation.
                    </p>
                  </>
                )}
              </div>
            )}
            {reply.missing.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                Missing: {reply.missing.join('; ')}.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ui-pill" aria-pressed={showPast} onClick={() => setShowPast(!showPast)}>
                {showPast ? 'Hide what moved debt' : 'What moved debt, year by year'}
              </button>
              <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/debt-scenarios.csv`} download>
                Download scenarios (CSV)
              </a>
            </div>
            {showPast && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums" data-dsa-history="true">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400">
                      <th className="py-1 pr-3">Year</th>
                      <th className="py-1 pr-3">Debt</th>
                      <th className="py-1 pr-3">Change</th>
                      <th className="py-1 pr-3" title="Interest rate-growth differential">Interest vs growth</th>
                      <th className="py-1 pr-3" title="Minus the primary balance">Primary balance</th>
                      <th className="py-1 pr-3" title="What the identity leaves unexplained">Other (stock-flow)</th>
                      <th className="py-1 pr-3">Interest rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...reply.history].reverse().slice(0, 12).map((h) => (
                      <tr key={h.year} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-3">{h.year}</td>
                        <td className="py-1 pr-3">{f1(h.debt)}</td>
                        <td className="py-1 pr-3">{sg1(h.change)}</td>
                        <td className="py-1 pr-3">{sg1(h.snowball)}</td>
                        <td className="py-1 pr-3">{sg1(h.primary)}</td>
                        <td className="py-1 pr-3">{sg1(h.stockFlow)}</td>
                        <td className="py-1 pr-3">{h.interestPct === undefined ? '—' : `${f1(h.interestPct)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Points of GDP. Interest vs growth + primary balance + other = change in debt.</p>
              </div>
            )}
            <details className="text-xs text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer">Method and sources</summary>
              <p className="mt-1">{reply.method}.</p>
              <p className="mt-1">
                Outturns to {reply.lastOutturnYear}
                {reply.pulledAt ? `, history saved ${reply.pulledAt.slice(0, 10)}` : ''}. Later years use IMF projections.
              </p>
              <ol className="mt-1 list-decimal pl-4">
                {reply.sources.map((r) => (
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
