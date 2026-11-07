import React, { useState } from 'react';
import { CheckCircle2, Circle, PauseCircle } from 'lucide-react';
import type { CROOverrideState, CounterfactualShockConfig } from '../types/council';

type ScoreKey = 'geopoliticalRiskScore' | 'sovereignRiskScore' | 'macroRiskScore' | 'politicalWillIndex';
type FixedKey = 'energyInflationShockPct' | 'debtServicingSpreadBps' | 'fxReserveAdequacyMonths';
type ShockKey = keyof CounterfactualShockConfig;

interface Edit {
  min: number;
  max: number;
  step: number;
}

export interface Assumption {
  id: string;
  label: string;
  fmt: (v: number) => string;
  get: (s: CROOverrideState) => number;
  set?: (s: CROOverrideState, v: number) => CROOverrideState;
  /** Present when the reviewer may change it (the same ranges as the full review page). */
  edit?: Edit;
}

const score = (key: ScoreKey, label: string, edit: Edit, fmt = (v: number) => v.toFixed(2)): Assumption => ({
  id: key,
  label,
  fmt,
  get: (s) => s[key],
  set: (s, v) => ({ ...s, [key]: v, isOverridden: true }),
  edit,
});
const fixed = (key: FixedKey, label: string, fmt: (v: number) => string): Assumption => ({ id: key, label, fmt, get: (s) => s[key] });
const shock = (key: ShockKey, label: string, edit: Edit, fmt: (v: number) => string): Assumption => ({
  id: key,
  label,
  fmt,
  get: (s) => s.counterfactualShocks?.[key] ?? 0,
  set: (s, v) => ({ ...s, counterfactualShocks: { ...s.counterfactualShocks, [key]: v }, isOverridden: true }),
  edit,
});
const RISK: Edit = { min: 0.1, max: 0.98, step: 0.01 };

/** What the reviewer approves, in plain words. */
export const APPROVAL_ASSUMPTIONS: Assumption[] = [
  score('geopoliticalRiskScore', 'Geopolitical risk score', RISK),
  score('sovereignRiskScore', 'Sovereign credit risk score', RISK),
  score('macroRiskScore', 'Macro risk score', RISK),
  score('politicalWillIndex', 'Political will to adjust (0 to 100)', { min: 5, max: 95, step: 1 }, (v) => v.toFixed(0)),
  fixed('energyInflationShockPct', 'Energy price shock (from the desks)', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`),
  fixed('debtServicingSpreadBps', 'Extra borrowing cost (from the desks)', (v) => `${v >= 0 ? '+' : ''}${Math.round(v)} bps`),
  fixed('fxReserveAdequacyMonths', 'FX reserves (from the desks)', (v) => `${v.toFixed(1)} months of imports`),
  shock('brentCrudeShockUsd', 'What-if: oil price up', { min: 0, max: 40, step: 5 }, (v) => `+$${v.toFixed(0)} a barrel`),
  shock('fedTerminalRateShockBps', 'What-if: US rates higher', { min: 0, max: 150, step: 25 }, (v) => `+${v.toFixed(0)} bps`),
  shock('chokepointTransitDropPct', 'What-if: shipping lanes disrupted', { min: 0, max: 60, step: 10 }, (v) => `${v.toFixed(0)}% less traffic`),
  shock('domesticFiscalSlippagePctGdp', 'What-if: budget slips', { min: 0, max: 3, step: 0.5 }, (v) => `${v.toFixed(1)}% of GDP`),
];

/** Assumptions the reviewer changed from the desks' own figures. */
export function changedAssumptions(desk: CROOverrideState, draft: CROOverrideState): string[] {
  return APPROVAL_ASSUMPTIONS.filter((a) => Math.abs(a.get(desk) - a.get(draft)) > 1e-9).map((a) => a.id);
}

const STEPS = ['Desk debates', 'Knock-on effects', 'Your review', 'Final report'];

/**
 * The council's pause for the reviewer, in plain words, with the assumptions editable in place.
 * Shown inside Council chat on Today, and at the top of other pages so it is never missed.
 */
export const CouncilApprovalCard: React.FC<{
  countryName: string;
  /** The desks' own assumptions, as the pipeline left them. */
  deskState: CROOverrideState;
  /** The reviewer's working copy. */
  draft: CROOverrideState;
  isApproving: boolean;
  onApprove: () => void;
  onChangeDraft: (next: CROOverrideState) => void;
  /** Opens the full review page, when it is available in this view. */
  onOpenFullReview?: () => void;
  /** On other pages: a link back to the conversation on Today. */
  onOpenConversation?: () => void;
}> = ({ countryName, deskState, draft, isApproving, onApprove, onChangeDraft, onOpenFullReview, onOpenConversation }) => {
  const [editing, setEditing] = useState(false);
  const changed = new Set(changedAssumptions(deskState, draft));
  return (
    <section
      role="region"
      aria-label="Council paused for your approval"
      data-council-approval="true"
      className="border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <PauseCircle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your approval is needed: the {countryName} council is paused</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The desks have debated and the knock-on effects are worked out. Check the assumptions, change any you disagree with, then approve to write the final report. Nothing goes to the final step until you approve.
          </p>
        </div>
      </div>

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Council steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === 2 ? 'step' : undefined}
            className={`flex items-center gap-1 ${i === 2 ? 'font-medium text-amber-800 dark:text-amber-300' : i < 2 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}
          >
            {i < 2 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : i === 2 ? <PauseCircle className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            {i + 1}. {s}
            {i === 2 && ' (now)'}
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {APPROVAL_ASSUMPTIONS.map((a) => {
          const v = a.get(draft);
          return (
            <div key={a.id} className="border-b border-amber-200/70 dark:border-amber-900/60 py-0.5" data-assumption={a.id}>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">{a.label}</dt>
                <dd className="tabular-nums text-slate-900 dark:text-white text-right">{a.fmt(v)}</dd>
              </div>
              {editing && a.edit && a.set && (
                <input
                  type="range"
                  aria-label={a.label}
                  min={a.edit.min}
                  max={a.edit.max}
                  step={a.edit.step}
                  value={v}
                  onChange={(e) => onChangeDraft(a.set!(draft, Number(e.target.value)))}
                  className="w-full accent-amber-600"
                />
              )}
              {changed.has(a.id) && <div className="text-xs text-amber-800 dark:text-amber-300 text-right">changed by you, desks said {a.fmt(a.get(deskState))}</div>}
            </div>
          );
        })}
      </dl>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {changed.size ? `You changed ${changed.size} of the desks' assumptions. The final report is built on your figures.` : 'These are the desks’ own figures. You have not changed any.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn ui-btn-primary" onClick={onApprove} disabled={isApproving}>
          {isApproving ? 'Writing the final report…' : changed.size ? 'Approve my changes and write the final report' : 'Approve and write the final report'}
        </button>
        <button type="button" className="ui-btn" onClick={() => setEditing((e) => !e)} disabled={isApproving} aria-expanded={editing}>
          {editing ? 'Done changing' : 'Change assumptions'}
        </button>
        {changed.size > 0 && (
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onChangeDraft({ ...deskState })} disabled={isApproving}>
            Back to the desks’ figures
          </button>
        )}
        {onOpenFullReview && (
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onOpenFullReview} disabled={isApproving}>
            Full review page
          </button>
        )}
        {onOpenConversation && (
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onOpenConversation}>
            Open in Council chat
          </button>
        )}
      </div>
    </section>
  );
};
