import React from 'react';
import type { FigureCheck } from '../utils/runFigureCheck';

/** What the number check took out of the full council's text, with where each sentence was. */
export function FigureCheckNote({ check, what }: { check?: FigureCheck; what: string }) {
  if (!check) return null;
  const n = check.removed.length;
  if (!n) {
    return (
      <p className="text-xs text-slate-600 dark:text-slate-400" data-figure-check="0">
        Number check: every number in the {what} traces back to the figures the council was given.
      </p>
    );
  }
  return (
    <details className="text-xs text-slate-700 dark:text-slate-300" data-figure-check={n}>
      <summary className="cursor-pointer">
        Number check: {n} sentence{n === 1 ? '' : 's'} removed from the {what}, because a number did not trace back to the figures the council was given.
      </summary>
      <ul className="mt-1 space-y-1 list-disc pl-5">
        {check.removed.slice(0, 40).map((r, i) => (
          <li key={i}>
            <span className="text-slate-500 dark:text-slate-400">{r.where}:</span> {r.sentence}
          </li>
        ))}
        {n > 40 && <li>and {n - 40} more.</li>}
      </ul>
    </details>
  );
}
