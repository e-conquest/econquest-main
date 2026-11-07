/**
 * Evidence grade: how a pre-registered pass, the multiple-testing correction and the forward record
 * combine into the one label a model or signal carries (gap analysis R1 + N3, Sam 2026-11-07).
 *
 * The recorded verdict (passed / failed / too few cases) is never changed. The grade sits on top of
 * it and follows practice that model-validation and quant research teams use:
 *
 * - Pre-registered test, judged once (no re-tuning after a fail): the signal standard, rules 1-4.
 * - Multiple testing: a pass counts as Validated only when it still holds after the Holm (1979)
 *   correction across every test on record (Harvey, Liu and Zhu 2016, "... and the Cross-Section of
 *   Expected Returns": a single-test p of 0.05 is too lax once many rules have been tried).
 * - Out-of-sample confirmation: a pass that does not survive the correction is Provisional. It can
 *   still earn Validated from 24 months of forward record (calls written down before the outcome)
 *   that beat the test's own base rate with a one-sided binomial p at or under 0.05.
 * - Ongoing monitoring with a traffic light, as in the Basel backtesting zones (BCBS 1996) and the
 *   ongoing-monitoring and outcomes-analysis parts of the Fed/OCC guidance on model risk (SR 11-7,
 *   2011): once 12 or more forward calls are scored, a hit rate below the base rate puts the label
 *   Under review (amber), and one significantly below it (one-sided p at or under 0.05) Withdraws it
 *   (red) until a new pre-registered version passes.
 * - Periodic revalidation (SR 11-7): a pass whose test last ran more than 12 months ago reads
 *   Review due until it is run again.
 * - Backtest figures are hypothetical: every grade's text says so and says the result is net of the
 *   registered costs where the test has costs (the way the SEC marketing rule and GIPS treat
 *   hypothetical performance).
 *
 * Browser-safe, pure.
 */
import type { ValidationStatus } from '../data/modelRegister';
import type { ForwardSummary } from './forwardRecord';
import type { HolmReading } from './multipleTesting';

export type EvidenceGrade = 'validated' | 'provisional' | 'under_review' | 'review_due' | 'withdrawn';

export const GRADE_LABEL: Record<EvidenceGrade, string> = {
  validated: 'Validated',
  provisional: 'Provisional pass',
  under_review: 'Under review',
  review_due: 'Review due',
  withdrawn: 'Withdrawn',
};

/** Badge tone: green, amber or red (the Basel traffic-light reading). */
export const GRADE_TONE: Record<EvidenceGrade, 'positive' | 'warning' | 'negative'> = {
  validated: 'positive',
  provisional: 'warning',
  under_review: 'warning',
  review_due: 'warning',
  withdrawn: 'negative',
};

/** The thresholds of the policy, fixed here so the methods note and the tests read the same numbers. */
export const GRADE_POLICY = {
  /** Months of forward record that can promote a Provisional pass. */
  promoteMonths: 24,
  /** Scored forward calls needed before the record can promote, flag or withdraw. */
  minForwardScored: 12,
  /** One-sided binomial p for promotion (beats the base rate) and withdrawal (falls short of it). */
  alpha: 0.05,
  /** Months after the last run before a pass needs to be run again. */
  reviewMonths: 12,
} as const;

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialUpper(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const q = Math.min(1, Math.max(0, p));
  if (q === 0) return 0;
  if (q === 1) return 1;
  let term = Math.pow(1 - q, n); // P(X = 0)
  let cdfBelow = 0;
  for (let i = 0; i < k; i++) {
    cdfBelow += term;
    term = (term * (n - i) * q) / ((i + 1) * (1 - q));
  }
  return Math.min(1, Math.max(0, 1 - cdfBelow));
}

/** P(X <= k) for X ~ Binomial(n, p). */
export function binomialLower(k: number, n: number, p: number): number {
  return k >= n ? 1 : 1 - binomialUpper(k + 1, n, p);
}

const monthsBetween = (fromIso: string, to: Date) => (to.getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24 * 30.44);

export interface GradeInput {
  /** The recorded verdict (or the register's own status when no test has run). */
  status: ValidationStatus;
  /** When the test behind the verdict last ran (ISO). */
  ranAt?: string;
  /** The Holm reading for that test version. */
  holm?: HolmReading;
  /** Forward record for that test version. */
  forward?: ForwardSummary;
  /** Test with trading costs (currency signals): the text says "net of the registered costs". */
  netOfCosts?: boolean;
  now?: Date;
}

export interface GradeReading {
  grade: EvidenceGrade;
  label: string;
  tone: 'positive' | 'warning' | 'negative';
  /** One or two sentences: why this grade, and what would change it. */
  why: string;
  /** One-sided binomial p of the forward record against its base rate, when it was read. */
  forwardP?: { above: number; below: number };
}

/**
 * The grade for a test that passed; null for any other verdict (failed, too few cases, not tested
 * and descriptive keep their own labels).
 */
export function evidenceGrade(input: GradeInput): GradeReading | null {
  if (input.status !== 'passed') return null;
  const now = input.now ?? new Date();
  const P = GRADE_POLICY;
  const hypo = `Backtest figures are hypothetical${input.netOfCosts ? ', net of the registered costs' : ''}.`;
  const out = (grade: EvidenceGrade, why: string, forwardP?: GradeReading['forwardP']): GradeReading => ({
    grade,
    label: GRADE_LABEL[grade],
    tone: GRADE_TONE[grade],
    why: `${why} ${hypo}`,
    ...(forwardP ? { forwardP } : {}),
  });

  const f = input.forward;
  let forwardP: GradeReading['forwardP'] | undefined;
  let fwdMonths = 0;
  if (f && f.scored >= P.minForwardScored && f.baseRatePct !== null) {
    const base = f.baseRatePct / 100;
    forwardP = { above: Number(binomialUpper(f.hits, f.scored, base).toPrecision(3)), below: Number(binomialLower(f.hits, f.scored, base).toPrecision(3)) };
    fwdMonths = monthsBetween(f.since, now);
  }
  const fwdText = f && forwardP ? `Forward record: ${f.hits} of ${f.scored} scored calls followed (${f.hitRatePct}% against a base rate of ${f.baseRatePct}%)` : '';

  // Monitoring first: a forward record that falls short overrides any in-sample pass.
  if (f && forwardP && forwardP.below <= P.alpha)
    return out('withdrawn', `${fwdText}, significantly below the base rate (one-sided p ${forwardP.below}). Withdrawn until a new pre-registered version passes.`, forwardP);
  if (f && forwardP && f.hitRatePct !== null && f.baseRatePct !== null && f.hitRatePct < f.baseRatePct)
    return out('under_review', `${fwdText}, below the base rate but not significantly (one-sided p ${forwardP.below}). Withdrawn if it falls significantly below; back to its earlier grade if it recovers.`, forwardP);

  if (input.ranAt && monthsBetween(input.ranAt, now) > P.reviewMonths)
    return out('review_due', `The test last ran on ${input.ranAt.slice(0, 10)}, more than ${P.reviewMonths} months ago. Run it again (Menu > Models & validation) to keep the grade.`, forwardP);

  const h = input.holm;
  if (h?.holds) return out('validated', `Passed its pre-registered test and still holds after correcting for the ${h.tested} tests on record (Holm-adjusted p ${h.adjusted}, pass mark ${h.alpha}).`, forwardP);

  if (f && forwardP && fwdMonths >= P.promoteMonths && forwardP.above <= P.alpha)
    return out('validated', `Passed alone but not after correcting for the tests on record; validated by ${Math.floor(fwdMonths)} months of forward record: ${f.hits} of ${f.scored} calls followed (${f.hitRatePct}% against ${f.baseRatePct}%, one-sided p ${forwardP.above}).`, forwardP);

  const holmText = h ? `Passed alone (raw p ${Number(h.p.toPrecision(3))}) but not after correcting for the ${h.tested} tests on record (Holm-adjusted p ${h.adjusted}, pass mark ${h.alpha}).` : 'Passed its pre-registered test; the correction across all tests on record has not been read yet.';
  return out('provisional', `${holmText} It becomes Validated after ${P.promoteMonths} months of forward record that beat the base rate (one-sided p at or under ${P.alpha}, at least ${P.minForwardScored} scored calls).`, forwardP);
}
