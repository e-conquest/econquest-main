/**
 * Runs the pre-registered backtests (server only). Files are <id>.json (version 1) or
 * <id>.v<N>.json (later versions); every version runs, the latest shows on the badge.
 *
 * Runs the pre-registered backtests: Menu > Models & validation > Run backtests, or
 * `npm run backtest`. Reads each test file in docs/validation/preregistered/, refuses any whose
 * SHA-256 is not the one in manifest.json, pulls the long history it needs from the free feeds,
 * and saves the verdicts in data/local/validation/results.json. Each verdict also goes in the audit
 * log. See src/utils/backtest.ts.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { BIS_API } from './bisDebtSecurities';
import { CBPOL_AREA, CBPOL_DATASET, parseCbpolCsv } from './bisPolicyRates';
import { CLI_LABEL, cliUrl, parseCli } from './oecdCli';
import { CPI_LABEL, cpiUrl, parseCpi } from './oecdInflation';
import { TARGET_HISTORY } from '../data/inflationTargetHistory';
import { markImfProjections, parseImfYears } from './officialHistory';
import { realTimeOutputGap } from './outputGap';
import { areaSeries } from './oecdSdmx';
import { CFTC_CURRENCY_CODES, CFTC_LABEL, cftcUrl, parseCftcRows } from './cftcPositioning';
import { cftcCrowdingCases, cliTurnPolicyCases, cycleClockCases, regimeQuadrantCases, taylorGapCases, ruleFamilyCases, timingUnwindCases, unrestOnsetCases, judgeWithRobustness, sampleCases, spanOf, type BacktestCase, type BacktestResult, type BacktestSpec, type OpenCall } from './backtest';
import { forwardStep, type ForwardBody } from './forwardRecord';
import { onsetYears } from './unrestOnset';
import type { V1Month } from './gdeltDaily';
import type { UcdpData } from './ucdpConflict';
import { appendForward, loadForward } from './forwardRecordStore';
import { writeFileAtomic } from './atomicWrite';

export interface ValidationFile {
  /** Latest version's result per test id (what the badges show). */
  results: Record<string, BacktestResult>;
  /** Every version's latest result, keyed "id v1", "id v2": a re-test never hides the earlier verdict. */
  versions?: Record<string, BacktestResult>;
  lastRun?: { at: string; problems: string[] };
}

export interface LoadedSpec {
  file: string;
  hash: string;
  spec: BacktestSpec | null;
  /** Why the test cannot run (hash not registered, unreadable). */
  problem?: string;
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export function loadSpecs(dir: string): LoadedSpec[] {
  let manifest: Record<string, string> = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).files || {};
  } catch {
    // no manifest: every file is refused below
  }
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const buf = fs.readFileSync(path.join(dir, file));
    const hash = sha256(buf);
    if (manifest[file] !== hash) return { file, hash, spec: null, problem: manifest[file] ? 'the file changed after it was registered (hash differs from manifest.json)' : 'not in manifest.json, so not registered' };
    try {
      return { file, hash, spec: JSON.parse(buf.toString('utf8')) as BacktestSpec };
    } catch {
      return { file, hash, spec: null, problem: 'not readable JSON' };
    }
  });
}

export function validationFilePath(dataDir: string): string {
  return path.join(dataDir, 'local', 'validation', 'results.json');
}

export function loadValidation(file: string): ValidationFile {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    const results: Record<string, BacktestResult> = v?.results && typeof v.results === 'object' ? v.results : {};
    const versions: Record<string, BacktestResult> = v?.versions && typeof v.versions === 'object' ? v.versions : {};
    // Files saved before versions were kept: the result under results is its own version.
    for (const r of Object.values(results)) if (r?.id && !versions[`${r.id} v${r.specVersion}`]) versions[`${r.id} v${r.specVersion}`] = r;
    return { results, versions, ...(v?.lastRun ? { lastRun: v.lastRun } : {}) };
  } catch {
    return { results: {}, versions: {} };
  }
}

type Fetcher = (url: string) => Promise<string>;

export const defaultFetcher: Fetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { Accept: '*/*' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

/** The long histories the tests read, pulled once per run. */
const IMF_GROWTH = 'NGDP_RPCH';
export const imfGrowthUrl = (iso3: string) => `https://www.imf.org/external/datamapper/api/v1/${IMF_GROWTH}/${iso3}`;

/** Real-time output gap by year (one-sided HP lambda 100) per country, from IMF real GDP growth. */
async function pullOutputGaps(fetcher: Fetcher, problems: string[], now: Date): Promise<Record<string, { year: string; gap: number }[]>> {
  const out: Record<string, { year: string; gap: number }[]> = {};
  const failed: string[] = [];
  await Promise.all(
    Object.keys(TARGET_HISTORY).map(async (iso3) => {
      try {
        const years = parseImfYears(JSON.parse(await fetcher(imfGrowthUrl(iso3))), IMF_GROWTH, iso3);
        if (!years?.length) return;
        const pts = markImfProjections(years.map(({ year, value }) => ({ date: year, value })), now);
        out[iso3] = realTimeOutputGap(pts).map((g) => ({ year: g.year, gap: g.hp100 }));
      } catch {
        failed.push(iso3);
      }
    })
  );
  if (failed.length) problems.push(`IMF real GDP growth did not answer for ${failed.sort().join(', ')} (no output gap there)`);
  return out;
}

async function pullHistory(fetcher: Fetcher, problems: string[], methods: Set<string>) {
  const areas = [...new Set(Object.values(CBPOL_AREA))].sort().join('+');
  const [bis, cli, cftc, cpi] = await Promise.all([
    fetcher(`${BIS_API}/${CBPOL_DATASET}/M.${areas}/all?startPeriod=1990-01&format=csv`).then((t) => parseCbpolCsv(t, 'M')).catch((e) => (problems.push(`BIS policy rates did not answer (${e.message})`), null)),
    fetcher(cliUrl()).then((t) => parseCli(t, 100_000)).catch((e) => (problems.push(`OECD leading indicator did not answer (${e.message})`), null)),
    fetcher(cftcUrl(new Date(), undefined, { since: '2006-06-01', limit: 50_000 })).then((t) => parseCftcRows(JSON.parse(t))).catch((e) => (problems.push(`CFTC did not answer (${e.message})`), null)),
    methods.has('taylor_gap') || methods.has('regime_quadrant') || methods.has('rule_family') ? fetcher(cpiUrl()).then((t) => parseCpi(t, 100_000)).catch((e) => (problems.push(`OECD consumer prices did not answer (${e.message})`), null)) : Promise.resolve(null),
  ]);
  return { bis, cli, cftc, cpi };
}

export async function runBacktests(opts: { specDir: string; resultFile: string; fetcher?: Fetcher; now?: Date; onResult?: (r: BacktestResult) => void; forwardFile?: string; /** Files on disk some tests read (GDELT months, UCDP), loaded only when such a test runs. */ local?: { gdeltMonths: () => V1Month[]; ucdp: () => UcdpData | null } }): Promise<ValidationFile & { problems: string[] }> {
  const problems: string[] = [];
  const specs = loadSpecs(opts.specDir);
  for (const s of specs) if (s.problem) problems.push(`${s.file}: ${s.problem}; not run`);
  // Oldest version first, so the latest version of each test ends up under results[id].
  const runnable = specs.filter((s) => s.spec).sort((a, b) => a.spec!.id.localeCompare(b.spec!.id) || a.spec!.version - b.spec!.version);
  const file = loadValidation(opts.resultFile);
  if (runnable.length) {
    const h = await pullHistory(opts.fetcher || defaultFetcher, problems, new Set(runnable.map((s) => s.spec!.method)));
    const needGap = runnable.some((s) => (s.spec!.method === 'taylor_gap' && Number(s.spec!.params?.outputWeight) > 0) || s.spec!.method === 'rule_family');
    const gaps = needGap ? await pullOutputGaps(opts.fetcher || defaultFetcher, problems, opts.now || new Date()) : {};
    const at = (opts.now || new Date()).toISOString();
    const forwardFile = opts.forwardFile ?? path.join(path.dirname(opts.resultFile), 'forward.jsonl');
    const forward: ForwardBody[] = loadForward(forwardFile).lines;
    const forwardNew: ForwardBody[] = [];
    for (const { spec, hash } of runnable) {
      const s = spec!;
      let cases: BacktestCase[] = [];
      let series: string[] = [];
      let data = '';
      const open: OpenCall[] = [];
      if (s.method === 'cli_turn_policy') {
        if (!h.bis || !h.cli) continue;
        data = `${CLI_LABEL}; BIS central bank policy rates (monthly, from 1990)`;
        const seen = new Set<string>();
        for (const [iso3, area] of Object.entries(CBPOL_AREA)) {
          if (seen.has(area)) continue;
          const cli = areaSeries(iso3, h.cli);
          const pol = h.bis[area]?.points;
          if (!cli?.length || !pol?.length) continue;
          seen.add(area);
          series.push(iso3);
          cases.push(...cliTurnPolicyCases(s, iso3, cli, pol, open));
        }
      } else if (s.method === 'cftc_crowding') {
        if (!h.cftc) continue;
        data = `${CFTC_LABEL} (weekly, from 2006)`;
        for (const [iso3, def] of Object.entries(CFTC_CURRENCY_CODES)) {
          const weeks = h.cftc.get(def.code);
          if (!weeks?.length) continue;
          series.push(`${def.ccy} (${def.market})`);
          cases.push(...cftcCrowdingCases(s, def.ccy, weeks, open));
        }
      } else if (s.method === 'taylor_gap') {
        if (!h.bis || !h.cpi) continue;
        const withGap = Number(s.params?.outputWeight) > 0;
        data = `${CPI_LABEL}; BIS central bank policy rates (monthly, from 1990); inflation targets as they stood (src/data/inflationTargetHistory.ts)${withGap ? '; real-time output gap from IMF WEO real GDP growth (one-sided HP, lambda 100; year t used from April t+1)' : ''}`;
        for (const iso3 of Object.keys(TARGET_HISTORY)) {
          const area = CBPOL_AREA[iso3];
          const infl = areaSeries(iso3, h.cpi)?.points;
          const pol = area ? h.bis[area]?.points : undefined;
          if (!infl?.length || !pol?.length) continue;
          if (withGap && !gaps[iso3]?.length) continue;
          series.push(iso3);
          cases.push(...taylorGapCases(s, iso3, infl, pol, withGap ? gaps[iso3] : undefined, open));
        }
      } else if (s.method === 'rule_family') {
        if (!h.bis || !h.cpi) continue;
        data = `${CPI_LABEL}; BIS central bank policy rates (monthly, from 1990); inflation targets as they stood (src/data/inflationTargetHistory.ts); real-time output gap from IMF WEO real GDP growth (one-sided HP, lambda 100; year t used from April t+1)`;
        for (const iso3 of Object.keys(TARGET_HISTORY)) {
          const area = CBPOL_AREA[iso3];
          const infl = areaSeries(iso3, h.cpi)?.points;
          const pol = area ? h.bis[area]?.points : undefined;
          if (!infl?.length || !pol?.length || !gaps[iso3]?.length) continue;
          series.push(iso3);
          cases.push(...ruleFamilyCases(s, iso3, infl, pol, gaps[iso3], open));
        }
      } else if (s.method === 'regime_quadrant') {
        if (!h.bis || !h.cli || !h.cpi) continue;
        data = `${CLI_LABEL}; ${CPI_LABEL}; BIS central bank policy rates (monthly, from 1990)`;
        const seen = new Set<string>();
        for (const [iso3, area] of Object.entries(CBPOL_AREA)) {
          if (seen.has(area)) continue;
          const cli = areaSeries(iso3, h.cli);
          const infl = areaSeries(iso3, h.cpi)?.points;
          const pol = h.bis[area]?.points;
          if (!cli?.length || !infl?.length || !pol?.length) continue;
          seen.add(area);
          series.push(iso3);
          cases.push(...regimeQuadrantCases(s, iso3, cli, infl, pol, open));
        }
      } else if (s.method === 'cycle_clock') {
        if (!h.bis) continue;
        data = 'BIS central bank policy rates (monthly, from 1990)';
        const seen = new Set<string>();
        for (const [iso3, area] of Object.entries(CBPOL_AREA)) {
          if (seen.has(area)) continue;
          const pol = h.bis[area]?.points;
          if (!pol?.length) continue;
          seen.add(area);
          series.push(iso3);
          cases.push(...cycleClockCases(s, iso3, pol, open));
        }
      } else if (s.method === 'timing_unwind') {
        if (!h.cftc) continue;
        data = `${CFTC_LABEL} (weekly, from 2006)`;
        for (const [, def] of Object.entries(CFTC_CURRENCY_CODES)) {
          const weeks = h.cftc.get(def.code);
          if (!weeks?.length) continue;
          series.push(`${def.ccy} (${def.market})`);
          cases.push(...timingUnwindCases(s, def.ccy, weeks, open));
        }
      } else if (s.method === 'unrest_onset') {
        const months = opts.local?.gdeltMonths() || [];
        const ucdp = opts.local?.ucdp() || null;
        if (!months.length || !ucdp?.files.acd) {
          problems.push(`${s.id}: needs the GDELT 1.0 months on disk (npm run gdelt:daily) and the UCDP/PRIO Armed Conflict Dataset; not run`);
          continue;
        }
        data = `GDELT 1.0 event files on disk (${months.length} months), protests and violence as a share of each country's events; UCDP/PRIO Armed Conflict Dataset ${ucdp.files.acd.version} (conflict located in the country)`;
        const years = onsetYears(months, ucdp, { baselineMonths: s.params.baselineMonths, zSpike: s.params.zSpike, sdFloorPts: s.params.sdFloorPts });
        series = [...new Set(years.map((y) => y.where))];
        cases.push(...unrestOnsetCases(s, years, open));
      } else {
        problems.push(`${s.id}: unknown method ${String(s.method)}`);
        continue;
      }
      const result: BacktestResult = { id: s.id, specVersion: s.version, specHash: hash, ranAt: at, ...judgeWithRobustness(s, cases), span: spanOf(cases), series, data, sample: sampleCases(cases) };
      // Rule 7: open calls of a passing test go on the forward record; recorded calls get their outcome.
      const step = forwardStep(forward, { key: `${s.id} v${s.version}`, specHash: hash, passing: result.status === 'passed' }, cases, open, at);
      forward.push(...step);
      forwardNew.push(...step);
      file.versions = { ...(file.versions || {}), [`${s.id} v${s.version}`]: result };
      file.results[s.id] = result;
      opts.onResult?.(result);
    }
    try {
      appendForward(forwardFile, forwardNew);
    } catch (e: any) {
      problems.push(`The forward record could not be saved (${e?.code || e?.message || e})`);
    }
  }
  const out: ValidationFile = { results: file.results, versions: file.versions || {}, lastRun: { at: (opts.now || new Date()).toISOString(), problems } };
  writeFileAtomic(opts.resultFile, JSON.stringify(out, null, 1), 0o600);
  return { ...out, problems };
}
