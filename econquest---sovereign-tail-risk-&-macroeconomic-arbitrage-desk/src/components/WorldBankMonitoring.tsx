import { useEffect, useState } from 'react';
import { getWorldBankCoverage, getWorldBankObservations, getWorldBankRun, mutateWorldBank, startWorldBank, WorldBankCoverage, WorldBankObservations, WorldBankRun, WorldBankSummary, WorldBankProvider } from '../services/worldbankApi';
import { worldbankHistory } from '../math/worldbankMonitoring';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';

function NativeChart({ data, label }: { data: WorldBankObservations; label: string }) {
  const history = worldbankHistory(data.rows);
  const values = history.sorted.filter(r => r.value !== null).map(r => r.value!);
  if (!values.length) return <p>No valid {label} values for this economy/indicator. Analysis unavailable; nothing is filled.</p>;
  const min = Math.min(...values), max = Math.max(...values);
  const first = history.sorted[0].year, last = history.sorted.at(-1)!.year;
  const x = (year: number) => 20 + 760 * (year - first) / (last - first || 1);
  const y = (value: number) => 180 - 160 * (value - min) / (max - min || 1);
  return <div className="space-y-2">
    <svg role="img" aria-label={`${label} annual native history with gaps`} viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
      {history.segments.map((segment, i) => segment.length === 1
        ? <circle key={i} cx={x(segment[0].year)} cy={y(segment[0].value!)} r="3" fill="#22d3ee" />
        : <polyline key={i} points={segment.map(r => `${x(r.year)},${y(r.value!)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="2" />)}
      <text x="20" y="205" fill="#94a3b8" fontSize="12">{first}</text>
      <text x="780" y="205" textAnchor="end" fill="#94a3b8" fontSize="12">{last}</text>
    </svg>
    <p>Vertical range: {min} to {max} in native API values. No scaling, resampling or currency conversion.
      Gaps, unit changes and flagged/footnoted observations are not connected.</p>
    {data.series?.analysisBlocked && <p className="text-amber-200">Full-window/derived analysis blocked by missing years or source flags/footnotes; inspect before analysis.</p>}
    <details><summary>Annual values, native units, status and footnotes</summary>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm">
        <thead><tr><th>Year</th><th>Native value</th><th>API unit</th><th>Status</th><th>Footnote</th></tr></thead>
        <tbody>{history.sorted.map(r => <tr key={r.year}><td>{r.year}</td><td>{r.value ?? 'Missing'}</td><td>{r.unit || 'See indicator definition; unit field unavailable/blank'}</td><td>{r.status || 'Unknown / unverified'}</td><td>{r.footnote || (r.attributes ? JSON.stringify(r.attributes) : 'None supplied')}</td></tr>)}</tbody>
      </table></div>
    </details>
    <details><summary>Exact series, precision and source checksums</summary><pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(data, null, 2)}</pre></details>
  </div>;
}

export function WorldBankMonitoring({ summaries, online, onRefresh, provider = 'worldbank' }: {
  summaries: WorldBankSummary[]; online: boolean; onRefresh: () => Promise<void>; provider?: WorldBankProvider;
}) {
  const ids = provider === 'ids';
  const label = ids ? 'IDS' : 'World Bank';
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<WorldBankRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reload, setReload] = useState(0);
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [economySearch, setEconomySearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [globalCoverage, setGlobalCoverage] = useState(false);
  const [view, setView] = useState<{ runId: string; country: string; indicator: string; name: string; description: string; organization: string; data: WorldBankObservations } | null>(null);
  const [coverage, setCoverage] = useState<{ runId: string; scope: string; rows: WorldBankCoverage[]; total: number; offset: number } | null>(null);
  const id = selected || summaries.find(s => s.active)?.id || summaries.at(-1)?.id || '';
  const currentCountry = country || run?.report.countries?.[0]?.code || '';
  const currentIndicator = indicator || run?.report.indicators?.[0]?.code || '';
  const reportError = (cause: unknown) => {
    console.error('World Bank operation failed:', cause);
    setError(cause instanceof Error ? cause.message : 'World Bank operation failed.');
  };
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getWorldBankRun(id, provider);
        if (cancelled) return;
        setRun(next); setError(null);
        if (next.status === 'running') timer = setTimeout(() => void load(), 2000);
        else if (summaries.find(s => s.id === id)?.status === 'running') void onRefresh().catch(reportError);
      } catch (cause) { if (!cancelled) reportError(cause); }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, reload, summaries, onRefresh, provider]);
  useEffect(() => {
    if (!run || run.id !== id || run.status === 'running' || !currentCountry || !currentIndicator) return;
    const definition = run.report.indicators?.find(i => i.code === currentIndicator);
    if (!definition) return;
    let cancelled = false;
    void getWorldBankObservations(id, currentCountry, currentIndicator, provider).then(data => {
      if (!cancelled) setView({ runId: id, country: currentCountry, indicator: currentIndicator,
        name: definition.name, description: definition.description, organization: definition.sourceOrganization, data });
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, currentCountry, currentIndicator, provider]);
  useEffect(() => {
    if (!run || run.id !== id || !run.report.countries || run.status === 'running') return;
    let cancelled = false;
    void getWorldBankCoverage(id, globalCoverage ? '' : currentCountry, offset, provider).then(next => {
      if (!cancelled) setCoverage({ ...next, runId: id, scope: globalCoverage ? 'All economies' : currentCountry });
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, globalCoverage, currentCountry, offset, provider]);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startWorldBank(provider);
      setSelected(next.id); setRun(next); setCountry(''); setIndicator(''); setOffset(0);
      await onRefresh();
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const mutate = async (action: 'commit' | 'rollback' | 'cancel') => {
    if (!run || (action !== 'cancel' && !confirm(`${action} ${label} snapshot ${run.id}? Only separate ${label} monitoring changes. Fitted models and every other provider selection are unaffected.`))) return;
    setBusy(true); setError(null);
    try { await mutateWorldBank(run.id, action, provider); setRun(await getWorldBankRun(run.id, provider)); await onRefresh(); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl">{ids ? 'World Bank IDS: external-debt research' : 'World Bank WDI: sovereign-macro research'}</h2>
    <p>{ids ? '18 reviewed IDS indicators, individual source-6 economies and all available nonfuture annual history. Creditor counterpart fixed to World (WLD), not all creditor breakdowns added together.' : '17 reviewed WDI indicators, all current source-2 individual economies and all available annual history.'}
      {' '}Aggregates excluded using provider metadata. Incomplete coverage is disclosed, never filled.</p>
    <p className="text-amber-200">Separate monitoring only; fitted Firth, LightGBM and HMM inputs are unchanged.
      Source update is not per-observation publication. Blank status does not establish actual/forecast classification.
      {ids ? 'PPG is long-term public and publicly guaranteed external debt, not total sovereign debt. Creditor breakdowns are PPG only. Principal/disbursements are long-term, not matching total debt-service components. Source-6 attributes may be absent, not normal/actual flags. Future-dated values are excluded and counted in the report; historical dates alone do not establish actuals.' : 'Fiscal debt/revenue refer to central government, not WEO general government.'} Current freshness unverified.</p>
    {ids && <p className="text-amber-200">WDI overlaps: {run?.report.wdiOverlapCodes?.join(', ') || 'DT.DOD.DECT.CD, DT.DOD.DECT.GN.ZS, DT.TDS.DECT.EX.ZS'}.
      Shared underlying provider series, not independent evidence. Separate source revisions may differ; no automatic reconciliation or aggregation.</p>}
    <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I confirm research use of the fixed World Bank {ids ? 'IDS' : 'WDI'} basket.</label>
    <button className={button} disabled={!online || !consent || busy || summaries.some(s => s.status === 'running')} onClick={() => void start()}>Pull World Bank {ids ? 'IDS' : 'WDI'} history</button>
    {error && <p role="alert" className="text-rose-300">{error} Last valid review retained under its original snapshot identity; no replacement observations generated.</p>}
    {!online && <p className="text-amber-200">Backend unavailable; mutations and current eligibility blocked.</p>}
    <label className="block">{label} snapshot <select className={input} value={id} onChange={e => { setSelected(e.target.value); setCountry(''); setIndicator(''); setOffset(0); }}>
      <option value="">No snapshot</option>{summaries.map(s => <option key={s.id} value={s.id}>{s.createdAt} · {s.status}{s.active ? ' · active' : ''} · {s.id}</option>)}
    </select></label>
    <button className={button} disabled={!online || !id} onClick={() => setReload(n => n + 1)}>Reload {label} review</button>
    {run && <div className="space-y-3">
      <p>Reviewed snapshot {run.id}: {run.status}{run.active ? ' / active' : ' / inactive'}.
        {' '}Source last updated: {run.report.sourceLastUpdated ?? 'Unknown'}; retrieved: {run.report.retrievedAt ?? 'See immutable sources / created time'}.
        {' '}Rows: {run.report.rowCount ?? 0}; missing entire pairs: {run.report.absentPairs ?? 'Not evaluated'} / {run.report.requiredPairs ?? 'Unknown'}.</p>
      {run.id !== id && <p className="text-amber-200">Retained snapshot is not the requested selection.</p>}
      {run.report.errors?.length ? <p role="alert">{run.report.errors.join('; ')}</p> : null}
      {run.status === 'running' && <><pre>{JSON.stringify(run.progress, null, 2)}</pre><button className={button} disabled={!online || busy} onClick={() => void mutate('cancel')}>Cancel {label} pull</button></>}
      {run.report.countries && <>
        <label className="block">Find {label} economy <input className={input} value={economySearch} onChange={e => setEconomySearch(e.target.value)} /></label>
        <label className="block">{label} economy <select className={input} value={currentCountry} onChange={e => { setCountry(e.target.value); setOffset(0); }}>
          {run.report.countries.filter(c => c.code === currentCountry || `${c.code} ${c.name}`.toLowerCase().includes(economySearch.toLowerCase())).map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select></label>
        <label className="block">{label} indicator <select className={`${input} max-w-full`} value={currentIndicator} onChange={e => setIndicator(e.target.value)}>
          {run.report.indicators?.map(i => <option key={i.code} value={i.code}>{i.sourceTitle || i.name} ({i.code})</option>)}
        </select></label>
        <label className="flex gap-2"><input type="checkbox" checked={globalCoverage} onChange={e => { setGlobalCoverage(e.target.checked); setOffset(0); }} />Show coverage for every {label} economy</label>
      </>}
      {view && <div className="space-y-2">
        <h3>Displayed history: {view.country} · {view.name}</h3>
        <p className="text-xs">Snapshot {view.runId} · {view.indicator}{view.runId !== id || view.country !== currentCountry || view.indicator !== currentIndicator ? ' · Retained previous selection, not current selectors' : ''}</p>
        <p>{view.description}</p><p className="text-xs">Source organization: {view.organization}</p>
        <NativeChart data={view.data} label={label} />
      </div>}
      {coverage && <div className="overflow-auto">
        <p>Coverage review: snapshot {coverage.runId} · {coverage.scope} · pairs {coverage.offset + 1}–{Math.min(coverage.offset + coverage.rows.length, coverage.total)} / {coverage.total}.</p>
        <table className="w-full text-left text-sm"><thead><tr><th>Economy</th><th>Indicator</th><th>Valid years</th><th>Missing years</th><th>Analysis</th></tr></thead>
          <tbody>{coverage.rows.map(c => <tr key={`${c.country}:${c.indicator}`}><td>{c.name} ({c.country})</td><td>{c.indicatorName}</td><td>{c.absent ? 'Entire series absent' : c.validCount}</td><td><details><summary>{c.missingYears.length} gaps</summary>{c.missingYears.join(', ')}</details></td><td>{c.analysisBlocked ? 'Full-window/derived blocked' : 'No recorded gaps/flags; native history only'}</td></tr>)}</tbody></table>
        <button className={button} disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 50))}>Previous {label} coverage</button>
        <button className={button} disabled={offset + 50 >= coverage.total} onClick={() => setOffset(n => n + 50)}>Next {label} coverage</button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!online || busy || run.id !== id || run.active || !['staged', 'committed'].includes(run.status) || !!run.report.errors?.length} onClick={() => void mutate('commit')}>Activate {label} snapshot</button>
        <button className={button} disabled={!online || busy || run.id !== id || run.status !== 'committed'} onClick={() => void mutate('rollback')}>Rollback {label} snapshot</button>
        <a className={button} href={`/api/${provider}/${encodeURIComponent(run.id)}/export`}>Export {label} native history</a>
      </div>
      <details><summary>{label} contract, missing coverage, exclusions and source originals</summary>
        <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(run.report, null, 2)}</pre>
        <ul className="text-xs break-all">{run.sources.map(s => <li key={s.ordinal}><a href={`/api/${provider}/${encodeURIComponent(run.id)}/sources/${s.ordinal}`}>Original {s.ordinal}</a> · HTTP {s.httpStatus} · {s.bytes} bytes · {s.sha256}<br />{s.path}</li>)}</ul>
      </details>
    </div>}
  </section>;
}
