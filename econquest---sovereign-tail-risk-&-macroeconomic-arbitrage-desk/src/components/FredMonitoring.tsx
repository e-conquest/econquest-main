import { useEffect, useState } from 'react';
import { FredConfig, FredHistory, FredMode, FredRun, FredSeries, FredSummary, getFredCatalog, getFredConfig, getFredHistory, getFredRun, mutateFred, startFred } from '../services/fredApi';
import { fredHistory } from '../math/fredMonitoring';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';

function History({ data }: { data: FredHistory }) {
  const [offset, setOffset] = useState(0);
  const history = fredHistory(data.rows, data.series.metadata.frequency_short);
  if (!history.valid.length) return <p>No numeric history for this as-of date. {data.series.reason} No current-vintage fallback.</p>;
  const values = history.valid.map(r => r.value!);
  const min = Math.min(...values), max = Math.max(...values);
  const first = Date.parse(data.rows[0].date), last = Date.parse(data.rows.at(-1)!.date);
  const x = (date: string) => 20 + 760 * (Date.parse(date) - first) / (last - first || 1);
  const y = (value: number) => 180 - 160 * (value - min) / (max - min || 1);
  return <div className="space-y-2">
    <p>Native units: {data.series.metadata.units}; frequency: {data.series.metadata.frequency};
      {' '}{data.series.metadata.seasonal_adjustment}. No transformation or resampling.</p>
    <p>{data.series.validCount} numeric values; {data.series.missingCount} explicit missing dots.
      Latest numeric observation period: {data.series.latestValidObservation ?? 'Unavailable'}. Current freshness unverified.</p>
    {data.series.analysisBlocked && <p className="text-amber-200">Full-window/derived analysis blocked by missing values or unavailable history.</p>}
    <svg role="img" aria-label="FRED native history at selected real-time date" viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
      {history.segments.map((segment, i) => segment.length === 1
        ? <circle key={i} cx={x(segment[0].date)} cy={y(segment[0].value!)} r="2" fill="#22d3ee" />
        : <polyline key={i} points={segment.map(r => `${x(r.date)},${y(r.value!)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="2" />)}
      <text x="20" y="205" fill="#94a3b8" fontSize="12">{data.rows[0].date}</text>
      <text x="780" y="205" textAnchor="end" fill="#94a3b8" fontSize="12">{data.rows.at(-1)!.date}</text>
    </svg>
    <p className="text-xs">Native range: {min} to {max}. Nulls and nonconsecutive native periods disconnect lines.
      Daily weekends/holidays may also appear as breaks; no trading/release calendar is inferred.
      Monthly/quarterly dates label observation periods, not publication dates.</p>
    <details><summary>Native observations and real-time bounds</summary>
      <table className="w-full text-left text-sm"><thead><tr><th>Period</th><th>Exact API text</th><th>Real-time query bounds</th></tr></thead>
        <tbody>{data.rows.slice(offset, offset + 100).map(r => <tr key={r.date}><td>{r.date}</td><td>{r.rawValue === '.' ? 'Missing (.)' : r.rawValue}</td><td>{r.realtimeStart} to {r.realtimeEnd}</td></tr>)}</tbody></table>
      <button className={button} disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 100))}>Previous FRED values</button>
      <button className={button} disabled={offset + 100 >= data.rows.length} onClick={() => setOffset(n => n + 100)}>Next FRED values</button>
      <p>{offset + 1}–{Math.min(offset + 100, data.rows.length)} / {data.rows.length}</p>
    </details>
    <details><summary>Native definitions, archived vintage dates and source lineage</summary>
      <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(data.series, null, 2)}</pre>
      <p className="text-xs">Each observation page has its own SHA-256 in the native-history export. Real-time bounds are clipped by the query and are not original release timestamps.</p>
    </details>
  </div>;
}

export function FredMonitoring({ summaries, online, onRefresh }: {
  summaries: FredSummary[]; online: boolean; onRefresh: () => Promise<void>;
}) {
  const [config, setConfig] = useState<FredConfig | null>(null);
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<FredRun | null>(null);
  const [catalog, setCatalog] = useState<{ runId: string; series: FredSeries[] } | null>(null);
  const [view, setView] = useState<{ runId: string; mode: FredMode; asOf: string; data: FredHistory } | null>(null);
  const [seriesId, setSeriesId] = useState('');
  const [mode, setMode] = useState<FredMode>('current');
  const [asOf, setAsOf] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const id = selected || summaries.find(s => s.active && s.report.mode === 'current')?.id || summaries.at(-1)?.id || '';
  const currentSeries = seriesId || catalog?.series[0]?.id || '';
  const reportError = (cause: unknown) => {
    console.error('FRED/ALFRED operation failed:', cause);
    setError(cause instanceof Error ? cause.message : 'FRED/ALFRED operation failed.');
  };
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void getFredConfig().then(next => { if (!cancelled) setConfig(next); }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [online, reload]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getFredRun(id);
        if (cancelled) return;
        setRun(next); setError(null);
        if (next.status === 'running') timer = setTimeout(() => void load(), 2000);
        else if (summaries.find(s => s.id === id)?.status === 'running') void onRefresh().catch(reportError);
      } catch (cause) { if (!cancelled) reportError(cause); }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, summaries, onRefresh, reload]);
  useEffect(() => {
    if (!run || run.id !== id || !run.report.seriesCount || run.status === 'running') return;
    let cancelled = false;
    void getFredCatalog(run).then(series => { if (!cancelled) setCatalog({ runId: run.id, series }); }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run]);
  useEffect(() => {
    if (!run || !catalog || catalog.runId !== run.id || run.id !== id || !currentSeries || run.status === 'running') return;
    let cancelled = false;
    void getFredHistory(run, currentSeries).then(data => {
      if (!cancelled) setView({ runId: run.id, mode: run.report.mode, asOf: run.report.asOf, data });
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, catalog, currentSeries]);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startFred(mode, asOf);
      setSelected(next.id); setRun(next); setSeriesId('');
      await onRefresh();
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const mutate = async (action: 'commit' | 'rollback' | 'cancel') => {
    if (!run || (action !== 'cancel' && !confirm(`${action} ${run.report.mode} snapshot as of ${run.report.asOf}? Current and historical selections are separate. No model inputs or other providers change.`))) return;
    setBusy(true); setError(null);
    try { await mutateFred(run.id, action); setRun(await getFredRun(run.id)); await onRefresh(); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl">FRED and ALFRED: native history and as-of research</h2>
    <p>18 reviewed series; complete available history at native frequency. Manual pulls, separate current and historical active selections.
      ALFRED as-of snapshots are saved on demand, not a downloaded full revision archive.</p>
    <p className="text-amber-200">Monitoring only: fitted Firth/LightGBM/HMM inputs are unchanged.
      Nominal GDP is not real GDP; broad dollar index is not ICE DXY. Real-time dates are not intraday publication times.
      No freshness, forecast, trading-signal or backtest-validation claims.</p>
    <p>Backend key: {config ? config.configured ? 'Configured (not yet proof of API access)' : 'Not configured: export FRED_API_KEY into the backend process and restart it.' : 'Not checked'}.
      Never paste the key here or use VITE_* variables.</p>
    <button className={button} disabled={!online} onClick={() => setReload(n => n + 1)}>Reload FRED configuration and review</button>
    <details><summary>Reviewed FRED series basket</summary><ul>{config?.series.map(s => <li key={s.id}>{s.id}: {s.name} ({s.frequency})</li>)}</ul></details>
    <label className="block">FRED pull mode <select className={input} value={mode} onChange={e => setMode(e.target.value === 'historical' ? 'historical' : 'current')}>
      <option value="current">Current FRED history</option><option value="historical">Historical ALFRED as-of snapshot</option>
    </select></label>
    {mode === 'historical' && <label className="block">ALFRED as-of date <input type="date" className={input} value={asOf}
      min={config?.earliestDate} max={config?.today} onChange={e => setAsOf(e.target.value)} /></label>}
    <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I confirm authorized research use of FRED/ALFRED data and source-specific terms.</label>
    <button className={button} disabled={!online || !config?.configured || !consent || busy || summaries.some(s => s.status === 'running') ||
      (mode === 'historical' && (!asOf || asOf < (config?.earliestDate ?? '') || asOf > (config?.today ?? '')))} onClick={() => void start()}>
      {mode === 'current' ? 'Pull current FRED history' : 'Pull ALFRED as-of snapshot'}</button>
    {!online && <p className="text-amber-200">Backend unavailable; pulls/activation blocked. Retained history is not a current signal.</p>}
    {error && <p role="alert" className="text-rose-300">{error} Last valid review retained with its original date and identity.</p>}
    <label className="block">FRED/ALFRED saved snapshot <select className={`${input} max-w-full`} value={id} onChange={e => { setSelected(e.target.value); setSeriesId(''); }}>
      <option value="">No saved snapshot</option>{summaries.map(s => <option key={s.id} value={s.id}>{s.report.mode} · as of {s.report.asOf} · {s.status}{s.active ? ' · active' : ''} · {s.id}</option>)}
    </select></label>
    {run && <div className="space-y-3">
      <p>Reviewed {run.report.mode} snapshot {run.id}: as of {run.report.asOf}; {run.status} / {run.active ? 'active' : 'inactive'}.
        Retrieved: {run.report.retrievedAt ?? 'Acquisition not complete'}. Numeric observations: {run.report.numericCount ?? 0};
        available series: {run.report.availableSeries ?? 0} / {run.report.seriesCount ?? 18}.</p>
      {run.id !== id && <p className="text-amber-200">Retained manifest is not the requested snapshot selection.</p>}
      {!!run.report.errors?.length && <p role="alert">{run.report.errors.join('; ')}</p>}
      {run.status === 'running' && <><pre>{JSON.stringify(run.progress, null, 2)}</pre><button className={button} disabled={!online || busy || run.id !== id} onClick={() => void mutate('cancel')}>Cancel FRED pull</button></>}
      {catalog && <div>
        <p className="text-xs">Coverage catalog from snapshot {catalog.runId}.</p>
        <label>FRED series <select className={`${input} max-w-full`} value={currentSeries} onChange={e => setSeriesId(e.target.value)}>
          {catalog.series.map(s => <option key={s.id} value={s.id}>{s.id}: {s.metadata.title}</option>)}
        </select></label>
        <details><summary>FRED/ALFRED coverage and vintage availability</summary>
          <table className="w-full text-left text-sm"><thead><tr><th>Series</th><th>Numeric / missing</th><th>First archived vintage</th><th>Latest eligible vintage</th><th>Availability</th></tr></thead>
            <tbody>{catalog.series.map(s => <tr key={s.id}><td>{s.id}</td><td>{s.validCount} / {s.missingCount}</td><td>{s.firstArchivedVintage ?? 'Not supplied'}</td><td>{s.latestEligibleVintage ?? 'Unavailable'}</td><td>{s.status}: {s.reason}</td></tr>)}</tbody></table>
          <p>Archive dates mark changes/new releases, not every scheduled release. Metadata for unavailable historical series is current reference only.</p>
        </details>
      </div>}
      {view && <div className="space-y-2"><h3>Displayed {view.data.series.id}: {view.data.series.metadata.title}</h3>
        <p>Snapshot {view.runId} · {view.mode} · as of {view.asOf}
          {view.runId !== id || view.data.series.id !== currentSeries ? ' · Retained previous selection, not current selectors' : ''}.</p>
        <History key={`${view.runId}:${view.data.series.id}`} data={view.data} /></div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!online || busy || run.id !== id || run.active || !['staged', 'committed'].includes(run.status)} onClick={() => void mutate('commit')}>Activate {run.report.mode} FRED snapshot</button>
        <button className={button} disabled={!online || busy || run.id !== id || run.status !== 'committed'} onClick={() => void mutate('rollback')}>Rollback FRED snapshot</button>
        <a className={button} href={`/api/fred/${encodeURIComponent(run.id)}/export`}>Export FRED native history</a>
      </div>
      <details><summary>FRED contract and credential-free source originals</summary><pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(run.report, null, 2)}</pre>
        <ul className="text-xs break-all">{run.sources.map(s => <li key={s.ordinal}><a href={`/api/fred/${encodeURIComponent(run.id)}/sources/${s.ordinal}`}>Original {s.ordinal}</a> · HTTP {s.httpStatus} · {s.bytes} bytes · {s.sha256}<br />{s.path}</li>)}</ul>
      </details>
    </div>}
  </section>;
}
