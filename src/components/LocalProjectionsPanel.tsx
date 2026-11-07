import React, { useEffect, useState } from 'react';
import { ValidationBadge } from './ValidationBadge';
import { ChartNumbers } from './ChartNumbers';
import { Activity } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LpOutcome } from '../utils/localProjections';
import { explainInChat } from '../utils/explainHandoff';

/**
 * Country Research > History & data > Inflation after rate changes (src/utils/localProjections.ts):
 * local projections of monthly inflation on the policy rate. Reduced form, labelled so.
 */

type Reply = LpOutcome & { iso3: string; sentence?: string; sources?: string[] };

const f = (v: number) => v.toFixed(2);

export const LocalProjectionsPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/local-projections/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The local projections could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);

  return (
    <section className="ui-panel" data-local-projections="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Inflation after rate changes, {countryName}
          <ValidationBadge id="local_projections" />
          {reply?.ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Inflation after policy rate changes (local projections), ${countryName}`,
                  value: reply.steps.map((s) => `${s.h}m: ${f(s.beta)} [${f(s.lo)}, ${f(s.hi)}]`).join('; '),
                  source: (reply.sources || []).join('; '),
                  asOf: `${reply.from} to ${reply.to}`,
                  iso3,
                  countryName,
                  detail: [reply.sentence || '', reply.method],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">How inflation has moved in the months after a one-point policy rate change, in this country's own history. Co-movement, not the effect of policy.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.reason}.
          </p>
        )}
        {reply?.ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-lp-sentence="true">{reply.sentence}</p>
            <div className="h-56" role="img" aria-label="Inflation response by month after a one-point rate change, with a 90% band. The numbers are in the table below.">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={reply.steps.map((s) => ({ h: s.h, band: [s.lo, s.hi], beta: s.beta }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                  <XAxis dataKey="h" tick={{ fontSize: 12 }} unit="m" />
                  <YAxis tick={{ fontSize: 12 }} width={44} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Tooltip formatter={(v: unknown) => (Array.isArray(v) ? `${f(v[0])} to ${f(v[1])} pts` : `${f(v as number)} pts`)} labelFormatter={(h) => `${h} months after`} />
                  <Area dataKey="band" name="90% band" stroke="none" fill="#2563eb" fillOpacity={0.2} isAnimationActive={false} />
                  <Line dataKey="beta" name="Response" stroke="#2563eb" strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartNumbers
              caption="Inflation after rate changes"
              columns={['Months after', 'Response (pts)', '90% band low', '90% band high']}
              rows={reply.steps.map((s) => [s.h, f(s.beta), f(s.lo), f(s.hi)])}
              newestFirst={false}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Points of inflation (% y/y) against the month before the move, per 1 point of policy rate. {reply.n} months, {reply.moves} with a rate change. Method: {reply.method} Sources: {(reply.sources || []).join('; ')}.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
