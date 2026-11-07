import type { CouncilAssessmentRun, SupremeCouncilOutput } from '../types/council';

/**
 * The council's final report, only when an AI model wrote it in a council run. Every country starts
 * with a built-in report (template text and a verdict) that the older desks still read; it is not a
 * result and must not appear in memos, notes or briefs as one.
 */
/** What a council report field shows when the model wrote nothing for it: never built-in text. */
export const MODEL_FIELD_MISSING = 'Missing: model gave no answer for this field.';
/** A placeholder a model writes instead of an answer ("NA", "N/A", "none", "-"): treated as no answer. */
export const isModelPlaceholder = (v: string): boolean => /^\s*(n\/?a|none|null|nil|-+|tbd|unknown)\.?\s*$/i.test(v);

/** Drawdown and liquidity haircut: nothing in the app estimates them, so they are never a built-in number. */
export const RISK_ESTIMATE_MISSING = 'Missing (the app does not estimate this yet)';

/** A risk-check percentage, or Missing with the reason. */
export function riskPctText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v}%` : RISK_ESTIMATE_MISSING;
}

/** The risk check's approval in plain words, or Missing when the model gave none. */
export function approvalText(v: string | null | undefined): string {
  return v ? v.replace(/_/g, ' ').toLowerCase() : 'missing (the model gave no approval)';
}

/** Decision triggers: the council does not set them yet, so none are ever built in. */
export const TRIGGERS_MISSING = 'Missing (the council does not set decision triggers yet)';

/** A ticket's direction or conviction in plain words, or Missing when the model gave none. */
export function ticketCallText(v: string | null | undefined): string {
  return v ? v.replace(/_/g, ' ').toLowerCase() : 'missing';
}

/** A ticket's portfolio weight, or Missing: nothing in the app sizes trades yet. */
export function sizingText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v}%` : 'Missing (the app does not size trades yet)';
}

/** Shown where the council's agreement would go: nothing in the app measures it, so it is never a built-in number. */
export const COHERENCE_MISSING = 'Missing (the council does not measure agreement yet)';

/** The council's agreement as a percentage, or Missing with the reason. */
export function coherenceText(sc: Pick<SupremeCouncilOutput, 'globalCoherenceScore'> | null | undefined): string {
  const v = sc?.globalCoherenceScore;
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : COHERENCE_MISSING;
}

/** The composite risk score as "0.62 / 1.00" (or out of 100), or Missing when there is no report. */
export function compositeText(sc: Pick<SupremeCouncilOutput, 'compositeRiskScore'> | null | undefined, outOf: 1 | 100 = 1): string {
  const v = sc?.compositeRiskScore;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Missing (no council report yet)';
  return outOf === 100 ? `${Math.round(v * 100)}/100` : `${v.toFixed(2)} / 1.00`;
}

export function modelCouncil(run: Pick<CouncilAssessmentRun, 'supremeCouncil'> | null | undefined): SupremeCouncilOutput | undefined {
  const sc = run?.supremeCouncil;
  return sc && sc.fromModel === true ? sc : undefined;
}
