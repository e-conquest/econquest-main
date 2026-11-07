import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import type { AlfredReply } from '../utils/alfredVintages';

/**
 * Country Research > History & data > US data as first published (United States only): every
 * release of one month's or quarter's figure from ALFRED (src/utils/alfredVintages.ts), and the
 * figure as it was known on a chosen day. Needs the user's free FRED API key.
 */

type Reply = AlfredReply & { choices?: Array<{ id: string; label: string }> };
const SELECT = 'px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white';

export const UsVintagesPanel: React.FC = () => {
  const [series, setSeries] = useState('GDPC1');
  const [period, setPeriod] = useState('');
  const [asOf, setAsOf] = useState('');
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    const q = new URLSearchParams({ series, ...(period ? { period } : {}), ...(asOf ? { asOf } : {}) });
    fetch(`/api/us-vintages?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`US vintages could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [series, period, asOf]);

  const label = (d: string) => (series === 'GDPC1' ? `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}` : d.slice(0, 7));

  return (
    <section className="ui-panel" data-us-vintages="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          US data as first published
        </h2>
        <p className="ui-label">Every release of a US figure since it first came out, and what was known on a past day (ALFRED, St. Louis Fed). The other screens show today's revised numbers.</p>
      </header>
      <div className="p-4 space-y-3">
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {reply && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              Figure
              <select className={SELECT} value={series} onChange={(e) => { setSeries(e.target.value); setPeriod(''); }}>
                {(reply.choices || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            {reply.ok && reply.periods && (
              <label className="flex items-center gap-1">
                Period
                <select className={SELECT} value={reply.period} onChange={(e) => setPeriod(e.target.value)}>
                  {[...reply.periods].reverse().map((d) => (
                    <option key={d} value={d}>{label(d)}</option>
                  ))}
                </select>
              </label>
            )}
            {reply.ok && (
              <label className="flex items-center gap-1">
                Known on
                <input type="date" className={SELECT} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </label>
            )}
          </div>
        )}
        {reply && !reply.ok && <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">Missing: {reply.reason}.</p>}
        {reply?.ok && (
          <>
            {reply.sentence && <p className="text-sm text-slate-900 dark:text-white" data-us-vintage-sentence="true">{reply.sentence}</p>}
            {reply.asOf && (
              <p className="text-sm text-slate-900 dark:text-white" data-us-vintage-asof="true">
                {reply.asOf.value === null ? `On ${reply.asOf.day} the figure for ${reply.periodLabel} was not yet published.` : `On ${reply.asOf.day} the published figure for ${reply.periodLabel} was ${reply.asOf.value}.`}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-medium">Published from</th>
                  <th className="py-1 font-medium text-right">{reply.label}, {reply.periodLabel}</th>
                </tr>
              </thead>
              <tbody>
                {(reply.releases || []).map((r) => (
                  <tr key={r.day} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-3">{r.day}</td>
                    <td className="py-1 text-right tabular-nums">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 dark:text-slate-400">Growth and inflation are worked out inside each release (this period against the earlier one as that release stood). Source: {reply.source}.</p>
          </>
        )}
      </div>
    </section>
  );
};
