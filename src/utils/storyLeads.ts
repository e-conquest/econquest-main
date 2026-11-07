/**
 * Story leads (seven-groups plan, Phase 5, journalists): a short list of what in the saved data
 * could be a story, by stated rules and no AI.
 *
 *   Records    the latest real observation of an official yearly series is the highest or lowest
 *              on record (at least 10 observations), or since a year at least 10 years earlier
 *              (utils/historicalContext.ts); only when that observation is for one of the last
 *              two calendar years.
 *   Revisions  values the IMF or World Bank revised in the last 30 days (Data health), by at least
 *              0.5 points for figures in % and 5% of the old value otherwise; projections left out.
 *
 * The browser adds what moved since your last visit (utils/digest.ts). A lead is a place to look,
 * not a finding: the figure may be revised, and a record in a short series means little.
 *
 * Browser-safe, pure.
 */
import type { SeriesPoint } from './seriesHistory';
import type { HistoryRevision } from './officialHistory';
import { historicalContext } from './historicalContext';

export const LEAD_RECORD_YEARS = 10;
export const LEAD_MIN_OBS = 10;
export const LEAD_REVISION_DAYS = 30;

export type LeadKind = 'record' | 'revision';

export interface StoryLead {
  kind: LeadKind;
  iso3: string;
  countryName: string;
  figure: string;
  label: string;
  text: string;
  source: string;
  /** Year of the figure (records) or when the revision was seen. */
  when: string;
  /** For ordering: larger first. */
  weight: number;
}

export interface LeadSeries {
  id: string;
  label: string;
  unit: string;
  source: string;
  points: SeriesPoint[];
  revisions?: HistoryRevision[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number, unit: string) => (unit.startsWith('%') ? `${r2(v)}${unit}` : `${r2(v)} ${unit}`.trim());

export function recordLead(iso3: string, countryName: string, s: LeadSeries, now: Date): StoryLead | null {
  const c = historicalContext(s.points, 'annual');
  if (!c?.record) return null;
  const year = Number(c.date.slice(0, 4));
  if (year < now.getUTCFullYear() - 2) return null;
  const onRecord = c.record.since === null;
  if (onRecord && c.observations < LEAD_MIN_OBS) return null;
  if (!onRecord && year - Number(c.record.since!.slice(0, 4)) < LEAD_RECORD_YEARS) return null;
  const span = onRecord ? `on record (since ${c.first})` : `since ${c.record.since}`;
  const yearsBack = onRecord ? year - Number(c.first.slice(0, 4)) : year - Number(c.record.since!.slice(0, 4));
  return {
    kind: 'record',
    iso3,
    countryName,
    figure: s.id,
    label: s.label,
    text: `${s.label} was ${fmt(c.value, s.unit)} in ${c.date}, the ${c.record.kind} ${span}.`,
    source: s.source,
    when: c.date,
    weight: (onRecord ? 2 : 1) + Math.min(yearsBack, 60) / 60,
  };
}

export function revisionLeads(iso3: string, countryName: string, s: LeadSeries, now: Date): StoryLead[] {
  const cutoff = now.getTime() - LEAD_REVISION_DAYS * 86400000;
  const out: StoryLead[] = [];
  for (const r of s.revisions || []) {
    if (r.projection || r.to === undefined || Date.parse(r.seenAt) < cutoff) continue;
    const change = r.to - r.from;
    const big = s.unit.startsWith('%') ? Math.abs(change) >= 0.5 : r.from !== 0 && Math.abs(change / r.from) >= 0.05;
    if (!big) continue;
    const size = s.unit.startsWith('%') ? `${change > 0 ? '+' : ''}${r2(change)} points` : `${change > 0 ? '+' : ''}${r2((change / Math.abs(r.from)) * 100)}%`;
    out.push({
      kind: 'revision',
      iso3,
      countryName,
      figure: s.id,
      label: s.label,
      text: `${s.label} for ${r.date} was revised from ${fmt(r.from, s.unit)} to ${fmt(r.to, s.unit)} (${size}).`,
      source: s.source,
      when: r.seenAt.slice(0, 10),
      weight: 1 + Math.min(Math.abs(s.unit.startsWith('%') ? change / 5 : change / r.from), 1),
    });
  }
  return out;
}

/** Leads for many countries, strongest first. */
export function storyLeads(countries: Array<{ iso3: string; countryName: string; series: LeadSeries[] }>, now = new Date(), max = 30): StoryLead[] {
  const all: StoryLead[] = [];
  for (const c of countries)
    for (const s of c.series) {
      const rec = recordLead(c.iso3, c.countryName, s, now);
      if (rec) all.push(rec);
      all.push(...revisionLeads(c.iso3, c.countryName, s, now));
    }
  return all.sort((a, b) => b.weight - a.weight || (a.when < b.when ? 1 : -1)).slice(0, max);
}

export const STORY_LEADS_METHOD = `Records: the latest real observation of each official yearly series (IMF WEO, World Bank; projections left out) that is the highest or lowest on record (at least ${LEAD_MIN_OBS} observations) or since a year at least ${LEAD_RECORD_YEARS} years earlier, for the last two calendar years only. Revisions: values the IMF or World Bank revised in the last ${LEAD_REVISION_DAYS} days, by at least 0.5 points (figures in %) or 5% of the old value. Moves since your last visit come from the same rules as Since your last visit. Gaps between data and market prices are in Where data and price disagree on the same page. A lead is a place to look, not a finding.`;
