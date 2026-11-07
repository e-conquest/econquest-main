/**
 * Replicate a rate decision: pick a decision date and see what the data said the week before, what
 * a simple Taylor rule pointed to on those figures, and what the bank did. A teaching and checking
 * tool on sourced figures, not a model of the bank's reaction function.
 *
 * Inputs are the app's own series: BIS policy rates (the decisions and the rate going in), monthly
 * inflation, the OECD leading indicator, and the bank's stated target (src/utils/marketsMacro.ts).
 * Inflation and the leading indicator use the latest month BEFORE the decision month, because a
 * month's figure is published weeks later. Today's series may hold revised figures, and the replay
 * says so. The output gap is left out: the IMF's is an annual estimate revised every vintage, so it
 * is not what the bank saw at the time.
 *
 * Browser-safe.
 */
import type { InflationTarget } from './marketsMacro';
import type { Series, SeriesPoint } from './seriesHistory';
import { TAYLOR_BAND_PTS, TAYLOR_R_STAR, taylorRate } from './taylorRule';

export interface RateDecision {
  /** The date (daily series) or month (monthly series) the new rate took effect. */
  date: string;
  fromPct: number;
  toPct: number;
}

export type BankAction = 'raised' | 'cut' | 'held';
export type RuleSignal = 'raise' | 'cut' | 'hold';

export interface DecisionReplay {
  iso3: string;
  decisionDate: string;
  /** The day the "week before" figures are read on. */
  asOf: string;
  action: BankAction;
  rateBeforePct: number;
  rateAfterPct: number;
  inflation?: { month: string; pct: number; source: string };
  cli?: { month: string; level: number; change6m?: number };
  target?: InflationTarget;
  rule?: { pct: number; gapPts: number; signal: RuleSignal; method: string };
  /** Whether the bank moved the way the rule pointed (only with a rule reading). */
  matched?: boolean;
  missing: string[];
  caveats: string[];
}

const r2 = (v: number) => Number(v.toFixed(2));

/** Each change in the policy rate series, newest first. */
export function decisionsFrom(policy: Series | undefined, limit = 30): RateDecision[] {
  const pts = policy?.points || [];
  const out: RateDecision[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].value !== pts[i - 1].value) out.push({ date: pts[i].date, fromPct: pts[i - 1].value, toPct: pts[i].value });
  }
  return out.reverse().slice(0, limit);
}

/** The day `days` before a date (YYYY-MM-DD; a YYYY-MM month counts as its first day). */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`);
  return new Date(d.getTime() - days * 864e5).toISOString().slice(0, 10);
}

/** Last point dated on or before a day (a point's month or day is compared at its own length). */
function onOrBefore(points: SeriesPoint[], day: string): SeriesPoint | undefined {
  let hit: SeriesPoint | undefined;
  for (const p of points) if (p.date <= day.slice(0, p.date.length)) hit = p;
  return hit;
}

/** Last monthly point for a month before the given month. */
function monthBefore(points: SeriesPoint[], month: string): SeriesPoint | undefined {
  let hit: SeriesPoint | undefined;
  for (const p of points) if (p.date.slice(0, 7) < month) hit = p;
  return hit;
}

function monthsBack(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

export function ruleSignal(gapPts: number): RuleSignal {
  // Policy above the rule by more than the band = the rule pointed to cutting, and the reverse.
  return gapPts > TAYLOR_BAND_PTS ? 'cut' : gapPts < -TAYLOR_BAND_PTS ? 'raise' : 'hold';
}

export function replayDecision(input: { iso3: string; date: string; policy?: Series; cpi?: Series; cli?: Series; target?: InflationTarget }): DecisionReplay | { error: string } {
  const pts = input.policy?.points || [];
  if (!pts.length) return { error: 'No BIS policy rate history for this country.' };
  const date = input.date;
  const before = pts.filter((p) => p.date < date.slice(0, p.date.length));
  const prior = before[before.length - 1];
  const after = onOrBefore(pts, date.length === 7 ? `${date}-31` : date);
  if (!prior || !after) return { error: `The BIS series starts ${pts[0].date}; pick a later date.` };
  const asOf = daysBefore(date, 7);
  const rateBefore = onOrBefore(pts, asOf) || prior;
  const action: BankAction = after.value > rateBefore.value ? 'raised' : after.value < rateBefore.value ? 'cut' : 'held';
  const month = date.slice(0, 7);
  const missing: string[] = [];
  const caveats = [
    'Inflation and the leading indicator use the latest month before the decision month, as a month is published weeks later. Today\'s series may hold revised figures, not the first release the bank saw.',
    'The output gap is left out: the IMF\'s is an annual estimate revised every vintage, not what the bank saw.',
  ];

  const cpiPt = input.cpi ? monthBefore(input.cpi.points, month) : undefined;
  const inflation = cpiPt && input.cpi ? { month: cpiPt.date.slice(0, 7), pct: cpiPt.value, source: input.cpi.source } : undefined;
  if (!input.cpi) missing.push('monthly inflation');
  else if (!inflation) missing.push(`monthly inflation before ${month} (the series starts ${input.cpi.points[0]?.date ?? 'later'})`);

  const cliPt = input.cli ? monthBefore(input.cli.points, month) : undefined;
  const cli6 = cliPt && input.cli ? input.cli.points.find((p) => p.date.slice(0, 7) === monthsBack(cliPt.date.slice(0, 7), 6)) : undefined;
  const cli = cliPt ? { month: cliPt.date.slice(0, 7), level: cliPt.value, ...(cli6 ? { change6m: r2(cliPt.value - cli6.value) } : {}) } : undefined;

  if (!input.target) missing.push("the central bank's inflation target");

  let rule: DecisionReplay['rule'];
  if (inflation && input.target) {
    const pct = taylorRate(inflation.pct, input.target.pct, undefined);
    const gapPts = r2(rateBefore.value - pct);
    rule = {
      pct,
      gapPts,
      signal: ruleSignal(gapPts),
      method: `rule = r* ${TAYLOR_R_STAR}% + inflation ${inflation.pct.toFixed(2)}% (${inflation.month}) + 0.5 x (inflation - target ${input.target.pct}%); output gap left out`,
    };
  }
  const matched = rule ? (rule.signal === 'raise' && action === 'raised') || (rule.signal === 'cut' && action === 'cut') || (rule.signal === 'hold' && action === 'held') : undefined;

  return {
    iso3: input.iso3,
    decisionDate: date,
    asOf,
    action,
    rateBeforePct: rateBefore.value,
    rateAfterPct: after.value,
    ...(inflation ? { inflation } : {}),
    ...(cli ? { cli } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(rule ? { rule, matched } : {}),
    missing,
    caveats,
  };
}

const p2 = (v: number) => `${v.toFixed(2)}%`;

/** One sentence: what the rule pointed to and what the bank did. */
export function replaySentence(r: DecisionReplay): string {
  const did = r.action === 'held' ? `held at ${p2(r.rateAfterPct)}` : `${r.action} from ${p2(r.rateBeforePct)} to ${p2(r.rateAfterPct)}`;
  if (!r.rule) return `The bank ${did}. No rule reading: ${r.missing.join(', ') || 'inputs missing'}.`;
  const pointed = r.rule.signal === 'hold' ? 'holding' : r.rule.signal === 'raise' ? 'raising' : 'cutting';
  return `The week before, a simple Taylor rule put the rate at ${p2(r.rule.pct)} against ${p2(r.rateBeforePct)}, pointing to ${pointed}. The bank ${did}: ${r.matched ? 'in line with the rule' : 'not what the rule pointed to'}.`;
}
