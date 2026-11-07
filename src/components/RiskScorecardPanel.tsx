import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ValidationBadge } from './ValidationBadge';
import type { Scorecard } from '../utils/countryRiskScorecard';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Country risk scorecard (src/utils/countryRiskScorecard.ts):
 * governance, armed conflict, unrest and the economy side by side. No overall score.
 */

type Reply = Scorecard & { iso3: string; sentence: string; method: string };

const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`;

export const RiskScorecardPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/risk-scorecard/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The scorecard could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  return (
    <section className="ui-panel" data-risk-scorecard="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Country risk scorecard, {countryName}
          <ValidationBadge id="risk_scorecard" />
          {reply && reply.filled > 0 && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Country risk scorecard, ${countryName}`,
                  value: reply.sentence,
                  source: reply.pillars.map((p) => p.source).filter((s) => s !== '—').join('; '),
                  iso3,
                  countryName,
                  detail: [
                    ...reply.pillars.flatMap((p) => p.rows.map((r) => `${p.label}: ${r.label} ${r.value} ${r.unit} (${r.when})${r.context ? `, ${r.context}` : ''}`)),
                    reply.method,
                  ],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">Governance, armed conflict, unrest, geopolitical risk and the economy side by side, each figure with its source and year. No overall score.</p>
      </header>
      <div className="p-4 space-y-4">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-scorecard-sentence="true">{reply.sentence}</p>
            {reply.pillars.map((p) => (
              <div key={p.id} data-scorecard-pillar={p.id}>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white">{p.label}</h3>
                {p.rows.length > 0 && (
                  <table className="w-full text-xs mt-1">
                    <tbody>
                      {p.rows.map((r) => (
                        <tr key={r.label} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-0.5 pr-3 text-slate-500 dark:text-slate-400">{r.label}</td>
                          <td className="py-0.5 pr-3 tabular-nums text-right whitespace-nowrap">{r.value} <span className="text-slate-500">{r.unit}</span></td>
                          <td className="py-0.5 pr-3 tabular-nums whitespace-nowrap text-slate-500">{r.when}</td>
                          <td className="py-0.5 pr-3 tabular-nums whitespace-nowrap text-slate-500">{r.change5y !== undefined ? `${signed(r.change5y)} in 5 years` : ''}</td>
                          <td className="py-0.5 text-slate-500">{r.context || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {p.missing.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1" data-missing="true">
                    Missing: {p.missing.join('; ')}.
                  </p>
                )}
                {p.rows.length > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">Source: {p.source}.</p>}
              </div>
            ))}
            <p className="text-xs text-slate-500 dark:text-slate-400">Method: {reply.method} Description, not a tested signal.</p>
          </>
        )}
      </div>
    </section>
  );
};
