/**
 * Watch alerts (Sam, 2026-11-05): thresholds you set on the timing figures; Today flags a country
 * when one is crossed. No threshold is built in: every rule is one you added.
 *
 * Saved in data/local/watch-rules.json (DATA_DIR/local when DATA_DIR is set), like Settings and the
 * research library: on this computer only, shared by `npm run dev` and Docker. The functions here
 * are browser-safe; the file is read and written by watchRulesStore.ts on the server.
 */
import type { LiveWatchlistItem } from '../types/council';
import { shockWatch } from './shockWatch';
import { fastestOddsMove } from './oddsMoves';

export type WatchMetric =
  | 'yield_level'
  | 'yield_3m_bps'
  | 'policy_rate'
  | 'cli_level'
  | 'cftc_percentile'
  | 'tone_shift'
  | 'reserves_12m_pct'
  | 'shock_alerts'
  | 'odds_1w_pts';

export const WATCH_METRICS: Record<WatchMetric, { label: string; unit: string; source: string }> = {
  yield_level: { label: '10Y yield', unit: '%', source: 'official 10Y yield' },
  yield_3m_bps: { label: '10Y yield change over 3 months', unit: 'bps', source: 'official monthly 10Y yield' },
  policy_rate: { label: 'Policy rate', unit: '%', source: 'BIS policy rates' },
  cli_level: { label: 'OECD leading indicator', unit: '', source: 'OECD CLI via DBnomics' },
  cftc_percentile: { label: 'CFTC positioning percentile (3 years)', unit: 'th percentile', source: 'CFTC TFF' },
  tone_shift: { label: 'GDELT news tone shift', unit: 'pts', source: 'GDELT tone timeline' },
  reserves_12m_pct: { label: 'Reserves change over 12 months', unit: '%', source: 'IMF reserves' },
  shock_alerts: { label: 'Shock early-warning alerts', unit: '', source: 'stated rules (Country tab)' },
  odds_1w_pts: { label: 'Largest weekly Polymarket odds move (either way)', unit: 'pts', source: 'Polymarket' },
};

export type WatchOp = '>=' | '<=';

export interface WatchRule {
  id: string;
  /** A watchlist country (ISO3), or '*' for every country on screen. */
  iso3: string;
  metric: WatchMetric;
  op: WatchOp;
  value: number;
  createdAt: string;
  note?: string;
}

export interface WatchHit {
  rule: WatchRule;
  iso3: string;
  countryName: string;
  value: number;
  text: string;
}

export const MAX_RULES = 100;

/** The current figure for a metric, or undefined when no source filled it (a missing figure never triggers). */
export function metricValue(it: LiveWatchlistItem, m: WatchMetric): number | undefined {
  switch (m) {
    case 'yield_level':
      return it.yield10YPct;
    case 'yield_3m_bps':
      return it.yield10YChange3mPts !== undefined ? Math.round(it.yield10YChange3mPts * 100) : undefined;
    case 'policy_rate':
      return it.policyRateSource === 'bis' ? it.policyRatePct : undefined;
    case 'cli_level':
      return it.oecdCli?.level;
    case 'cftc_percentile':
      return it.cftc?.percentile;
    case 'tone_shift':
      return it.gdelt?.toneShift?.shift;
    case 'reserves_12m_pct':
      return it.imf?.reserves?.change12mPct;
    case 'shock_alerts':
      return shockWatch(it).warnings.filter((w) => w.level === 'alert').length;
    case 'odds_1w_pts': {
      const ms = (it.politics?.markets || []).filter((x) => x.change1wPts !== undefined);
      if (!ms.length) return undefined;
      return Math.max(...ms.map((x) => Math.abs(x.change1wPts!)));
    }
  }
}

const fmt = (v: number, m: WatchMetric) => {
  const u = WATCH_METRICS[m].unit;
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return u === '%' ? `${n}%` : u.startsWith('th') ? `${n}${u}` : u ? `${n} ${u}` : n;
};

export function ruleText(r: WatchRule, countryName?: string): string {
  return `${r.iso3 === '*' ? 'Any country' : countryName || r.iso3}: ${WATCH_METRICS[r.metric].label} ${r.op === '>=' ? 'at or above' : 'at or below'} ${fmt(r.value, r.metric)}`;
}

/** Every rule against every country it covers; hits first by rule order. */
export function evaluateRules(rules: WatchRule[], items: LiveWatchlistItem[]): { hits: WatchHit[]; noFigure: Array<{ rule: WatchRule; iso3: string }> } {
  const hits: WatchHit[] = [];
  const noFigure: Array<{ rule: WatchRule; iso3: string }> = [];
  for (const r of rules) {
    for (const it of items.filter((i) => r.iso3 === '*' || i.iso3 === r.iso3)) {
      const v = metricValue(it, r.metric);
      if (v === undefined) {
        noFigure.push({ rule: r, iso3: it.iso3 });
        continue;
      }
      if (r.op === '>=' ? v >= r.value : v <= r.value) {
        const extra = r.metric === 'odds_1w_pts' ? fastestOddsMove(it.politics?.markets) : undefined;
        hits.push({
          rule: r,
          iso3: it.iso3,
          countryName: it.countryName,
          value: v,
          text: `${it.countryName}: ${WATCH_METRICS[r.metric].label} is ${fmt(v, r.metric)} (your rule: ${r.op === '>=' ? 'at or above' : 'at or below'} ${fmt(r.value, r.metric)}; ${WATCH_METRICS[r.metric].source})${extra ? `, "${extra.question}"` : ''}.`,
        });
      }
    }
  }
  return { hits, noFigure };
}

/** A rule as sent by the page, checked. Null when anything is off. */
export function parseRule(x: unknown): WatchRule | null {
  const r = x as Partial<WatchRule> | null;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.iso3 !== 'string' || !/^(\*|[A-Z]{3})$/.test(r.iso3)) return null;
  if (typeof r.metric !== 'string' || !(r.metric in WATCH_METRICS)) return null;
  if (r.op !== '>=' && r.op !== '<=') return null;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  return {
    id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : `w${Date.now().toString(36)}`,
    iso3: r.iso3,
    metric: r.metric as WatchMetric,
    op: r.op,
    value: r.value,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt.slice(0, 30) : new Date().toISOString(),
    ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim().slice(0, 200) } : {}),
  };
}

export function parseRules(x: unknown): WatchRule[] {
  const list = (x as { rules?: unknown })?.rules;
  return Array.isArray(list) ? list.map(parseRule).filter((r): r is WatchRule => r !== null).slice(0, MAX_RULES) : [];
}
