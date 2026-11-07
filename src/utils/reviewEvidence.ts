/**
 * Policy review, step 4 "Evidence": a fixed evidence pack for the review's country, cut at the
 * frame's "As of" day, and what it says for each ranked option.
 *
 * - Analyses: the Chart Agent's ready-made macro charts and statistical tests on the app's own
 *   history (Taylor rule gap, real policy rate, does the policy rate lead inflation (lead/lag and
 *   Granger), r minus g, leading indicator vs policy rate). Every series is cut at the As of day,
 *   and each analysis records the span and number of points it used.
 * - Past episodes: this country's own policy-rate moves (BIS) at least a year before the As of
 *   day, with inflation the month before and twelve months later. Descriptive, not causal.
 * - Signals: each register entry an option leans on, with its Models & validation status at the
 *   time of the run. The step is "research only" unless every one of them has passed a
 *   pre-registered backtest.
 *
 * The same series and the same As of day give the same pack. Browser-safe; the server fetches.
 */
import type { Lever, OptionsStep } from './reviewOptions';
import { computeChart, PRESETS, presetRequest, type ChartRequest, type ChartTestResult, type FetchedSeries } from './councilChart';
import { MODEL_REGISTER, STATUS_LABEL, type ValidationStatus } from '../data/modelRegister';

export const EVIDENCE_TEMPLATE_VERSION = 'review-evidence-v1';
export const EPISODE_HORIZON_MONTHS = 12;
export const MAX_EPISODES = 8;

export interface EvidenceAnalysis {
  id: string;
  title: string;
  /** Which levers it speaks to. */
  informs: Lever[];
  /** True when at least one test or reading could run on the data. */
  ran: boolean;
  tests: ChartTestResult[];
  missing: string[];
  notes: string[];
  first?: string;
  last?: string;
  /** Each input series: label, source, span and number of points used (after the As of cut). */
  inputs: Array<{ label: string; source: string; first: string; last: string; n: number }>;
}

export interface PastEpisode {
  date: string;
  action: 'raised' | 'cut';
  fromPct: number;
  toPct: number;
  inflationBefore?: { month: string; pct: number };
  inflationAfter?: { month: string; pct: number };
  /** Inflation 12 months later minus the month before, in points; only with both. */
  changePts?: number;
}

export interface EvidenceSignal {
  id: string;
  name: string;
  status: ValidationStatus;
  statusLabel: string;
  /** Backtest verdict text when one exists. */
  verdict?: string;
  informs: Lever[];
}

export interface OptionEvidence {
  rank: number;
  title: string;
  lever: Lever;
  analyses: string[];
  signals: string[];
  /** One line: what the pack has for this option, or that it has nothing. */
  note: string;
}

export interface EvidenceStep {
  templateVersion: string;
  asOf: string;
  analyses: EvidenceAnalysis[];
  episodes: { items: PastEpisode[]; method: string; missing?: string; source?: string };
  signals: EvidenceSignal[];
  perOption: OptionEvidence[];
  /** True unless every signal the options lean on has passed a pre-registered backtest. */
  researchOnly: boolean;
}

/** The analyses in the pack: a ready-made chart (or a custom request) and the levers it informs. */
export const PACK: Array<{ id: string; preset?: string; informs: Lever[]; title?: string }> = [
  { id: 'taylor', preset: 'taylor', informs: ['monetary', 'communication'] },
  { id: 'real_rate', preset: 'real_rate', informs: ['monetary'] },
  { id: 'rate_inflation', title: 'Does the policy rate lead inflation?', informs: ['monetary', 'communication'] },
  { id: 'r_minus_g', preset: 'r_minus_g', informs: ['fiscal', 'structural'] },
  { id: 'cli_policy', preset: 'cli_policy', informs: ['monetary', 'structural'] },
];

/** Register entries each lever leans on (src/data/modelRegister.ts). */
export const SIGNALS_FOR_LEVER: Record<Lever, string[]> = {
  monetary: ['taylor_gap', 'cli_turn_policy', 'regime_quadrant'],
  communication: ['taylor_gap'],
  fiscal: [],
  structural: ['regime_quadrant'],
  external: ['reer_gap', 'cftc_crowding'],
  other: [],
};

/** Every option's text is written by a model when the council ranked them. */
const SUMMARY_SIGNAL = 'council_summary';

/** The chart requests of the pack for one country. */
export function packRequests(c: { iso3: string; countryName: string }): Array<{ id: string; informs: Lever[]; req: ChartRequest }> {
  return PACK.map((p) => {
    if (p.preset) {
      const preset = PRESETS.find((x) => x.id === p.preset)!;
      return { id: p.id, informs: p.informs, req: presetRequest(preset, c) };
    }
    const req: ChartRequest = {
      series: [
        { iso3: c.iso3, countryName: c.countryName, id: 'policy_rate', label: `${c.countryName}: Policy rate` },
        { iso3: c.iso3, countryName: c.countryName, id: 'cpi_monthly', fallback: 'cpi_imf', label: `${c.countryName}: Inflation` },
      ],
      tests: ['leadlag', 'granger'],
      transform: 'level',
      why: 'policy review evidence pack',
      notes: [],
      title: `${c.countryName}: ${p.title}`,
    };
    return { id: p.id, informs: p.informs, req };
  });
}

/** Keeps only points on or before the As of day (a month or year counts as on or before when it starts by then). */
export function cutAt<T extends { points: Array<{ date: string }> }>(s: T, asOf: string): T {
  return { ...s, points: s.points.filter((p) => p.date.slice(0, 10) <= asOf) };
}

/** Runs one analysis on series already cut at the As of day. */
export function runAnalysis(id: string, informs: Lever[], req: ChartRequest, fetched: Array<FetchedSeries | { reason: string }>): EvidenceAnalysis {
  const r = computeChart(req, fetched);
  const used = fetched.filter((f) => 'points' in f && f.points.length).length;
  return {
    id,
    title: req.title || r.title,
    informs,
    ran: used > 0 && r.tests.some((t) => !/^Not run/.test(t.reading)),
    tests: r.tests,
    missing: r.missing,
    notes: r.notes,
    ...(r.first ? { first: r.first } : {}),
    ...(r.last ? { last: r.last } : {}),
    inputs: fetched.flatMap((f, i) => ('points' in f && f.points.length ? [{ label: req.series[i].label, source: f.source, first: f.points[0].date, last: f.points[f.points.length - 1].date, n: f.points.length }] : [])),
  };
}

const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * Policy-rate moves at least EPISODE_HORIZON_MONTHS before the As of day, newest first, with
 * monthly inflation the month before the move and twelve months after it.
 */
export function pastEpisodes(policy: { points: Array<{ date: string; value: number }> } | undefined, cpi: { points: Array<{ date: string; value: number }> } | undefined, asOf: string): PastEpisode[] {
  const pts = policy?.points || [];
  const lastMonth = addMonths(asOf.slice(0, 7), -EPISODE_HORIZON_MONTHS);
  const cpiByMonth = new Map((cpi?.points || []).map((p) => [p.date.slice(0, 7), p.value]));
  const out: PastEpisode[] = [];
  for (let i = pts.length - 1; i >= 1 && out.length < MAX_EPISODES; i--) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.value === b.value || b.date.slice(0, 7) > lastMonth) continue;
    const month = b.date.slice(0, 7);
    const before = addMonths(month, -1);
    const after = addMonths(month, EPISODE_HORIZON_MONTHS);
    const ib = cpiByMonth.get(before);
    const ia = cpiByMonth.get(after);
    out.push({
      date: b.date,
      action: b.value > a.value ? 'raised' : 'cut',
      fromPct: a.value,
      toPct: b.value,
      ...(ib !== undefined ? { inflationBefore: { month: before, pct: ib } } : {}),
      ...(ia !== undefined ? { inflationAfter: { month: after, pct: ia } } : {}),
      ...(ib !== undefined && ia !== undefined ? { changePts: Math.round((ia - ib) * 100) / 100 } : {}),
    });
  }
  return out;
}

/** The register entries the options lean on, with the status they have now. */
export function signalsFor(options: OptionsStep, verdicts: Record<string, { status: ValidationStatus; verdict?: string }>): EvidenceSignal[] {
  const ids = new Map<string, Set<Lever>>();
  for (const o of options.options) for (const id of SIGNALS_FOR_LEVER[o.lever]) (ids.get(id) ?? ids.set(id, new Set()).get(id)!).add(o.lever);
  if (options.model) ids.set(SUMMARY_SIGNAL, new Set(options.options.map((o) => o.lever)));
  return [...ids.entries()].flatMap(([id, levers]) => {
    const e = MODEL_REGISTER.find((x) => x.id === id);
    if (!e) return [];
    const v = verdicts[id];
    const status = v?.status ?? e.status;
    return [{ id, name: e.name, status, statusLabel: STATUS_LABEL[status], ...(v?.verdict ? { verdict: v.verdict } : {}), informs: [...levers] }];
  });
}

export function perOption(options: OptionsStep, analyses: EvidenceAnalysis[], signals: EvidenceSignal[]): OptionEvidence[] {
  return options.options.map((o) => {
    const a = analyses.filter((x) => x.informs.includes(o.lever) && x.ran);
    const s = signals.filter((x) => x.informs.includes(o.lever) && x.id !== SUMMARY_SIGNAL);
    const note = a.length
      ? `${a.length} analys${a.length === 1 ? 'is' : 'es'} in the pack speak to this ${o.lever} option.`
      : o.lever === 'external' || o.lever === 'other' || o.lever === 'fiscal'
        ? `The pack has no statistical test for ${o.lever === 'external' || o.lever === 'other' ? 'an' : 'a'} ${o.lever} option yet; it rests on the diagnosis and the council's reasoning only.`
        : 'The analyses for this option could not run: their series are Missing (see each analysis).';
    return { rank: o.rank, title: o.title, lever: o.lever, analyses: a.map((x) => x.id), signals: s.map((x) => x.id), note };
  });
}

export function isResearchOnly(signals: EvidenceSignal[]): boolean {
  return signals.length === 0 || signals.some((s) => s.status !== 'passed' && s.status !== 'descriptive');
}

export const EPISODE_METHOD = `Each change in the BIS policy rate at least ${EPISODE_HORIZON_MONTHS} months before the As of day (newest ${MAX_EPISODES}), with monthly inflation the month before the move and ${EPISODE_HORIZON_MONTHS} months after. What followed a move is not what the move caused: other things changed too.`;
