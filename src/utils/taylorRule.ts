/**
 * Policy rule check: the policy rate against a simple Taylor rule, a standard cross-check of how
 * tight a central bank is. A stated rule on sourced figures, not a forecast of the next move.
 *
 *   rule rate = r* + inflation + 0.5 x (inflation - target) + 0.5 x output gap
 *
 * Inputs: the BIS policy rate, the latest inflation the app holds (monthly where it has it, else
 * the IMF WEO year), the central bank's own target (src/utils/marketsMacro.ts) and the IMF WEO
 * output gap where the IMF publishes one. r* is the rule's parameter: 2% real, as in Taylor (1993),
 * stated on every reading. Without an output gap the gap term is left out and the reading says so.
 * Without a policy rate, inflation or a target there is no reading, only the reason.
 *
 * Browser-safe.
 */
import type { WatchlistItem } from '../types/council';
import { INFLATION_TARGETS, type InflationTarget } from './marketsMacro';

/** The rule's neutral real rate, in %: Taylor's (1993) original 2%. A stated parameter, not data. */
export const TAYLOR_R_STAR = 2;
/** Weights on the inflation gap and the output gap, as in Taylor (1993). */
export const TAYLOR_WEIGHTS = { inflation: 0.5, output: 0.5 } as const;
/** Within this many points of the rule = close to it. */
export const TAYLOR_BAND_PTS = 1;

export type TaylorStance = 'tighter than the rule' | 'looser than the rule' | 'close to the rule';

export interface TaylorReading {
  policyPct: number;
  inflationPct: number;
  inflationBasis: string;
  target: InflationTarget;
  outputGapPct?: number;
  outputGapYear?: string;
  /** 'estimate' when the gap is the app's own filter estimate (src/utils/outputGap.ts), not the IMF's. */
  outputGapSource?: 'imf' | 'estimate';
  rStar: number;
  rulePct: number;
  /** Policy rate minus the rule rate; positive = tighter than the rule. */
  gapToRulePts: number;
  stance: TaylorStance;
  /** True when the output gap was missing and its term left out. */
  withoutOutputGap: boolean;
}

export type TaylorResult = { ok: true; reading: TaylorReading } | { ok: false; missing: string[] };

const r2 = (v: number) => Number(v.toFixed(2));

export function taylorStance(gapPts: number): TaylorStance {
  return gapPts > TAYLOR_BAND_PTS ? 'tighter than the rule' : gapPts < -TAYLOR_BAND_PTS ? 'looser than the rule' : 'close to the rule';
}

/** The rule rate from its parts. */
export function taylorRate(inflationPct: number, targetPct: number, outputGapPct: number | undefined, rStar = TAYLOR_R_STAR): number {
  return r2(rStar + inflationPct + TAYLOR_WEIGHTS.inflation * (inflationPct - targetPct) + (outputGapPct === undefined ? 0 : TAYLOR_WEIGHTS.output * outputGapPct));
}

type RowInputs = Pick<WatchlistItem, 'iso3' | 'policyRatePct' | 'policyRateSource' | 'cpiInflationPct' | 'cpiSource' | 'cpiMonth' | 'outputGap'>;

/** The check for one watchlist row. Live inputs only: a sample or estimated figure never counts. */
export function taylorCheck(row: RowInputs | undefined): TaylorResult {
  if (!row) return { ok: false, missing: ['the live watchlist row'] };
  const missing: string[] = [];
  const policy = row.policyRateSource === 'bis' && Number.isFinite(row.policyRatePct) ? row.policyRatePct! : undefined;
  const liveCpi = row.cpiSource === 'oecd' || row.cpiSource === 'live';
  const inflation = liveCpi && Number.isFinite(row.cpiInflationPct) ? row.cpiInflationPct! : undefined;
  const target = INFLATION_TARGETS[row.iso3];
  if (policy === undefined) missing.push('the BIS policy rate');
  if (inflation === undefined) missing.push('live inflation');
  if (!target) missing.push("the central bank's inflation target");
  if (policy === undefined || inflation === undefined || !target) return { ok: false, missing };
  const gap = row.outputGap && Number.isFinite(row.outputGap.pct) ? row.outputGap : undefined;
  const rulePct = taylorRate(inflation, target.pct, gap?.pct);
  const gapToRulePts = r2(policy - rulePct);
  return {
    ok: true,
    reading: {
      policyPct: policy,
      inflationPct: inflation,
      inflationBasis: row.cpiSource === 'oecd' ? `monthly${row.cpiMonth ? `, ${row.cpiMonth}` : ''}` : 'IMF WEO, year',
      target,
      ...(gap ? { outputGapPct: gap.pct, outputGapYear: gap.year, outputGapSource: gap.source === 'estimate' ? ('estimate' as const) : ('imf' as const) } : {}),
      rStar: TAYLOR_R_STAR,
      rulePct,
      gapToRulePts,
      stance: taylorStance(gapToRulePts),
      withoutOutputGap: !gap,
    },
  };
}

const p2 = (v: number) => `${v.toFixed(2)}%`;
const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/** Where the output gap in a reading came from, in words. */
export function outputGapLabel(r: Pick<TaylorReading, 'outputGapSource' | 'outputGapYear'>): string {
  const yr = r.outputGapYear ? ` ${r.outputGapYear}` : '';
  return r.outputGapSource === 'estimate' ? `app estimate${yr}, HP and Hamilton filters on IMF real GDP growth` : `IMF WEO${yr}`;
}

/** The stated rule, with the numbers that went in. */
export function taylorMethod(r: TaylorReading): string {
  const gapPart = r.withoutOutputGap
    ? 'output gap left out (no IMF figure and too little IMF growth history for the app estimate)'
    : `+ 0.5 x output gap ${sg(r.outputGapPct!)} (${outputGapLabel(r)})`;
  return `rule = r* ${r.rStar}% + inflation ${r.inflationPct.toFixed(2)}% + 0.5 x (inflation - target ${r.target.pct}%) ${gapPart}; r* is Taylor (1993)'s 2%, a stated parameter`;
}

export function taylorSentence(r: TaylorReading): string {
  return `The policy rate of ${p2(r.policyPct)} is ${Math.abs(r.gapToRulePts).toFixed(2)} pts ${r.gapToRulePts >= 0 ? 'above' : 'below'} a simple Taylor rule (${p2(r.rulePct)}${r.withoutOutputGap ? ', without an output gap' : ''}): ${r.stance}.`;
}
