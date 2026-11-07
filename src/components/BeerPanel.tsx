import React, { useEffect, useState } from 'react';
import { Scale3d } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ValidationBadge } from './ValidationBadge';
import { ChartNumbers } from './ChartNumbers';
import { explainInChat } from '../utils/explainHandoff';
import type { BeerOutcome } from '../utils/beer';

/**
 * Country Research > History & data > BEER fair value (src/utils/beer.ts): the real effective
 * exchange rate against the level its fundamentals have gone with.
 */

type Reply = BeerOutcome & { iso3: string; name?: string; sentence?: string; sources?: string[] };

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export const BeerPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/beer/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The BEER fair value could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const ok = reply && reply.ok ? reply : null;

  return (
    <section className="ui-panel" data-beer="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Scale3d className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          BEER fair value, {countryName}
          <ValidationBadge id="beer" />
          {ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `BEER fair value of the real exchange rate, ${countryName}`,
                  value: reply?.sentence || '',
                  source: (reply?.sources || []).join('; '),
                  asOf: ok.latest.month,
                  iso3,
                  countryName,
                  detail: [ok.method, ...ok.coef.map((c) => `${c.name}: ${c.beta} (s.e. ${c.se}), expected ${c.expected}`), `R² ${ok.r2}, ${ok.n} years ${ok.from}-${ok.to}`],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">Is the real exchange rate where its terms of trade, productivity and foreign assets have put it in the past? A yardstick fitted on this country's own history, not a forecast.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.reason}.
          </p>
        )}
        {ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-beer-sentence="true">{reply?.sentence}</p>
            <div className="h-56" role="img" aria-label="Real effective exchange rate and BEER fitted level by year. The numbers are in the table below.">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ok.years} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={44} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: unknown) => f(v as number)} />
                  <Line dataKey="reer" name="Real effective rate (BIS)" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="fitted" name="BEER fitted level" stroke="#64748b" strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-medium">Fundamental</th>
                  <th className="py-1 pr-3 font-medium text-right">Coefficient</th>
                  <th className="py-1 pr-3 font-medium text-right">s.e.</th>
                  <th className="py-1 font-medium">Sign vs theory</th>
                </tr>
              </thead>
              <tbody>
                {ok.coef.map((c) => (
                  <tr key={c.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-0.5 pr-3">{c.name}</td>
                    <td className="py-0.5 pr-3 text-right">{f(c.beta, 3)}</td>
                    <td className="py-0.5 pr-3 text-right">{f(c.se, 3)}</td>
                    <td className={`py-0.5 ${c.signOk ? '' : 'text-amber-700 dark:text-amber-400'}`}>{c.signOk ? 'as expected (+)' : 'opposite to theory'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ChartNumbers
              caption="BEER fair value"
              columns={['Year', 'Real effective rate', 'Fitted level', 'Gap %']}
              rows={ok.years.map((y) => [y.year, f(y.reer), f(y.fitted), f(y.gapPct, 1)])}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest: {ok.latest.month} at {f(ok.latest.reer)} against the fair value for {ok.latest.fairValueYear} of {f(ok.latest.fairValue)} ({ok.latest.gapPct >= 0 ? '+' : ''}{f(ok.latest.gapPct, 1)}%). R² {f(ok.r2)}, {ok.n} years {ok.from}-{ok.to}. Method: {ok.method} Net foreign assets have no free source, so the summed current account stands in. Sources: {(reply?.sources || []).join('; ')}.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
