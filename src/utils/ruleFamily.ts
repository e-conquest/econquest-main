/**
 * Policy rule family: the policy rate against five standard rules on the same inputs, so a reader
 * sees the range of what simple rules prescribe instead of one number. The rules follow the set the
 * Federal Reserve shows in its Monetary Policy Report (Taylor 1993, balanced approach, inertial,
 * first difference) plus an inflation-only rule for when no output gap is held.
 *
 *   Taylor (1993):       r* + pi + 0.5 (pi - pi*) + 0.5 gap
 *   Balanced approach:   r* + pi + 0.5 (pi - pi*) + 1.0 gap
 *   Inflation only:      r* + pi + 0.5 (pi - pi*)
 *   Inertial:            0.85 x current rate + 0.15 x Taylor (1993)
 *   First difference:    current rate + 0.5 (pi - pi*) + 0.5 x (change in the gap over a year)
 *
 * pi = latest monthly inflation (% y/y), pi* = the bank's stated target, gap = output gap (IMF where
 * it publishes one, else the app's own estimate, labelled), r* = 2% real as in Taylor (1993). r* is
 * not data; each point lower moves the level rules down one point, the inertial rule 0.15, and the
 * first-difference rule not at all. Rules needing the gap are Missing without it.
 *
 * Stated rules on sourced figures: a cross-check of stance, not a forecast of the next move.
 *
 * Browser-safe.
 */
import { TAYLOR_BAND_PTS, TAYLOR_R_STAR } from './taylorRule';

export const INERTIA = 0.85;

export type RuleId = 'taylor1993' | 'balanced' | 'inflation_only' | 'inertial' | 'first_difference';

export interface RuleRow {
  id: RuleId;
  label: string;
  formula: string;
  /** Prescribed rate, %; absent with a reason when an input is missing. */
  pct?: number;
  missing?: string;
  /** Policy rate minus the rule; positive = tighter than the rule. */
  gapPts?: number;
}

export interface RuleFamilyInputs {
  policyPct?: number;
  inflation?: { pct: number; month: string };
  targetPct?: number;
  gap?: { pct: number; year: string; prevPct?: number; source: 'imf' | 'estimate' };
  rStar?: number;
}

export interface RuleFamily {
  ok: true;
  rows: RuleRow[];
  policyPct: number;
  /** Lowest and highest prescription across the rules that ran. */
  range: { lo: number; hi: number };
  /** Where the policy rate sits against that range. */
  position: 'above the range' | 'below the range' | 'inside the range';
  rStar: number;
  inputs: RuleFamilyInputs;
}

export type RuleFamilyOutcome = RuleFamily | { ok: false; missing: string[] };

const r2 = (v: number) => Number(v.toFixed(2));

export function ruleFamily(inp: RuleFamilyInputs): RuleFamilyOutcome {
  const missing: string[] = [];
  if (inp.policyPct === undefined || !Number.isFinite(inp.policyPct)) missing.push('the BIS policy rate');
  if (!inp.inflation || !Number.isFinite(inp.inflation.pct)) missing.push('monthly inflation');
  if (inp.targetPct === undefined) missing.push("the central bank's inflation target");
  if (missing.length) return { ok: false, missing };
  const i = inp.policyPct!;
  const pi = inp.inflation!.pct;
  const piGap = pi - inp.targetPct!;
  const rs = inp.rStar ?? TAYLOR_R_STAR;
  const g = inp.gap && Number.isFinite(inp.gap.pct) ? inp.gap : undefined;
  const noGap = 'No output gap for this country';

  const base = rs + pi + 0.5 * piGap;
  const taylor = g ? base + 0.5 * g.pct : undefined;
  const rows: RuleRow[] = [
    { id: 'taylor1993', label: 'Taylor (1993)', formula: 'r* + pi + 0.5(pi - target) + 0.5 gap', ...(taylor !== undefined ? { pct: r2(taylor) } : { missing: noGap }) },
    { id: 'balanced', label: 'Balanced approach', formula: 'r* + pi + 0.5(pi - target) + 1.0 gap', ...(g ? { pct: r2(base + g.pct) } : { missing: noGap }) },
    { id: 'inflation_only', label: 'Inflation only', formula: 'r* + pi + 0.5(pi - target)', pct: r2(base) },
    { id: 'inertial', label: 'Inertial', formula: `${INERTIA} x current rate + ${r2(1 - INERTIA)} x Taylor (1993)`, ...(taylor !== undefined ? { pct: r2(INERTIA * i + (1 - INERTIA) * taylor) } : { missing: noGap }) },
    {
      id: 'first_difference',
      label: 'First difference',
      formula: 'current rate + 0.5(pi - target) + 0.5 x change in gap over a year',
      ...(g && g.prevPct !== undefined && Number.isFinite(g.prevPct) ? { pct: r2(i + 0.5 * piGap + 0.5 * (g.pct - g.prevPct)) } : { missing: g ? 'No output gap for the year before' : noGap }),
    },
  ];
  for (const r of rows) if (r.pct !== undefined) r.gapPts = r2(i - r.pct);
  const vals = rows.map((r) => r.pct).filter((v): v is number => v !== undefined);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const position = i > hi + TAYLOR_BAND_PTS ? 'above the range' : i < lo - TAYLOR_BAND_PTS ? 'below the range' : 'inside the range';
  return { ok: true, rows, policyPct: i, range: { lo: r2(lo), hi: r2(hi) }, position, rStar: rs, inputs: inp };
}

export function ruleFamilySentence(r: RuleFamily, name: string): string {
  const ran = r.rows.filter((x) => x.pct !== undefined).length;
  const where =
    r.position === 'inside the range'
      ? 'within a point of the range, so no rule clearly calls for a move'
      : r.position === 'above the range'
        ? 'more than a point above every rule: tight on all of them'
        : 'more than a point below every rule: loose on all of them';
  return `${name}: the policy rate of ${r.policyPct.toFixed(2)}% against ${ran} rule${ran === 1 ? '' : 's'} prescribing ${r.range.lo.toFixed(2)}-${r.range.hi.toFixed(2)}% (r* ${r.rStar}%) is ${where}.`;
}

export const RULE_FAMILY_METHOD = `Five stated rules on the same inputs: latest monthly inflation, the bank's target, the output gap (IMF, else the app's estimate) and r* ${TAYLOR_R_STAR}% (Taylor 1993). Inertial weight ${INERTIA}. Each point lower r* lowers the level rules one point and the inertial rule 0.15.`;
