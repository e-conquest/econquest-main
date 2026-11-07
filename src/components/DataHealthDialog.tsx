/**
 * Menu > Data health: is the data the app shows still coming in, and has any of it changed under
 * it? Three views, read from the server (src/utils/dataHealth.ts, figureWatch.ts, officialHistory.ts):
 *
 * - Sources: every source's state at the last check, failing since, and its last checks as dots.
 * - Figure alerts: watchlist figures that went missing, got old, jumped, left their range or were revised.
 * - Revisions: IMF and World Bank yearly values changed since the app first downloaded them.
 * - Scheduled: jobs the server runs by itself (Download all, the pre-registered tests) and how each run ended.
 *
 * Nothing here changes a figure: it says what to check.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';
import type { ConnectionState } from '../utils/connectionCheck';
import type { SourceHealth } from '../utils/dataHealth';
import type { FigureEvent, FigureEventKind, OpenIssue } from '../utils/figureWatch';
import type { HistoryRevision } from '../utils/officialHistory';

type SourcesReply = {
  sources: SourceHealth[];
  runs: number;
  lastRun: { at: string; trigger: string; label: string } | null;
  nightly: { time: string; timeZone: string; lastDay: string | null; lastSkipped: { at: string; reason: string } | null };
  file: string;
};
type FiguresReply = { open: OpenIssue[]; events: FigureEvent[]; total: number; kinds: Record<FigureEventKind, string>; watchedSince: string | null };
type RevisionRow = HistoryRevision & { iso3: string; figure: string; label: string; unit: string; source: string };
type RevisionsReply = { revisions: RevisionRow[]; total: number; projectionsHidden: number; countries: number };

type JobRun = { startedAt: string; finishedAt?: string; ok?: boolean; summary?: string };
type ScheduledReply = {
  timeZone: string;
  jobs: Array<{ id: string; label: string; what: string; env: string; on: boolean; schedule: string; running: boolean; lastSkipped: { at: string; reason: string } | null; runs: JobRun[] }>;
  nightlyCheck: { schedule: string };
  file: string;
};

export type DataHealthTab = 'sources' | 'figures' | 'revisions' | 'scheduled';

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const FAILING = new Set<ConnectionState>(['no_answer', 'refused', 'bad_reply']);
const STATE_TEXT: Record<ConnectionState, string> = {
  connected: 'Connected',
  needs_setup: 'Needs setup',
  optional: 'Not set (optional)',
  off: 'Off (your own account)',
  no_answer: 'No answer',
  refused: 'Refused',
  bad_reply: 'Unreadable answer',
};
const dotClass = (s: ConnectionState) =>
  s === 'connected' ? 'bg-emerald-500' : FAILING.has(s) ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600';
/** Failing first, then connected, then sources not asked (setup, off, optional). */
const rank = (s: ConnectionState) => (FAILING.has(s) ? 0 : s === 'connected' ? 1 : 2);
const KIND_CLASS: Record<FigureEventKind, string> = {
  missing: 'text-rose-700 dark:text-rose-300',
  out_of_range: 'text-rose-700 dark:text-rose-300',
  jump: 'text-amber-700 dark:text-amber-300',
  stale: 'text-amber-700 dark:text-amber-300',
  revised: 'text-blue-700 dark:text-blue-300',
  back: 'text-emerald-700 dark:text-emerald-300',
};

function useJson<T>(url: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => alive && (setData(j), setError(null)))
      .catch((e) => alive && setError(`The app server did not answer (${e?.message || 'error'}).`));
    return () => {
      alive = false;
    };
  }, [url, n]);
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

function SourcesView() {
  const { data, error, reload } = useJson<SourcesReply>('/api/data/health/sources');
  const [checking, setChecking] = useState(false);
  const checkNow = async () => {
    setChecking(true);
    try {
      await fetch('/api/data/connections?refresh=1');
    } finally {
      setChecking(false);
      reload();
    }
  };
  const failing = data?.sources.filter((s) => FAILING.has(s.state)) || [];
  return (
    <div className="space-y-3">
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {data?.lastRun ? `Last check ${when(data.lastRun.at)} (${data.lastRun.label})` : 'No check saved yet.'}
          {data ? ` · Nightly after ${data.nightly.time} (${data.nightly.timeZone})` : ''}
          {data?.nightly.lastSkipped ? ` · ${data.nightly.lastSkipped.reason}` : ''}
        </span>
        <button type="button" onClick={() => void checkNow()} disabled={checking} className="ui-btn ui-btn-ghost inline-flex items-center gap-1 ml-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden /> {checking ? 'Checking every source…' : 'Check now'}
        </button>
      </div>
      {data && data.sources.length > 0 && (
        <p data-testid="health-sources-summary" className={failing.length ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}>
          {failing.length
            ? failing.length > 4
              ? `${failing.length} sources failing at the last check, listed first below.${failing.length >= data.sources.filter((x) => x.group === 'free').length ? ' Every free source failed: this computer was probably offline.' : ''}`
              : `${failing.length} source${failing.length === 1 ? '' : 's'} failing at the last check: ${failing.map((s) => s.name).join(', ')}.`
            : 'Every source that was asked answered at the last check.'}
        </p>
      )}
      {data && !data.sources.length && <p>The first check runs tonight after {data.nightly.time}, or press Check now.</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {[...(data?.sources || [])].sort((a, b) => rank(a.state) - rank(b.state)).map((s) => (
          <li key={s.id} className="py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>
              <span className={`text-xs ${FAILING.has(s.state) ? 'text-rose-700 dark:text-rose-300' : s.state === 'connected' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                {STATE_TEXT[s.state]}
                {s.failingSince ? ` since ${day(s.failingSince)} (${s.failuresInRow} check${s.failuresInRow === 1 ? '' : 's'} in a row)` : ''}
              </span>
              <span className="ml-auto flex gap-0.5" aria-label={`Last ${s.recent.length} checks`}>
                {s.recent.map((r, i) => (
                  <span key={i} title={`${when(r.at)}: ${STATE_TEXT[r.state]}`} className={`inline-block w-2 h-2 rounded-full ${dotClass(r.state)}`} />
                ))}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {FAILING.has(s.state) ? s.detail : s.sample || s.detail}
              {s.asked ? ` · Connected ${s.connected} of its last ${s.asked} checks` : ''}
              {FAILING.has(s.state) && s.lastConnectedAt ? ` · last connected ${day(s.lastConnectedAt)}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {data && <p className="text-xs text-slate-400 dark:text-slate-500">{data.runs} checks saved in {data.file} (states and reasons only, never keys).</p>}
    </div>
  );
}

function FiguresView() {
  const [kind, setKind] = useState<FigureEventKind | ''>('');
  const [iso3, setIso3] = useState('');
  const params = new URLSearchParams({ limit: '300', ...(kind ? { kind } : {}), ...(iso3 ? { iso3 } : {}) });
  const { data, error } = useJson<FiguresReply>(`/api/data/health/figures?${params}`);
  return (
    <div className="space-y-3">
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
      {data && (
        <div data-testid="health-open">
          {data.open.length ? (
            <>
              <p className="font-medium text-slate-800 dark:text-slate-100">Open now</p>
              <ul className="text-sm">
                {data.open.map((o) => (
                  <li key={`${o.iso3}:${o.figure}`} className={o.kind === 'missing' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}>
                    {o.iso3} · {o.label}: {o.kind === 'missing' ? `missing since ${when(o.since)}` : `older than usual since ${day(o.since)}`} (last {o.lastValue}
                    {o.period ? ` for ${o.period}` : ''})
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-emerald-700 dark:text-emerald-300">{data.watchedSince ? 'No watchlist figure is missing or older than usual.' : 'Watching starts when the watchlist is next built.'}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="health-kind">
          Alert
        </label>
        <select id="health-kind" value={kind} onChange={(e) => setKind(e.target.value as FigureEventKind | '')} className="px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white">
          <option value="">Every alert</option>
          {data &&
            Object.entries(data.kinds).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
        </select>
        <label className="sr-only" htmlFor="health-iso3">
          Country code
        </label>
        <input id="health-iso3" value={iso3} onChange={(e) => setIso3(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} placeholder="Country (e.g. BRA)" className="w-40 px-2 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white" />
        {data && <span className="text-xs text-slate-500 dark:text-slate-400">{data.total > data.events.length ? `Newest ${data.events.length} of ${data.total}` : `${data.total} alert${data.total === 1 ? '' : 's'}`}</span>}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data?.events.map((e, i) => (
          <li key={`${e.at}-${e.iso3}-${e.figure}-${i}`} className="py-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 block">
              {when(e.at)} · <span className={KIND_CLASS[e.kind]}>{data.kinds[e.kind] || e.kind}</span>
            </span>
            <span className="text-slate-800 dark:text-slate-100">
              {e.country} · {e.label}
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400">{e.detail}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Rules: missing for 30 minutes or more; older than the source's usual age; a move bigger than the figure plausibly makes in one step; a value outside its plausible range; the same period with a new value. An alert says what to check: it never changes a figure.
      </p>
    </div>
  );
}

function RevisionsView() {
  const [projections, setProjections] = useState(false);
  const { data, error } = useJson<RevisionsReply>(`/api/data/health/revisions?limit=400${projections ? '&projections=1' : ''}`);
  return (
    <div className="space-y-3">
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={projections} onChange={(e) => setProjections(e.target.checked)} /> Include IMF projections
        </label>
        {data && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.total} revision{data.total === 1 ? '' : 's'} across {data.countries} countries{data.projectionsHidden ? ` · ${data.projectionsHidden} revised projections hidden` : ''}
          </span>
        )}
      </div>
      {data && !data.total && <p>No yearly IMF or World Bank value has changed since the app first downloaded it. Changes are found when the full history is downloaded again (weekly, or Menu &gt; Offline data).</p>}
      {data && data.total > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="pr-3 font-normal">Seen</th>
                <th className="pr-3 font-normal">Country</th>
                <th className="pr-3 font-normal">Figure</th>
                <th className="pr-3 font-normal">Year</th>
                <th className="pr-3 font-normal">Was</th>
                <th className="font-normal">Now</th>
              </tr>
            </thead>
            <tbody>
              {data.revisions.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="pr-3 whitespace-nowrap">{day(r.seenAt)}</td>
                  <td className="pr-3">{r.iso3}</td>
                  <td className="pr-3" title={r.source}>
                    {r.label}
                    {r.unit ? <span className="text-xs text-slate-500 dark:text-slate-400"> ({r.unit})</span> : null}
                  </td>
                  <td className="pr-3">
                    {r.date}
                    {r.projection ? <span className="text-xs text-slate-500 dark:text-slate-400"> projection</span> : null}
                  </td>
                  <td className="pr-3 tabular-nums">{r.from}</td>
                  <td className="tabular-nums">{r.to ?? 'no longer published'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScheduledView() {
  const { data, error } = useJson<ScheduledReply>('/api/scheduled-jobs');
  return (
    <div className="space-y-3">
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        <li className="py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-slate-800 dark:text-slate-100">Data check</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{data?.nightlyCheck.schedule}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Asks every source once; results are on the Sources tab.</p>
        </li>
        {(data?.jobs || []).map((j) => (
          <li key={j.id} className="py-2" data-testid={`scheduled-job-${j.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-slate-800 dark:text-slate-100">{j.label}</span>
              <span className={`text-xs ${j.on ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                {j.schedule}
                {j.running ? ' · running now' : ''}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {j.what}
              {!j.on ? ` To switch it on, set ${j.env} on the server (see docs/HOME_SERVER.md).` : ''}
            </p>
            {j.lastSkipped && <p className="text-xs text-amber-700 dark:text-amber-300">{when(j.lastSkipped.at)}: {j.lastSkipped.reason}</p>}
            {j.runs.length > 0 && (
              <table className="mt-1 w-full text-left text-xs">
                <tbody>
                  {j.runs.map((r) => (
                    <tr key={r.startedAt} className="align-top">
                      <td className="pr-3 whitespace-nowrap tabular-nums">{when(r.startedAt)}</td>
                      <td className={r.finishedAt ? (r.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300') : 'text-slate-500'}>
                        {r.finishedAt ? r.summary : 'Running…'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {j.on && !j.runs.length && <p className="text-xs text-slate-500 dark:text-slate-400">No run yet.</p>}
          </li>
        ))}
      </ul>
      {data && <p className="text-xs text-slate-500 dark:text-slate-400">Kept in {data.file}.</p>}
    </div>
  );
}

export function DataHealthDialog({ onClose, initialTab = 'sources' }: { onClose: () => void; initialTab?: DataHealthTab }) {
  const [tab, setTab] = useState<DataHealthTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const tabs: Array<[DataHealthTab, string]> = [
    ['sources', 'Sources'],
    ['figures', 'Figure alerts'],
    ['revisions', 'Revisions'],
    ['scheduled', 'Scheduled'],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="data-health-title" className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="data-health-title" className="ui-title inline-flex items-center gap-2">
            <Activity className="w-4 h-4" aria-hidden /> Data health
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close data health" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div role="tablist" className="flex gap-1 px-4 pt-2 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === id ? 'border-blue-600 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="p-4 overflow-y-auto ui-body">
          {tab === 'sources' && <SourcesView />}
          {tab === 'figures' && <FiguresView />}
          {tab === 'revisions' && <RevisionsView />}
          {tab === 'scheduled' && <ScheduledView />}
        </div>
      </div>
    </div>
  );
}
