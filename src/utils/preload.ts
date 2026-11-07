/**
 * "Download all country data": one pass over every free feed for every country the app covers, so
 * analysis afterwards reads from disk (fast, and offline). Screens keep showing only the newest
 * value; the full runs sit behind the History tab and downloads.
 *
 * This file is the plan and the bookkeeping (browser-safe, no fs). server.ts runs the steps one at
 * a time, saves the state after each in data/local/preload.json, and a later run skips every step
 * that finished within the last day, so a stopped or crashed run picks up where it left off.
 *
 * Nothing is ever made up: a step that fails is recorded as failed with the reason, and the figures
 * it would have filled stay Missing.
 */

export type PreloadStepKind = 'world' | 'country';

export interface PreloadStep {
  id: string;
  kind: PreloadStepKind;
  /** What the step downloads, in words. */
  label: string;
  iso3?: string;
}

export type PreloadOutcome = 'done' | 'failed' | 'skipped';

export interface PreloadStepResult {
  outcome: PreloadOutcome;
  /** When it finished (ISO). */
  at: string;
  /** Why it failed or was skipped, or what it brought back. */
  note?: string;
}

export interface PreloadState {
  /** True while a run is going. */
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** Set when a run ended early: "Stopped by you", "Server restarted", ... */
  endedEarly?: string;
  /** Step being run now. */
  current?: { id: string; label: string; since: string };
  /** A pause the run is waiting out (a feed asked to slow down). */
  waiting?: { until: string; why: string };
  /** Result of every step ever run, by step id (kept across runs; that is what makes it resumable). */
  steps: Record<string, PreloadStepResult>;
  /** Countries in the last plan. */
  countries?: string[];
}

export const EMPTY_PRELOAD_STATE: PreloadState = { running: false, steps: {} };

/** World-wide pulls: one each, shared by every country. */
export const WORLD_STEPS: PreloadStep[] = [
  { id: 'world:bis', kind: 'world', label: 'BIS central bank policy rates (daily and monthly history)' },
  { id: 'world:oecd_cli', kind: 'world', label: 'OECD leading indicators (via DBnomics)' },
  { id: 'world:oecd_qna', kind: 'world', label: 'OECD quarterly GDP growth (via DBnomics)' },
  { id: 'world:oecd_cpi', kind: 'world', label: 'OECD monthly inflation (via DBnomics)' },
  { id: 'world:national_cpi', kind: 'world', label: 'National inflation (BCB IPCA, Eurostat HICP)' },
  { id: 'world:activity', kind: 'world', label: 'Monthly activity indexes (BCB IBC-Br, Eurostat industrial production)' },
  { id: 'world:cftc', kind: 'world', label: 'CFTC futures positioning' },
  { id: 'world:tic', kind: 'world', label: 'US Treasury TIC holdings' },
  { id: 'world:imf_external', kind: 'world', label: 'IMF reserves and balance of payments' },
  { id: 'world:cofer', kind: 'world', label: 'IMF COFER reserve currencies' },
  { id: 'world:commodities', kind: 'world', label: 'Commodity prices (World Bank Pink Sheet, EIA)' },
  { id: 'world:comtrade', kind: 'world', label: 'UN Comtrade trade partners' },
  { id: 'world:hc_spread', kind: 'world', label: 'USD bond spreads over Treasuries (central bank of Peru, J.P. Morgan EMBI Global, monthly)' },
  { id: 'world:fx_history', kind: 'world', label: 'Daily exchange rates since 1999 (ECB reference rates via Frankfurter)' },
  { id: 'world:market_extras', kind: 'world', label: 'US 10Y, fed funds and FX valuation (FRED, NY Fed, BIS, ECB)' },
];

/** Per country: the full snapshot (every feed the country page uses) and the full yearly history. */
export function countrySteps(iso3: string, name?: string): PreloadStep[] {
  const who = name ? `${name} (${iso3})` : iso3;
  return [
    { id: `country:${iso3}:snapshot`, kind: 'country', iso3, label: `${who}: latest figures from every feed` },
    { id: `country:${iso3}:history`, kind: 'country', iso3, label: `${who}: full World Bank and IMF history` },
  ];
}

/**
 * Long world pulls that go after the countries, so the country figures are ready first. They run
 * without the per-step time limit (each saves as it goes and can be stopped at any point).
 */
export const LAST_STEPS: PreloadStep[] = [
  { id: 'world:gdelt_raw', kind: 'world', label: 'GDELT events and news themes (raw 15-minute files, weeks back as set)' },
];
export const NO_TIME_LIMIT_STEPS = new Set(LAST_STEPS.map((s) => s.id));

export function planPreload(countries: Array<{ iso3: string; countryName?: string }>): PreloadStep[] {
  const seen = new Set<string>();
  const list = countries.filter((c) => {
    const k = String(c.iso3 || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...WORLD_STEPS, ...list.flatMap((c) => countrySteps(c.iso3.toUpperCase(), c.countryName)), ...LAST_STEPS];
}

/** A finished step counts for this long; after that a new run downloads it again. */
export const PRELOAD_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * The steps a run still has to do: everything not done within PRELOAD_FRESH_MS (failed and
 * skipped steps are tried again). With fresh, everything.
 */
export function stepsToRun(plan: PreloadStep[], state: PreloadState, opts: { fresh?: boolean; now?: number } = {}): PreloadStep[] {
  if (opts.fresh) return plan;
  const now = opts.now ?? Date.now();
  return plan.filter((s) => {
    const r = state.steps[s.id];
    return !(r?.outcome === 'done' && now - Date.parse(r.at) < PRELOAD_FRESH_MS);
  });
}

export interface PreloadSummary {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  /** Not yet run, or done too long ago. */
  todo: number;
  /** Countries with both steps done. */
  countriesReady: number;
  countriesTotal: number;
  /** The last time every step was done (the oldest finish among them), or null. */
  completeAsOf: string | null;
  /** Failed and skipped steps with the reason, for the window. */
  problems: Array<{ id: string; label: string; outcome: PreloadOutcome; note?: string }>;
}

export function summarisePreload(plan: PreloadStep[], state: PreloadState, now = Date.now()): PreloadSummary {
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const problems: PreloadSummary['problems'] = [];
  const finishes: string[] = [];
  for (const s of plan) {
    const r = state.steps[s.id];
    if (r?.outcome === 'done' && now - Date.parse(r.at) < PRELOAD_FRESH_MS) {
      done++;
      finishes.push(r.at);
    } else if (r?.outcome === 'failed') {
      failed++;
      problems.push({ id: s.id, label: s.label, outcome: r.outcome, note: r.note });
    } else if (r?.outcome === 'skipped') {
      skipped++;
      problems.push({ id: s.id, label: s.label, outcome: r.outcome, note: r.note });
    }
  }
  const isos = Array.from(new Set(plan.filter((s) => s.iso3).map((s) => s.iso3 as string)));
  const ready = isos.filter((iso) =>
    plan.filter((s) => s.iso3 === iso).every((s) => {
      const r = state.steps[s.id];
      return r?.outcome === 'done' && now - Date.parse(r.at) < PRELOAD_FRESH_MS;
    })
  ).length;
  return {
    total: plan.length,
    done,
    failed,
    skipped,
    todo: plan.length - done - failed - skipped,
    countriesReady: ready,
    countriesTotal: isos.length,
    completeAsOf: done === plan.length && finishes.length ? finishes.sort()[0] : null,
    problems,
  };
}

/** "12.4 MB" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'Missing';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Size estimate for the countries not yet saved: the average size per country already on disk
 * times the countries left. Null (shown as "known after the first country") when none is saved yet,
 * because a guess would be a made-up number.
 */
export function estimateRemainingBytes(bytesPerCountry: number[], countriesLeft: number): number | null {
  const known = bytesPerCountry.filter((b) => Number.isFinite(b) && b > 0);
  if (!known.length) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return Math.round(avg * Math.max(0, countriesLeft));
}

/** One line for the terminal and the server log. */
export function progressLine(index: number, count: number, step: PreloadStep, result: PreloadStepResult): string {
  const mark = result.outcome === 'done' ? 'ok  ' : result.outcome === 'skipped' ? 'needs setup' : 'FAIL';
  return `[preload ${index}/${count}] ${mark} ${step.label}${result.note ? ` (${result.note})` : ''}`;
}
