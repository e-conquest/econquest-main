import React, { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import { buildDigest, digestEmptyNote, loadDigestVisit, saveDigestVisit, visitFrom, FIRST_VISIT_DAYS, type DigestKind } from '../utils/digest';
import { evaluateRules, parseRules, type WatchRule } from '../utils/watchRules';

/**
 * Workspace > Since your last visit: policy moves, new inflation prints, leading-indicator turns,
 * 10Y moves of 25 bp or more and watch alerts that started firing, each dated and sourced.
 */
const KIND_LABEL: Record<DigestKind, string> = { policy: 'Rate move', inflation: 'Inflation', cycle: 'Cycle', yield: '10Y yield', alert: 'Alert' };

export const DigestPanel: React.FC<{ items: LiveWatchlistItem[]; onOpenCountry?: (item: LiveWatchlistItem) => void; uses?: React.ReactNode }> = ({ items, onOpenCountry, uses }) => {
  const [last] = useState(() => loadDigestVisit());
  const [rules, setRules] = useState<WatchRule[]>([]);
  useEffect(() => {
    fetch('/api/watch-rules')
      .then((r) => (r.ok ? r.json() : { rules: [] }))
      .then((d) => setRules(parseRules(d?.rules)))
      .catch(() => setRules([]));
  }, []);
  const alertsNow = useMemo(
    () => evaluateRules(rules, items).hits.map((h) => ({ key: `${h.rule.id}|${h.iso3}`, iso3: h.iso3, countryName: h.countryName, text: h.text })),
    [rules, items]
  );
  const digest = useMemo(() => buildDigest(items, last, alertsNow), [items, last, alertsNow]);
  // Record this visit once the figures have settled, for next time.
  useEffect(() => {
    if (!items.length) return;
    const t = window.setTimeout(() => saveDigestVisit(visitFrom(items, alertsNow.map((a) => a.key))), 5000);
    return () => window.clearTimeout(t);
  }, [items, alertsNow]);

  const since = last ? new Date(last.savedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section className="ui-panel" data-digest="true">
      <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            {since ? `Since your last visit (${since})` : 'What moved recently'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {since
              ? 'Rate moves, new inflation prints, leading-indicator turns, 10Y moves of 25 bp or more and new watch alerts. Live figures only.'
              : `First visit on this browser: policy moves in the last ${FIRST_VISIT_DAYS} days. From your next visit this lists everything that moved in between.`}
          </p>
          {uses}
        </div>
      </header>
      <div className="p-4">
        {digest.length === 0 ? (
          <p className={`ui-body ${digestEmptyNote(items, Boolean(since)).startsWith('Missing') ? 'text-amber-800 dark:text-amber-300' : ''}`}>{digestEmptyNote(items, Boolean(since))}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {digest.map((d, i) => {
              const item = items.find((x) => x.iso3 === d.iso3);
              return (
                <li key={`${d.kind}-${d.iso3}-${i}`} className="py-1.5 flex items-start justify-between gap-3">
                  <button type="button" className="text-left" onClick={() => item && onOpenCountry?.(item)}>
                    <span className="ui-badge mr-2">{KIND_LABEL[d.kind]}</span>
                    <span className="text-sm text-slate-900 dark:text-white">{d.text}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{d.source}</span>
                  </button>
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap [font-variant-numeric:tabular-nums]">{d.when}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
