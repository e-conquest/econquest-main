import React, { useEffect, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { convertAll, fmtAmount, CONVERTER_METHOD, type ConverterSeries } from '../utils/unitConverters';

/**
 * Country Research > History & data > Unit converters (src/utils/unitConverters.ts): a local
 * currency amount in real terms, US dollars, PPP and per head, each with its factor and source.
 */

export const UnitConverterPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [series, setSeries] = useState<ConverterSeries | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [amount, setAmount] = useState('1000000');
  const [year, setYear] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => {
    let live = true;
    setSeries(null);
    setMissing([]);
    fetch(`/api/unit-converters/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: { series: ConverterSeries; missing: string[] }) => {
        if (!live) return;
        const s = b.series || {};
        setSeries(s);
        setMissing(b.missing || []);
        const years = (s.cpi || s.fx || []).filter((p) => p.note !== 'IMF projection').map((p) => String(p.date).slice(0, 4));
        const last = years[years.length - 1] || String(new Date().getUTCFullYear() - 1);
        setYear((y) => y || last);
        setTarget((t) => t || last);
      })
      .catch((e: Error) => {
        if (!live) return;
        setSeries({});
        setMissing([`The converter figures could not be read (${e.message}).`]);
      });
    return () => {
      live = false;
    };
  }, [iso3]);

  const value = Number(amount.replace(/[, _]/g, ''));
  const results = useMemo(() => (series && Number.isFinite(value) && /^\d{4}$/.test(year) && /^\d{4}$/.test(target) ? convertAll(value, year, target, series) : []), [series, value, year, target]);
  const input = 'px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white';

  return (
    <section className="ui-panel" data-unit-converter="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Unit converters, {countryName}
        </h2>
        <p className="ui-label">An amount in {countryName}'s currency in real terms, US dollars, purchasing power parity and per head, each with the figure used and its source.</p>
      </header>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-slate-500 dark:text-slate-400">Amount, local currency</span>
            <input className={`${input} w-36 tabular-nums`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in local currency" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-500 dark:text-slate-400">Year of the amount</span>
            <input className={`${input} w-20 tabular-nums`} value={year} onChange={(e) => setYear(e.target.value.trim())} aria-label="Year of the amount" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-500 dark:text-slate-400">Real terms, prices of</span>
            <input className={`${input} w-20 tabular-nums`} value={target} onChange={(e) => setTarget(e.target.value.trim())} aria-label="Year for real terms" />
          </label>
        </div>
        {!series && <p className="ui-body">Loading…</p>}
        {series && !Number.isFinite(value) && <p className="text-xs text-amber-700 dark:text-amber-400">The amount is not a number.</p>}
        {results.length > 0 && (
          <table className="w-full text-xs" data-converter-results="true">
            <tbody>
              {results.map((r) => (
                <tr key={r.ok ? r.step.label : r.label} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-1 pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.ok ? r.step.label : r.label}</td>
                  {r.ok ? (
                    <>
                      <td className="py-1 pr-3 tabular-nums text-right whitespace-nowrap text-slate-900 dark:text-white">
                        {fmtAmount(r.step.value)} <span className="text-slate-500">{r.step.unit}</span>
                      </td>
                      <td className="py-1 text-slate-500">
                        {r.step.how}. {r.step.source}.
                      </td>
                    </>
                  ) : (
                    <td className="py-1 text-amber-700 dark:text-amber-400" colSpan={2} data-missing="true">
                      Missing: {r.reason}.
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {missing.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Not read: {missing.join(' ')}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">Method: {CONVERTER_METHOD}</p>
      </div>
    </section>
  );
};
