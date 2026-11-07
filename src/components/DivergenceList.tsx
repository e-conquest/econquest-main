import { CDS_HIDDEN } from '../utils/cdsHidden';
import { ValidationBadge } from './ValidationBadge';
import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import { QUALITY_LABEL, rankDivergences, type LastLook, type Quality } from '../utils/divergences';
import { formatPeriod } from '../utils/officialYields';

const QUALITY_CLASS: Record<Quality, string> = {
  live: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  estimate: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  sample: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600',
};

/**
 * Today > Where data and price disagree: one line per country, strongest gap first, with the two
 * figures behind it, what it could mean, the next official date and the change since last look.
 */
export const DivergenceList: React.FC<{
  items: LiveWatchlistItem[];
  lastLook?: LastLook | null;
  onOpenCountry: (item: LiveWatchlistItem) => void;
  limit?: number;
}> = ({ items, lastLook, onOpenCountry, limit = 8 }) => {
  const ranked = useMemo(() => rankDivergences(items, lastLook), [items, lastLook]);
  const shown = ranked.slice(0, limit);

  return (
    <section className="ui-panel" data-divergences="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h3 className="ui-section-title flex flex-wrap items-center gap-2">
          Where data and price disagree
          <ValidationBadge id="divergence_rank" />
        </h3>
        <p className="ui-label">
          One line per country, biggest gap first, from live figures only. Missing figures are left out, never filled in.
        </p>
      </header>
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">No gaps big enough to flag on the figures available.</p>
      ) : (
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((c, i) => {
            const item = items.find((it) => it.iso3 === c.iso3);
            return (
              <li key={c.iso3} data-divergence={c.iso3}>
                <button
                  type="button"
                  onClick={() => item && onOpenCountry(item)}
                  className="w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span className="w-5 shrink-0 text-sm tabular-nums text-slate-400">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-slate-900 dark:text-white">{c.countryName}</span>
                      <span className="text-sm text-blue-700 dark:text-blue-300">{c.top.label}</span>
                      <span className={`px-1.5 py-0.5 text-xs border ${QUALITY_CLASS[c.top.quality]}`}>{QUALITY_LABEL[c.top.quality]}</span>
                    </div>
                    <p className="text-sm text-slate-800 dark:text-slate-200">{c.top.headline}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {c.top.evidence.map((e) => `${e.text} (${e.source})`).join(' · ')}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{c.top.soWhat}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {[
                        c.catalyst ? `Next: ${c.catalyst.title}, ${c.catalyst.legalDeadline ? 'by ' : ''}${formatPeriod(c.catalyst.date)} (${c.catalyst.daysUntil === 0 ? 'today' : c.catalyst.daysUntil === 1 ? 'tomorrow' : `in ${c.catalyst.daysUntil} days`})` : 'No official date in the next 60 days',
                        c.change,
                        c.others.length ? `Also: ${c.others.map((o) => o.label).join(', ')}` : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 self-center" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
        Stated rules on the figures shown, for discussion, not trade advice.
      </p>
    </section>
  );
};
