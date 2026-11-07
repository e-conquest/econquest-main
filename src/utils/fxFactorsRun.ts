/**
 * Runs the pre-registered currency factor tests (server and scripts only): `npm run
 * signals:evaluate`. Reads each spec in docs/validation/signals/, refuses any whose SHA-256 is not
 * the one in manifest.json, pulls the free histories it needs (ECB reference rates via Frankfurter,
 * BIS policy rates, OECD consumer prices), and saves the verdicts in
 * data/local/validation/signals.json. Method: src/utils/fxFactors.ts.
 */
import fs from 'fs';
import { loadSpecs } from './backtestRun';
import { BIS_API } from './bisDebtSecurities';
import { CBPOL_DATASET, parseCbpolCsv } from './bisPolicyRates';
import { cpiUrl, parseCpi } from './oecdInflation';
import { areaSeries } from './oecdSdmx';
import { allQuarters, fxQuarterUrl, parseFxQuarter, type FxHistoryFile } from './fxHistory';
import { addMonth, excessReturn, fxFactorBook, fxFactorReturns, type FxMonth, judgeFxFactor, monthEndMap, type FxFactorResult, type FxFactorSpec, type FxPanel, type MonthMap } from './fxFactors';
import { writeFileAtomic } from './atomicWrite';
import path from 'path';
import { forwardStep, type ForwardBody } from './forwardRecord';
import { appendForward, loadForward } from './forwardRecordStore';

export type TextFetcher = (url: string) => Promise<string>;

export interface SignalResult extends FxFactorResult {
  id: string;
  specVersion: number;
  specHash: string;
  ranAt: string;
  data: string;
}

export interface SignalValidationFile {
  results: Record<string, SignalResult>;
  versions: Record<string, SignalResult>;
  lastRun?: { at: string; problems: string[] };
}

export function loadSignalValidation(file: string): SignalValidationFile {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { results: v?.results || {}, versions: v?.versions || {}, ...(v?.lastRun ? { lastRun: v.lastRun } : {}) };
  } catch {
    return { results: {}, versions: {} };
  }
}

export const US_CPI_AREA = 'USA';

/** The panel every factor test reads. `saved` is the app's saved ECB history; missing quarters are pulled. */
export async function pullFxPanel(fetcher: TextFetcher, specs: FxFactorSpec[], problems: string[], saved?: FxHistoryFile | null, now = new Date()): Promise<FxPanel> {
  const ccys = [...new Set(specs.flatMap((s) => s.universe.map((u) => u.ccy)))];
  const areas = [...new Set(['US', ...specs.flatMap((s) => s.universe.map((u) => u.bis))])].sort();
  // ECB reference rates per USD: the saved quarters, plus any not saved.
  const daily = new Map<string, Array<{ date: string; value: number }>>();
  const add = (rates: Record<string, Record<string, number>>) => {
    for (const [day, row] of Object.entries(rates)) for (const c of ccys) if (row[c]) (daily.get(c) || daily.set(c, []).get(c)!).push({ date: day, value: row[c] });
  };
  let pulled = 0;
  for (const q of allQuarters(now)) {
    const chunk = saved?.chunks?.[q];
    if (chunk) {
      add(chunk.rates);
      continue;
    }
    const url = fxQuarterUrl(q, now);
    if (!url) continue;
    try {
      const r = parseFxQuarter(JSON.parse(await fetcher(url)));
      if (r) add(r);
      pulled++;
    } catch (e: any) {
      problems.push(`ECB reference rates for ${q} did not answer (${e?.message || e})`);
    }
  }
  const fx: Record<string, MonthMap> = {};
  for (const [c, pts] of daily) fx[c] = monthEndMap(pts);
  const policy: Record<string, MonthMap> = {};
  try {
    const bis = parseCbpolCsv(await fetcher(`${BIS_API}/${CBPOL_DATASET}/M.${areas.join('+')}/all?startPeriod=1990-01&format=csv`), 'M');
    for (const [area, s] of Object.entries(bis)) policy[area] = new Map(s.points.map((p) => [p.period, p.pct]));
  } catch (e: any) {
    problems.push(`BIS policy rates did not answer (${e?.message || e})`);
  }
  const cpiYoy: Record<string, MonthMap> = {};
  try {
    const cpi = parseCpi(await fetcher(cpiUrl()), 100_000);
    for (const a of new Set([US_CPI_AREA, ...specs.flatMap((s) => s.universe.map((u) => u.cpi))])) {
      const s = areaSeries(a, cpi);
      if (s?.points.length) cpiYoy[a] = new Map(s.points.map((p) => [p.period, p.value]));
    }
  } catch (e: any) {
    problems.push(`OECD consumer prices did not answer (${e?.message || e})`);
  }
  if (pulled) problems.push(`${pulled} quarter(s) of ECB rates were pulled because they were not saved`);
  // The month in progress has no month-end yet: its latest fixing is not a month-end value.
  const current = now.toISOString().slice(0, 7);
  for (const maps of [fx, policy]) for (const m of Object.values(maps)) for (const k of [...m.keys()]) if (k >= current) m.delete(k);
  return { fx, policy, cpiYoy, usCpi: US_CPI_AREA };
}

/** The latest month-end with an FX rate in the panel. */
export function lastPanelMonth(p: FxPanel): string | undefined {
  let last: string | undefined;
  for (const m of Object.values(p.fx)) for (const k of m.keys()) if (!last || k > last) last = k;
  return last;
}

const bookText = (b: { long: string[]; short: string[] }) => `long ${b.long.join(', ')}; short ${b.short.join(', ')}: net return next month above zero?`;

/**
 * Outcomes of the books on record for one test, scored as recorded (the book can differ from the
 * test's own row for that month when a feed filled in later): equal-weight long minus short excess
 * return over the month, less the flat cost on turnover from the test's book the month before.
 */
export function recordedOutcomes(spec: FxFactorSpec, panel: FxPanel, months: string[], rows: FxMonth[], forward: ForwardBody[], key: string, base: number) {
  const done = new Set(months);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: Array<{ where: string; when: string; what: string; hit: boolean; base: number; value: number }> = [];
  for (const l of forward) {
    if (l.kind !== 'call' || l.test !== key || !l.book || !done.has(l.when)) continue;
    const ret = (c: string) => excessReturn(panel, spec.universe.find((u) => u.ccy === c)!, l.when);
    const lr = l.book.long.map(ret);
    const sr = l.book.short.map(ret);
    if ([...lr, ...sr].some((v) => v === undefined) || !l.book.long.length || !l.book.short.length) continue;
    const mean = (v: Array<number | undefined>) => v.reduce((a: number, x) => a + (x as number), 0) / v.length;
    const prev = byMonth.get(addMonth(l.when, -1));
    const w = new Map<string, number>([...l.book.long.map((c) => [c, 1 / l.book!.long.length] as [string, number]), ...l.book.short.map((c) => [c, -1 / l.book!.short.length] as [string, number])]);
    const pw = new Map<string, number>(prev ? [...prev.long.map((c) => [c, 1 / prev.long.length] as [string, number]), ...prev.short.map((c) => [c, -1 / prev.short.length] as [string, number])] : []);
    let turnover = 0;
    for (const c of new Set([...w.keys(), ...pw.keys()])) turnover += Math.abs((w.get(c) ?? 0) - (pw.get(c) ?? 0));
    const net = mean(lr) - mean(sr) - spec.params.costPctPerSide * turnover;
    out.push({ where: l.where, when: l.when, what: l.what, hit: net > 0, base, value: net });
  }
  return out;
}

/** Every month-end with an FX rate in the panel, oldest first, the last one dropped (no next month yet). */
export function panelMonths(p: FxPanel): string[] {
  const all = new Set<string>();
  for (const m of Object.values(p.fx)) for (const k of m.keys()) all.add(k);
  const months = [...all].sort();
  return months.filter((m) => all.has(addMonth(m, 1)));
}

export async function runSignalEvaluations(opts: { specDir: string; resultFile: string; fetcher: TextFetcher; savedFx?: FxHistoryFile | null; now?: Date; onResult?: (r: SignalResult) => void; forwardFile?: string }): Promise<SignalValidationFile & { problems: string[] }> {
  const problems: string[] = [];
  const specs = loadSpecs(opts.specDir);
  for (const s of specs) if (s.problem) problems.push(`${s.file}: ${s.problem}; not run`);
  const runnable = specs.filter((s) => s.spec).sort((a, b) => a.spec!.id.localeCompare(b.spec!.id) || a.spec!.version - b.spec!.version);
  const file = loadSignalValidation(opts.resultFile);
  const at = (opts.now || new Date()).toISOString();
  if (runnable.length) {
    const fspecs = runnable.map((s) => s.spec as unknown as FxFactorSpec);
    const panel = await pullFxPanel(opts.fetcher, fspecs, problems, opts.savedFx, opts.now);
    const months = panelMonths(panel);
    const forwardFile = opts.forwardFile ?? path.join(path.dirname(opts.resultFile), 'forward.jsonl');
    const forward: ForwardBody[] = loadForward(forwardFile).lines;
    const forwardNew: ForwardBody[] = [];
    for (const { spec, hash } of runnable) {
      const s = spec as unknown as FxFactorSpec;
      const j = judgeFxFactor(s, fxFactorReturns(s, panel, months));
      const result: SignalResult = {
        ...j,
        id: s.id,
        specVersion: s.version,
        specHash: hash,
        ranAt: at,
        data: 'ECB euro reference rates via Frankfurter (month-end, per USD); BIS central bank policy rates (monthly) standing in for short rates; OECD consumer prices via DBnomics (y/y)',
      };
      // Rule 7: a passing test's book at the latest month-end is written down before its month's
      // return exists; recorded books get their month's net return once it does.
      const rows = fxFactorReturns(s, panel, months);
      const lastMonth = lastPanelMonth(panel);
      const book = lastMonth && !months.includes(lastMonth) ? fxFactorBook(s, panel, lastMonth) : null;
      const positive = rows.length ? rows.filter((r) => r.net > 0).length / rows.length : 0;
      const step = forwardStep(
        forward,
        { key: `${s.id} v${s.version}`, specHash: hash, passing: j.status === 'passed' },
        recordedOutcomes(s, panel, months, rows, forward, `${s.id} v${s.version}`, positive),
        book && lastMonth ? [{ where: 'book', when: lastMonth, what: bookText(book), due: addMonth(lastMonth, 1), book }] : [],
        at,
      );
      forward.push(...step);
      forwardNew.push(...step);
      file.versions[`${s.id} v${s.version}`] = result;
      file.results[s.id] = result;
      opts.onResult?.(result);
    }
    try {
      appendForward(forwardFile, forwardNew);
    } catch (e: any) {
      problems.push(`The forward record could not be saved (${e?.code || e?.message || e})`);
    }
  }
  const out: SignalValidationFile = { results: file.results, versions: file.versions, lastRun: { at, problems } };
  fs.mkdirSync(opts.resultFile.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
  writeFileAtomic(opts.resultFile, JSON.stringify(out, null, 1), 0o600);
  return { ...out, problems };
}
