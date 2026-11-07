import React, { useEffect, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { Ruler } from 'lucide-react';
import type { RuleFamilyOutcome } from '../utils/ruleFamily';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Policy rules (src/utils/ruleFamily.ts): the policy rate
 * against five stated rules on the same inputs.
 */

type Reply = RuleFamilyOutcome & { iso3: string; method: string; sentence?: string; sources?: string[] };

const f = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2));
const sg = (v: number | undefined) => (v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

export const RuleFamilyPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/rule-family/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The policy rules could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  return (
    <section className="ui-panel" data-rule-family="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Ruler className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Policy rules, {countryName}
          <ValidationBadge id="rule_family" />
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Policy rule family, ${countryName}`,
                  value: `policy ${f(reply.policyPct)}%; rules ${f(reply.range.lo)}-${f(reply.range.hi)}%: ${reply.position}`,
                  source: (reply.sources || []).join('; '),
                  iso3,
                  countryName,
                  detail: [reply.sentence || '', ...reply.rows.map((r) => `${r.label}: ${r.pct !== undefined ? `${f(r.pct)}%` : `Missing (${r.missing})`}`), reply.method],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">What five standard rules prescribe on the same figures, and where the policy rate sits against them. A cross-check of stance, not a forecast.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.missing.join(', ')}.
          </p>
        )}
        {reply?.ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-rule-sentence="true">{reply.sentence}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3 font-medium">Rule</th>
                  <th className="py-1 pr-3 font-medium">Formula</th>
                  <th className="py-1 pr-3 font-medium text-right">Prescribes</th>
                  <th className="py-1 font-medium text-right">Policy minus rule</th>
                </tr>
              </thead>
              <tbody>
                {reply.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 tabular-nums" data-rule={r.id}>
                    <td className="py-0.5 pr-3 text-slate-900 dark:text-white">{r.label}</td>
                    <td className="py-0.5 pr-3 text-slate-500 dark:text-slate-400">{r.formula}</td>
                    <td className="py-0.5 pr-3 text-right">{r.pct !== undefined ? `${f(r.pct)}%` : <span className="text-amber-700 dark:text-amber-400" title={r.missing}>Missing</span>}</td>
                    <td className="py-0.5 text-right">{sg(r.gapPts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Inputs: inflation {f(reply.inputs.inflation?.pct)}% ({reply.inputs.inflation?.month}), target {f(reply.inputs.targetPct)}%
              {reply.inputs.gap ? `, output gap ${f(reply.inputs.gap.pct)}% (${reply.inputs.gap.year}, ${reply.inputs.gap.source === 'imf' ? 'IMF WEO' : "the app's estimate"})` : ', no output gap'}, r* {reply.rStar}%. {reply.method} Sources: {(reply.sources || []).join('; ')}.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
