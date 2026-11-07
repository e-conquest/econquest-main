import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { WEO_VINTAGE_CODES, WEO_VINTAGE_LABELS, type WeoVintageReply } from '../utils/weoVintages';

/**
 * Country Research > History & data > IMF forecasts by edition: every saved WEO edition's figure for
 * one year (src/utils/weoVintages.ts), from the files in data/local/weo-vintages/. Shows how the
 * IMF's number moved and whether each was a projection, an estimate or data at the time.
 */

const KIND: Record<string, string> = { actual: 'Data', estimate: 'IMF estimate', projection: 'IMF projection' };

export const WeoVintagesPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [code, setCode] = useState<string>('NGDP_RPCH');
  const [year, setYear] = useState<string>('');
  const [reply, setReply] = useState<WeoVintageReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    const q = new URLSearchParams({ code, ...(year ? { year } : {}), ...(tick ? { fresh: '1' } : {}) });
    fetch(`/api/weo-vintages/${encodeURIComponent(iso3)}?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: WeoVintageReply) => live && setReply(b))
      .catch((e: Error) => live && setError(`Past IMF editions could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3, code, year, tick]);

  return (
    <section className="ui-panel" data-weo-vintages="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          IMF forecasts by edition, {countryName}
        </h2>
        <p className="ui-label">What each past IMF World Economic Outlook edition said for one year, read from your saved WEO files.</p>
      </header>
      <div className="p-4 space-y-3">
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {reply && reply.editions === 0 && (
          <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1" data-missing="true">
            <p>Missing: no past WEO editions saved yet.</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Download past editions from the IMF WEO database (the tab-delimited “By Countries” file of each edition, named like WEOOct2018all.xls) into data/local/weo-vintages/, then{' '}
              <button type="button" className="underline" onClick={() => setTick((t) => t + 1)}>read the folder again</button>. Nothing is fetched.
            </p>
          </div>
        )}
        {reply && reply.editions > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                Indicator
                <select className="px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value={code} onChange={(e) => { setCode(e.target.value); setYear(''); }}>
                  {WEO_VINTAGE_CODES.map((c) => (
                    <option key={c} value={c}>{WEO_VINTAGE_LABELS[c]}</option>
                  ))}
                </select>
              </label>
              {reply.years.length > 0 && (
                <label className="flex items-center gap-1">
                  Year
                  <select className="px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" value={reply.year ?? ''} onChange={(e) => setYear(e.target.value)}>
                    {reply.years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="ui-pill" onClick={() => setTick((t) => t + 1)}>Read the folder again</button>
            </div>
            {!reply.releases.length ? (
              <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">Missing: none of your {reply.editions} saved editions has {reply.label.toLowerCase()} for {countryName}.</p>
            ) : (
              <>
                {reply.sentence && <p className="text-sm text-slate-900 dark:text-white" data-weo-vintage-sentence="true">{reply.sentence}</p>}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-1 pr-3 font-medium">Edition</th>
                      <th className="py-1 pr-3 font-medium text-right">{reply.label}, {reply.year}</th>
                      <th className="py-1 font-medium">At the time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reply.releases.map((r) => (
                      <tr key={r.vintage} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-3">{r.label}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.value}</td>
                        <td className="py-1 text-slate-500 dark:text-slate-400">{KIND[r.kind]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-500 dark:text-slate-400">Source: IMF World Economic Outlook database, past editions (your files). Licence: see Menu &gt; About &amp; data licences (IMF).</p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};
