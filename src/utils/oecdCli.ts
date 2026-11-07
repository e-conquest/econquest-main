/**
 * OECD Composite Leading Indicators (CLI), monthly (Sam, 2026-11-05: "OECD composite leading
 * indicators and inflation, monthly, no key").
 *
 * Source: the OECD's dataflow DSD_STES@DF_CLI, measure LI, the amplitude-adjusted series
 * (long-term average = 100), read through DBnomics (api.db.nomics.world, free, no key) because
 * the OECD's own API refused the app with a bot check. The OECD publishes it around mid-month;
 * the newest month is usually one to two months old.
 *
 * The app asks once a day for every area at once and keeps the reply on disk (data/live/oecd-cli.json).
 * Countries the OECD does not publish a CLI for (Egypt, for one) read Missing with that reason.
 *
 * Readings: the latest level and month, the change on the month and over six months, and the
 * OECD's own cycle phases as a stated rule: above 100 and rising = expansion, above 100 and
 * falling = downturn, below 100 and falling = slowdown, below 100 and rising = recovery.
 */
import { OECD_AREA_FOR, areaSeries, dbnomicsUrl, formatMonth, parseOecdReply, seriesByArea } from './oecdSdmx';

export const CLI_LABEL = 'OECD Composite Leading Indicator via DBnomics (amplitude adjusted, long-term average = 100)';
export const CLI_DATASET = 'DSD_STES@DF_CLI';

/**
 * DBnomics query for the CLI. With no area, every area (one call for the whole app). Filtered to
 * monthly, measure LI, amplitude adjusted; `wide` drops the adjustment filter (used if the narrow
 * query finds nothing) and the reader still keeps only amplitude-adjusted series.
 */
export function cliUrl(opts: { areas?: string[]; wide?: boolean } = {}): string {
  const areas = (opts.areas || []).flatMap((a) => OECD_AREA_FOR[a] || [a]);
  return dbnomicsUrl(CLI_DATASET, {
    ...(areas.length ? { REF_AREA: areas } : {}),
    FREQ: ['M'],
    MEASURE: ['LI'],
    ...(opts.wide ? {} : { ADJUSTMENT: ['AA'] }),
  });
}

export type CliSeries = Record<string, { period: string; value: number }[]>;

/** Reads the OECD reply into one amplitude-adjusted CLI series per area. Null when nothing usable. */
export function parseCli(text: unknown, keepMonths?: number): CliSeries | null {
  const obs = parseOecdReply(text, keepMonths);
  if (!obs?.length) return null;
  const s = seriesByArea(
    obs,
    { MEASURE: ['LI'], FREQ: ['M'], ADJUSTMENT: ['AA'] },
    { METHODOLOGY: ['H'], UNIT_MEASURE: ['IX'], TRANSFORMATION: ['IX', '_Z'] }
  );
  // Only levels around 100 are an amplitude-adjusted CLI; anything else is a different series.
  for (const [a, pts] of Object.entries(s)) if (!pts.length || pts.some((p) => p.value < 50 || p.value > 150)) delete s[a];
  return Object.keys(s).length ? s : null;
}

export type CliPhase = 'expansion' | 'downturn' | 'slowdown' | 'recovery';

/** OECD cycle phases on the level and the change on the month. */
export function cliPhase(level: number, change1m: number): CliPhase {
  if (level >= 100) return change1m >= 0 ? 'expansion' : 'downturn';
  return change1m < 0 ? 'slowdown' : 'recovery';
}

export interface CliReading {
  iso3: string;
  /** YYYY-MM of the latest figure. */
  month: string;
  level: number;
  change1m?: number;
  change6m?: number;
  phase?: CliPhase;
  /** First month of the current phase, read back through the series (calendar months, no gaps). */
  phaseSince?: string;
  /** Months the current phase has lasted, counting the latest month. */
  monthsInPhase?: number;
  /** True when the phase began at the start of the series read, so it may have begun earlier. */
  phaseSinceAtStart?: boolean;
  /** Latest turning point: the month the indicator peaked or bottomed, with two months one way before it and two months the other way after. */
  lastTurn?: { month: string; kind: 'peak' | 'trough'; level: number };
}

export function cliFor(iso3: string, series: CliSeries | null | undefined): CliReading | null {
  const pts = areaSeries(iso3, series);
  if (!pts?.length) return null;
  const last = pts[pts.length - 1];
  // By calendar month, so a gap in the series is never read as a one-month change.
  const back = (n: number) => {
    const [y, m] = last.period.split('-').map(Number);
    const want = new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
    return pts.find((p) => p.period === want);
  };
  const prev = back(1);
  const six = back(6);
  const r2 = (v: number) => Number(v.toFixed(2));
  const change1m = prev ? r2(last.value - prev.value) : undefined;
  const hist = cliHistory(pts);
  return {
    iso3,
    month: last.period,
    level: r2(last.value),
    ...(change1m !== undefined ? { change1m, phase: cliPhase(last.value, change1m) } : {}),
    ...(six ? { change6m: r2(last.value - six.value) } : {}),
    ...hist,
  };
}

const nextMonth = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

/**
 * How long the current phase has lasted and the latest turning point, from the unbroken run of
 * calendar months that ends at the latest figure (a gap ends the run: nothing is read across it).
 */
export function cliHistory(pts: { period: string; value: number }[]): Pick<CliReading, 'phaseSince' | 'monthsInPhase' | 'phaseSinceAtStart' | 'lastTurn'> {
  let start = pts.length - 1;
  while (start > 0 && nextMonth(pts[start - 1].period) === pts[start].period) start--;
  const run = pts.slice(start);
  if (run.length < 2) return {};
  const steps = run.slice(1).map((p, i) => ({ period: p.period, level: p.value, change: p.value - run[i].value }));
  const phases = steps.map((s) => cliPhase(s.level, s.change));
  const now = phases[phases.length - 1];
  let i = phases.length - 1;
  while (i > 0 && phases[i - 1] === now) i--;
  const out: ReturnType<typeof cliHistory> = { phaseSince: steps[i].period, monthsInPhase: phases.length - i, ...(i === 0 ? { phaseSinceAtStart: true } : {}) };
  const turns = turnsIn(steps);
  return turns.length ? { ...out, lastTurn: turns[turns.length - 1] } : out;
}

type Step = { period: string; level: number; change: number };

/**
 * Turning points: two months one way, then two months the other way. A one-month reversal is not
 * counted on either side, so a single wobble is never called a turn. Oldest first.
 */
function turnsIn(steps: Step[]): CliTurn[] {
  const out: CliTurn[] = [];
  for (let k = 2; k < steps.length - 1; k++) {
    const a = steps[k - 1].change;
    const b = steps[k].change;
    if (Math.sign(steps[k + 1].change) !== Math.sign(b) || Math.sign(steps[k - 2].change) !== Math.sign(a)) continue;
    if (a > 0 && b < 0) out.push({ month: steps[k - 1].period, kind: 'peak', level: Number(steps[k - 1].level.toFixed(2)) });
    if (a < 0 && b > 0) out.push({ month: steps[k - 1].period, kind: 'trough', level: Number(steps[k - 1].level.toFixed(2)) });
  }
  return out;
}

export interface CliTurn {
  month: string;
  kind: 'peak' | 'trough';
  level: number;
}

/** Every turning point in the unbroken run of months that ends at the latest figure, oldest first. */
export function cliTurns(pts: { period: string; value: number }[]): CliTurn[] {
  let start = pts.length - 1;
  while (start > 0 && nextMonth(pts[start - 1].period) === pts[start].period) start--;
  const run = pts.slice(start);
  if (run.length < 2) return [];
  return turnsIn(run.slice(1).map((p, i) => ({ period: p.period, level: p.value, change: p.value - run[i].value })));
}

/** Why a country has no CLI figure: the OECD answered without it, or did not answer. */
export function cliMissing(pulled: boolean): { short: string; help: string } {
  return pulled
    ? { short: 'OECD publishes no CLI', help: 'The OECD answered, but publishes no composite leading indicator for this country.' }
    : { short: 'DBnomics did not answer', help: 'DBnomics (the free mirror the app reads OECD data from) did not answer yet; the app asks again within the hour.' };
}

const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/** "OECD leading indicator 100.42 (Sep 2026), +0.08 on the month: expansion." */
export function cliSentence(c: CliReading): string {
  const base = `OECD leading indicator ${c.level.toFixed(2)} (${formatMonth(c.month)})`;
  if (c.change1m === undefined || !c.phase) return `${base}.`;
  return `${base}, ${sg(c.change1m)} on the month: ${c.phase} (${c.level >= 100 ? 'above' : 'below'} its long-term average of 100 and ${c.change1m >= 0 ? 'rising' : 'falling'}).`;
}
