import { ValidationBadge } from './ValidationBadge';
import React, { useEffect, useState } from 'react';
import { Gavel } from 'lucide-react';
import type { DecisionReplay, RateDecision } from '../utils/decisionReplay';
import type { InflationTarget } from '../utils/marketsMacro';

/**
 * Country Research > History > Replicate a rate decision: pick one of the bank's moves (or any
 * date) and see the data the week before, what a simple Taylor rule pointed to, and what the bank
 * did. Built on the app's own series; the stated caveats travel with every reading.
 */

type ListReply = { decisions: RateDecision[]; policySource: string | null; first: string | null; last: string | null; policyMissing?: string; target: InflationTarget | null };
type ReplayReply = ListReply & { replay: DecisionReplay; sentence: string };

const p2 = (v: number) => `${v.toFixed(2)}%`;
const sg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export const DecisionReplayPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [list, setList] = useState<ListReply | null>(null);
  const [date, setDate] = useState('');
  const [reply, setReply] = useState<ReplayReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setList(null);
    setReply(null);
    setError(null);
    fetch(`/api/decision-replay/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: ListReply) => {
        if (!live) return;
        setList(b);
        setDate(b.decisions[0]?.date || '');
      })
      .catch((e: Error) => live && setError(`Rate decisions could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    setError(null);
    fetch(`/api/decision-replay/${encodeURIComponent(iso3)}?date=${encodeURIComponent(date)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`))))
      .then((b: ReplayReply) => live && setReply(b))
      .catch((e: Error) => live && (setReply(null), setError(e.message)));
    return () => {
      live = false;
    };
  }, [iso3, date]);

  const r = reply?.replay;

  return (
    <section className="ui-panel" data-decision-replay="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Gavel className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Replicate a rate decision, {countryName}
          <ValidationBadge id="taylor_gap" />
        </h2>
        <p className="ui-label">Pick one of the central bank's moves, or any date: the data the week before, what a simple Taylor rule pointed to, and what the bank did.</p>
      </header>
      <div className="p-4 space-y-3">
        {list === null && !error && <p className="ui-body">Loading…</p>}
        {list && list.policyMissing && (
          <p className="ui-body" data-missing="true">
            Missing: {list.policyMissing}. Without the BIS policy rate history there are no decisions to replay.
          </p>
        )}
        {list && !list.policyMissing && (
          <div className="space-y-2">
            {list.decisions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rate decisions">
                {list.decisions.slice(0, 12).map((d) => (
                  <button key={d.date} type="button" className="ui-pill" aria-pressed={date === d.date} onClick={() => setDate(d.date)}>
                    {d.date}: {d.toPct > d.fromPct ? 'up' : 'down'} {Math.abs(d.toPct - d.fromPct).toFixed(2)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The BIS series the app holds ({list.first}
                {list.last && list.last !== list.first ? ` to ${list.last}` : ''}) shows no change in the rate. Pick a date to replay a hold.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="ui-label" htmlFor={`replay-${iso3}`}>
                Or any date
              </label>
              <input
                id={`replay-${iso3}`}
                type="date"
                value={date.length === 10 ? date : ''}
                min={list.first && list.first.length === 10 ? list.first : undefined}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              {list.policySource && <span className="text-xs text-slate-500 dark:text-slate-400">Decisions from {list.policySource}.</span>}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {r && reply && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-replay-sentence="true">
              {reply.sentence}
            </p>
            <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
              <tbody>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Policy rate the week before ({r.asOf})</td>
                  <td className="py-1.5 text-right text-slate-900 dark:text-white">{p2(r.rateBeforePct)}</td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">What the bank did ({r.decisionDate})</td>
                  <td className="py-1.5 text-right text-slate-900 dark:text-white">
                    {r.action === 'held' ? `held at ${p2(r.rateAfterPct)}` : `${r.action} to ${p2(r.rateAfterPct)}`}
                  </td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Inflation, latest month before the decision</td>
                  <td className={`py-1.5 text-right ${r.inflation ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`} title={r.inflation?.source}>
                    {r.inflation ? `${p2(r.inflation.pct)} (${r.inflation.month})` : 'Missing'}
                  </td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Inflation target</td>
                  <td className={`py-1.5 text-right ${r.target ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                    {r.target ? (
                      <a href={r.target.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {r.target.pct}%{r.target.bandPts ? ` ± ${r.target.bandPts}` : ''} ({r.target.bank})
                      </a>
                    ) : (
                      'Missing'
                    )}
                  </td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">OECD leading indicator</td>
                  <td className={`py-1.5 text-right ${r.cli ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                    {r.cli ? `${r.cli.level.toFixed(2)} (${r.cli.month})${r.cli.change6m !== undefined ? `, ${sg(r.cli.change6m)} over 6 months` : ''}` : 'Missing'}
                  </td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Taylor rule rate</td>
                  <td className={`py-1.5 text-right ${r.rule ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                    {r.rule ? `${p2(r.rule.pct)} (policy ${sg(r.rule.gapPts)} pts against it)` : 'Missing'}
                  </td>
                </tr>
              </tbody>
            </table>
            {r.rule && <p className="text-xs text-slate-500 dark:text-slate-400">{r.rule.method}. Within 1 pt of the rule counts as pointing to a hold.</p>}
            {r.missing.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Missing: {r.missing.join('; ')}.</p>}
            <ul className="text-xs text-slate-500 dark:text-slate-400 list-disc pl-4 space-y-0.5">
              {r.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
};
