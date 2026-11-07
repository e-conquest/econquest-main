import React, { useMemo } from 'react';
import type { CouncilAssessmentRun, WatchlistItem } from '../types/council';
import { toLive } from '../utils/liveFigures';
import { emptyGroupReasons, marketsMacroBrief, splitEmptyGroups } from '../utils/marketsMacro';
import { marketEdgePeers } from '../utils/marketEdgeAnchors';
import { BriefGroups, BriefSummary } from './CountryBriefPanel';
import { useMarketEdgeAnchors } from './MarketEdgeScreen';
import type { BriefRow } from '../utils/countryNotes';

/** Rows the Brief tab already shows; MarketEdge leaves them out of its first group. */
const ON_BRIEF = new Set(['Real GDP growth', 'CPI inflation', 'Primary balance', 'Debt / GDP', 'Current account', 'FX reserves']);

/** The MarketEdge groups under three headings. A group not named here goes under the last one. */
const SECTIONS: { title: string; groups: string[] }[] = [
  {
    title: 'Economy and policy',
    groups: ['Macro now', 'Central Bank Watcher Agent', 'Cycle clock', 'OECD inflation (monthly)', 'OECD leading indicator (monthly)', 'Reserves and balance of payments (IMF)'],
  },
  {
    title: 'Markets and positioning',
    groups: ['Market pricing', 'Relative Value Agent', 'FX Valuation Agent', 'Futures positioning (CFTC, weekly)', 'US Treasury holdings (TIC, monthly)', 'World reserve currencies (IMF COFER, quarterly)'],
  },
  { title: 'Risks and links', groups: [] },
];

/**
 * Country page > MarketEdge: the economy, market pricing and simple model readings of where
 * they disagree, in three sections. The same readings across the watchlist are on Compare.
 */
export const MarketsMacroPanel: React.FC<{
  run: CouncilAssessmentRun;
  peers: WatchlistItem[];
  onOpenCountry: (item: WatchlistItem) => void;
  /** Opens Compare, where the peer screen lives. */
  onOpenCompare?: () => void;
  /** Shown right under the MarketEdge summary (News and events). */
  afterSummary?: React.ReactNode;
}> = ({ run, peers, onOpenCompare, afterSummary }) => {
  const anchors = useMarketEdgeAnchors();
  // Peers without their built-in figures (utils/liveFigures.ts).
  const livePeers = useMemo(() => peers.map(toLive), [peers]);
  const allPeers = useMemo(() => marketEdgePeers(livePeers, anchors?.peers || []), [livePeers, anchors]);
  const brief = useMemo(() => marketsMacroBrief(run, allPeers), [run, allPeers]);
  const sections = useMemo(() => {
    const named = new Set(SECTIONS.flatMap((x) => x.groups));
    const groups = brief.groups.map((g) =>
      g.title === 'Macro now'
        ? { ...g, title: 'Policy rate and inflation target', rows: g.rows.filter((r: BriefRow) => !ON_BRIEF.has(r.label)) }
        : g
    );
    return SECTIONS.map((sec, i) => ({
      title: sec.title,
      groups: brief.groups
        .map((g, k) => ({ g: groups[k], orig: g.title }))
        .filter(({ orig }) => (i === SECTIONS.length - 1 ? !named.has(orig) : sec.groups.includes(orig)))
        .sort((a, b) => (sec.groups.length ? sec.groups.indexOf(a.orig) - sec.groups.indexOf(b.orig) : 0))
        .map(({ g }) => g),
    }));
  }, [brief]);
  // Panels with no figure at all fold into one list at the end, so the page leads with what is held.
  const split = useMemo(() => {
    const empty: typeof brief.groups = [];
    const shown = sections.map((sec) => {
      const s = splitEmptyGroups(sec.groups);
      empty.push(...s.empty);
      return { title: sec.title, groups: s.filled };
    });
    return { shown, empty };
  }, [sections]);

  return (
    <div className="space-y-3" data-no-stat-ref="true" data-no-provenance-overlay="true" data-markets-macro="true">
      <section className="ui-panel">
        <header className="ui-panel-header">
          <h2 className="ui-section-title">MarketEdge</h2>
          <p className="ui-label">What the economy is doing, what markets are pricing, and where the two disagree.</p>
        </header>
        <BriefSummary brief={brief} />
      </section>
      {afterSummary}
      {split.shown.map((sec) =>
        sec.groups.length ? (
          <div key={sec.title} className="space-y-2">
            <h3 className="ui-section-title pt-2">{sec.title}</h3>
            <BriefGroups brief={{ ...brief, groups: sec.groups }} country={run} />
          </div>
        ) : null
      )}

      {split.empty.length > 0 && (
        <details className="ui-panel" data-empty-panels={split.empty.length}>
          <summary className="cursor-pointer px-4 py-3 ui-body">
            Not available yet: {split.empty.length} {split.empty.length === 1 ? 'panel has' : 'panels have'} no figures for {run.countryName}
            <span className="block ui-label">{split.empty.map((g) => g.title).join(' · ')}. Open for what each needs.</span>
          </summary>
          <ul className="border-t border-slate-100 dark:border-slate-800">
            {split.empty.map((g) => (
              <li key={g.title} className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span className="ui-body">{g.title}</span>
                <span className="block text-xs text-amber-700 dark:text-amber-400">{emptyGroupReasons(g).join('; ')}</span>
                <span className="block ui-label">{g.rows.map((r) => r.label).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="ui-panel px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <p className="ui-body">{run.countryName} against the rest of your watchlist and the benchmark markets is under Research › Compare countries.</p>
        {onOpenCompare && (
          <button type="button" className="ui-btn" onClick={onOpenCompare}>
            Open Compare
          </button>
        )}
      </div>
    </div>
  );
};
