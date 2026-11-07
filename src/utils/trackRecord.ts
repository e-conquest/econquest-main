/**
 * Track record log (roadmap E2, Sam 2026-11-05): the policy-rule signal the app gave on each
 * saved pull, and what the central bank did in the RATE_HORIZON_DAYS after it.
 *
 * Unlike the signal record on the Country tab (src/utils/signalRecord.ts), which tests a signal
 * over past years with hindsight, this log is built only from the pull archive (data/archive/):
 * the policy rate and the IMF output gap are read from that day's saved pull, as the app held them.
 * Monthly inflation comes from today's series, cut off CPI_LAG_DAYS before the pull day so a month
 * the bank could not yet have seen is never used; it is today's vintage, which the caveats say.
 *
 * Counting: one call per run of the same signal (a weekly pull repeating "cut" is one call, not
 * many), scored once the horizon has passed. No probabilities; small samples are stated as such.
 */
import type { InflationTarget } from './marketsMacro';
import type { Series, SeriesPoint } from './seriesHistory';
import { TAYLOR_BAND_PTS, TAYLOR_R_STAR, taylorRate } from './taylorRule';
import { SMALL_SAMPLE } from './signalRecord';

export const RATE_HORIZON_DAYS = 90;
export const CPI_LAG_DAYS = 45;

export type RateSignal = 'raise' | 'cut' | 'hold';
export type Outcome = { status: 'pending'; due: string } | { status: 'scored'; followed: boolean; action: 'raised' | 'cut' | 'held'; fromPct: number; toPct: number; on: string };

/** One saved pull, reduced to what the log reads. */
export interface ArchivedDay {
  date: string;
  snapshot: {
    liveFields?: Record<string, string>;
    monetaryAndMarket?: { policyRatePct?: number };
    imfIndicators?: { outputGapPct?: number; cpiInflationPct?: number; years?: Record<string, string> };
  };
}

export interface LogEntry {
  day: string;
  /** Present when the signal could be read. */
  reading?: {
    signal: RateSignal;
    policyPct: number;
    policySource: string;
    inflationPct: number;
    inflationBasis: string;
    outputGapPct?: number;
    rulePct: number;
    gapPts: number;
  };
  /** Why no signal could be read that day. */
  missing?: string[];
  /** True on the first day of a run of the same signal: the day that counts as a call. */
  call: boolean;
  outcome?: Outcome;
}

export interface TrackRecord {
  iso3: string;
  horizonDays: number;
  entries: LogEntry[];
  calls: number;
  scored: number;
  followed: number;
  pending: number;
  bySignal: Record<RateSignal, { scored: number; followed: number }>;
  smallSample: boolean;
  caveats: string[];
}

const r2 = (v: number) => Number(v.toFixed(2));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

/** Last point on or before a day (a monthly point counts at its own month). */
function onOrBefore(points: SeriesPoint[], day: string): SeriesPoint | undefined {
  let hit: SeriesPoint | undefined;
  for (const p of points) if (p.date <= day.slice(0, p.date.length)) hit = p;
  return hit;
}

export function signalFromGap(gapPts: number): RateSignal {
  return gapPts > TAYLOR_BAND_PTS ? 'cut' : gapPts < -TAYLOR_BAND_PTS ? 'raise' : 'hold';
}

/** The rule signal on one saved pull. */
export function readSignal(day: ArchivedDay, cpi: Series | undefined, target: InflationTarget | undefined): Pick<LogEntry, 'reading' | 'missing'> {
  const lf = day.snapshot.liveFields || {};
  const missing: string[] = [];
  const policySource = lf['market.policyRatePct'];
  const policy = policySource?.startsWith('BIS') && fin(day.snapshot.monetaryAndMarket?.policyRatePct) ? day.snapshot.monetaryAndMarket!.policyRatePct! : undefined;
  if (policy === undefined) missing.push('the BIS policy rate in that pull');

  // Monthly inflation, at least CPI_LAG_DAYS old on the pull day; else the IMF yearly figure saved in that pull.
  const cutoff = addDays(day.date, -CPI_LAG_DAYS).slice(0, 7);
  const monthly = cpi?.points.filter((p) => p.date.slice(0, 7) <= cutoff).pop();
  const imfCpi = lf['imf.cpiInflationPct'] && fin(day.snapshot.imfIndicators?.cpiInflationPct) ? day.snapshot.imfIndicators!.cpiInflationPct! : undefined;
  const inflation = monthly
    ? { pct: monthly.value, basis: `monthly, ${monthly.date.slice(0, 7)} (${cpi!.source})` }
    : imfCpi !== undefined
      ? { pct: imfCpi, basis: `IMF WEO yearly, as saved that day${day.snapshot.imfIndicators?.years?.['imf.cpiInflationPct'] ? ` (${day.snapshot.imfIndicators.years['imf.cpiInflationPct']})` : ''}` }
      : undefined;
  if (!inflation) missing.push('inflation');
  if (!target) missing.push("the central bank's inflation target");
  if (policy === undefined || !inflation || !target) return { missing };

  const gap = lf['imf.outputGapPct'] && fin(day.snapshot.imfIndicators?.outputGapPct) ? day.snapshot.imfIndicators!.outputGapPct! : undefined;
  const rulePct = taylorRate(inflation.pct, target.pct, gap);
  const gapPts = r2(policy - rulePct);
  return {
    reading: {
      signal: signalFromGap(gapPts),
      policyPct: policy,
      policySource: policySource!,
      inflationPct: inflation.pct,
      inflationBasis: inflation.basis,
      ...(gap !== undefined ? { outputGapPct: gap } : {}),
      rulePct,
      gapPts,
    },
  };
}

/** What the bank did between the pull day and the horizon, from the BIS series. */
export function scoreCall(day: string, signal: RateSignal, policy: Series | undefined, today: string): Outcome {
  const due = addDays(day, RATE_HORIZON_DAYS);
  const pts = policy?.points || [];
  const last = pts[pts.length - 1];
  // Pending until the horizon has passed and the series reaches it (a monthly series must cover the month).
  if (due > today || !last || last.date < due.slice(0, last.date.length)) return { status: 'pending', due };
  const from = onOrBefore(pts, day);
  const to = onOrBefore(pts, due);
  if (!from || !to) return { status: 'pending', due };
  const action = to.value > from.value ? 'raised' : to.value < from.value ? 'cut' : 'held';
  const followed = (signal === 'raise' && action === 'raised') || (signal === 'cut' && action === 'cut') || (signal === 'hold' && action === 'held');
  return { status: 'scored', followed, action, fromPct: from.value, toPct: to.value, on: due };
}

export function trackRecord(input: { iso3: string; days: ArchivedDay[]; policy?: Series; cpi?: Series; target?: InflationTarget; today?: string }): TrackRecord {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const days = [...input.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const entries: LogEntry[] = [];
  let prev: RateSignal | undefined;
  for (const d of days) {
    const read = readSignal(d, input.cpi, input.target);
    const signal = read.reading?.signal;
    const call = Boolean(signal && signal !== prev);
    prev = signal;
    entries.push({ day: d.date, ...read, call, ...(call && signal ? { outcome: scoreCall(d.date, signal, input.policy, today) } : {}) });
  }
  const calls = entries.filter((e) => e.call);
  const scored = calls.filter((e) => e.outcome?.status === 'scored');
  const bySignal: TrackRecord['bySignal'] = { raise: { scored: 0, followed: 0 }, cut: { scored: 0, followed: 0 }, hold: { scored: 0, followed: 0 } };
  for (const e of scored) {
    const b = bySignal[e.reading!.signal];
    b.scored++;
    if (e.outcome?.status === 'scored' && e.outcome.followed) b.followed++;
  }
  return {
    iso3: input.iso3,
    horizonDays: RATE_HORIZON_DAYS,
    entries: entries.reverse(),
    calls: calls.length,
    scored: scored.length,
    followed: scored.filter((e) => e.outcome?.status === 'scored' && e.outcome.followed).length,
    pending: calls.length - scored.length,
    bySignal,
    smallSample: scored.length < SMALL_SAMPLE,
    caveats: [
      `Rule: r* ${TAYLOR_R_STAR}% + inflation + 0.5 x (inflation - target) + 0.5 x IMF output gap where that pull held one. More than ${TAYLOR_BAND_PTS} pt above the rule points to a cut, more than ${TAYLOR_BAND_PTS} pt below to a raise, otherwise a hold.`,
      'The policy rate and output gap are as saved in that day\'s pull. Monthly inflation is today\'s series, using only months at least 45 days old on the pull day; revisions since then are not undone.',
      `A call is the first pull of a run of the same signal; it is scored on the BIS policy rate ${RATE_HORIZON_DAYS} days later. A hold counts as followed only if the rate did not change.`,
      'This counts how the rule lined up with the bank here, over the days the archive holds. It is not a forecast and gives no odds.',
    ],
  };
}

export const TRACK_RECORD_HEADER = ['iso3', 'pull_day', 'call', 'signal', 'policy_pct', 'policy_source', 'inflation_pct', 'inflation_basis', 'output_gap_pct', 'rule_pct', 'gap_pts', 'outcome', 'bank_action', 'rate_then_pct', 'rate_at_horizon_pct', 'scored_on', 'missing'];

export function trackRecordRows(t: TrackRecord): Array<Array<string | number | null>> {
  return [...t.entries].reverse().map((e) => {
    const r = e.reading;
    const o = e.outcome;
    return [
      t.iso3,
      e.day,
      e.call ? 'yes' : 'no',
      r?.signal ?? 'Missing',
      r?.policyPct ?? null,
      r?.policySource ?? '',
      r?.inflationPct ?? null,
      r?.inflationBasis ?? '',
      r?.outputGapPct ?? null,
      r?.rulePct ?? null,
      r?.gapPts ?? null,
      !o ? '' : o.status === 'pending' ? `pending until ${o.due}` : o.followed ? 'followed' : 'not followed',
      o?.status === 'scored' ? o.action : '',
      o?.status === 'scored' ? o.fromPct : null,
      o?.status === 'scored' ? o.toPct : null,
      o?.status === 'scored' ? o.on : '',
      e.missing?.join('; ') ?? '',
    ];
  });
}

/** One line for the panel and the council. */
export function trackRecordSentence(t: TrackRecord): string {
  if (!t.entries.length) return 'No saved pulls yet; the log gains a day with each pull.';
  if (!t.calls) return `${t.entries.length} saved pull${t.entries.length === 1 ? '' : 's'}, none with a rule reading.`;
  if (!t.scored) return `${t.calls} call${t.calls === 1 ? '' : 's'} logged; none scored yet (each is scored ${t.horizonDays} days after it).`;
  return `The rule's call was followed by the bank in ${t.followed} of ${t.scored} scored call${t.scored === 1 ? '' : 's'}${t.pending ? `, ${t.pending} pending` : ''}${t.smallSample ? '. Too few to lean on' : ''}.`;
}
