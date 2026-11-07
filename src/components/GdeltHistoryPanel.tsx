import { ChartNumbers } from './ChartNumbers';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { V1Reading, V1Series } from '../utils/gdeltDaily';
import { GDELT_V1_SHORT, V1_PERCENTILE_RULE, v1Figures } from '../utils/gdeltDaily';
import type { SpikeMonth } from '../utils/unrestSpikes';
import { ValidationBadge } from './ValidationBadge';

/**
 * Research > History & data > Event history: protests and violence as a share of the country's
 * events per month, from the GDELT 1.0 event files (utils/gdeltDaily.ts). Shares, not counts,
 * since GDELT's volume grew many times over the years. Before a pull it says Missing and how.
 */

type Reply = { series: V1Series | null; reading: V1Reading | null; spikes?: SpikeMonth[]; spikeSentence?: string | null; spikeMethod?: string; pull: { pulledAt?: string; note?: string }; from: string };

export const GdeltHistoryPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/gdelt-daily/${encodeURIComponent(iso3)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The GDELT history could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3]);
  const s = reply?.series;
  const r = reply?.reading;
  return (
    <section className="ui-panel" data-gdelt-daily="true" data-no-provenance-overlay="true" data-no-stat-ref="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">Event history, {countryName} <ValidationBadge id="unrest_onset" /></h2>
        <p className="ui-label">Protests and violence as a share of the country&apos;s reported events, month by month, from GDELT&apos;s own event files.</p>
      </header>
      <div className="p-4 space-y-3">
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !s && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.pull.pulledAt ? `no GDELT 1.0 months on disk name ${countryName}` : 'GDELT 1.0 files not pulled yet'}. Pull them with <code>npm run gdelt:daily</code> (from {reply.from}; add{' '}
            <code>-- --estimate</code> to see the size first).{reply.pull.note ? ` Last pull: ${reply.pull.note}.` : ''}
          </p>
        )}
        {r && v1Figures(r).sentences.length > 0 && <p className="text-sm text-slate-900 dark:text-white">{v1Figures(r).sentences.join(' ')}</p>}
        {s && (
          <>
            <div className="h-64" role="img" aria-label={`Protests and violence as a share of ${countryName}'s reported events, ${s.points[0]?.month} to ${s.points[s.points.length - 1]?.month}. The numbers are in the table below.`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 12 }} width={48} unit="%" />
                  <Tooltip formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="linear" dataKey="protestPct" name="Protests" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="violencePct" name="Violence" stroke="#e11d48" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {r && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {r.month}: protests {r.protestPct}%{r.protestPctile !== null ? ` (${r.protestPctile}th percentile)` : ''}, violence {r.violencePct}%
                {r.violencePctile !== null ? ` (${r.violencePctile}th percentile)` : ''}, against {r.months} months from {r.from}. {V1_PERCENTILE_RULE}.
              </p>
            )}
            {reply?.spikeSentence && (
              <div className="space-y-1" data-unrest-spikes="true">
                <p className="text-sm text-slate-900 dark:text-white">{reply.spikeSentence}</p>
                {(reply.spikes || []).filter((x) => x.episodes.length).length > 0 && (
                  <ul className="text-xs text-slate-600 dark:text-slate-300 list-disc pl-5">
                    {(reply.spikes || [])
                      .filter((x) => x.episodes.length)
                      .slice(-8)
                      .reverse()
                      .map((x) => (
                        <li key={x.month}>
                          {x.month}: spike in {x.episodes.join(' and ')} (protests {x.protestPct}%, z {x.protestZ}; violence {x.violencePct}%, z {x.violenceZ})
                        </li>
                      ))}
                  </ul>
                )}
                {reply.spikeMethod && <p className="text-xs text-slate-500 dark:text-slate-400">{reply.spikeMethod} Whether a spike year comes before armed conflict the next year is a pre-registered test (Models &amp; validation).</p>}
              </div>
            )}
            <ChartNumbers
              caption={`Event history, ${countryName}`}
              columns={['Month', 'Protests (%)', 'Violence (%)']}
              rows={s.points.map((p) => [p.month, p.protestPct, p.violencePct])}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {s.points.length} months, {s.points[0]?.month} to {s.points[s.points.length - 1]?.month}. Source: {GDELT_V1_SHORT}
              {s.pulledAt ? `, pulled ${s.pulledAt.slice(0, 10)}` : ''}. An event counts where it took place or when the country is an actor.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
