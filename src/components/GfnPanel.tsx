import React, { useEffect, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { Landmark } from 'lucide-react';
import type { GfnOutcome } from '../utils/grossFinancingNeed';
import { GFN_EM_BENCHMARK } from '../utils/grossFinancingNeed';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Gross financing need: the deficit plus external debt falling
 * due, % of GDP (src/utils/grossFinancingNeed.ts). Domestic amortisation has no free source, so the
 * total is a lower bound and says so.
 */

type Reply = GfnOutcome & { iso3: string; sentence?: string };

const f = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));

export const GfnPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/gfn/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The gross financing need could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  return (
    <section className="ui-panel" data-gfn="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Gross financing need, {countryName}
          <ValidationBadge id="gross_financing_need" />
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Gross financing need (lower bound), ${countryName}`,
                  value: reply.peak ? `${reply.peak.value}% of GDP in ${reply.peak.year} (deficit + external amortisation)` : 'parts only',
                  source: reply.sources.join('; '),
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
        <p className="ui-label">How much the government must borrow each year: the deficit plus debt falling due. Only external debt falling due has a free source, so this is a lower bound.</p>
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
            <p className="text-sm text-slate-900 dark:text-white" data-gfn-sentence="true">{reply.sentence}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-medium">Year</th>
                  <th className="py-1 pr-3 font-medium text-right">Deficit</th>
                  <th className="py-1 pr-3 font-medium text-right">of which interest</th>
                  <th className="py-1 pr-3 font-medium text-right">External amortisation</th>
                  <th className="py-1 font-medium text-right">GFN, at least</th>
                </tr>
              </thead>
              <tbody>
                {reply.years.map((y) => (
                  <tr key={y.year} className="border-t border-slate-100 dark:border-slate-800 tabular-nums" data-gfn-year={y.year}>
                    <td className="py-0.5 pr-3">{y.year}{y.projection ? ' (IMF proj.)' : ''}</td>
                    <td className="py-0.5 pr-3 text-right">{f(y.deficit)}</td>
                    <td className="py-0.5 pr-3 text-right">{f(y.interest)}</td>
                    <td className="py-0.5 pr-3 text-right" title={y.extPrincipalUsdBn !== undefined ? `$${y.extPrincipalUsdBn}bn (IDS projection)` : undefined}>{f(y.extAmortisation)}</td>
                    <td className={`py-0.5 text-right font-medium ${y.gfnLowerBound !== undefined && y.gfnLowerBound >= GFN_EM_BENCHMARK ? 'text-amber-700 dark:text-amber-400' : ''}`}>{f(y.gfnLowerBound)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 dark:text-slate-400">All % of GDP. A dash means the source has no figure for that year; nothing is filled in.</p>
            {reply.next12m && (
              <p className="text-xs text-slate-600 dark:text-slate-300" data-gfn-qeds="true">
                Government external principal due in the next 12 months (QEDS, from {reply.next12m.asOf}): ${reply.next12m.usdBn}bn
                {reply.next12m.pctGdp !== undefined ? `, ${reply.next12m.pctGdp}% of GDP` : ''}.
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Method: {reply.method} The IMF's market-access DSA flags a total above {GFN_EM_BENCHMARK}% of GDP for emerging markets. Sources: {reply.sources.join('; ')}.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
