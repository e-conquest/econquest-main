import React, { useEffect, useMemo, useState } from 'react';
import type { LiveWatchlistItem } from '../types/council';
import { WATCH_METRICS, evaluateRules, ruleText, type WatchMetric, type WatchOp, type WatchRule } from '../utils/watchRules';

/**
 * Watch alerts on Today: the thresholds you set on the timing figures, and which countries cross
 * them now. No rule is built in. Rules are kept in data/local/watch-rules.json on this computer.
 */
export const WatchAlertsPanel: React.FC<{
  items: LiveWatchlistItem[];
  onOpenCountry: (item: LiveWatchlistItem) => void;
  /** "Uses:" line linking back to Workspace > Your inputs. */
  uses?: React.ReactNode;
}> = ({ items, onOpenCountry, uses }) => {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ iso3: string; metric: WatchMetric; op: WatchOp; value: string }>({ iso3: '*', metric: 'cftc_percentile', op: '>=', value: '' });

  useEffect(() => {
    fetch('/api/watch-rules')
      .then((r) => (r.ok ? r.json() : { rules: [] }))
      .then((d) => setRules(Array.isArray(d?.rules) ? d.rules : []))
      .catch(() => setError('Could not read your watch alerts.'))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (next: WatchRule[]) => {
    setError('');
    try {
      const r = await fetch('/api/watch-rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: next }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Could not save.');
      setRules(d.rules);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    }
  };

  const { hits, noFigure } = useMemo(() => evaluateRules(rules, items), [rules, items]);
  const nameOf = (iso3: string) => items.find((i) => i.iso3 === iso3)?.countryName || iso3;
  const value = Number(draft.value);
  const canAdd = draft.value.trim() !== '' && Number.isFinite(value);

  return (
    <section className="ui-panel" data-watch-alerts="true">
      <header className="ui-panel-header flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="ui-section-title">Watch alerts</h3>
          <p className="ui-label">Thresholds you set on the timing figures. A missing figure never triggers. Kept on this computer.</p>
          {uses}
        </div>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setAdding((a) => !a)} data-watch-add-toggle="true">
          {adding ? 'Close' : 'Add a rule'}
        </button>
      </header>

      {adding && (
        <div className="px-4 py-3 flex flex-wrap items-end gap-2 border-b border-slate-100 dark:border-slate-800 text-sm">
          <label className="flex flex-col gap-1">
            <span className="ui-label">Country</span>
            <select className="border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1" value={draft.iso3} onChange={(e) => setDraft({ ...draft, iso3: e.target.value })}>
              <option value="*">Any country on screen</option>
              {items.map((i) => (
                <option key={i.iso3} value={i.iso3}>
                  {i.countryName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ui-label">Figure</span>
            <select className="border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1" value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as WatchMetric })}>
              {(Object.keys(WATCH_METRICS) as WatchMetric[]).map((m) => (
                <option key={m} value={m}>
                  {WATCH_METRICS[m].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ui-label">When</span>
            <select className="border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1" value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value as WatchOp })}>
              <option value=">=">at or above</option>
              <option value="<=">at or below</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="ui-label">Value{WATCH_METRICS[draft.metric].unit ? ` (${WATCH_METRICS[draft.metric].unit})` : ''}</span>
            <input
              className="w-24 border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 tabular-nums"
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              data-watch-value="true"
            />
          </label>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={!canAdd}
            data-watch-save="true"
            onClick={() => {
              void save([...rules, { id: `w${Date.now().toString(36)}`, iso3: draft.iso3, metric: draft.metric, op: draft.op, value, createdAt: new Date().toISOString() }]);
              setDraft({ ...draft, value: '' });
            }}
          >
            Save rule
          </button>
        </div>
      )}

      {error && <p className="px-4 py-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

      <div className="px-4 py-3 text-sm">
        {!loaded ? (
          <p className="ui-label">Loading your rules.</p>
        ) : !rules.length ? (
          <p className="ui-label">No rules yet. Add one, for example CFTC positioning percentile at or above 90 for any country.</p>
        ) : (
          <>
            {hits.length ? (
              <ul className="space-y-1 mb-3">
                {hits.map((h) => (
                  <li key={`${h.rule.id}-${h.iso3}`} data-watch-hit={h.iso3}>
                    <button
                      type="button"
                      className="text-left text-rose-700 dark:text-rose-400 hover:underline"
                      onClick={() => {
                        const it = items.find((i) => i.iso3 === h.iso3);
                        if (it) onOpenCountry(it);
                      }}
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-label mb-3">No rule is crossed now.</p>
            )}
            <ul className="space-y-1">
              {rules.map((r) => {
                const blanks = noFigure.filter((n) => n.rule.id === r.id).length;
                return (
                  <li key={r.id} className="flex items-baseline justify-between gap-2 text-slate-600 dark:text-slate-400">
                    <span>
                      {ruleText(r, nameOf(r.iso3))}
                      {blanks ? <span className="text-xs text-slate-500"> · no figure for {blanks} {blanks === 1 ? 'country' : 'countries'}</span> : null}
                    </span>
                    <button type="button" className="ui-btn ui-btn-ghost text-xs" onClick={() => void save(rules.filter((x) => x.id !== r.id))}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
};
