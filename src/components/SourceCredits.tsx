import React from 'react';
import type { RequiredCredit } from '../data/requiredCredits';

/** The credit lines a source's terms ask for, linked, shown beside its figures. Renders nothing for none. */
export function SourceCredits({ credits, className = '' }: { credits: RequiredCredit[]; className?: string }) {
  if (!credits.length) return null;
  return (
    <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`} data-source-credits={credits.map((c) => c.id).join(' ')}>
      {credits.map((c, i) => (
        <React.Fragment key={c.id}>
          {i > 0 && ' · '}
          <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
            {c.text}
          </a>
          {c.after}
        </React.Fragment>
      ))}
    </p>
  );
}
