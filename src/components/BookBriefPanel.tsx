import React, { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { LiveWatchlistItem } from '../types/council';
import type { StagedTradeTicketSpec } from '../utils/nssYieldCurveAndCatalystEngine';
import type { Holding } from '../utils/holdings';
import { bookView, clientBrief, pmBookBrief } from '../utils/bookNote';
import { BriefGroups, BriefSummary } from './CountryBriefPanel';

export type BookBriefView = 'pm' | 'client';

const VIEW_INFO: Record<BookBriefView, { label: string; title: string; note: string; cta: string }> = {
  pm: {
    label: 'Book',
    title: 'Book brief',
    note: 'Concentration, where the risk sits, official events across the book in the next 30 days, and staged ideas.',
    cta: 'Write the portfolio review',
  },
  client: {
    label: 'Client',
    title: 'Client brief',
    note: 'The portfolio in plain terms: what is held, how risky each part is, and dates to watch.',
    cta: 'Write the client review',
  },
};

/**
 * Start view for the portfolio manager and the private wealth adviser under Research > My holdings > History & data:
 * the whole book, not one country. Either view can be switched to; the button opens the
 * matching report template.
 */
export const BookBriefPanel: React.FC<{
  holdings: Holding[];
  riskLookup: LiveWatchlistItem[];
  watchlist: LiveWatchlistItem[];
  stagedTickets: StagedTradeTicketSpec[];
  view: BookBriefView;
  onWriteReport: (view: BookBriefView) => void;
}> = ({ holdings, riskLookup, watchlist, stagedTickets, view: initialView, onWriteReport }) => {
  const [view, setView] = useState<BookBriefView>(initialView);
  const brief = useMemo(() => {
    const v = bookView(holdings, riskLookup, watchlist);
    return view === 'client' ? clientBrief(v) : pmBookBrief(v, stagedTickets);
  }, [holdings, riskLookup, watchlist, stagedTickets, view]);
  const info = VIEW_INFO[view];

  return (
    <div className="space-y-3" data-no-stat-ref="true" data-no-provenance-overlay="true">
      <section className="ui-panel">
        <header className="ui-panel-header flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="ui-section-title">{info.title}</h2>
            <p className="ui-label">{info.note}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="tablist" aria-label="Brief view" className="flex gap-1">
              {(Object.keys(VIEW_INFO) as BookBriefView[]).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} className="ui-pill" onClick={() => setView(v)}>
                  {VIEW_INFO[v].label}
                </button>
              ))}
            </div>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onWriteReport(view)}>
              <FileText className="w-3.5 h-3.5" /> {info.cta}
            </button>
          </div>
        </header>
        <BriefSummary brief={brief} />
      </section>
      <BriefGroups brief={brief} />
    </div>
  );
};
