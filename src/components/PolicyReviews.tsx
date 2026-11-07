import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Download, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { REVIEW_STEPS, STEP_HINT, STEP_LABEL, STEP_STATE_LABEL, type PolicyReview, type ReviewFrame, type ReviewStep, type ReviewSummary, type StepState } from '../utils/policyReview';
import { GOAL_INDICATORS, type Diagnosis, type DiagnosisFigure } from '../utils/reviewDiagnosis';
import type { EvidenceStep } from '../utils/reviewEvidence';
import { defaultMemoInputs, memoFileName, RESEARCH_BANNER, VALIDATED_BANNER, type MemoInputs, type MemoStep } from '../utils/reviewMemo';
import { saveFile } from '../utils/briefExport';
import { SignOffControl, refreshSignOffs } from './SignOffControl';
import { GOAL_MOVE_LABEL, type OutcomesStep } from '../utils/reviewOutcomes';
import { START_REVIEW_EVENT, takeReviewPrefill } from '../utils/reviewHandoff';
import { LENSES, LENS_LABEL, LEVER_LABEL, MAX_USER_OPTIONS, type OptionsStep, type PolicyOption, type UserOption } from '../utils/reviewOptions';
import { withNotice } from '../utils/disclaimer';

/**
 * Reports > Policy reviews: a guided, repeatable case file for one country and one problem.
 * Frame > Diagnose > Options > Evidence > Memo > Outcomes; every step saved, hashed and audited.
 * See docs/POLICY_REVIEW.md. Kept on this computer in data/local/reviews.json.
 */

type Country = { iso3: string; countryName: string };
type Opened = { review: PolicyReview; states: Record<ReviewStep, StepState>; changed: ReviewStep[] };

const INPUT = 'w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white';
const today = () => new Date().toISOString().slice(0, 10);
const short = (h?: string) => (h ? h.slice(0, 12) : '');

const STATE_BADGE: Record<StepState, string> = {
  done: 'ui-badge ui-badge-positive',
  out_of_date: 'ui-badge ui-badge-warning',
  not_started: 'ui-badge',
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The app answered ${res.status}.`);
  return body as T;
}

const AI_RUNTIME_STORAGE_KEY = 'econquest_ai_runtime_config_v1';
function runtimeConfig(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(AI_RUNTIME_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const emptyFrame = (iso3: string): ReviewFrame => ({ iso3, problem: '', goal: { indicator: '', direction: 'lower' }, constraints: [], asOf: today() });

const FrameForm: React.FC<{ countries: Country[]; initial: ReviewFrame; submitLabel: string; onSubmit: (f: ReviewFrame) => Promise<void>; onCancel: () => void }> = ({ countries, initial, submitLabel, onSubmit, onCancel }) => {
  const [f, setF] = useState<ReviewFrame>(initial);
  const [constraints, setConstraints] = useState(initial.constraints.join('\n'));
  const [busy, setBusy] = useState(false);
  const goal = (patch: Partial<ReviewFrame['goal']>) => setF((x) => ({ ...x, goal: { ...x.goal, ...patch } }));
  const known = countries.some((c) => c.iso3 === f.iso3);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-review-frame-form="true"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({ ...f, constraints: constraints.split('\n').map((c) => c.trim()).filter(Boolean) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <span className="ui-label block mb-1">Country</span>
        <select className={INPUT} value={f.iso3} onChange={(e) => setF({ ...f, iso3: e.target.value })} required>
          <option value="">Pick a country</option>
          {!known && f.iso3 && <option value={f.iso3}>{f.iso3}</option>}
          {countries.map((c) => (
            <option key={c.iso3} value={c.iso3}>
              {c.countryName}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="ui-label block mb-1">As of (every later step reads the data saved on or before this day)</span>
        <input type="date" className={INPUT} value={f.asOf} max={today()} onChange={(e) => setF({ ...f, asOf: e.target.value })} required />
      </label>
      <label className="block sm:col-span-2">
        <span className="ui-label block mb-1">The problem, in a sentence or two</span>
        <textarea className={INPUT} rows={2} maxLength={600} value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="e.g. Inflation is well above target while growth is slowing and debt is rising." required />
      </label>
      <label className="block">
        <span className="ui-label block mb-1">Goal: which indicator should improve</span>
        <input className={INPUT} list="review-goal-indicators" maxLength={120} value={f.goal.indicator} onChange={(e) => goal({ indicator: e.target.value })} placeholder="e.g. Inflation" required />
        <datalist id="review-goal-indicators">
          {GOAL_INDICATORS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="ui-label block mb-1">Direction</span>
          <select className={INPUT} value={f.goal.direction} onChange={(e) => goal({ direction: e.target.value as ReviewFrame['goal']['direction'] })}>
            <option value="lower">Lower</option>
            <option value="higher">Higher</option>
            <option value="stable">Stable</option>
          </select>
        </label>
        <label className="block">
          <span className="ui-label block mb-1">Target (optional)</span>
          <input className={INPUT} maxLength={60} value={f.goal.target || ''} onChange={(e) => goal({ target: e.target.value })} placeholder="3%" />
        </label>
        <label className="block">
          <span className="ui-label block mb-1">By (optional)</span>
          <input type="month" className={INPUT} value={f.goal.by || ''} onChange={(e) => goal({ by: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="ui-label block mb-1">Constraints, one per line (optional)</span>
        <textarea className={INPUT} rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder={'Currency peg to the USD\nLittle fiscal room\nElection in October'} />
      </label>
      <label className="block">
        <span className="ui-label block mb-1">Who it is for (optional)</span>
        <input className={INPUT} maxLength={120} value={f.audience || ''} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="e.g. Finance minister, monetary policy committee" />
      </label>
      <div className="sm:col-span-2 flex gap-1.5">
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

const FigureCell: React.FC<{ x: DiagnosisFigure }> = ({ x }) =>
  x.value === null ? (
    <span className="text-amber-700 dark:text-amber-400">Missing: {x.reason}</span>
  ) : (
    <span className="tabular-nums text-slate-900 dark:text-white">
      {x.value}
      {x.unit === '%' ? '%' : ` ${x.unit}`}
    </span>
  );

const DiagnosisView: React.FC<{ d: Diagnosis }> = ({ d }) => {
  const groups = [...new Set(d.figures.map((x) => x.group))];
  return (
    <div className="space-y-3" data-review-diagnosis="true">
      <p className="ui-label">
        From the pull saved on {d.pullDate} (asked for {d.asOf}){d.incomplete ? ', which was incomplete: some feeds did not answer that day' : ''}. {d.coverage}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left ui-label">
              <th className="py-1 pr-2 font-normal">#</th>
              <th className="py-1 pr-2 font-normal">Indicator</th>
              <th className="py-1 pr-2 font-normal">Value</th>
              <th className="py-1 pr-2 font-normal">Source and period</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g}>
                <tr>
                  <td colSpan={4} className="pt-2 pb-0.5 ui-label">
                    {g}
                  </td>
                </tr>
                {d.figures
                  .filter((x) => x.group === g)
                  .map((x) => (
                    <tr key={x.field} className="border-t border-slate-100 dark:border-slate-800" data-review-figure={x.field}>
                      <td className="py-1 pr-2 tabular-nums text-slate-500">[{x.ref}]</td>
                      <td className="py-1 pr-2 text-slate-800 dark:text-slate-200">{x.label}</td>
                      <td className="py-1 pr-2">
                        <FigureCell x={x} />
                      </td>
                      <td className="py-1 pr-2 text-xs text-slate-500 dark:text-slate-400">{x.value === null ? '' : `${x.source}${x.period ? `, ${x.period}` : ''}`}</td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1">
        {d.readings.map((r) => (
          <li key={r.id} className="text-sm text-slate-800 dark:text-slate-200" data-review-reading={r.id}>
            <span className="font-semibold">{r.label}:</span>{' '}
            {r.value === null ? <span className="text-amber-700 dark:text-amber-400">{r.reason}</span> : <span className="tabular-nums">{r.value} pts</span>}
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {r.method}
              {r.caveat ? ` ${r.caveat}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};


const OptionCard: React.FC<{ o: PolicyOption }> = ({ o }) => {
  const rows: Array<[string, string]> = [
    ['How it works', o.how],
    ['Effect on the goal', o.effect],
    ['Time to effect', o.timeToEffect],
    ['Trade-offs', o.tradeoffs],
    ['Who bears the cost', o.whoBears],
    ['What must be true', o.mustBeTrue],
    ['Risks', o.risks],
  ];
  const views = LENSES.filter((l) => o.views[l]);
  return (
    <li className="border border-slate-200 dark:border-slate-700 p-2 space-y-1.5" data-review-option={o.rank}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          {o.rank}. {o.title}
        </span>
        {!(o.fromUser && !o.effect) && <span className="ui-badge ui-badge-accent">{LEVER_LABEL[o.lever]}</span>}
        {o.fromUser && <span className="ui-badge">Your option</span>}
        {o.refs.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">rests on {o.refs.map((n) => `[${n}]`).join(' ')}</span>}
      </div>
      <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[9rem_1fr] text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="ui-label">{k}</dt>
              <dd className="text-slate-800 dark:text-slate-200">{v}</dd>
            </React.Fragment>
          ))}
      </dl>
      {views.length > 0 && (
        <details>
          <summary className="ui-label cursor-pointer">What each council lens says</summary>
          <ul className="mt-1 space-y-0.5">
            {views.map((l) => (
              <li key={l} className="text-sm text-slate-800 dark:text-slate-200">
                <span className="font-semibold">{LENS_LABEL[l]} Agent:</span> {o.views[l]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
};

const OptionsView: React.FC<{ s: OptionsStep }> = ({ s }) => (
  <div className="space-y-2" data-review-options="true">
    {s.ranking && <p className="ui-body">{s.ranking}</p>}
    {!s.model && <p className="text-xs text-amber-700 dark:text-amber-400">Your own options, not assessed by the council ({s.reason}).</p>}
    <ol className="space-y-1.5">
      {s.options.map((o) => (
        <OptionCard key={o.rank} o={o} />
      ))}
    </ol>
    {s.gaps.length > 0 && (
      <div>
        <p className="ui-label">What the missing figures stop the council from judging</p>
        <ul className="list-disc pl-5 text-sm text-slate-800 dark:text-slate-200">
          {s.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    )}
    {s.removed.length > 0 && (
      <details>
        <summary className="ui-label cursor-pointer">{s.removed.length} sentence{s.removed.length === 1 ? '' : 's'} removed: a number did not trace to the diagnosis</summary>
        <ul className="list-disc pl-5 text-xs text-slate-500 dark:text-slate-400">
          {s.removed.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </details>
    )}
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {s.model ? `Written by ${s.model} at temperature ${s.temperature}` : 'No AI model used'} · template {s.templateVersion} · prompt hash <span className="font-code">{s.promptHash.slice(0, 12)}</span>
    </p>
  </div>
);

const OwnOptions: React.FC<{ value: UserOption[]; onChange: (v: UserOption[]) => void }> = ({ value, onChange }) => (
  <fieldset className="space-y-1.5" data-review-own-options="true">
    <legend className="ui-label mb-1">Options you want assessed (optional, up to {MAX_USER_OPTIONS})</legend>
    {value.map((o, i) => (
      <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_2fr_auto]">
        <input className={INPUT} maxLength={120} value={o.title} placeholder="e.g. Raise the policy rate" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label={`Option ${i + 1} title`} />
        <input className={INPUT} maxLength={400} value={o.how} placeholder="How it would work (optional)" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, how: e.target.value } : x)))} aria-label={`Option ${i + 1} how`} />
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
    {value.length < MAX_USER_OPTIONS && (
      <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onChange([...value, { title: '', how: '' }])}>
        <Plus className="w-3.5 h-3.5" /> Add an option
      </button>
    )}
  </fieldset>
);

const EvidenceView: React.FC<{ e: EvidenceStep }> = ({ e }) => (
  <div className="space-y-3" data-review-evidence="true">
    <p className={e.researchOnly ? 'text-xs text-amber-700 dark:text-amber-400' : 'text-xs text-emerald-700 dark:text-emerald-400'}>
      {e.researchOnly
        ? 'Research only: the signals these options lean on have not all passed a pre-registered backtest (Menu > Models & validation).'
        : 'Every signal these options lean on has passed its pre-registered backtest. The options themselves are still a judgement, not a forecast.'}
    </p>
    <div>
      <p className="ui-label mb-1">For each option</p>
      <ul className="space-y-0.5">
        {e.perOption.map((o) => (
          <li key={o.rank} className="text-sm text-slate-800 dark:text-slate-200">
            <span className="font-semibold">
              {o.rank}. {o.title}:
            </span>{' '}
            {o.note}
          </li>
        ))}
      </ul>
    </div>
    <details>
      <summary className="ui-label cursor-pointer">Charts and tests ({e.analyses.filter((a) => a.ran).length} of {e.analyses.length} could run, data to {e.asOf})</summary>
      <ul className="mt-2 space-y-2">
        {e.analyses.map((a) => (
          <li key={a.id} className="border-l-2 border-slate-200 dark:border-slate-700 pl-2" data-review-analysis={a.id}>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{a.title}</p>
            {a.tests.map((t) => (
              <p key={t.test} className="text-sm text-slate-800 dark:text-slate-200">
                <span className="ui-label">{t.title}:</span> {t.reading}
                {t.caution ? <span className="block text-xs text-amber-700 dark:text-amber-400">{t.caution}</span> : null}
              </p>
            ))}
            {a.missing.map((m) => (
              <p key={m} className="text-xs text-amber-700 dark:text-amber-400">
                {m}
              </p>
            ))}
            {a.inputs.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Used: {a.inputs.map((x) => `${x.label} (${x.source}, ${x.first} to ${x.last}, ${x.n} points)`).join('; ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
    <details>
      <summary className="ui-label cursor-pointer">Past episodes in this country ({e.episodes.items.length})</summary>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{e.episodes.method}</p>
      {e.episodes.missing && <p className="text-xs text-amber-700 dark:text-amber-400">Missing: {e.episodes.missing}</p>}
      {e.episodes.items.length > 0 && (
        <table className="mt-1 text-sm">
          <thead>
            <tr className="text-left ui-label">
              <th className="pr-3 font-normal">Date</th>
              <th className="pr-3 font-normal">Move</th>
              <th className="pr-3 font-normal">Inflation before</th>
              <th className="pr-3 font-normal">12 months later</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {e.episodes.items.map((x) => (
              <tr key={x.date} className="border-t border-slate-100 dark:border-slate-800">
                <td className="pr-3">{x.date}</td>
                <td className="pr-3">
                  {x.action} {x.fromPct}% to {x.toPct}%
                </td>
                <td className="pr-3">{x.inflationBefore ? `${x.inflationBefore.pct}% (${x.inflationBefore.month})` : 'Missing'}</td>
                <td className="pr-3">{x.inflationAfter ? `${x.inflationAfter.pct}% (${x.inflationAfter.month})` : 'Missing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {e.episodes.source && <p className="text-xs text-slate-500 dark:text-slate-400">Policy rate: {e.episodes.source}</p>}
    </details>
    <details>
      <summary className="ui-label cursor-pointer">Validation status of the signals used ({e.signals.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {e.signals.map((x) => (
          <li key={x.id} className="text-sm text-slate-800 dark:text-slate-200">
            {x.name}: <span className={x.status === 'passed' ? 'ui-badge ui-badge-positive' : 'ui-badge ui-badge-warning'}>{x.statusLabel}</span>
            {x.verdict ? <span className="block text-xs text-slate-500 dark:text-slate-400">{x.verdict}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  </div>
);

/** A memo line: "- " is a list item, **x** is bold. */
const MemoLine: React.FC<{ text: string }> = ({ text }) => {
  if (!text.trim()) return <div className="h-1.5" />;
  const bullet = text.startsWith('- ');
  const body = (bullet ? text.slice(2) : text).split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
  return <p className={`text-sm text-slate-800 dark:text-slate-200 ${bullet ? 'pl-3 -indent-3' : ''}`}>{bullet ? '• ' : ''}{body}</p>;
};

const MemoView: React.FC<{ m: MemoStep }> = ({ m }) => (
  <article className="space-y-3" data-review-memo="true">
    <p className={m.researchOnly ? 'text-xs text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 p-2' : 'text-xs text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 p-2'}>
      {m.researchOnly ? RESEARCH_BANNER : VALIDATED_BANNER}
    </p>
    {m.sections.map((s) =>
      ['References', 'Method and reproducibility', 'Diagnosis', 'Gaps'].includes(s.heading) ? (
        <details key={s.heading}>
          <summary className="ui-section-title cursor-pointer">{s.heading}</summary>
          <div className="mt-1 space-y-0.5">
            {s.lines.map((l, i) => (
              <MemoLine key={i} text={l} />
            ))}
          </div>
        </details>
      ) : (
        <section key={s.heading} className="space-y-0.5">
          <h5 className="ui-section-title">{s.heading}</h5>
          {s.lines.map((l, i) => (
            <MemoLine key={i} text={l} />
          ))}
        </section>
      )
    )}
  </article>
);

const MemoForm: React.FC<{ options: OptionsStep; initial: MemoInputs; busy: boolean; onSubmit: (m: MemoInputs) => void }> = ({ options, initial, busy, onSubmit }) => {
  const [m, setM] = useState<MemoInputs>(initial);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-review-memo-form="true"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...m, watch: m.watch.filter((w) => w.indicator.trim()) });
      }}
    >
      <label className="block">
        <span className="ui-label block mb-1">Recommend</span>
        <select className={INPUT} value={m.recommended} onChange={(e) => setM({ ...m, recommended: Number(e.target.value) })}>
          {options.options.map((o) => (
            <option key={o.rank} value={o.rank}>
              {o.rank}. {o.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="ui-label block mb-1">Review on</span>
        <input type="date" className={INPUT} value={m.reviewDate} onChange={(e) => setM({ ...m, reviewDate: e.target.value })} required />
      </label>
      <label className="block sm:col-span-2">
        <span className="ui-label block mb-1">Your reasoning (optional, quoted as yours in the memo)</span>
        <textarea className={INPUT} rows={3} maxLength={3000} value={m.rationale} onChange={(e) => setM({ ...m, rationale: e.target.value })} placeholder="Why this option over the others, given the constraints." />
      </label>
      <fieldset className="sm:col-span-2 space-y-1.5">
        <legend className="ui-label mb-1">What to watch (and what would change the recommendation)</legend>
        {m.watch.map((w, i) => (
          <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
            <input className={INPUT} value={w.indicator} maxLength={120} placeholder="e.g. Inflation [1]" aria-label={`Watch ${i + 1}`} onChange={(e) => setM({ ...m, watch: m.watch.map((x, j) => (j === i ? { ...x, indicator: e.target.value } : x)) })} />
            <input className={INPUT} value={w.trigger || ''} maxLength={200} placeholder="e.g. still above target in six months" aria-label={`Trigger ${i + 1}`} onChange={(e) => setM({ ...m, watch: m.watch.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)) })} />
            <button type="button" className="ui-btn ui-btn-ghost" aria-label={`Remove watch ${i + 1}`} onClick={() => setM({ ...m, watch: m.watch.filter((_, j) => j !== i) })}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {m.watch.length < 8 && (
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setM({ ...m, watch: [...m.watch, { indicator: '' }] })}>
            <Plus className="w-3.5 h-3.5" /> Add an indicator
          </button>
        )}
      </fieldset>
      <div className="sm:col-span-2">
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>
          {busy ? 'Writing…' : 'Write the memo'}
        </button>
      </div>
    </form>
  );
};

const cellText = (v: { value: number | null; reason: string }, unit: string) => (v.value === null ? `Missing: ${v.reason}` : `${v.value}${unit === '%' ? '%' : ` ${unit}`}`);

const OutcomesView: React.FC<{ o: OutcomesStep }> = ({ o }) => {
  const row = (x: OutcomesStep['rows'][number]) => (
    <tr key={x.ref} className="border-t border-slate-100 dark:border-slate-800" data-review-outcome={x.ref}>
      <td className="py-1 pr-2 text-slate-500 tabular-nums">[{x.ref}]</td>
      <td className="py-1 pr-2">{x.label}</td>
      <td className="py-1 pr-2 tabular-nums">{cellText(x.then, x.unit)}</td>
      <td className="py-1 pr-2 tabular-nums">{cellText(x.now, x.unit)}</td>
      <td className="py-1 pr-2 tabular-nums">{x.change === null ? '' : `${x.change > 0 ? '+' : ''}${x.change}`}</td>
    </tr>
  );
  const head = (
    <thead>
      <tr className="text-left ui-label">
        <th className="py-1 pr-2 font-normal">#</th>
        <th className="py-1 pr-2 font-normal">Indicator</th>
        <th className="py-1 pr-2 font-normal">At the review</th>
        <th className="py-1 pr-2 font-normal">Now ({o.pullDate})</th>
        <th className="py-1 pr-2 font-normal">Change</th>
      </tr>
    </thead>
  );
  const watched = o.rows.filter((x) => x.watched);
  return (
    <div className="space-y-2" data-review-outcomes={o.goal.move}>
      <p className="text-sm">
        <span className="font-semibold">{o.goal.label}:</span>{' '}
        <span className={o.goal.move === 'right_way' ? 'ui-badge ui-badge-positive' : o.goal.move === 'wrong_way' ? 'ui-badge ui-badge-negative' : 'ui-badge'}>{GOAL_MOVE_LABEL[o.goal.move]}</span>
        {o.goal.targetText ? <span className="text-xs text-slate-500 dark:text-slate-400"> (target {o.goal.targetText})</span> : null}
      </p>
      {watched.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-slate-800 dark:text-slate-200">
            {head}
            <tbody>{watched.map(row)}</tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="ui-label cursor-pointer">All {o.rows.length} indicators</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-slate-800 dark:text-slate-200">
            {head}
            <tbody>{o.rows.map(row)}</tbody>
          </table>
        </div>
      </details>
      <ul className="list-disc pl-5 text-xs text-slate-500 dark:text-slate-400">
        {o.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
};

export const PolicyReviews: React.FC<{ countries?: Country[]; defaultIso3?: string }> = ({ countries = [], defaultIso3 = '' }) => {
  const [list, setList] = useState<ReviewSummary[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [editingFrame, setEditingFrame] = useState(false);
  const [busy, setBusy] = useState('');
  const [own, setOwn] = useState<UserOption[]>([]);
  const [prefill, setPrefill] = useState<{ frame: ReviewFrame; previousId?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList((await api<{ reviews: ReviewSummary[] }>('/api/reviews')).reviews);
      setError('');
    } catch (e) {
      setError(`Could not read the policy reviews: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // A review started from Council chat (or elsewhere): open the frame form filled in.
  useEffect(() => {
    const pick = () => {
      const p = takeReviewPrefill();
      if (!p) return;
      setOpened(null);
      setPrefill({ frame: { ...emptyFrame(p.iso3 || defaultIso3), problem: (p.problem || '').slice(0, 600) }, previousId: p.previousId });
      setCreating(true);
      document.getElementById('tool-policy-reviews')?.scrollIntoView({ block: 'start' });
    };
    pick();
    window.addEventListener(START_REVIEW_EVENT, pick);
    return () => window.removeEventListener(START_REVIEW_EVENT, pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id: string | null) => {
    setEditingFrame(false);
    if (!id) return setOpened(null);
    try {
      setOpened(await api<Opened>(`/api/reviews/${encodeURIComponent(id)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const apply = async (out: { review: PolicyReview; states: Record<ReviewStep, StepState> }) => {
    setOpened({ review: out.review, states: out.states, changed: [] });
    await refresh();
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const r = opened?.review;
  const frame = r?.steps.frame?.content as ReviewFrame | undefined;
  const diagnosis = r?.steps.diagnose?.content as Diagnosis | undefined;
  const options = r?.steps.options?.content as OptionsStep | undefined;
  const evidence = r?.steps.evidence?.content as EvidenceStep | undefined;
  const memo = r?.steps.memo?.content as MemoStep | undefined;
  const outcomes = r?.steps.outcomes?.content as OutcomesStep | undefined;
  const previous = r?.previousId ? list.find((x) => x.id === r.previousId) : undefined;
  const reviewAgain = () => {
    if (!r || !frame) return;
    setOpened(null);
    setPrefill({ frame: { ...frame, asOf: today() }, previousId: r.id });
    setCreating(true);
  };
  const [editingMemo, setEditingMemo] = useState(false);
  // Start the option editor from what was saved last time.
  useEffect(() => {
    setOwn(options?.userOptions ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, r?.steps.options?.hash]);
  const askOptions = (ownOnly: boolean) =>
    run(ownOnly ? 'own' : 'options', async () =>
      apply(await api(`/api/reviews/${encodeURIComponent(r!.id)}/options`, { method: 'POST', body: JSON.stringify({ userOptions: own.filter((o) => o.title.trim()), ownOnly, runtimeConfig: runtimeConfig() }) }))
    );
  const name = (iso3: string) => countries.find((c) => c.iso3 === iso3)?.countryName || iso3;

  return (
    <section className="ui-panel" data-policy-reviews="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Policy reviews
        </h2>
        <p className="ui-label">
          A step-by-step case file for finding ways to improve policy in one country: Frame, Diagnose, Options, Evidence, Recommendation memo, Track outcomes. Every step is saved and
          hashed, so the same inputs give the same figures. Research, not validated advice.
        </p>
      </header>
      <div className="p-4 space-y-3">
        {error && (
          <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
            {error}
          </p>
        )}

        {!creating && !r && (
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> New policy review
          </button>
        )}
        {creating && (
          <>
          {prefill?.previousId && <p className="ui-label">Review again: the frame is copied from the earlier review with today as the As of day. Change anything that is different now.</p>}
          <FrameForm
            key={JSON.stringify(prefill)}
            countries={countries}
            initial={prefill?.frame ?? emptyFrame(defaultIso3)}
            submitLabel="Start review"
            onCancel={() => {
              setCreating(false);
              setPrefill(null);
            }}
            onSubmit={(f) =>
              run('create', async () => {
                const out = await api<{ review: PolicyReview; states: Record<ReviewStep, StepState> }>('/api/reviews', { method: 'POST', body: JSON.stringify({ frame: f, ...(prefill?.previousId ? { previousId: prefill.previousId } : {}) }) });
                setCreating(false);
                setPrefill(null);
                await apply(out);
              })
            }
          />
          </>
        )}

        {!r && !creating && list.length === 0 && !error && <p className="ui-body">No policy reviews yet. Start one to frame a problem for a country and work through it with the council.</p>}

        {!r && list.length > 0 && (
          <ul className="space-y-1.5">
            {list.map((s) => (
              <li key={s.id} className="border border-slate-200 dark:border-slate-700" data-review={s.id}>
                <button type="button" onClick={() => void open(s.id)} className="w-full text-left px-2 py-1.5 flex flex-wrap items-baseline justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className="text-sm text-slate-900 dark:text-white">{s.title}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {s.next ? `Next: ${STEP_LABEL[s.next]}` : 'All steps done'} · {REVIEW_STEPS.filter((x) => s.states[x] === 'done').length} of 6 done · changed {s.updatedAt.slice(0, 10)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {r && frame && (
          <div className="space-y-3" data-review-open={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => void open(null)}>
                ← All policy reviews
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() =>
                  run('delete', async () => {
                    await api(`/api/reviews/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
                    setOpened(null);
                    await refresh();
                  })
                }
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete review
              </button>
            </div>
            <h3 className="ui-section-title">{r.title}</h3>
            {r.previousId && (
              <p className="ui-label">
                Started with Review again from{' '}
                <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline" onClick={() => void open(r.previousId!)}>
                  {previous?.title || 'an earlier review'}
                </button>
                .
              </p>
            )}
            {opened!.changed.length > 0 && (
              <p className="text-xs text-rose-700 dark:text-rose-400" role="alert">
                The saved {opened!.changed.map((s) => STEP_LABEL[s]).join(', ')} no longer match{opened!.changed.length === 1 ? 'es' : ''} its hash: the file was changed outside the app. Run
                {opened!.changed.length === 1 ? ' that step' : ' those steps'} again.
              </p>
            )}

            <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
              {REVIEW_STEPS.map((s, i) => (
                <li key={s} className={STATE_BADGE[opened!.states[s]]} data-review-step-state={`${s}:${opened!.states[s]}`}>
                  {i + 1}. {STEP_LABEL[s]} · {STEP_STATE_LABEL[opened!.states[s]]}
                </li>
              ))}
            </ol>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="frame">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="ui-section-title">1. {STEP_LABEL.frame}</h4>
                {!editingFrame && (
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setEditingFrame(true)}>
                    <Pencil className="w-3.5 h-3.5" /> Change
                  </button>
                )}
              </div>
              {editingFrame ? (
                <>
                  <p className="ui-label">Changing the frame marks every later step Out of date until you run it again. The earlier runs stay in the review's history.</p>
                  <FrameForm
                    countries={countries}
                    initial={frame}
                    submitLabel="Save frame"
                    onCancel={() => setEditingFrame(false)}
                    onSubmit={(f) =>
                      run('frame', async () => {
                        await apply(await api(`/api/reviews/${encodeURIComponent(r.id)}/frame`, { method: 'PUT', body: JSON.stringify({ frame: f }) }));
                        setEditingFrame(false);
                      })
                    }
                  />
                </>
              ) : (
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] text-sm">
                  <dt className="ui-label">Country</dt>
                  <dd className="text-slate-900 dark:text-white">{name(frame.iso3)}</dd>
                  <dt className="ui-label">Problem</dt>
                  <dd className="text-slate-900 dark:text-white">{frame.problem}</dd>
                  <dt className="ui-label">Goal</dt>
                  <dd className="text-slate-900 dark:text-white">
                    {frame.goal.indicator}: {frame.goal.direction}
                    {frame.goal.target ? `, to ${frame.goal.target}` : ''}
                    {frame.goal.by ? `, by ${frame.goal.by}` : ''}
                  </dd>
                  <dt className="ui-label">Constraints</dt>
                  <dd className="text-slate-900 dark:text-white">{frame.constraints.length ? frame.constraints.join('; ') : 'None stated'}</dd>
                  {frame.audience && (
                    <>
                      <dt className="ui-label">For</dt>
                      <dd className="text-slate-900 dark:text-white">{frame.audience}</dd>
                    </>
                  )}
                  <dt className="ui-label">As of</dt>
                  <dd className="text-slate-900 dark:text-white tabular-nums">{frame.asOf}</dd>
                  <dt className="ui-label">Saved</dt>
                  <dd className="text-xs text-slate-500 dark:text-slate-400">
                    {r.steps.frame?.savedAt.slice(0, 16).replace('T', ' ')} · hash <span className="font-code">{short(r.steps.frame?.hash)}</span>
                  </dd>
                </dl>
              )}
            </section>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="diagnose">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="ui-section-title">2. {STEP_LABEL.diagnose}</h4>
                <button
                  type="button"
                  className={diagnosis && opened!.states.diagnose === 'done' ? 'ui-btn' : 'ui-btn ui-btn-primary'}
                  disabled={Boolean(busy) || editingFrame}
                  onClick={() => run('diagnose', async () => apply(await api(`/api/reviews/${encodeURIComponent(r.id)}/diagnose`, { method: 'POST', body: '{}' })))}
                >
                  <Play className="w-3.5 h-3.5" /> {busy === 'diagnose' ? 'Reading the saved pull…' : diagnosis ? 'Run again' : 'Run diagnose'}
                </button>
              </div>
              <p className="ui-label">{STEP_HINT.diagnose}</p>
              {opened!.states.diagnose === 'out_of_date' && <p className="text-xs text-amber-700 dark:text-amber-400">Out of date: the frame changed after this was run. Run it again.</p>}
              {diagnosis && <DiagnosisView d={diagnosis} />}
              {r.steps.diagnose && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Saved {r.steps.diagnose.savedAt.slice(0, 16).replace('T', ' ')} · hash <span className="font-code">{short(r.steps.diagnose.hash)}</span> · run {r.runs.filter((x) => x.step === 'diagnose').length} time
                  {r.runs.filter((x) => x.step === 'diagnose').length === 1 ? '' : 's'}
                </p>
              )}
            </section>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="options">
              <h4 className="ui-section-title">3. {STEP_LABEL.options}</h4>
              <p className="ui-label">{STEP_HINT.options} It reads only the frame and the diagnosis above, at temperature 0, and every number it writes must come from the diagnosis.</p>
              {opened!.states.diagnose !== 'done' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Run Diagnose first.</p>
              ) : (
                <>
                  {opened!.states.options === 'out_of_date' && <p className="text-xs text-amber-700 dark:text-amber-400">Out of date: an earlier step changed after this was run. Run it again.</p>}
                  <OwnOptions value={own} onChange={setOwn} />
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={options?.model && opened!.states.options === 'done' ? 'ui-btn' : 'ui-btn ui-btn-primary'} disabled={Boolean(busy)} onClick={() => void askOptions(false)}>
                      <Play className="w-3.5 h-3.5" /> {busy === 'options' ? 'The council is working… (a local model can take a few minutes)' : options?.model ? 'Ask the council again' : 'Ask the council'}
                    </button>
                    <button type="button" className="ui-btn ui-btn-ghost" disabled={Boolean(busy) || !own.some((o) => o.title.trim())} onClick={() => void askOptions(true)}>
                      Save my options only
                    </button>
                  </div>
                </>
              )}
              {options && <OptionsView s={options} />}
              {r.steps.options && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Saved {r.steps.options.savedAt.slice(0, 16).replace('T', ' ')} · hash <span className="font-code">{short(r.steps.options.hash)}</span> · run {r.runs.filter((x) => x.step === 'options').length} time
                  {r.runs.filter((x) => x.step === 'options').length === 1 ? '' : 's'}
                </p>
              )}
            </section>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="evidence">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="ui-section-title">4. {STEP_LABEL.evidence}</h4>
                {opened!.states.options === 'done' && (
                  <button
                    type="button"
                    className={evidence && opened!.states.evidence === 'done' ? 'ui-btn' : 'ui-btn ui-btn-primary'}
                    disabled={Boolean(busy)}
                    onClick={() => run('evidence', async () => apply(await api(`/api/reviews/${encodeURIComponent(r.id)}/evidence`, { method: 'POST', body: '{}' })))}
                  >
                    <Play className="w-3.5 h-3.5" /> {busy === 'evidence' ? 'Running the tests…' : evidence ? 'Run again' : 'Gather evidence'}
                  </button>
                )}
              </div>
              <p className="ui-label">{STEP_HINT.evidence} Every series is cut at the As of day.</p>
              {opened!.states.options !== 'done' && <p className="text-xs text-slate-500 dark:text-slate-400">Finish Options first.</p>}
              {opened!.states.evidence === 'out_of_date' && <p className="text-xs text-amber-700 dark:text-amber-400">Out of date: an earlier step changed after this was run. Run it again.</p>}
              {evidence && <EvidenceView e={evidence} />}
              {r.steps.evidence && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Saved {r.steps.evidence.savedAt.slice(0, 16).replace('T', ' ')} · hash <span className="font-code">{short(r.steps.evidence.hash)}</span>
                </p>
              )}
            </section>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="memo">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="ui-section-title">5. {STEP_LABEL.memo}</h4>
                {memo && opened!.states.memo === 'done' && !editingMemo && (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setEditingMemo(true)}>
                      <Pencil className="w-3.5 h-3.5" /> Change choices
                    </button>
                    <button type="button" className="ui-btn" onClick={() => saveFile(memoFileName(memo, 'md'), withNotice(memo.markdown), 'text/markdown;charset=utf-8')}>
                      <Download className="w-3.5 h-3.5" /> Markdown
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={() =>
                        run('pdf', async () => {
                          const { memoPdf } = await import('../utils/memoPdf');
                          saveFile(memoFileName(memo, 'pdf'), await memoPdf(memo, r.steps.memo!.savedAt, r.steps.memo!.hash), 'application/pdf');
                        })
                      }
                    >
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                  </div>
                )}
              </div>
              <p className="ui-label">{STEP_HINT.memo} No AI writes it: the same steps and choices give the same memo, word for word.</p>
              {opened!.states.evidence !== 'done' && <p className="text-xs text-slate-500 dark:text-slate-400">Finish Evidence first.</p>}
              {opened!.states.evidence === 'done' && options && diagnosis && frame && (!memo || editingMemo || opened!.states.memo !== 'done') && (
                <>
                  {opened!.states.memo === 'out_of_date' && <p className="text-xs text-amber-700 dark:text-amber-400">Out of date: an earlier step changed after the memo was written. Write it again.</p>}
                  <MemoForm
                    key={`${r.id}-${r.steps.evidence?.hash}`}
                    options={options}
                    initial={memo?.inputs && options.options.some((o) => o.rank === memo.inputs.recommended) ? memo.inputs : defaultMemoInputs(frame, diagnosis, options)}
                    busy={busy === 'memo'}
                    onSubmit={(m) =>
                      run('memo', async () => {
                        await apply(await api(`/api/reviews/${encodeURIComponent(r.id)}/memo`, { method: 'POST', body: JSON.stringify(m) }));
                        setEditingMemo(false);
                        await refreshSignOffs();
                      })
                    }
                  />
                </>
              )}
              {memo && opened!.states.memo === 'done' && (
                <>
                  <SignOffControl briefId={r.id} kind="review" />
                  <MemoView m={memo} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Saved {r.steps.memo!.savedAt.slice(0, 16).replace('T', ' ')} · hash <span className="font-code">{short(r.steps.memo!.hash)}</span> · the sign-off records this hash; a memo written again reads "Changed after sign-off".
                  </p>
                </>
              )}
            </section>

            <section className="border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-review-step="outcomes">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="ui-section-title">6. {STEP_LABEL.outcomes}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {opened!.states.memo === 'done' && memo && (
                    <button
                      type="button"
                      className={today() >= memo.inputs.reviewDate && !outcomes ? 'ui-btn ui-btn-primary' : 'ui-btn'}
                      disabled={Boolean(busy)}
                      onClick={() => run('outcomes', async () => apply(await api(`/api/reviews/${encodeURIComponent(r.id)}/outcomes`, { method: 'POST', body: '{}' })))}
                    >
                      <Play className="w-3.5 h-3.5" /> {busy === 'outcomes' ? 'Checking…' : today() < memo.inputs.reviewDate ? `Check now (review date ${memo.inputs.reviewDate})` : outcomes ? 'Check again' : 'Check outcomes'}
                    </button>
                  )}
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={reviewAgain} data-review-again="true">
                    Review again
                  </button>
                </div>
              </div>
              <p className="ui-label">{STEP_HINT.outcomes} Review again copies the frame onto today's data as a new review linked to this one.</p>
              {opened!.states.memo !== 'done' && <p className="text-xs text-slate-500 dark:text-slate-400">Write the memo first.</p>}
              {opened!.states.outcomes === 'out_of_date' && <p className="text-xs text-amber-700 dark:text-amber-400">Out of date: the memo changed after this check. Check again.</p>}
              {outcomes && <OutcomesView o={outcomes} />}
              {r.steps.outcomes && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Checked {outcomes?.checkedOn} · hash <span className="font-code">{short(r.steps.outcomes.hash)}</span>
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
};
