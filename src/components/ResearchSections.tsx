import React, { useEffect, useRef, useState } from 'react';
import type { LiveWatchlistItem } from '../types/council';
import { RESEARCH_SECTIONS, sourcesGrid } from '../utils/researchSections';
import { useOnlineStatus } from './OfflineData';

/** The section menu, the same on every Research scope. Extra tabs (the specialist desks) follow a divider. */
export const ResearchSectionNav: React.FC<{
  active: string;
  onChange: (id: string) => void;
  /** The four shared sections by default; one country passes its own tabs under the same names. */
  sections?: Array<{ id: string; label: string }>;
  extra?: Array<{ id: string; label: string; className?: string }>;
  ariaLabel?: string;
}> = ({ active, onChange, sections = RESEARCH_SECTIONS, extra = [], ariaLabel = 'Research sections' }) => {
  const ref = useRef<HTMLElement | null>(null);
  // On a phone the menu scrolls sideways: keep the open section in view.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && ref.current && ref.current.scrollWidth > ref.current.clientWidth) {
      ref.current.scrollLeft = Math.max(0, el.offsetLeft - ref.current.clientWidth / 2 + el.clientWidth / 2);
    }
  }, [active]);
  // When more sections sit off to the right (a phone), fade the right edge so the menu reads as scrollable.
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [sections.length, extra.length]);
  return (
    <nav
      ref={ref}
      className={`mt-3 -mb-3 flex gap-1 ui-scroll-x border-t border-slate-100 dark:border-slate-800 ${moreRight ? '[mask-image:linear-gradient(to_right,black_80%,transparent)]' : ''}`}
      aria-label={ariaLabel}
      data-research-sections="true"
      data-more-right={moreRight ? 'true' : undefined}
    >
      {sections.map((s) => (
        <button key={s.id} type="button" onClick={() => onChange(s.id)} aria-current={active === s.id ? 'page' : undefined} className="ui-tab whitespace-nowrap">
          {s.label}
        </button>
      ))}
      {extra.length > 0 && <span aria-hidden="true" className="self-center mx-1 h-4 border-l border-slate-200 dark:border-slate-700" />}
      {extra.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)} aria-current={active === t.id ? 'page' : undefined} className={`ui-tab whitespace-nowrap ${t.className || ''}`}>
          {t.label}
        </button>
      ))}
    </nav>
  );
};

/** Header card for the Compare and My holdings scopes: what is in view, its data state, then the section menu. */
export const ResearchHeader: React.FC<{
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  /** A section id, or one of the extra tabs. */
  section: string;
  onSection: (id: string) => void;
  extra?: Array<{ id: string; label: string }>;
}> = ({ title, subtitle, badge, actions, section, onSection, extra }) => (
  <div className="ui-panel px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {badge}
        {actions}
      </div>
    </div>
    <ResearchSectionNav active={section} onChange={onSection} extra={extra} />
  </div>
);

/** "Live data for 3 of 5 countries" ("Offline: saved data for ..." without feeds), or the honest empty state. */
export const LiveCountBadge: React.FC<{ items: LiveWatchlistItem[] }> = ({ items }) => {
  const live = items.filter((w) => w.dataMode === 'live' || w.dataMode === 'partial').length;
  const net = useOnlineStatus();
  // Offline the figures are the last saved pull: say so, never "Live data".
  const offline = !!net && !net.online;
  return (
    <p
      className={`text-xs px-2 py-1 border ${
        live === 0 || offline
          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
          : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      }`}
      title={
        offline
          ? 'The feeds cannot be reached from this computer. A country counts when at least one public data feed answered on its last saved pull.'
          : 'A country counts as live when at least one public data feed answered on its last pull.'
      }
    >
      {items.length === 0
        ? 'No countries yet'
        : live === 0
          ? 'No live data yet: figures read Missing until a source answers'
          : offline
            ? `Offline: saved data for ${live} of ${items.length} countries`
            : `Live data for ${live} of ${items.length} countries`}
    </p>
  );
};

/** Sources across many countries: each key figure, live or the reason it is missing. */
export const SourcesGrid: React.FC<{
  items: LiveWatchlistItem[];
  title: string;
  empty: string;
  onOpenCountry?: (item: LiveWatchlistItem) => void;
}> = ({ items, title, empty, onOpenCountry }) => {
  const rows = sourcesGrid(items);
  const byIso = new Map(items.map((w) => [w.iso3, w]));
  return (
    <section className="ui-panel" data-sources-grid="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title">{title}</h2>
        <p className="ui-label">Live means a feed, an official series or your own file filled it. Anything else reads Missing with the reason; no built-in values are shown. Open a country for every figure and its source.</p>
      </header>
      {rows.length === 0 ? (
        <p className="p-4 ui-body">{empty}</p>
      ) : (
        <div className="ui-scroll-x">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-normal">Country</th>
                {rows[0].cells.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-normal whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.iso3} className="border-b border-slate-50 dark:border-slate-800/60 align-top">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {onOpenCountry ? (
                      <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline text-left" onClick={() => onOpenCountry(byIso.get(r.iso3)!)}>
                        {r.countryName}
                      </button>
                    ) : (
                      r.countryName
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {r.liveCount} of {r.cells.length} live
                    </div>
                  </td>
                  {r.cells.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-xs whitespace-nowrap" title={c.help || undefined}>
                      {c.live ? (
                        <span className="text-emerald-700 dark:text-emerald-400">Live</span>
                      ) : (
                        <>
                          <span className="text-slate-400 dark:text-slate-500">Missing</span>
                          <div className={c.kind === 'setup' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}>{c.short}</div>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
