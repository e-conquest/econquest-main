/**
 * Country risk scorecard (seven-groups plan, Phase 4, political and country risk): the figures a
 * country risk analyst looks at first, side by side, each with its source and year.
 *
 *   Governance  World Bank Worldwide Governance Indicators, six estimates (world mean 0, sd 1)
 *   Conflict    UCDP/PRIO armed conflict located in the country and UCDP deaths, latest coded year
 *   Unrest      GDELT 1.0 protest and violence spikes (utils/unrestSpikes.ts)
 *   Geopolitical Caldara-Iacoviello Geopolitical Risk index, country and world (utils/gprIndex.ts)
 *   Economy     IMF WEO and World Bank: debt, growth, inflation, current account, reserves, external debt
 *
 * There is no overall score. Any weighting of these pillars would be a guess, and a single number
 * would look more certain than it is. Each row says where the figure sits against a stated
 * reference instead (the world average for WGI, the country's own record for the rest).
 *
 * Description, not a tested signal. Browser-safe, pure.
 */
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';
import type { UcdpReading } from './ucdpConflict';
import type { SpikeMonth } from './unrestSpikes';
import { GPR_SOURCE, type GprCountry, type GprReading } from './gprIndex';

export type PillarId = 'governance' | 'conflict' | 'unrest' | 'geopolitical' | 'economy';

export interface ScoreRow {
  label: string;
  value: number;
  unit: string;
  /** Year or month of the value. */
  when: string;
  /** Change against five years earlier, when that year is on file. */
  change5y?: number;
  /** One short phrase against a stated reference. */
  context?: string;
}

export interface Pillar {
  id: PillarId;
  label: string;
  source: string;
  rows: ScoreRow[];
  /** Figures the pillar could not show, with why. */
  missing: string[];
}

export interface ScorecardInputs {
  /** Official series by figure id (wgi_*, debt_gdp, gdp_growth, cpi_imf, current_account, reserves_months, external_debt). */
  official: Record<string, Series | SeriesMissing | undefined>;
  officialMissingReason?: string;
  conflict?: UcdpReading | null;
  conflictMissing?: string;
  spikes?: SpikeMonth[];
  spikesMissing?: string;
  gpr?: GprCountry | null;
  gprMissing?: string;
}

export const WGI_IDS = ['wgi_voice', 'wgi_stability', 'wgi_effectiveness', 'wgi_regulatory', 'wgi_rule_of_law', 'wgi_corruption'] as const;
export const ECONOMY_IDS = ['debt_gdp', 'gdp_growth', 'cpi_imf', 'current_account', 'reserves_months', 'external_debt'] as const;

export const SCORECARD_METHOD =
  'Each figure as published, with its year. Governance: World Bank WGI estimates, where 0 is the world average and 1 is one standard deviation; the change is against five years earlier. Conflict: UCDP/PRIO armed conflicts located in the country and UCDP best estimates of deaths for the latest year UCDP has coded, with the three years before. Unrest: the latest complete GDELT month against the country\'s previous 24 months (a spike is z of 3 or more). Geopolitical risk: the Caldara-Iacoviello news index for the country and the world, against all months on file. Economy: latest outturn year (IMF projections left out), against five years earlier. No overall score: any weights would be a guess.';

const r2 = (v: number) => Math.round(v * 100) / 100;
const isSeries = (s: Series | SeriesMissing | undefined): s is Series => !!s && 'points' in s && Array.isArray(s.points) && s.points.length > 0;

/** Latest point that is not an IMF projection, and the point five years before it. */
export function latestOutturn(points: SeriesPoint[]): { last: SeriesPoint; prior?: SeriesPoint } | null {
  const real = points.filter((p) => p.note !== 'IMF projection' && Number.isFinite(p.value));
  const last = real[real.length - 1];
  if (!last) return null;
  const y = Number(String(last.date).slice(0, 4));
  const prior = real.find((p) => Number(String(p.date).slice(0, 4)) === y - 5);
  return { last, prior };
}

function wgiContext(v: number): string {
  if (v >= 1) return 'well above the world average';
  if (v > 0.25) return 'above the world average';
  if (v >= -0.25) return 'near the world average';
  if (v > -1) return 'below the world average';
  return 'well below the world average';
}

function officialRow(s: Series, unit?: string, context?: (v: number) => string): ScoreRow | null {
  const o = latestOutturn(s.points);
  if (!o) return null;
  return {
    label: s.label,
    value: r2(o.last.value),
    unit: unit ?? s.unit ?? '',
    when: String(o.last.date).slice(0, 4),
    ...(o.prior ? { change5y: r2(o.last.value - o.prior.value) } : {}),
    ...(context ? { context: context(o.last.value) } : {}),
  };
}

function officialPillar(id: PillarId, label: string, ids: readonly string[], inp: ScorecardInputs, context?: (v: number) => string, unit?: string): Pillar {
  const rows: ScoreRow[] = [];
  const missing: string[] = [];
  const sources = new Set<string>();
  for (const fid of ids) {
    const s = inp.official[fid];
    if (isSeries(s)) {
      const row = officialRow(s, unit, context);
      if (row) {
        rows.push(row);
        if (s.source) sources.add(s.source.replace(/\s*\([^)]*\)$/, ''));
        continue;
      }
      missing.push(`${s.label}: no outturn year on file`);
    } else if (s) missing.push(`${s.label}: ${(s as SeriesMissing).reason}`);
    else missing.push(`${fid}: ${inp.officialMissingReason || 'not on file'}`);
  }
  return { id, label, source: [...sources].join('; ') || '—', rows, missing };
}

function conflictPillar(inp: ScorecardInputs): Pillar {
  const p: Pillar = { id: 'conflict', label: 'Armed conflict', source: 'UCDP/PRIO and UCDP (Uppsala Conflict Data Program)', rows: [], missing: [] };
  const c = inp.conflict;
  if (!c) {
    p.missing.push(`UCDP: ${inp.conflictMissing || 'no UCDP files read'}`);
    return p;
  }
  const y = String(c.latest.year);
  const years = [c.latest, ...c.prior];
  if (c.latest.conflicts) {
    const withConflict = years.filter((f) => (f.conflicts?.n ?? 0) > 0).length;
    p.rows.push({ label: 'Armed conflicts located in the country', value: c.latest.conflicts.n, unit: 'conflicts', when: y, context: `${c.latest.conflicts.wars} at war level (1,000+ battle deaths); conflict in ${withConflict} of the last ${years.length} coded years` });
  } else p.missing.push('Armed conflicts: UCDP/PRIO Armed Conflict Dataset not on disk');
  if (c.latest.stateBased) p.rows.push({ label: 'Battle deaths, state-based conflict', value: c.latest.stateBased.best, unit: 'deaths (best estimate)', when: y, context: `range ${c.latest.stateBased.low}-${c.latest.stateBased.high}` });
  else p.missing.push('Battle deaths: UCDP Battle-Related Deaths file not on disk');
  if (c.latest.nonState) p.rows.push({ label: 'Deaths, non-state conflict', value: c.latest.nonState.best, unit: 'deaths (best estimate)', when: y });
  else p.missing.push('Non-state conflict deaths: UCDP Non-State file not on disk');
  if (c.latest.oneSided) p.rows.push({ label: 'Deaths, one-sided violence against civilians', value: c.latest.oneSided.best, unit: 'deaths (best estimate)', when: y });
  else p.missing.push('One-sided violence deaths: UCDP One-Sided file not on disk');
  return p;
}

function unrestPillar(inp: ScorecardInputs): Pillar {
  const p: Pillar = { id: 'unrest', label: 'Unrest', source: 'GDELT 1.0 event files (shares of the country\'s events)', rows: [], missing: [] };
  const rows = inp.spikes || [];
  const last = rows[rows.length - 1];
  if (!last) {
    p.missing.push(`GDELT: ${inp.spikesMissing || 'not enough GDELT months on disk for a two-year baseline'}`);
    return p;
  }
  const episodes = rows.slice(-24).filter((r) => r.episodes.length).length;
  p.rows.push({ label: 'Protests, share of events', value: last.protestPct, unit: '%', when: last.month, context: `z ${last.protestZ} against the previous 24 months${last.spikes.includes('protests') ? ' (spike)' : ''}` });
  p.rows.push({ label: 'Violence, share of events', value: last.violencePct, unit: '%', when: last.month, context: `z ${last.violenceZ} against the previous 24 months${last.spikes.includes('violence') ? ' (spike)' : ''}` });
  p.rows.push({ label: 'Spike episodes, last 24 months', value: episodes, unit: 'episodes', when: `${rows.slice(-24)[0].month} to ${last.month}` });
  return p;
}

function gprPillar(inp: ScorecardInputs): Pillar {
  const p: Pillar = { id: 'geopolitical', label: 'Geopolitical risk (news index)', source: GPR_SOURCE, rows: [], missing: [] };
  const g = inp.gpr;
  if (!g) {
    p.missing.push(`GPR index: ${inp.gprMissing || 'no GPR file read'}`);
    return p;
  }
  const row = (r: GprReading): ScoreRow => ({ label: r.label, value: r.value, unit: 'index', when: r.month, context: `at or above ${r.percentile}% of months on file; 12-month mean ${r.mean12}, all-time mean ${r.meanAll}` });
  if (g.country) p.rows.push(row(g.country));
  else p.missing.push(`Country index: ${g.countryMissing || 'not in the file'}`);
  if (g.world) p.rows.push(row(g.world));
  else p.missing.push('World index: the GPR column is empty');
  return p;
}

export interface Scorecard {
  pillars: Pillar[];
  /** Pillars with at least one figure. */
  filled: number;
}

export function countryRiskScorecard(inp: ScorecardInputs): Scorecard {
  const pillars = [
    officialPillar('governance', 'Governance', WGI_IDS, inp, wgiContext, 'estimate'),
    conflictPillar(inp),
    unrestPillar(inp),
    gprPillar(inp),
    officialPillar('economy', 'Economy', ECONOMY_IDS, inp),
  ];
  return { pillars, filled: pillars.filter((p) => p.rows.length).length };
}

/** One plain sentence: the weakest governance estimate, conflict, and whether this month spikes. */
export function scorecardSentence(name: string, sc: Scorecard): string {
  const parts: string[] = [];
  const gov = sc.pillars.find((p) => p.id === 'governance')?.rows || [];
  if (gov.length) {
    const low = [...gov].sort((a, b) => a.value - b.value)[0];
    parts.push(`weakest governance estimate is ${low.label.toLowerCase()} at ${low.value} (${low.when}, ${low.context})`);
  }
  const con = sc.pillars.find((p) => p.id === 'conflict')?.rows.find((r) => r.unit === 'conflicts');
  if (con) parts.push(con.value > 0 ? `${con.value} armed conflict${con.value === 1 ? '' : 's'} located in the country in ${con.when}` : `no armed conflict located in the country in ${con.when}`);
  const un = sc.pillars.find((p) => p.id === 'unrest')?.rows || [];
  if (un.length) {
    const spiking = un.slice(0, 2).filter((r) => r.context?.includes('(spike)')).map((r) => r.label.split(',')[0].toLowerCase());
    parts.push(spiking.length ? `${un[0].when} is a spike in ${spiking.join(' and ')}` : `${un[0].when} is not an unrest spike`);
  }
  if (!parts.length) return `${name}: no scorecard figures on file yet.`;
  return `${name}: ${parts.join('; ')}.`;
}
