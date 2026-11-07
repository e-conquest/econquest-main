import type { CouncilAssessmentRun } from '../types/council';
import { getSnapshotDataStatus } from './dataStatus';
import {
  calendarSection,
  groupLines,
  pct,
  pts,
  liveRow,
  missingNote,
  missingRow,
  noSourceRow,
  pathMissing,
  sourcesSection,
  type CountryBrief,
  type NoteSection,
} from './countryNotes';

/**
 * Multilateral and official sector view: is public debt sustainable, how does it react to
 * standard shocks, and what adjustment would stabilise it.
 *
 * The projection is the textbook debt dynamics equation, d(t+1) = d(t) x (1 + r) / (1 + g) - pb,
 * run for five years on the snapshot's figures. The shocks are fixed, stated sizes, in the
 * spirit of the IMF's market-access DSA bound tests but much simpler. Nothing here is an IMF or
 * World Bank assessment or risk rating, and the text says so.
 */

/** IMF market-access DSA (2013 guidance) higher-scrutiny benchmark for emerging markets: debt above 70% of GDP. */
export const EM_DEBT_BENCHMARK_PCT = 70;
export const PROJECTION_YEARS = 5;
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export interface DebtPathInput {
  debtPct: number;
  /** Real interest rate, % a year. */
  r: number;
  /** Real GDP growth, % a year. */
  g: number;
  /** Primary balance, % of GDP (surplus positive). */
  pb: number;
}

export interface Scenario {
  id: 'baseline' | 'growth' | 'interest' | 'primary' | 'combined';
  label: string;
  /** What the shock does, in words. */
  shock: string;
  path: number[]; // debt % of GDP, year 0 (today) then each projected year
}

/** Debt path for `years` years. Shocks are adjustments by year index (1-based). */
export function projectDebt(
  input: DebtPathInput,
  years: number,
  adjust: (year: number) => { dr?: number; dg?: number; dpb?: number } = () => ({})
): number[] {
  const out = [input.debtPct];
  let d = input.debtPct;
  for (let t = 1; t <= years; t++) {
    const a = adjust(t);
    const r = (input.r + (a.dr ?? 0)) / 100;
    const g = (input.g + (a.dg ?? 0)) / 100;
    const pb = input.pb + (a.dpb ?? 0);
    d = (d * (1 + r)) / (1 + g) - pb;
    out.push(Number(d.toFixed(1)));
  }
  return out;
}

export function standardScenarios(input: DebtPathInput, years = PROJECTION_YEARS): Scenario[] {
  const growth = (t: number) => (t <= 2 ? { dg: -2 } : {});
  return [
    { id: 'baseline', label: 'Baseline', shock: 'Current figures held constant', path: projectDebt(input, years) },
    { id: 'growth', label: 'Lower growth', shock: 'Growth 2 pts lower in years 1 and 2', path: projectDebt(input, years, growth) },
    { id: 'interest', label: 'Higher interest rates', shock: 'Real interest rate 2 pts higher in every year', path: projectDebt(input, years, () => ({ dr: 2 })) },
    { id: 'primary', label: 'Weaker budget', shock: 'Primary balance 1 pt of GDP lower in every year', path: projectDebt(input, years, () => ({ dpb: -1 })) },
    {
      id: 'combined',
      label: 'Combined',
      shock: 'All three shocks together',
      path: projectDebt(input, years, (t) => ({ dr: 2, dpb: -1, ...(t <= 2 ? { dg: -2 } : {}) })),
    },
  ];
}

export type SignalLevel = 'low' | 'moderate' | 'high';

/** Count of simple warning signs, mapped to a level. Not an official risk rating. Runs only on live figures. */
export function sustainabilitySignals(run: CouncilAssessmentRun, scenarios: Scenario[], gapPts?: number, rMinusG?: number): { level: SignalLevel; signs: string[] } {
  const status = getSnapshotDataStatus(run.openData);
  const signs: string[] = [];
  const debt = status.live('imf.debtToGdpPct');
  if (debt !== undefined && debt > EM_DEBT_BENCHMARK_PCT) signs.push(`debt above the ${EM_DEBT_BENCHMARK_PCT}% of GDP emerging-market benchmark`);
  if (scenarios.length) {
    const base = scenarios.find((s) => s.id === 'baseline')!.path;
    const combined = scenarios.find((s) => s.id === 'combined')!.path;
    if (base[base.length - 1] > base[0] + 1) signs.push('debt still rising at the end of the baseline projection');
    if (combined[combined.length - 1] > EM_DEBT_BENCHMARK_PCT && combined[combined.length - 1] > base[base.length - 1] + 10)
      signs.push(`debt above ${EM_DEBT_BENCHMARK_PCT}% and 10 pts above baseline in the combined shock`);
  }
  if (rMinusG !== undefined && gapPts !== undefined && rMinusG > 0 && gapPts > 1) signs.push('interest rates above growth with a primary balance short of the stabilising level');
  const res = status.live('wb.fxReservesMonthsImport');
  if (res !== undefined && res < 3) signs.push('reserves under three months of imports');
  const ext = status.live('wb.externalDebtPctGni');
  if (ext !== undefined && ext > 60) signs.push('external debt above 60% of GNI');
  const level: SignalLevel = signs.length >= 3 ? 'high' : signs.length >= 1 ? 'moderate' : 'low';
  return { level, signs };
}

const LEVEL_TEXT: Record<SignalLevel, string> = {
  low: 'few warning signs',
  moderate: 'some warning signs',
  high: 'many warning signs',
};

/** Figures the debt projection needs; without every one of them live, there is no projection. */
export const DSA_INPUTS = ['imf.debtToGdpPct', 'imf.primaryFiscalBalancePct', 'imf.realGdpGrowthPct', 'imf.cpiInflationPct', 'market.sovereign10YBondYieldPct'];

/** Debt dynamics on live figures only: the real rate is the official 10Y yield minus three-quarters of inflation. */
export function liveDsa(run: CouncilAssessmentRun): { input: DebtPathInput; rMinusG: number; pbStar: number; gap: number } | { missing: string[] } {
  const status = getSnapshotDataStatus(run.openData);
  const missing = DSA_INPUTS.filter((p) => !status.isLive(p));
  if (missing.length) return { missing };
  const L = (p: string) => status.live(p) as number;
  const debt = L('imf.debtToGdpPct');
  const pb = L('imf.primaryFiscalBalancePct');
  const g = L('imf.realGdpGrowthPct');
  const r = Math.max(0.8, L('market.sovereign10YBondYieldPct') - L('imf.cpiInflationPct') * 0.75);
  const pbStar = ((r - g) / (100 + g)) * debt;
  return { input: { debtPct: debt, r, g, pb }, rMinusG: r - g, pbStar, gap: pbStar - pb };
}

const INPUT_LABEL: Record<string, string> = {
  'imf.debtToGdpPct': 'debt/GDP',
  'imf.primaryFiscalBalancePct': 'primary balance',
  'imf.realGdpGrowthPct': 'growth',
  'imf.cpiInflationPct': 'inflation',
  'market.sovereign10YBondYieldPct': 'official 10Y yield',
};

export function officialBrief(run: CouncilAssessmentRun, now: Date = new Date()): CountryBrief & { scenarios: Scenario[]; level: SignalLevel; startYear: number } {
  const open = run.openData;
  const status = getSnapshotDataStatus(open);
  const dsa = liveDsa(run);
  const ok = 'input' in dsa;
  const scenarios = ok ? standardScenarios(dsa.input) : [];
  const { level, signs } = sustainabilitySignals(run, scenarios, ok ? dsa.gap : undefined, ok ? dsa.rMinusG : undefined);
  const startYear = now.getFullYear();
  const debt27 = status.live('imf.debtToGdpForecast2027Pct');

  const j: string[] = [];
  if (ok) {
    const base = scenarios[0].path;
    const end = base[base.length - 1];
    const worst = scenarios.reduce((a, s) => (s.path[s.path.length - 1] > a.path[a.path.length - 1] ? s : a), scenarios[0]);
    j.push(`On current figures, debt moves from ${pct(base[0], 0)} to ${pct(end, 0)} of GDP by ${startYear + PROJECTION_YEARS} (${end > base[0] + 1 ? 'rising' : end < base[0] - 1 ? 'falling' : 'roughly flat'}).`);
    j.push(
      dsa.gap > 0.25
        ? `Stabilising debt needs a primary balance of ${pct(dsa.pbStar)} of GDP, ${dsa.gap.toFixed(1)} pts above today's ${pct(dsa.input.pb)}.`
        : `Today's primary balance of ${pct(dsa.input.pb)} of GDP is enough to keep debt stable (needed: ${pct(dsa.pbStar)}).`
    );
    j.push(`The hardest standard shock is "${worst.label.toLowerCase()}", which takes debt to ${pct(worst.path[worst.path.length - 1], 0)} of GDP by ${startYear + PROJECTION_YEARS}.`);
    const idx2027 = 2027 - startYear;
    if (debt27 !== undefined && idx2027 >= 1 && idx2027 < base.length) {
      const gap = base[idx2027] - debt27;
      if (gap > 3)
        j.push(`This mechanical projection reaches ${pct(base[idx2027], 0)} in 2027, above the IMF forecast of ${pct(debt27, 0)}. It prices all debt at today's market rate, so treat it as an upper bound.`);
      else if (gap < -3) j.push(`This mechanical projection reaches ${pct(base[idx2027], 0)} in 2027, below the IMF forecast of ${pct(debt27, 0)}.`);
    }
  } else {
    j.push(`No debt projection: it needs live ${dsa.missing.map((p) => INPUT_LABEL[p] || p).join(', ')}.`);
  }
  j.push(signs.length ? `Warning signs: ${signs.join('; ')}.` : 'No warning signs on the tests that could be run with live figures.');

  const debt = status.live('imf.debtToGdpPct');
  const brief = {
    headline: ok
      ? `${run.countryName}: ${LEVEL_TEXT[level]} on debt sustainability. Debt is ${pct(dsa.input.debtPct, 0)} of GDP${debt27 !== undefined ? `; the IMF forecasts ${pct(debt27, 0)} for 2027` : ''}.`
      : `${run.countryName}: ${debt !== undefined ? `debt is ${pct(debt, 0)} of GDP; ` : ''}no sustainability reading until the missing figures are live.`,
    judgements: j,
    scenarios,
    level,
    startYear,
    groups: [
      {
        title: 'Debt path',
        rows: [
          liveRow(status, 'Debt / GDP', 'imf.debtToGdpPct', (v) => pct(v), open),
          liveRow(status, 'Debt / GDP, 2027 forecast', 'imf.debtToGdpForecast2027Pct', (v) => pct(v), open),
          liveRow(status, 'Primary balance', 'imf.primaryFiscalBalancePct', (v) => `${pct(v)} of GDP`, open),
          liveRow(status, 'Real GDP growth', 'imf.realGdpGrowthPct', (v) => pct(v), open),
          ...(ok
            ? [
                { label: 'Real interest rate (approx.)', value: pct(dsa.input.r), source: 'model: official 10Y yield minus ¾ of inflation', verified: false },
                { label: 'Interest rate minus growth', value: pts(dsa.rMinusG), source: 'model, from figures above', verified: false },
                { label: 'Balance that keeps debt stable', value: `${pct(dsa.pbStar)} of GDP`, source: 'model, from figures above', verified: false },
              ]
            : [missingRow('Real interest rate, r minus g, stabilising balance', { ...pathMissing(status, dsa.missing[0]), short: `Needs live ${INPUT_LABEL[dsa.missing[0]] || 'inputs'}` })]),
        ],
      },
      {
        title: `Projection to ${startYear + PROJECTION_YEARS}, % of GDP`,
        rows: ok
          ? scenarios.map((s) => ({
              label: s.label,
              value: `${pct(s.path[s.path.length - 1], 0)} (peak ${pct(Math.max(...s.path), 0)})`,
              source: s.id === 'baseline' ? 'model: current figures' : `model: ${lowerFirst(s.shock)}`,
              verified: false,
            }))
          : [missingRow('Projection and stress tests', { ...pathMissing(status, dsa.missing[0]), short: 'Needs live inputs' })],
      },
      {
        title: 'External sustainability',
        rows: [
          liveRow(status, 'Current account', 'wb.currentAccountPctGdp', (v) => `${pct(v)} of GDP`, open),
          liveRow(status, 'External debt', 'wb.externalDebtPctGni', (v) => `${pct(v, 0)} of GNI`, open),
          liveRow(status, 'FX reserves', 'wb.fxReservesMonthsImport', (v) => `${v.toFixed(1)} months of imports`, open),
          noSourceRow('Reserves / short-term external debt', 'Needs short-term external debt, which no connected source provides yet.'),
        ],
      },
    ],
  };
  return { ...brief, sampleWarning: missingNote(brief.groups, run.countryName) };
}

export const OFFICIAL_SECTIONS: Record<string, string> = {
  summary: 'Summary',
  path: 'Debt path',
  projection: 'Projection and stress tests',
  adjustment: 'Fiscal adjustment',
  external: 'External sustainability',
  risks: 'Risks',
  calendar: 'Coming up',
  method: 'Method and assumptions',
  sources: 'Data and sources',
};

export function buildOfficialSections(run: CouncilAssessmentRun, include: (id: string) => boolean, now: Date = new Date()): NoteSection[] {
  const b = officialBrief(run, now);
  const dsa = liveDsa(run);
  const out: NoteSection[] = [];
  const years = (b.scenarios[0]?.path || []).map((_, i) => b.startYear + i);
  if (include('summary')) {
    out.push({
      id: 'summary',
      heading: OFFICIAL_SECTIONS.summary,
      lines: [b.headline, ...(b.sampleWarning ? [`**Note:** ${b.sampleWarning}`] : []), ...b.judgements.map((x) => `- ${x}`)],
    });
  }
  if (include('path')) out.push({ id: 'path', heading: OFFICIAL_SECTIONS.path, lines: groupLines(b.groups[0]) });
  if (include('projection')) {
    out.push({
      id: 'projection',
      heading: OFFICIAL_SECTIONS.projection,
      lines: b.scenarios.length
        ? [`Debt, % of GDP, ${years[0]} to ${years[years.length - 1]}:`, ...b.scenarios.map((s) => `- **${s.label}** (${lowerFirst(s.shock)}): ${s.path.map((v) => v.toFixed(0)).join(' → ')}`)]
        : ['No projection: its inputs are not all live. See Debt path for what is missing.'],
    });
  }
  if (include('adjustment')) {
    out.push({
      id: 'adjustment',
      heading: OFFICIAL_SECTIONS.adjustment,
      lines: [
        !('input' in dsa)
          ? 'No adjustment figure: the debt projection needs live inputs.'
          : dsa.gap > 0.25
            ? `Holding debt at today's ratio would need the primary balance to improve by about ${dsa.gap.toFixed(1)} pts of GDP, to ${pct(dsa.pbStar)}.`
            : `No adjustment is needed to hold debt at today's ratio on current figures.`,
        'Write the recommended measures and their timing here.',
      ],
    });
  }
  if (include('external')) out.push({ id: 'external', heading: OFFICIAL_SECTIONS.external, lines: groupLines(b.groups[2]) });
  if (include('risks')) {
    const vul = (run.supremeCouncil?.policyResearcherReport.structuralVulnerabilities || []).map((v) => v.replace(/\s*\(Ref:[^)]*\)/g, '').trim());
    out.push({
      id: 'risks',
      heading: OFFICIAL_SECTIONS.risks,
      lines: vul.length ? vul.slice(0, 5).map((v) => `- ${v}`) : ['Write the main risks here, including contingent liabilities. Running the council adds a draft list.'],
    });
  }
  if (include('calendar')) out.push(calendarSection(run, OFFICIAL_SECTIONS.calendar, now));
  if (include('method')) {
    out.push({
      id: 'method',
      heading: OFFICIAL_SECTIONS.method,
      lines: [
        '- Projection: d(t+1) = d(t) × (1 + r) / (1 + g) − pb, with r the real interest rate, g real growth and pb the primary balance, held at today’s values unless shocked.',
        '- Real interest rate approximated as the 10-year yield minus three-quarters of inflation. The effective rate on the whole debt stock is usually lower, so this tends to overstate debt growth.',
        `- Benchmark: debt above ${EM_DEBT_BENCHMARK_PCT}% of GDP, the higher-scrutiny threshold for emerging markets in the IMF’s 2013 market-access DSA guidance (since replaced by the 2021 framework, which uses a different method).`,
        '- Exchange-rate and contingent-liability shocks are not modelled because the currency composition of debt is not available.',
        '- The warning-sign count is a simple screen, not an IMF or World Bank risk rating.',
      ],
    });
  }
  if (include('sources')) out.push(sourcesSection(run, 'Staff-style analysis for discussion. Not an IMF or World Bank debt sustainability assessment.'));
  return out;
}
