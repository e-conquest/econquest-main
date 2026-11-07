import { ValidationBadge } from './ValidationBadge';
import React, { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { TrackRecord } from '../utils/trackRecord';

/**
 * Country Research > History > Track record: the policy-rule signal the app gave on each saved
 * pull and, once the horizon has passed, what the central bank did. Built from the pull archive
 * only, so it fills in week by week from the day the archive started.
 */

type Reply = TrackRecord & { sentence: string; policyMissing: string | null };

const p2 = (v: number) => `${v.toFixed(2)}%`;
const sg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
const word = { raise: 'raise', cut: 'cut', hold: 'hold' } as const;

export const TrackRecordPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/track-record/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The track record could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  const rows = reply ? (all ? reply.entries : reply.entries.filter((e) => e.call || !e.reading)) : [];

  return (
    <section className="ui-panel" data-track-record="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Track record, {countryName}
          <ValidationBadge id="taylor_gap" />
        </h2>
        <p className="ui-label">
          The rule signal the app gave on each saved pull, read from that pull, and what the central bank did in the {reply?.horizonDays ?? 90} days after. No odds, no hindsight on the inputs.
        </p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-track-sentence="true">
              {reply.sentence}
            </p>
            {reply.policyMissing && (
              <p className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                Missing: {reply.policyMissing}. Calls cannot be scored without the BIS policy rate.
              </p>
            )}
            {reply.scored > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                By signal:{' '}
                {(['raise', 'hold', 'cut'] as const)
                  .filter((k) => reply.bySignal[k].scored)
                  .map((k) => `${word[k]} ${reply.bySignal[k].followed} of ${reply.bySignal[k].scored}`)
                  .join(', ')}
                .
              </p>
            )}
            {reply.entries.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="ui-pill" aria-pressed={all} onClick={() => setAll(!all)}>
                    {all ? 'Showing every saved pull' : 'Showing calls only'}
                  </button>
                  <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/track-record.csv`} download>
                    Download log (CSV)
                  </a>
                  <a className="ui-btn inline-flex" href={`/api/export/${encodeURIComponent(iso3)}/track-record.xlsx`} download>
                    Excel
                  </a>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="py-1 pr-3 font-normal">Pull</th>
                        <th className="py-1 pr-3 font-normal">Rule pointed to</th>
                        <th className="py-1 pr-3 font-normal text-right">Policy</th>
                        <th className="py-1 pr-3 font-normal text-right">Rule</th>
                        <th className="py-1 font-normal">What the bank did</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => (
                        <tr key={e.day} className="border-t border-slate-100 dark:border-slate-800 align-top">
                          <td className="py-1.5 pr-3 text-slate-900 dark:text-white whitespace-nowrap">
                            {e.day}
                            {e.call && <div className="text-xs text-slate-400">call</div>}
                          </td>
                          {e.reading ? (
                            <>
                              <td className="py-1.5 pr-3 text-slate-900 dark:text-white" title={`Inflation ${p2(e.reading.inflationPct)}, ${e.reading.inflationBasis}${e.reading.outputGapPct !== undefined ? `; output gap ${sg(e.reading.outputGapPct)}` : '; no output gap'}`}>
                                {word[e.reading.signal]}
                                <div className="text-xs text-slate-400">policy {sg(e.reading.gapPts)} pts against the rule</div>
                              </td>
                              <td className="py-1.5 pr-3 text-right text-slate-900 dark:text-white" title={e.reading.policySource}>
                                {p2(e.reading.policyPct)}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-slate-900 dark:text-white">{p2(e.reading.rulePct)}</td>
                            </>
                          ) : (
                            <td colSpan={3} className="py-1.5 pr-3 text-slate-400" data-missing="true">
                              Missing: {e.missing?.join(', ')}
                            </td>
                          )}
                          <td className="py-1.5 text-slate-700 dark:text-slate-300">
                            {!e.outcome
                              ? e.reading
                                ? 'same signal as the pull before'
                                : ''
                              : e.outcome.status === 'pending'
                                ? `pending until ${e.outcome.due}`
                                : `${e.outcome.action === 'held' ? `held at ${p2(e.outcome.toPct)}` : `${e.outcome.action} ${p2(e.outcome.fromPct)} to ${p2(e.outcome.toPct)}`} by ${e.outcome.on}: ${e.outcome.followed ? 'followed' : 'not followed'}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <ul className="text-xs text-slate-500 dark:text-slate-400 list-disc pl-4 space-y-0.5">
              {reply.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
};
