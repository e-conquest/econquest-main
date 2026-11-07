/**
 * Policy review, step 2 "Diagnose": the app's model readings as they could have been worked out on
 * the As-of day (Sam, 2026-11-06). They join the diagnosis as numbered figures after the standard indicators
 * indicators, so Options, Evidence and the memo cite them like any other figure.
 *
 * As-of rule: an IMF yearly outturn counts only once it would have been published. The April WEO
 * brings last year's figure, so on an As-of day from April on the newest year used is last year;
 * before April it is the year before that. IMF projections are never used (the projections made at
 * the time are not kept). The figures themselves are today's IMF vintage, so later revisions to
 * past years still show; every reading says so.
 *
 *   - Output gap: one-sided HP (lambda 100) and Hamilton filters on growth up to that year only
 *     (src/utils/outputGap.ts realTimeOutputGap); the reading is their average, both shown.
 *   - Debt: r - g, the debt-stabilising primary balance, and debt five years on at the last ten
 *     years' averages and under the combined shock (src/utils/debtSustainability.ts), all from
 *     outturns up to that year.
 *   - Fiscal multiplier: the IMF bucket range (src/utils/fiscalMultipliers.ts) from the diagnosis's
 *     own debt figure, policy rate and this output gap.
 *
 * Browser-safe.
 */
import type { Series } from './seriesHistory';
import type { DiagnosisFigure } from './reviewDiagnosis';
import { realTimeOutputGap } from './outputGap';
import { DSA_HORIZON, INTEREST_SHOCK_PTS, ROLLOVER_SHARE, debtSustainability, nextDebt, nominalGrowthPct } from './debtSustainability';
import { multiplierView } from './fiscalMultipliers';

export const MODEL_GROUP = 'Model readings (app estimates, data known by the As of day)';

export interface ReviewModelInputs {
  iso3: string;
  asOf: string;
  growth?: Series;
  debt?: Series;
  primaryBalance?: Series;
  overallBalance?: Series;
  inflation?: Series;
  /** The diagnosis's standard indicator figures (debt and policy rate are read from them). */
  figures: DiagnosisFigure[];
}

/** Newest IMF outturn year that would have been published by the As-of day. */
export function lastKnownYear(asOf: string): number {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7)) || 1;
  return m >= 4 ? y - 1 : y - 2;
}

/** Only outturn years up to the cut, projection notes dropped (none survive the cut anyway). */
export function cutSeries(s: Series | undefined, lastYear: number): Series | undefined {
  if (!s) return undefined;
  const points = s.points.filter((p) => Number(p.date) <= lastYear && p.note !== 'IMF projection');
  return points.length ? { ...s, points } : undefined;
}

const r2 = (v: number) => Number(v.toFixed(2));
const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

export function reviewModelFigures(inp: ReviewModelInputs): DiagnosisFigure[] {
  const cut = lastKnownYear(inp.asOf);
  const vintage = "today's IMF vintage of past years, so later revisions show";
  const start = inp.figures.length + 1;
  const out: DiagnosisFigure[] = [];
  const push = (field: string, label: string, unit: string, value: number | null, period: string, source: string, reason: string) =>
    out.push({ ref: start + out.length, field, group: MODEL_GROUP, label, unit, value: value === null ? null : r2(value), status: value === null ? 'Missing' : 'Live', period: value === null ? '' : period, source: value === null ? '' : source, reason: value === null ? reason : '' });

  // Output gap, one-sided.
  const growth = cutSeries(inp.growth, cut);
  const rt = realTimeOutputGap(growth?.points);
  const g = rt[rt.length - 1];
  const gap = g && String(cut) === g.year ? (g.hamilton !== undefined ? (g.hp100 + g.hamilton) / 2 : g.hp100) : null;
  push(
    'model.outputGapPct',
    'Output gap (app estimate)',
    '% of potential GDP',
    gap,
    String(cut),
    g ? `app estimate: one-sided HP lambda 100 ${g.hp100}${g.hamilton !== undefined ? ` and Hamilton ${g.hamilton}, averaged` : ''}, on IMF real GDP growth to ${cut}; ${vintage}` : '',
    !growth ? 'No saved IMF real GDP growth history (Menu > Offline data)' : `Needs unbroken IMF growth outturns to ${cut}; the filters need at least 15 years`,
  );

  // Debt dynamics on outturns to the cut.
  const dsa = debtSustainability({
    debt: cutSeries(inp.debt, cut),
    primaryBalance: cutSeries(inp.primaryBalance, cut),
    overallBalance: cutSeries(inp.overallBalance, cut),
    realGrowth: growth,
    inflation: cutSeries(inp.inflation, cut),
  });
  const dsaWhy = dsa.ok ? (dsa.missing[0] ? `Needs ${dsa.missing[0]}` : 'Not enough history') : dsa.reason;
  const dsaOk = dsa.ok && String(dsa.lastOutturnYear) === String(cut);
  const why = dsa.ok && !dsaOk ? `IMF debt outturns end ${dsa.lastOutturnYear}, before ${cut}` : dsaWhy;
  const src = `debt dynamics on IMF WEO and Fiscal Monitor outturns to ${cut}; CPI stands in for the GDP deflator; ${vintage}`;
  push('model.rMinusGPts', 'Interest rate less growth, r - g (10-year average)', 'percentage points', dsaOk && dsa.ok && dsa.rMinusG !== undefined ? dsa.rMinusG : null, `${cut - 9}-${cut}`, src, why);
  push('model.stabilisingPbPct', 'Debt-stabilising primary balance (10-year averages)', '% of GDP', dsaOk && dsa.ok && dsa.stabilisingPb !== undefined ? dsa.stabilisingPb : null, String(cut), src, why);
  const hist = dsaOk && dsa.ok ? dsa.scenarios.find((s) => s.id === 'historical') : undefined;
  const endYear = String(cut + DSA_HORIZON);
  push('model.debtHistoricalPct', `Government debt in ${endYear} at 10-year averages`, '% of GDP', hist ? hist.end : null, endYear, `${src}; growth, inflation, interest and primary balance held at their averages`, why);
  let combined: number | null = null;
  if (dsaOk && dsa.ok && hist) {
    const recent = dsa.history.slice(-10);
    const avgOf = (k: 'realGrowthPct' | 'inflationPct' | 'primaryBalance') => recent.reduce((s, h) => s + h[k], 0) / recent.length;
    const is = recent.map((h) => h.interestPct).filter((v): v is number => v !== undefined);
    const avgI = is.reduce((s, v) => s + v, 0) / is.length;
    const sG = sd(recent.map((h) => h.realGrowthPct));
    const sPb = sd(recent.map((h) => h.primaryBalance));
    let d = dsa.debtNow;
    for (let k = 0; k < DSA_HORIZON; k++) {
      const gk = avgOf('realGrowthPct') - (k < 2 ? sG : 0);
      const pb = avgOf('primaryBalance') - (k < 2 ? sPb / 2 : 0);
      const i = avgI + INTEREST_SHOCK_PTS * Math.min(1, ROLLOVER_SHARE * (k + 1));
      d = nextDebt(d, i, nominalGrowthPct(gk, avgOf('inflationPct')), pb);
    }
    combined = d;
  }
  push('model.debtCombinedShockPct', `Government debt in ${endYear}, combined shock`, '% of GDP', combined, endYear, `${src}; growth 1 s.d. lower and primary balance 1/2 s.d. lower in years 1-2, interest up to ${INTEREST_SHOCK_PTS} pts higher as debt rolls over`, why);

  // Fiscal multiplier from the diagnosis's own debt and policy rate.
  const debtFig = inp.figures.find((f) => f.field === 'imf.debtToGdpPct');
  const rateFig = inp.figures.find((f) => f.field === 'market.policyRatePct');
  const mv = multiplierView({
    iso3: inp.iso3,
    ...(debtFig?.value !== null && debtFig?.value !== undefined ? { debtPctGdp: { value: debtFig.value, year: debtFig.period } } : {}),
    ...(gap !== null ? { outputGap: { pct: r2(gap), year: String(cut), source: 'estimate' as const } } : {}),
    ...(rateFig?.value !== null && rateFig?.value !== undefined ? { policyRatePct: rateFig.value } : {}),
  });
  const mSrc = `reference range, not an estimate: IMF bucket approach (Batini et al. 2014, IMF TNM 14/04, Table 6), ${mv.guide.bucket} bucket for ${mv.group === 'advanced' ? 'an advanced economy' : 'an emerging market'}, normal times`;
  push('model.multiplierLow', 'Fiscal multiplier, first year, low end', 'ratio', mv.guide.low, 'reference', mSrc, '');
  push('model.multiplierHigh', 'Fiscal multiplier, first year, high end', 'ratio', mv.guide.high, 'reference', mSrc, '');
  return out;
}
