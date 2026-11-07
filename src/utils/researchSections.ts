import { FIGURE_LABEL, MISSING_KEYS, hasFigure, missingReason, type FigureKey } from './liveFigures';
import type { LiveWatchlistItem, WatchlistItem } from '../types/council';

/**
 * Research has the same four sections for every scope (Sam, 2026-11-05): one country, compare
 * countries and my holdings. Learn the page once; the scope changes how far you zoom out.
 */
export type ResearchSectionId = 'summary' | 'markets' | 'history' | 'sources';

export const RESEARCH_SECTIONS: Array<{ id: ResearchSectionId; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'markets', label: 'Markets & signals' },
  { id: 'history', label: 'History & data' },
  { id: 'sources', label: 'Sources' },
];

export function sectionLabel(id: ResearchSectionId): string {
  return RESEARCH_SECTIONS.find((s) => s.id === id)?.label || id;
}

/** One country's tab ids, kept so old links ('macro', 'overview') still land. */
const COUNTRY_TAB_FOR: Record<ResearchSectionId, string> = {
  summary: 'brief',
  markets: 'macro',
  history: 'history',
  sources: 'overview',
};

export function countryTabForSection(id: ResearchSectionId): string {
  return COUNTRY_TAB_FOR[id];
}

export function sectionForCountryTab(tab: string): ResearchSectionId | undefined {
  return (Object.keys(COUNTRY_TAB_FOR) as ResearchSectionId[]).find((k) => COUNTRY_TAB_FOR[k] === tab);
}

export interface SourceCell {
  key: FigureKey;
  label: string;
  live: boolean;
  /** Short reason when missing ("Needs setup", "IMF did not answer"); empty when live. */
  short: string;
  help: string;
  kind: 'live' | 'setup' | 'unreachable';
}

export interface SourceRow {
  iso3: string;
  countryName: string;
  liveCount: number;
  cells: SourceCell[];
}

/** For the Sources section of Compare and My holdings: each country, each key figure, live or why not. */
export function sourcesGrid(items: Array<WatchlistItem | LiveWatchlistItem>): SourceRow[] {
  return items.map((it) => {
    const cells = MISSING_KEYS.map((key): SourceCell => {
      if (hasFigure(it, key)) return { key, label: FIGURE_LABEL[key], live: true, short: '', help: '', kind: 'live' };
      const r = missingReason(key, it.iso3);
      return { key, label: FIGURE_LABEL[key], live: false, short: r.short, help: r.help, kind: r.kind };
    });
    return { iso3: it.iso3, countryName: it.countryName, liveCount: cells.filter((c) => c.live).length, cells };
  });
}

/** Where each Tools-page anchor lives on Compare and My holdings. */
const ANCHOR_SECTION: Record<string, ResearchSectionId> = {
  'tool-story-leads': 'summary',
  'tool-divergences': 'summary',
  'tool-regime': 'summary',
  'tool-marketedge': 'markets',
  'tool-scenarios': 'markets',
  'tool-fed-balance-sheet': 'markets',
  'tool-panel': 'history',
  'tool-holdings-signals': 'markets',
};

export function sectionForAnchor(anchor: string | undefined): ResearchSectionId {
  return (anchor && ANCHOR_SECTION[anchor]) || 'summary';
}
