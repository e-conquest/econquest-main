import React, { useCallback, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { DEFAULT_QUESTIONS, MAX_QUESTIONS, type MorningBriefFile, type MorningBriefSettings as Settings } from '../utils/morningBrief';

/**
 * Menu > Settings > Morning brief: when to run, which watchlist, and the standing questions.
 * Each brief is saved to saved research (Reports) with what moved since the same question last ran.
 */
type Reply = MorningBriefFile & { next: string; running: boolean; watchlists: Array<{ id: string; name: string; countries: number }> };

const FIELD = 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-sm text-slate-900 dark:text-white';

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const MorningBriefSettings: React.FC = () => {
  const [reply, setReply] = useState<Reply | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/morning-brief');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as Reply;
      setReply(r);
      setDraft({ ...r.settings, timeZone: r.settings.enabled ? r.settings.timeZone : browserZone() });
    } catch (e) {
      setError(`The app server did not answer (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: Settings) => {
    setError('');
    setSaved('');
    try {
      const res = await fetch('/api/morning-brief', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // The time is read in this browser's zone (right under Docker too, whose clock is on UTC).
        body: JSON.stringify({ settings: { ...next, timeZone: browserZone() } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReply((r) => (r ? { ...r, ...body } : r));
      setDraft(body.settings);
      setSaved('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runNow = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/morning-brief/run', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (!reply || !draft) return <p className="text-sm text-slate-500">{error || 'Loading…'}</p>;
  const qs = draft.questions.length ? draft.questions : [''];
  const setQ = (i: number, v: string) => setDraft({ ...draft, questions: qs.map((q, j) => (j === i ? v : q)) });
  const last = reply.lastRun;

  return (
    <div className="space-y-5" data-morning-brief="true">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        At the time you set, the council answers your standing questions about a watchlist from the app's figures, your AI model writes the summary, and each one is saved to saved research
        (Reports) with what moved since the same question last ran. The app must be running then; if it was closed, the brief runs when it next starts that day.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Run every day
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          At
          <input type="time" className={`${FIELD} ml-2`} value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} aria-label="Time of the morning brief" />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          Watchlist
          <select className={`${FIELD} ml-2`} value={draft.watchlistId || reply.watchlists[0]?.id || ''} onChange={(e) => setDraft({ ...draft, watchlistId: e.target.value })} aria-label="Watchlist for the morning brief">
            {reply.watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.countries})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400" data-morning-next="true">
        Next: {reply.next}. Times are read in {browserZone()}.
      </p>

      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Standing questions</h4>
        <div className="mt-2 space-y-2">
          {qs.map((q, i) => (
            <input key={i} className={`${FIELD} block w-full`} value={q} maxLength={300} placeholder="A question for the council" onChange={(e) => setQ(i, e.target.value)} aria-label={`Question ${i + 1}`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {qs.length < MAX_QUESTIONS && (
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setDraft({ ...draft, questions: [...qs, ''] })}>
              Add a question
            </button>
          )}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setDraft({ ...draft, questions: DEFAULT_QUESTIONS })}>
            Use the starting questions
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => void save({ ...draft, questions: qs.map((q) => q.trim()).filter(Boolean) })}>
          Save
        </button>
        <button type="button" className="ui-btn inline-flex items-center gap-1.5" onClick={() => void runNow()} disabled={running || reply.running}>
          <Play className="w-3.5 h-3.5" aria-hidden /> {running || reply.running ? 'Running…' : 'Run now'}
        </button>
        {saved && <span className="text-xs text-emerald-700 dark:text-emerald-400" role="status">{saved}</span>}
      </div>

      {last && (
        <div data-morning-last="true">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Last brief: {new Date(last.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ({last.trigger === 'manual' ? 'run by hand' : 'scheduled'}), {last.watchlist}, {last.countries} countries
          </h4>
          <ul className="mt-1 space-y-1">
            {last.results.map((r, i) => (
              <li key={i} className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-100">{r.question}</span> {r.headline ? `– ${r.headline}` : r.note ? `– ${r.note}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">Open them under Reports &gt; Saved research, where each starts with "Morning brief:".</p>
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
