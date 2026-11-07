import React, { useState } from 'react';
import { shortHash, type RunComparison, type SnapshotSummary } from '../utils/answerSnapshot';
import type { SynthesisResult } from '../utils/askCouncil';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * The snapshot an answer is pinned to (src/utils/answerSnapshot.ts), folded into one line under
 * the answer: open it for the data date, model, sampling, hashes, agent documents and every figure.
 */
export function AnswerSnapshotDetails({ snapshot, runtimeConfig }: { snapshot: SnapshotSummary; runtimeConfig?: () => Record<string, unknown> }) {
  const s = snapshot;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2">
      <dt className="w-24 sm:w-32 shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
  return (
    <details className="text-xs text-slate-500 dark:text-slate-400" data-council-snapshot={s.id}>
      <summary className="cursor-pointer">
        Snapshot {shortHash(s.inputsHash)} · {s.asOf ? `data as of ${s.asOf}` : s.dataPinnedAt ? 'pinned data' : 'latest data'} · {s.model || 'no model answered'}
      </summary>
      <div className="mt-1 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
        <p>
          What this answer was made from. The same snapshot sent to the same model at temperature {s.temperature} with seed {s.seed} gives the same answer as closely as the model
          allows.
        </p>
        <dl className="space-y-0.5">
          {row('Asked', when(s.askedAt))}
          {row('Data', s.asOf ? `As of ${s.asOf} (saved pull on or before that day)` : s.dataPinnedAt ? `Pinned: the figures the app held at ${when(s.dataPinnedAt)}` : 'Latest figures the app held when asked')}
          {row('AI model', s.model || 'None answered')}
          {row('Sampling', `Temperature ${s.temperature}, seed ${s.seed}`)}
          {row('Instructions', <span title={s.templateHash}>{shortHash(s.templateHash)}</span>)}
          {row('Prompt sent', <span title={s.promptHash}>{shortHash(s.promptHash)}</span>)}
          {row('Inputs / answer', (
            <span>
              <span title={s.inputsHash}>{shortHash(s.inputsHash)}</span> / <span title={s.outputHash}>{shortHash(s.outputHash)}</span>
            </span>
          ))}
          {s.rerunOf && row('Re-run of', s.rerunOf)}
        </dl>
        {s.documents.length > 0 && (
          <div>
            <p className="text-slate-700 dark:text-slate-300">Agent documents read</p>
            <ul className="mt-0.5 space-y-0.5">
              {s.documents.map((d) => (
                <li key={d.docId}>
                  {d.agent}: template v{d.version}, {d.figures} figure{d.figures === 1 ? '' : 's'}, <span title={d.hash}>{shortHash(d.hash)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.figures.length > 0 && (
          <details>
            <summary className="cursor-pointer text-slate-700 dark:text-slate-300">Figures used ({s.figures.length})</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="pr-2 font-normal">Country</th>
                    <th className="pr-2 font-normal">Figure</th>
                    <th className="pr-2 font-normal">Value</th>
                    <th className="font-normal">Source and period</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800 dark:text-slate-200">
                  {s.figures.map((f, i) => (
                    <tr key={i} className="align-top">
                      <td className="pr-2">{f.iso3}</td>
                      <td className="pr-2">{f.label}</td>
                      <td className="pr-2 whitespace-nowrap">{f.value}</td>
                      <td>{f.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <p>Saved on this computer as {s.id} and named in Menu &gt; Audit log.</p>
        <RerunSnapshot id={s.id} runtimeConfig={runtimeConfig} />
      </div>
    </details>
  );
}

interface RerunReply {
  rerun: SynthesisResult;
  comparison: RunComparison | null;
}

/** Sends the same snapshot to the model again and says what, if anything, came out different. */
function RerunSnapshot({ id, runtimeConfig }: { id: string; runtimeConfig?: () => Record<string, unknown> }) {
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<RerunReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch('/api/council/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, runtimeConfig: runtimeConfig?.() ?? {} }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j?.error || `The re-run did not answer (HTTP ${r.status}).`);
      else setReply(j as RerunReply);
    } catch {
      setError('The app server did not answer.');
    } finally {
      setRunning(false);
    }
  };
  const c = reply?.comparison;
  const b = reply?.rerun.brief;
  return (
    <div className="space-y-1" data-council-rerun={id}>
      <button type="button" className="ui-btn text-xs" onClick={run} disabled={running}>
        {running ? 'Re-running…' : reply ? 'Re-run again' : 'Re-run on this snapshot'}
      </button>
      {!reply && !running && <p>Sends the same figures, documents and question to the model you have set now, and compares the answer.</p>}
      {error && <p className="text-amber-800 dark:text-amber-300">{error}</p>}
      {reply && !c && <p className="text-amber-800 dark:text-amber-300">{reply.rerun.reason || 'The re-run could not be saved, so it was not compared.'}</p>}
      {c && (
        <div className="space-y-1" data-council-rerun-result={c.sameAnswer ? 'same' : 'different'}>
          <ul className="space-y-0.5">
            {c.notes.map((n, i) => (
              <li key={i} className={i === 0 ? (c.sameAnswer ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-300') : ''}>
                {n}
              </li>
            ))}
          </ul>
          {!c.sameAnswer && b && (
            <details>
              <summary className="cursor-pointer text-slate-700 dark:text-slate-300">Show what changed</summary>
              <div className="mt-1 space-y-1 text-slate-800 dark:text-slate-200">
                {c.headlineChanged && <p>New headline: {b.headline || '(none)'}</p>}
                {c.pointsAdded.length > 0 && (
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">New sentences</p>
                    <ul className="list-disc pl-5">
                      {c.pointsAdded.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.pointsRemoved.length > 0 && (
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Sentences no longer there</p>
                    <ul className="list-disc pl-5 line-through decoration-slate-400">
                      {c.pointsRemoved.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
          {reply.rerun.snapshot && <p>Saved as {reply.rerun.snapshot.id}.</p>}
        </div>
      )}
    </div>
  );
}
