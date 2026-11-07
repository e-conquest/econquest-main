import React from 'react';
import { formatDuration, slowestStep, statsText, tookLine, totalMs, type CouncilTiming } from '../utils/councilTiming';

const OUTCOME = { model: 'answered', no_model: 'no model answered', skipped: 'skipped', no_model_needed: '' } as const;

/**
 * How long the full council took (src/utils/councilTiming.ts), folded into one line under the
 * report: open it for each step, the model that ran it and, for Ollama, where the time went.
 */
export function CouncilTimingNote({ timing }: { timing: CouncilTiming }) {
  const slow = slowestStep(timing);
  const share = slow && totalMs(timing) > 0 ? Math.round((slow.ms / totalMs(timing)) * 100) : null;
  return (
    <details className="text-xs text-slate-500 dark:text-slate-400" data-council-timing={totalMs(timing)}>
      <summary className="cursor-pointer">{tookLine(timing)}</summary>
      <div className="mt-1 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
        <ul className="space-y-1">
          {timing.steps.map((s) => (
            <li key={s.id} className="text-slate-700 dark:text-slate-300">
              <span className="tabular-nums">{s.outcome === 'skipped' ? 'skipped' : formatDuration(s.ms)}</span> · {s.label}
              {timing.sentTogether.includes(s.id) ? ' (sent at the same time as the other desks)' : ''}
              <span className="text-slate-500 dark:text-slate-400">
                {s.model ? ` · ${s.model}` : OUTCOME[s.outcome] ? ` · ${OUTCOME[s.outcome]}` : ''}
                {s.outcome === 'model' && s.stats ? ` · ${statsText(s.stats)}` : s.reason ? ` · ${s.reason}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {slow && share !== null && <p>Slowest step: {slow.label}, {formatDuration(slow.ms)} ({share}% of the total).</p>}
        <p>Measured by the app on this run. Your review between the desks and the final report is not counted. Every run is also kept in data/local/council-timing.jsonl.</p>
      </div>
    </details>
  );
}
