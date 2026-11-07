import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ValidationBadge } from './ValidationBadge';
import { ChartNumbers } from './ChartNumbers';
import { explainInChat } from '../utils/explainHandoff';
import type { EventStudy } from '../utils/eventStudy';

/**
 * Country Research > History & data > Currency around rate decisions (src/utils/eventStudy.ts):
 * the currency's average path in the days around its own central bank's and the Fed's rate changes.
 */

type Reply = ({ ok: true; sentence: string; method: string; sources: string[] } & EventStudy) | { ok: false; reason: string };

const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

export const EventStudyPanel: React.FC<{ iso3: string; countryName: string }> = ({ iso3, countryName }) => {
  const [bank, setBank] = useState<'own' | 'fed'>('own');
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setError(null);
    fetch(`/api/event-study/${encodeURIComponent(iso3)}?bank=${bank}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: Reply) => live && setReply(b))
      .catch((e: Error) => live && setError(`The event study could not be read (${e.message}).`));
    return () => {
      live = false;
    };
  }, [iso3, bank]);

  const ok = reply && reply.ok ? reply : null;
  const hikes = ok?.groups.find((g) => g.kind === 'hike');
  const cuts = ok?.groups.find((g) => g.kind === 'cut');
  const days = (hikes?.ok ? hikes.steps : cuts?.steps || []).map((s) => s.day);
  const data = days.map((day) => ({ day, hike: hikes?.steps.find((s) => s.day === day)?.mean, cut: cuts?.steps.find((s) => s.day === day)?.mean }));

  return (
    <section className="ui-panel" data-event-study="true" data-no-provenance-overlay="true">
      <header className="ui-panel-header">
        <h2 className="ui-section-title flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          Currency around rate decisions, {countryName}
          <ValidationBadge id="event_study" />
          {ok && (
            <button
              type="button"
              className="ui-btn ml-auto text-xs"
              data-explain-panel="true"
              onClick={() =>
                explainInChat({
                  kind: 'panel',
                  label: `Currency around ${bank === 'own' ? 'its central bank' : 'Fed'} rate changes, ${countryName}`,
                  value: ok.sentence,
                  source: ok.sources.join('; '),
                  asOf: ok.from && ok.to ? `${ok.from} to ${ok.to}` : undefined,
                  iso3,
                  countryName,
                  detail: [ok.method, ...ok.groups.filter((g) => g.ok).map((g) => `${g.kind}s (${g.n}): day 0 ${f(g.dayZero!)}%, day +20 ${f(g.end!)}%`)],
                })
              }
            >
              Explain
            </button>
          )}
        </h2>
        <p className="ui-label">How the currency has moved against the dollar in the days around rate changes. Up = weaker currency. A description of the past, not a forecast: many decisions were expected.</p>
      </header>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-pill" aria-pressed={bank === 'own'} onClick={() => setBank('own')}>
            Its central bank
          </button>
          <button type="button" className="ui-pill" aria-pressed={bank === 'fed'} onClick={() => setBank('fed')}>
            The Fed
          </button>
        </div>
        {!reply && !error && <p className="ui-body">Loading…</p>}
        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {reply && !reply.ok && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-missing="true">
            Missing: {reply.reason}.
          </p>
        )}
        {ok && (
          <>
            <p className="text-sm text-slate-900 dark:text-white" data-event-sentence="true">{ok.sentence}</p>
            {ok.groups.filter((g) => !g.ok).map((g) => (
              <p key={g.kind} className="text-xs text-amber-700 dark:text-amber-400" data-missing="true">
                {g.kind === 'hike' ? 'Hikes' : 'Cuts'}: {g.reason}.
              </p>
            ))}
            {data.length > 0 && (
              <div className="h-56" role="img" aria-label="Average currency path around rate hikes and cuts. The numbers are in the table below.">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} width={44} unit="%" />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip formatter={(v: unknown) => `${f(v as number)}%`} labelFormatter={(d) => `Day ${d}`} />
                    {hikes?.ok && <Line dataKey="hike" name={`After hikes (${hikes.n})`} stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {cuts?.ok && <Line dataKey="cut" name={`After cuts (${cuts.n})`} stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <ChartNumbers
              caption="Currency around rate decisions"
              columns={['Business day', 'Hikes: mean %', 'Hikes: 90% band', 'Cuts: mean %', 'Cuts: 90% band']}
              rows={days.map((d) => {
                const h = hikes?.steps.find((s) => s.day === d);
                const c = cuts?.steps.find((s) => s.day === d);
                return [d, h ? f(h.mean) : '—', h ? `${f(h.lo)} to ${f(h.hi)}` : '—', c ? f(c.mean) : '—', c ? `${f(c.lo)} to ${f(c.hi)}` : '—'];
              })}
              newestFirst={false}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {hikes?.n ?? 0} hikes and {cuts?.n ?? 0} cuts{ok.from ? `, ${ok.from} to ${ok.to}` : ''}. Method: {ok.method} Sources: {ok.sources.join('; ')}.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
