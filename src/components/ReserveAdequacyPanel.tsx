import React, { useEffect, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { Vault } from 'lucide-react';
import type { ReserveAdequacyOutcome } from '../utils/reserveAdequacy';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Reserve adequacy (src/utils/reserveAdequacy.ts): traditional
 * ratios and the IMF ARA metric without other portfolio liabilities, shown as an upper bound.
 */

type Reply = ReserveAdequacyOutcome & { iso3: string; sentence?: string };

const f = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

export const ReserveAdequacyPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showYears, setShowYears] = useState(false);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/reserve-adequacy/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`Reserve adequacy could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  return (
    <section className="ui-panel" data-reserve-adequacy="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Vault className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Reserve adequacy, {countryName}
          <ValidationBadge id="reserve_adequacy" />
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Reserve adequacy (IMF ARA, partial), ${countryName}`,
                  value: `reserves at most ${reply.latest.ratioFloatingMax}% (floating) / ${reply.latest.ratioFixedMax}% (fixed) of the ARA metric without other liabilities`,
                  source: reply.sources.join('; '),
                  asOf: String(reply.latest.year),
                  iso3,
                  countryName,
                  detail: [reply.sentence || '', reply.method],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">Are reserves enough to cover a sudden stop? Usual ratios and the IMF's reserve adequacy metric, built from World Bank and IMF figures.</p>
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
            <p className={`text-sm ${reply.reading === 'below' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`} data-ara-sentence="true">{reply.sentence}</p>
            <table className="text-sm">
              <tbody>
                <tr><td className="pr-4 text-slate-500 dark:text-slate-400">IMF ARA, at most (floating / fixed weights)</td><td className="tabular-nums">{f(reply.latest.ratioFloatingMax)}% / {f(reply.latest.ratioFixedMax)}% <span className="text-slate-500">({reply.latest.year}; adequate 100-150%)</span></td></tr>
                {reply.monthsOfImports && <tr><td className="pr-4 text-slate-500 dark:text-slate-400">Months of imports</td><td className="tabular-nums">{f(reply.monthsOfImports.value)} <span className="text-slate-500">({reply.monthsOfImports.year}; usual floor 3)</span></td></tr>}
                {reply.reservesToShortTermDebt && <tr><td className="pr-4 text-slate-500 dark:text-slate-400">Reserves / short-term external debt</td><td className="tabular-nums">{f(reply.reservesToShortTermDebt.pct)}% <span className="text-slate-500">({reply.reservesToShortTermDebt.year}; Greenspan-Guidotti 100%)</span></td></tr>}
                {reply.reservesToBroadMoney && <tr><td className="pr-4 text-slate-500 dark:text-slate-400">Reserves / broad money</td><td className="tabular-nums">{f(reply.reservesToBroadMoney.pct)}% <span className="text-slate-500">({reply.reservesToBroadMoney.year}; usual floor 20%)</span></td></tr>}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Method: {reply.method} The exchange rate regime is not a free feed, so both weightings are shown. Sources: {reply.sources.join('; ')}.
            </p>
            <button type="button" className="ui-pill" aria-pressed={showYears} onClick={() => setShowYears(!showYears)}>
              {showYears ? 'Hide the years' : 'Show the years'}
            </button>
            {showYears && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="py-1 pr-3 font-medium">Year</th>
                    <th className="py-1 pr-3 font-medium text-right">Reserves, $bn</th>
                    <th className="py-1 pr-3 font-medium text-right">Short-term debt</th>
                    <th className="py-1 pr-3 font-medium text-right">Broad money</th>
                    <th className="py-1 pr-3 font-medium text-right">Exports</th>
                    <th className="py-1 font-medium text-right">ARA at most, float / fixed</th>
                  </tr>
                </thead>
                <tbody>
                  {reply.years.map((y) => (
                    <tr key={y.year} className="border-t border-slate-100 dark:border-slate-800 tabular-nums">
                      <td className="py-0.5 pr-3">{y.year}</td>
                      <td className="py-0.5 pr-3 text-right">{f(y.reservesUsdBn)}</td>
                      <td className="py-0.5 pr-3 text-right">{f(y.shortTermDebtUsdBn)}</td>
                      <td className="py-0.5 pr-3 text-right">{f(y.broadMoneyUsdBn)}</td>
                      <td className="py-0.5 pr-3 text-right">{f(y.exportsUsdBn)}</td>
                      <td className="py-0.5 text-right">{f(y.ratioFloatingMax)}% / {f(y.ratioFixedMax)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  );
};
