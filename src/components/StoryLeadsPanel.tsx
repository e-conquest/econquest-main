import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import type { StoryLead } from '../utils/storyLeads';
import { buildDigest, loadDigestVisit } from '../utils/digest';

/**
 * Research > Compare countries > Summary > Story leads (src/utils/storyLeads.ts): records and
 * recent revisions in the saved yearly history, plus what moved since your last visit. Places to
 * look, by stated rules; not findings.
 */

type Reply = { leads: StoryLead[]; countries: number; noHistory: string[]; method: string };

const KIND: Record<string, string> = { record: 'Record', revision: 'Revision', moved: 'Moved' };

export const StoryLeadsPanel: React.FC<{ items: LiveWatchlistItem[]; onOpenCountry?: (item: LiveWatchlistItem) => void }> = ({ items, onOpenCountry }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codes = useMemo(() => items.filter((i) => !i.isBenchmark).map((i) => i.iso3).sort().join(','), [items]);

  useEffect(() => {
    if (!codes) return;
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/story-leads?iso3=${encodeURIComponent(codes)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`Story leads could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [codes]);

  // Read-only: the Workspace digest records visits, so opening Compare does not reset it.
  const moved = useMemo(() => buildDigest(items, loadDigestVisit()).slice(0, 10), [items]);
  const name = (iso3: string) => items.find((i) => i.iso3 === iso3)?.countryName || iso3;
  const rows = [
    ...(reply?.leads || []).map((l) => ({ kind: l.kind as string, iso3: l.iso3, text: l.text, when: l.when, source: l.source })),
    ...moved.map((d) => ({ kind: 'moved', iso3: d.iso3, text: d.text, when: d.when, source: d.source })),
  ];

  return (
    <section className="ui-panel" data-story-leads="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Story leads
        </h2>
        <p className="ui-label">Records and recent revisions in the official yearly figures, and what moved since your last visit. Places to look, not findings.</p>
      </header>
      <div className="p-4 space-y-2">
        {!codes && <p className="ui-body">No countries on this watchlist yet.</p>}
        {codes && !reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && rows.length === 0 && (
          <p className="ui-body">No leads by these rules today: no records, no large recent revisions and nothing moved since your last visit.</p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {rows.map((r, i) => {
              const item = items.find((x) => x.iso3 === r.iso3);
              return (
                <li key={`${r.kind}-${r.iso3}-${i}`} className="py-1.5 flex items-start gap-3" data-lead-kind={r.kind}>
                  <span className="w-16 shrink-0 text-slate-500 dark:text-slate-400">{KIND[r.kind] || r.kind}</span>
                  <span className="flex-1 text-slate-900 dark:text-white">
                    {item && onOpenCountry ? (
                      <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpenCountry(item)}>
                        {name(r.iso3)}
                      </button>
                    ) : (
                      <span className="font-medium">{name(r.iso3)}</span>
                    )}
                    : {r.text} <span className="text-slate-500">({r.source}{r.when ? `, ${r.when}` : ''})</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {reply && reply.noHistory.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: no saved yearly history yet for {reply.noHistory.map(name).join(', ')} (open the country's History once to download it).
          </p>
        )}
        {reply && <p className="text-xs text-slate-500 dark:text-slate-400">Method: {reply.method} Description, not a tested signal.</p>}
      </div>
    </section>
  );
};
