/**
 * Exercises with answer keys (seven-groups plan, Phase 5, teaching): questions whose answers are
 * worked out from the app's own series at a date the teacher or student picks, with the tolerance
 * an answer must fall within and the workings.
 *
 *   Real policy rate   BIS policy rate at the end of the month less monthly inflation (y/y)
 *   Taylor rule        Taylor (1993): r* + inflation + 0.5 (inflation - target) + 0.5 output gap,
 *                      with r* = 2 and the bank's current published target, both given in the question
 *   r minus g          10Y government bond yield (December) less nominal GDP growth
 *                      ((1 + real growth)(1 + inflation) - 1, IMF WEO) for the year
 *   Debt change        government debt ratio this year less last year (IMF WEO)
 *
 * A question whose inputs are not on file is not set; it is listed with why. IMF projections are
 * never used. Description, not a tested signal. Browser-safe, pure.
 */
import type { Series, SeriesPoint } from './seriesHistory';

export type ExerciseId = 'real_rate' | 'taylor' | 'r_minus_g' | 'debt_change';

export interface ExerciseInput {
  label: string;
  value: number;
  unit: string;
  when: string;
  source: string;
}

export interface Exercise {
  id: ExerciseId;
  question: string;
  /** Series the student should read, in words (the values are in the key). */
  hint: string;
  answer: number;
  unit: string;
  tolerance: number;
  inputs: ExerciseInput[];
  workings: string;
}

export interface ExerciseSet {
  exercises: Exercise[];
  notSet: Array<{ id: ExerciseId; reason: string }>;
}

export const TAYLOR_R_STAR = 2;
const r2 = (v: number) => Math.round(v * 100) / 100;
const real = (s: Series | undefined) => (s?.points || []).filter((p) => Number.isFinite(p.value) && p.note !== 'IMF projection');

/** The last observation in a month (YYYY-MM), for daily or monthly series. */
export function inMonth(s: Series | undefined, month: string): SeriesPoint | undefined {
  const pts = real(s).filter((p) => String(p.date).slice(0, 7) === month);
  return pts[pts.length - 1];
}
/** A yearly value (YYYY), or the December value of a monthly or daily series. */
export function inYear(s: Series | undefined, year: string): SeriesPoint | undefined {
  const pts = real(s);
  const exact = pts.find((p) => String(p.date) === year);
  if (exact) return exact;
  const dec = pts.filter((p) => String(p.date).slice(0, 7) === `${year}-12`);
  return dec[dec.length - 1];
}

const inp = (s: Series, p: SeriesPoint, label = s.label): ExerciseInput => ({ label, value: p.value, unit: s.unit || '', when: String(p.date), source: s.source });

export interface ExerciseArgs {
  countryName: string;
  /** YYYY-MM for the real rate; the year is taken from it for the yearly questions. */
  month: string;
  series: Partial<Record<'policy_rate' | 'cpi_monthly' | 'cpi_imf' | 'output_gap' | 'yield_10y' | 'gdp_growth' | 'debt_gdp', Series>>;
  /** The central bank's current published inflation target, %, when the app has one. */
  target?: { pct: number; bank: string };
}

export function buildExercises(a: ExerciseArgs): ExerciseSet {
  const out: Exercise[] = [];
  const notSet: ExerciseSet['notSet'] = [];
  const year = a.month.slice(0, 4);
  const s = a.series;
  const name = a.countryName;

  // Real policy rate.
  const pol = inMonth(s.policy_rate, a.month);
  const cpiM = inMonth(s.cpi_monthly, a.month);
  if (s.policy_rate && s.cpi_monthly && pol && cpiM) {
    out.push({
      id: 'real_rate',
      question: `What was ${name}'s real policy rate at the end of ${a.month}, using the policy rate less inflation over the previous 12 months?`,
      hint: 'Read the BIS policy rate for the end of the month and the monthly inflation figure for the same month in History.',
      answer: r2(pol.value - cpiM.value),
      unit: 'percentage points',
      tolerance: 0.1,
      inputs: [inp(s.policy_rate, pol), inp(s.cpi_monthly, cpiM)],
      workings: `${r2(pol.value)} - ${r2(cpiM.value)} = ${r2(pol.value - cpiM.value)}`,
    });
  } else notSet.push({ id: 'real_rate', reason: `${!pol ? 'no policy rate' : 'no monthly inflation'} on file for ${a.month}` });

  // Taylor rule.
  const pi = inYear(s.cpi_imf, year);
  const gap = inYear(s.output_gap, year);
  const polY = inYear(s.policy_rate, year);
  if (a.target && s.cpi_imf && s.output_gap && pi && gap) {
    const t = TAYLOR_R_STAR + pi.value + 0.5 * (pi.value - a.target.pct) + 0.5 * gap.value;
    const inputs = [inp(s.cpi_imf, pi), inp(s.output_gap, gap), { label: `Inflation target (${a.target.bank}, current)`, value: a.target.pct, unit: '%', when: 'current', source: 'central bank, as given in the question' }];
    out.push({
      id: 'taylor',
      question: `Using the Taylor (1993) rule with a neutral real rate of ${TAYLOR_R_STAR}% and an inflation target of ${a.target.pct}%, what policy rate does the rule give for ${name} in ${year}?`,
      hint: 'Rule: neutral real rate + inflation + 0.5 x (inflation - target) + 0.5 x output gap. Use the IMF WEO inflation and output gap for the year.',
      answer: r2(t),
      unit: '%',
      tolerance: 0.1,
      inputs: polY && s.policy_rate ? [...inputs, inp(s.policy_rate, polY, 'Policy rate at the end of the year (to compare)')] : inputs,
      workings: `${TAYLOR_R_STAR} + ${r2(pi.value)} + 0.5 x (${r2(pi.value)} - ${a.target.pct}) + 0.5 x ${r2(gap.value)} = ${r2(t)}${polY ? `; the actual policy rate at the end of ${year} was ${r2(polY.value)}%, ${r2(polY.value - t)} points ${polY.value >= t ? 'above' : 'below'} the rule` : ''}`,
    });
  } else notSet.push({ id: 'taylor', reason: !a.target ? 'the app has no inflation target for this country' : `${!pi ? 'no IMF inflation' : 'no IMF output gap'} for ${year}` });

  // r minus g.
  const y10 = inYear(s.yield_10y, year);
  const g = inYear(s.gdp_growth, year);
  if (s.yield_10y && s.gdp_growth && s.cpi_imf && y10 && g && pi) {
    const nominal = ((1 + g.value / 100) * (1 + pi.value / 100) - 1) * 100;
    out.push({
      id: 'r_minus_g',
      question: `Taking the 10-year government bond yield at the end of ${year} as r and nominal GDP growth as g, what was r minus g for ${name} in ${year}?`,
      hint: 'Nominal growth = (1 + real growth) x (1 + inflation) - 1, from the IMF WEO; r is the 10Y yield in December.',
      answer: r2(y10.value - nominal),
      unit: 'percentage points',
      tolerance: 0.2,
      inputs: [inp(s.yield_10y, y10), inp(s.gdp_growth, g), inp(s.cpi_imf, pi)],
      workings: `g = (1 + ${r2(g.value)}/100) x (1 + ${r2(pi.value)}/100) - 1 = ${r2(nominal)}%; r - g = ${r2(y10.value)} - ${r2(nominal)} = ${r2(y10.value - nominal)}`,
    });
  } else notSet.push({ id: 'r_minus_g', reason: `${!y10 ? 'no 10Y yield for December' : !g ? 'no IMF real growth' : 'no IMF inflation'} ${year}` });

  // Debt change.
  const d1 = inYear(s.debt_gdp, year);
  const d0 = inYear(s.debt_gdp, String(Number(year) - 1));
  if (s.debt_gdp && d1 && d0) {
    out.push({
      id: 'debt_change',
      question: `By how many points of GDP did ${name}'s government debt ratio change from ${Number(year) - 1} to ${year}?`,
      hint: 'Read the IMF WEO government debt ratio for both years.',
      answer: r2(d1.value - d0.value),
      unit: 'points of GDP',
      tolerance: 0.2,
      inputs: [inp(s.debt_gdp, d0), inp(s.debt_gdp, d1)],
      workings: `${r2(d1.value)} - ${r2(d0.value)} = ${r2(d1.value - d0.value)}`,
    });
  } else notSet.push({ id: 'debt_change', reason: `no IMF debt ratio for ${!d1 ? year : Number(year) - 1}` });

  return { exercises: out, notSet };
}

/** Whether an answer is within the exercise's tolerance. */
export function checkAnswer(ex: Pick<Exercise, 'answer' | 'tolerance'>, given: number): boolean {
  return Number.isFinite(given) && Math.abs(given - ex.answer) <= ex.tolerance + 1e-9;
}

export const EXERCISES_METHOD = `Answers are worked out from the app's own series at the date picked: real policy rate (BIS policy rate at the end of the month less monthly inflation y/y), the Taylor (1993) rule (neutral real rate ${TAYLOR_R_STAR}%, the bank's current published target, IMF WEO inflation and output gap), r minus g (December 10Y yield less nominal GDP growth from IMF WEO real growth and inflation) and the change in the government debt ratio. An answer counts as right within the stated tolerance. A question whose inputs are not on file is not set. IMF projections are never used. The current inflation target is used for past years too, as the question says.`;
