/**
 * Forward record (rule 7 of the signal standard, Sam 2026-11-06): once a pre-registered backtest
 * passes, every call it makes from then on is written down while its window is still open, before
 * the outcome is known, and scored when the window runs out. The in-sample verdict says how the
 * rule did on the past; this record says how it does on calls nobody could have tuned.
 *
 * Each backtest run (Menu > Models & validation > Run backtests, or the scheduled job, weekly or
 * daily) appends to data/local/validation/forward.jsonl:
 * - a `call` line for each open call of a passing test not yet on record (key = test, place, date);
 * - an `outcome` line for each recorded call whose window has now run out, from the same rule's
 *   scoring (hit or miss, with the base rate of that outcome in that series).
 * Lines are never edited. Each carries a SHA-256 over the previous line's hash and its own
 * canonical JSON, so a changed, removed or reordered line breaks the chain from there on.
 *
 * Browser-safe, pure; the file and hash helpers are in src/utils/forwardRecordStore.ts.
 */
import type { BacktestCase, OpenCall } from './backtest';
import { SMALL_SAMPLE } from './signalRecord';

export interface ForwardCallLine {
  kind: 'call';
  /** `${id} v${version}` */
  test: string;
  specHash: string;
  where: string;
  when: string;
  what: string;
  due: string;
  /** Signal tests: the book as recorded, scored as recorded. */
  book?: { long: string[]; short: string[] };
  /** Forecast tests: the model's and the benchmark's figures as recorded. */
  forecast?: { model: number; bench: number };
  at: string;
}

export interface ForwardOutcomeLine {
  kind: 'outcome';
  test: string;
  where: string;
  when: string;
  hit: boolean;
  base: number;
  /** Signal tests: the period's net return, %. */
  value?: number;
  at: string;
}

export type ForwardBody = ForwardCallLine | ForwardOutcomeLine;
export type ForwardLine = ForwardBody & { hash: string };

const keyOf = (test: string, where: string, when: string) => `${test}|${where}|${when}`;

/**
 * The lines one test's run adds. `passing` = the test's status on this run; calls are recorded only
 * then. Outcomes are always read for calls already on record, whatever the status now.
 */
export function forwardStep(
  existing: ForwardBody[],
  test: { key: string; specHash: string; passing: boolean },
  cases: BacktestCase[],
  open: Array<OpenCall & { book?: { long: string[]; short: string[] }; forecast?: { model: number; bench: number } }>,
  at: string,
): ForwardBody[] {
  const calls = new Set<string>();
  const scored = new Set<string>();
  for (const l of existing) {
    if (l.test !== test.key) continue;
    (l.kind === 'call' ? calls : scored).add(keyOf(l.test, l.where, l.when));
  }
  const out: ForwardBody[] = [];
  if (test.passing) {
    for (const c of open) {
      const k = keyOf(test.key, c.where, c.when);
      if (calls.has(k)) continue;
      calls.add(k);
      out.push({ kind: 'call', test: test.key, specHash: test.specHash, where: c.where, when: c.when, what: c.what, due: c.due, ...(c.book ? { book: c.book } : {}), ...(c.forecast ? { forecast: c.forecast } : {}), at });
    }
  }
  const byKey = new Map(cases.map((c) => [keyOf(test.key, c.where, c.when), c]));
  for (const k of calls) {
    if (scored.has(k)) continue;
    const c = byKey.get(k);
    if (!c) continue;
    const value = (c as BacktestCase & { value?: number }).value;
    out.push({ kind: 'outcome', test: test.key, where: c.where, when: c.when, hit: c.hit, base: Number(c.base.toFixed(4)), ...(value !== undefined ? { value: Number(value.toFixed(4)) } : {}), at });
  }
  return out;
}

export interface ForwardSummary {
  test: string;
  since: string;
  calls: number;
  scored: number;
  hits: number;
  hitRatePct: number | null;
  baseRatePct: number | null;
  pending: number;
  /** Signal tests: average net return per period over the scored calls, %. */
  meanValue: number | null;
  small: boolean;
  /** The latest calls, newest first, with their outcome when scored. */
  recent: Array<{ where: string; when: string; what: string; due: string; hit?: boolean }>;
}

export function forwardSummary(lines: ForwardBody[]): Record<string, ForwardSummary> {
  const out: Record<string, ForwardSummary> = {};
  const outcomes = new Map<string, ForwardOutcomeLine>();
  for (const l of lines) if (l.kind === 'outcome') outcomes.set(keyOf(l.test, l.where, l.when), l);
  const byTest = new Map<string, ForwardCallLine[]>();
  for (const l of lines) if (l.kind === 'call') (byTest.get(l.test) || byTest.set(l.test, []).get(l.test)!).push(l);
  for (const [test, calls] of byTest) {
    const res = calls.map((c) => outcomes.get(keyOf(test, c.where, c.when))).filter((o): o is ForwardOutcomeLine => Boolean(o));
    const hits = res.filter((o) => o.hit).length;
    const pct = (v: number) => Number((100 * v).toFixed(1));
    out[test] = {
      test,
      since: calls.map((c) => c.at).sort()[0].slice(0, 10),
      calls: calls.length,
      scored: res.length,
      hits,
      hitRatePct: res.length ? pct(hits / res.length) : null,
      baseRatePct: res.length ? pct(res.reduce((a, o) => a + o.base, 0) / res.length) : null,
      pending: calls.length - res.length,
      meanValue: res.some((o) => o.value !== undefined) ? Number((res.reduce((a, o) => a + (o.value ?? 0), 0) / res.length).toFixed(3)) : null,
      small: res.length < SMALL_SAMPLE,
      recent: [...calls]
        .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0))
        .slice(0, 10)
        .map((c) => {
          const o = outcomes.get(keyOf(test, c.where, c.when));
          return { where: c.where, when: c.when, what: c.what, due: c.due, ...(o ? { hit: o.hit } : {}) };
        }),
    };
  }
  return out;
}

export function forwardSentence(s: ForwardSummary | undefined): string {
  if (!s) return '';
  const head = `Forward record since ${s.since}: ${s.calls} call${s.calls === 1 ? '' : 's'}`;
  if (!s.scored) return `${head}, none scored yet.`;
  if (s.meanValue !== null && !s.test.startsWith('fx_')) return `${head}, ${s.scored} scored: closer to the published figure than the benchmark in ${s.hits} (${s.hitRatePct}% against ${s.baseRatePct}% in the test), average gain ${s.meanValue} points, ${s.pending} still open${s.small ? '; too few to lean on' : ''}.`;
  if (s.meanValue !== null) return `${head}, ${s.scored} scored: average net ${s.meanValue}% a period, positive in ${s.hits} (${s.hitRatePct}% against ${s.baseRatePct}% of months in the test), ${s.pending} still open${s.small ? '; too few to lean on' : ''}.`;
  return `${head}, ${s.scored} scored, ${s.hits} followed (${s.hitRatePct}% against a base rate of ${s.baseRatePct}%), ${s.pending} still open${s.small ? '; too few to lean on' : ''}.`;
}
