import React, { useEffect, useState } from 'react';
import { PencilRuler } from 'lucide-react';
import type { Exercise, ExerciseId } from '../utils/exercises';

/**
 * Country Research > History & data > Exercises (src/utils/exercises.ts): questions worked out
 * from the app's series at a month, checked within a tolerance, with the answer key (held back on
 * the server in exam mode).
 */

type Ex = Pick<Exercise, 'id' | 'question' | 'hint' | 'unit' | 'tolerance'> & Partial<Pick<Exercise, 'answer' | 'inputs' | 'workings'>>;
type Reply = { exercises: Ex[]; notSet: Array<{ id: ExerciseId; reason: string }>; examMode: boolean; method: string };
type Checked = { correct: boolean; tolerance: number; unit: string; answer?: number };

const defaultMonth = () => `${new Date().getUTCFullYear() - 1}-12`;

export const ExercisesPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [month, setMonth] = useState(defaultMonth);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, Checked | string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let live = true;
    setReply(null);
    setError(null);
    setChecked({});
    setShown({});
    fetch(`/api/exercises/${encodeURIComponent(iso3)}?month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The exercises could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3, month]);

  const check = (id: string) => {
    fetch(`/api/exercises/${encodeURIComponent(iso3)}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, month, answer: Number(String(given[id] || '').replace(',', '.')) }) })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        setChecked((c) => ({ ...c, [id]: r.ok ? (b as Checked) : String(b.error || `HTTP ${r.status}`) }));
      })
      .catch(() => setChecked((c) => ({ ...c, [id]: 'The app server did not answer.' })));
  };
  const input = 'px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white';

  return (
    <section className="ui-panel" data-exercises="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <PencilRuler className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Exercises, {countryName}
        </h2>
        <p className="ui-label">Questions worked out from the app's own figures at the month you pick, checked within a tolerance, with the answer key.</p>
      </header>
      <div className="p-4 space-y-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">Month</span>
          <input type="month" className={input} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month of the exercises" />
        </label>
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-amber-700 dark:text-amber-400">{error}</p>}
        {reply?.examMode && <p className="text-amber-700 dark:text-amber-400">Exam mode is on: answers are checked, but the answer key is not shown.</p>}
        {reply && reply.exercises.length === 0 && <p className="ui-body">No exercise can be set for {month}: none has all its figures on file.</p>}
        {reply?.exercises.map((e, i) => {
          const c = checked[e.id];
          return (
            <div key={e.id} className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1" data-exercise={e.id}>
              <p className="text-slate-900 dark:text-white">
                {i + 1}. {e.question}
              </p>
              <p className="text-slate-500 dark:text-slate-400">{e.hint}</p>
              <div className="flex items-center gap-2">
                <input className={`${input} w-24 tabular-nums`} inputMode="decimal" value={given[e.id] || ''} onChange={(ev) => setGiven((g) => ({ ...g, [e.id]: ev.target.value }))} aria-label={`Answer to exercise ${i + 1}`} />
                <span className="text-slate-500">{e.unit}</span>
                <button type="button" className="ui-btn" onClick={() => check(e.id)} disabled={!given[e.id]}>
                  Check
                </button>
                {!reply.examMode && e.answer !== undefined && (
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setShown((s) => ({ ...s, [e.id]: !s[e.id] }))}>
                    {shown[e.id] ? 'Hide answer key' : 'Answer key'}
                  </button>
                )}
              </div>
              {typeof c === 'string' && <p className="text-amber-700 dark:text-amber-400">{c}</p>}
              {c && typeof c !== 'string' && (
                <p className={c.correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'} data-exercise-result={c.correct ? 'right' : 'wrong'}>
                  {c.correct ? 'Right' : 'Not right'}, within ±{c.tolerance} {c.unit}{c.answer !== undefined && !c.correct ? `; the answer is ${c.answer}` : ''}.
                </p>
              )}
              {shown[e.id] && e.answer !== undefined && (
                <div className="text-slate-600 dark:text-slate-300" data-answer-key="true">
                  <p>
                    Answer: {e.answer} {e.unit}. Workings: {e.workings}.
                  </p>
                  <ul className="list-disc ml-4">
                    {e.inputs?.map((x) => (
                      <li key={x.label + x.when}>
                        {x.label}: {x.value} {x.unit} ({x.when}; {x.source})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {reply && reply.notSet.length > 0 && (
          <p className="text-amber-700 dark:text-amber-400" data-missing="true">
            Not set: {reply.notSet.map((n) => `${n.id.replace(/_/g, ' ')} (${n.reason})`).join('; ')}.
          </p>
        )}
        {reply && <p className="text-slate-500 dark:text-slate-400">Method: {reply.method}</p>}
      </div>
    </section>
  );
};
