import React from 'react';
import type { AgentAnswer } from '../utils/askCouncil';
import { citedExplain, type CitedSentence, type ExplainBrief } from '../utils/explain';

/**
 * An explanation in Council chat: what the figures are (Data), then why, what it means through
 * each lens and what would change it (Interpretation). Sentences that quote a figure carry its
 * reference number; lenses with no figures say Missing and why.
 */
export const ExplainAnswer: React.FC<{ headline: string; explain: ExplainBrief; answers: AgentAnswer[] }> = ({ headline, explain, answers }) => {
  const c = citedExplain(explain, answers);
  const f = explain.focus;
  const line = (s: CitedSentence) => (
    <li key={s.text}>
      {s.text}
      {s.refs.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400"> [{s.refs.join(', ')}]</span>}
    </li>
  );
  const kind = (k: 'Data' | 'Interpretation') => (
    <span className={`ui-badge ${k === 'Data' ? 'ui-badge-accent' : ''}`} data-explain-kind={k}>
      {k}
    </span>
  );
  const section = (title: string, k: 'Data' | 'Interpretation', items: CitedSentence[], key: string) =>
    items.length > 0 && (
      <div data-explain-section={key}>
        <div className="flex items-center gap-2">
          <span className="ui-label">{title}</span>
          {kind(k)}
        </div>
        <ul className="list-disc pl-5 mt-1 text-sm text-slate-800 dark:text-slate-200 space-y-1">{items.map(line)}</ul>
      </div>
    );
  const lenses = c.lenses;
  return (
    <div className="space-y-3" data-explain="true">
      {f && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-explain-focus="true">
          You asked about: {f.countryName ? `${f.countryName}, ` : ''}
          {f.label}
          {f.value ? ` ${f.value}` : ''}
          {f.source ? ` (${f.source}${f.asOf ? `, ${f.asOf}` : ''})` : f.asOf ? ` (${f.asOf})` : ''}
        </p>
      )}
      {headline && <p className="text-sm font-medium text-slate-900 dark:text-white">{headline}</p>}
      {section('What the figures show', 'Data', c.facts, 'facts')}
      {section('Why it looks like this', 'Interpretation', c.reasons, 'reasons')}
      {lenses.length > 0 && (
        <div data-explain-section="lenses">
          <div className="flex items-center gap-2">
            <span className="ui-label">What it means</span>
            {kind('Interpretation')}
          </div>
          <dl className="mt-1 space-y-1.5 text-sm">
            {lenses.map((l) => (
              <div key={l.lens} data-explain-lens={l.lens}>
                <dt className="font-medium text-slate-700 dark:text-slate-200">{l.label}</dt>
                <dd className="text-slate-800 dark:text-slate-200">
                  {l.sentences.length ? (
                    l.sentences.map((s) => (
                      <span key={s.text}>
                        {s.text}
                        {s.refs.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400"> [{s.refs.join(', ')}]</span>}{' '}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400" data-explain-missing="true">
                      Missing: {l.missing}.
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {section('What would change this', 'Interpretation', c.watch, 'watch')}
      {c.references.length > 0 && (
        <ol className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5" data-explain-refs={c.references.length}>
          {c.references.map((r) => (
            <li key={r.n}>
              [{r.n}] {r.url ? <a className="underline" href={r.url} target="_blank" rel="noreferrer">{r.source}</a> : r.source}
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Data quotes the agents’ figures; Interpretation is the AI model’s reading of them, not a forecast.
      </p>
    </div>
  );
};
