/**
 * Offline data: the "Download all country data" window (Menu > Offline data) and the Offline pill
 * in the top bar. Both read the server: /api/preload for the download (same run as
 * `npm run preload`), /api/online for whether the free feeds can be reached from this computer.
 *
 * Screens always show only the newest value; this window is about having everything saved so the
 * app is fast and keeps working without a connection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, HardDriveDownload, Square, X } from 'lucide-react';
import { formatBytes, type PreloadState, type PreloadSummary } from '../utils/preload';

type PreloadReply = {
  state: PreloadState;
  summary: PreloadSummary;
  disk: { bytes: number; remainingEstimateBytes: number | null; countriesOnDisk: number };
  file: string;
};
type OnlineReply = {
  online: boolean;
  checkedAt: string;
  savedFrom: string | null;
  savedNewest: string | null;
  countriesSaved: number;
  countriesTotal: number;
  preloadRunning: boolean;
};

const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const dayTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/** "1 min 20 s" since an ISO time. */
export function elapsed(sinceIso: string, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - Date.parse(sinceIso)) / 1000));
  if (!Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  return m ? `${m} min ${sec % 60} s` : `${sec} s`;
}

/** Polls whether the feeds answer (every minute) and whether the browser itself has a network. */
export function useOnlineStatus(): OnlineReply | null {
  const [status, setStatus] = useState<OnlineReply | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/online')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setStatus(j))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    const onChange = () => load();
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);
  return status;
}

/** Top-bar pill, shown only while the feeds cannot be reached. */
export function OfflinePill({ status, onOpen }: { status: OnlineReply | null; onOpen: () => void }) {
  if (!status || status.online) return null;
  const from = status.savedFrom ? `saved data from ${day(status.savedFrom)}` : 'nothing saved yet';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap text-amber-700 dark:text-amber-300"
      title={`The free data feeds cannot be reached from this computer. The app shows ${from}; figures refresh once the feeds answer again.`}
    >
      <CloudOff className="w-3.5 h-3.5" aria-hidden />
      <span>Offline</span>
      <span className="hidden md:inline text-slate-500 dark:text-slate-400">· {from}</span>
    </button>
  );
}

export function OfflineDataDialog({ onClose }: { onClose: () => void }) {
  const [reply, setReply] = useState<PreloadReply | null>(null);
  const [online, setOnline] = useState<OnlineReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([fetch('/api/preload'), fetch('/api/online')]);
      if (!p.ok) throw new Error(`HTTP ${p.status}`);
      setReply(await p.json());
      if (o.ok) setOnline(await o.json());
      setError(null);
    } catch (e: any) {
      setError(`The app server did not answer (${e?.message || 'error'}).`);
    }
  }, []);

  useEffect(() => {
    void load();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  // Refresh every 2 s while a download runs, else every 30 s.
  const running = Boolean(reply?.state.running);
  useEffect(() => {
    const t = setInterval(() => void load(), running ? 2000 : 30_000);
    return () => clearInterval(t);
  }, [load, running]);

  const post = async (url: string, body?: unknown) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      setReply(await r.json());
      setTimeout(() => void load(), 800);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  // Ticks every second so the running step's time moves even between server polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const s = reply?.summary;
  const pct = s && s.total ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-data-title"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="offline-data-title" className="ui-title inline-flex items-center gap-2">
            <HardDriveDownload className="w-4 h-4" aria-hidden /> Offline data
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close offline data" className="ui-btn ui-btn-ghost">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto ui-body">
          <p>
            Download every free feed for every country the app covers, with the full World Bank and IMF history, so
            pages and the History tab load from this computer and keep working without a connection. Screens still
            show only the newest value.
          </p>

          {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}

          {online && (
            <p className={online.online ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}>
              {online.online
                ? 'Online: the free feeds answer from this computer.'
                : 'Offline: the free feeds cannot be reached from this computer. The app shows what is saved; a download needs a connection.'}
            </p>
          )}

          {s && reply && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="ui-label">Countries ready</div>
                <div className="ui-num text-base">
                  {s.countriesReady} of {s.countriesTotal}
                </div>
              </div>
              <div>
                <div className="ui-label">Steps saved</div>
                <div className="ui-num text-base">
                  {s.done} of {s.total}
                </div>
              </div>
              <div>
                <div className="ui-label">On this computer</div>
                <div className="ui-num text-base">{formatBytes(reply.disk.bytes)}</div>
              </div>
              <div>
                <div className="ui-label">Still to download</div>
                <div className="ui-num text-base" title="Average size of the countries already saved, times the countries left">
                  {reply.disk.remainingEstimateBytes === null
                    ? 'Known after the first country'
                    : reply.disk.remainingEstimateBytes === 0
                    ? 'None'
                    : `About ${formatBytes(reply.disk.remainingEstimateBytes)}`}
                </div>
              </div>
            </div>
          )}

          {s && (
            <div>
              <div className="h-2 bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download progress">
                <div className="h-2 bg-blue-600 dark:bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                {reply?.state.running
                  ? reply.state.waiting
                    ? `${reply.state.waiting.why}, until ${dayTime(reply.state.waiting.until)}.`
                    : reply.state.current
                    ? `Now (step ${s.done + s.failed + s.skipped + 1} of ${s.total}, running ${elapsed(reply.state.current.since, now)}): ${reply.state.current.label}`
                    : 'Starting…'
                  : s.completeAsOf
                  ? `Everything saved; the oldest step is from ${dayTime(s.completeAsOf)}.`
                  : reply?.state.finishedAt
                  ? `Last download finished ${dayTime(reply.state.finishedAt)}.`
                  : reply?.state.endedEarly
                  ? reply.state.endedEarly
                  : 'Not downloaded yet.'}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {running ? (
              <button type="button" className="ui-btn inline-flex items-center gap-1.5" onClick={() => void post('/api/preload/stop')}>
                <Square className="w-3.5 h-3.5" aria-hidden /> Stop after this step
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary inline-flex items-center gap-1.5"
                  disabled={online?.online === false}
                  onClick={() => void post('/api/preload/start')}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden />
                  {s && s.done > 0 && s.done < s.total ? 'Carry on downloading' : 'Download all country data'}
                </button>
                {s && s.done > 0 && (
                  <button type="button" className="ui-btn ui-btn-ghost" disabled={online?.online === false} onClick={() => void post('/api/preload/start', { fresh: true })}>
                    Download everything again
                  </button>
                )}
              </>
            )}
          </div>

          {s && s.problems.length > 0 && (
            <div>
              <div className="ui-section-title mb-1">Not saved</div>
              <ul className="space-y-1">
                {s.problems.map((p) => (
                  <li key={p.id}>
                    <span className={p.outcome === 'skipped' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-600 dark:text-rose-400'}>
                      {p.outcome === 'skipped' ? 'Needs setup' : 'Missing'}
                    </span>{' '}
                    {p.label}
                    {p.note ? <span className="text-slate-500 dark:text-slate-400">: {p.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-slate-500 dark:text-slate-400">
            Takes a few minutes per country. A step that takes longer than 3 minutes is listed as not saved and the run moves on. You can
            close this window; the download carries on, and a stopped one picks up where it left off. Same as{' '}
            <code>npm run preload</code> in a terminal. Saved in data/live, data/history and data/archive; progress in{' '}
            {reply?.file || 'data/local/preload.json'}.
          </p>
        </div>
      </div>
    </div>
  );
}
