import { useEffect, useState } from 'react';
import { getWeoCoverage, getWeoObservations, getWeoRun, mutateWeo, startWeo, WeoCoverage, WeoObservations, WeoRun, WeoSummary } from '../services/weoApi';
import { weoHistory } from '../math/weoMonitoring';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
const colors = { actual: '#22d3ee', estimate_projection: '#fbbf24', unknown: '#94a3b8' };
const labels = { actual: 'Actual per IMF boundary (revisable)', estimate_projection: 'IMF estimate/projection', unknown: 'Classification unknown' };

function AnnualChart({ data }: { data: WeoObservations }) {
  const result = weoHistory(data.rows, data.series);
  const values = result.sorted.filter(r => r.value !== null).map(r => r.value!);
  if (!data.series || !values.length) return <p>No valid WEO values for this economy/indicator. Analysis unavailable; nothing is filled.</p>;
  const min = Math.min(...values), max = Math.max(...values);
  const first = result.sorted[0].year, last = result.sorted.at(-1)!.year;
  const x = (year: number) => 20 + 760 * (year - first) / (last - first || 1);
  const y = (value: number) => 180 - 160 * (value - min) / (max - min || 1);
  return <div className="space-y-2">
    <p>Native unit: {data.series.unitLabel} ({data.series.unit ?? 'Not supplied'}); source SCALE {data.series.scale ?? 'Not supplied'} ({data.series.scaleLabel}).
      {' '}No multiplier applied to API values.</p>
    <p>Latest actual per IMF boundary: {data.series.latestActualYear ?? 'Unknown'}.
      {' '}Latest available actual: {result.latestActual ? `${result.latestActual.year}: ${result.latestActual.value}` : 'None classified'}.
      {' '}Estimate/projection years with values: {result.estimates.length}; unknown classification: {result.unknownCount}.</p>
    {data.series.analysisBlocked && <p className="text-amber-200">Comparative/derived analysis blocked: unit, scale or actual-data boundary missing/unmapped. {data.series.classificationNote}</p>}
    <svg role="img" aria-label="WEO annual history and estimates with gaps" viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
      {result.segments.map((segment, i) => segment.length === 1
        ? <circle key={i} cx={x(segment[0].year)} cy={y(segment[0].value!)} r="3" fill={colors[segment[0].classification]} />
        : <polyline key={i} points={segment.map(r => `${x(r.year)},${y(r.value!)}`).join(' ')} fill="none"
          stroke={colors[segment[0].classification]} strokeWidth="2" strokeDasharray={segment[0].classification === 'actual' ? undefined : '5 4'} />)}
      <text x="20" y="205" fill="#94a3b8" fontSize="12">{first}</text>
      <text x="780" y="205" textAnchor="end" fill="#94a3b8" fontSize="12">{last}</text>
    </svg>
    <p className="text-xs">Cyan: IMF-classified actual history (revisable). Dashed amber: estimates/projections.
      Gray: unknown. Gaps and classification/definition breaks are not connected. Fiscal reporting years may differ from calendar years.</p>
    <details><summary>Annual values and classifications</summary>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm">
        <thead><tr><th>Year</th><th>Native value</th><th>Classification</th><th>Status</th></tr></thead>
        <tbody>{result.sorted.map(r => <tr key={r.year}><td>{r.year}</td><td>{r.value ?? 'Missing'}</td><td>{labels[r.classification]}</td><td>{r.status ?? 'Not supplied'}</td></tr>)}</tbody>
      </table></div>
    </details>
    <details><summary>Series definitions, actual-data boundary and source lineage</summary>
      <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify({ series: data.series, observations: result.sorted }, null, 2)}</pre>
    </details>
  </div>;
}

export function WeoMonitoring({ summaries, online, onRefresh }: {
  summaries: WeoSummary[]; online: boolean; onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<WeoRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reload, setReload] = useState(0);
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [economySearch, setEconomySearch] = useState('');
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [globalCoverage, setGlobalCoverage] = useState(false);
  const [data, setData] = useState<WeoObservations | null>(null);
  const [coverage, setCoverage] = useState<{ rows: WeoCoverage[]; total: number } | null>(null);
  const id = selected || summaries.find(s => s.active)?.id || summaries.at(-1)?.id || '';
  const currentCountry = country || run?.report.countries?.[0]?.code || '';
  const currentIndicator = indicator || run?.report.indicators?.[0]?.code || '';
  const reportError = (cause: unknown) => {
    console.error('WEO operation failed:', cause);
    setError(cause instanceof Error ? cause.message : 'WEO operation failed.');
  };
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getWeoRun(id);
        if (cancelled) return;
        setRun(next); setError(null);
        if (next.status === 'running') timer = setTimeout(() => void load(), 2000);
        else if (summaries.find(s => s.id === id)?.status === 'running') void onRefresh();
      } catch (cause) { if (!cancelled) reportError(cause); }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, reload, summaries, onRefresh]);

  useEffect(() => {
    if (!run || run.id !== id || run.status === 'running' || !currentCountry || !currentIndicator) return;
    let cancelled = false;
    void getWeoObservations(id, currentCountry, currentIndicator).then(next => {
      if (!cancelled) setData(next);
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, currentCountry, currentIndicator]);
  useEffect(() => {
    if (!run || run.id !== id || !run.report.countries || run.status === 'running') return;
    let cancelled = false;
    void getWeoCoverage(id, globalCoverage ? '' : currentCountry, '', offset).then(next => {
      if (!cancelled) setCoverage(next);
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, globalCoverage, currentCountry, offset]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startWeo();
      setSelected(next.id); setRun(next); setData(null); setCoverage(null); setCountry(''); setIndicator(''); setOffset(0);
      await onRefresh();
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const mutate = async (action: 'commit' | 'rollback' | 'cancel') => {
    if (!run || (action !== 'cancel' && !confirm(`${action} WEO release ${run.id}? Only the separate WEO selection changes; fitted annual models and monthly/ETF inputs are unaffected.`))) return;
    setBusy(true); setError(null);
    try { await mutateWeo(run.id, action); setRun(await getWeoRun(run.id)); await onRefresh(); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl">IMF World Economic Outlook: annual research and projections</h2>
    <p>Latest WEO release, all catalog indicators and all available annual history/forecast years for individual
      economies. Aggregates excluded. Commodity/global-only indicators may have no economy-level values; these remain visible as absent.</p>
    <p className="text-amber-200">WEO is not an observed-only dataset. History can be revised; estimates/projections are never
      annual fitted-model inputs. Incomplete coverage is allowed for WEO only, disclosed explicitly, and blocks affected analyses.
      Monthly IMF strict coverage is unchanged. No current-freshness, harmonized units or point-in-time backtest claim.</p>
    <label className="block"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
      {' '}I confirm authorized WEO research use and understand its estimates/projections and incomplete coverage.</label>
    <button className={button} disabled={busy || !online || !consent || summaries.some(s => s.status === 'running') || run?.status === 'running'} onClick={() => void start()}>Pull latest WEO release</button>
    <button className={`${button} ml-2`} disabled={busy || !id} onClick={() => setReload(r => r + 1)}>Refresh WEO review/job</button>
    <p className="text-xs">Manual only; public IMF SDMX, 600-second deadline, 20-second HTTP inactivity timeout, 128 requests,
      16 MiB per response, 96 MiB per pull, at most 1,000,000 rows. No retries or automatic activation; running-job polling only.</p>
    {error && <p role="alert" className="text-rose-300">{error}. Last loaded WEO history retained; current eligibility blocked.</p>}
    {!online && <p className="text-amber-200">Backend unavailable. Last loaded WEO history is not refreshed.</p>}
    <label className="block">WEO snapshot <select className={`${input} ml-2`} value={id} onChange={e => {
      setSelected(e.target.value); setRun(null); setData(null); setCoverage(null); setCountry(''); setIndicator(''); setOffset(0);
    }}><option value="">No WEO acquisition</option>{summaries.map(s =>
      <option key={s.id} value={s.id}>{s.report.publicationDate ?? s.createdAt} · {s.status} {s.active ? '· ACTIVE' : ''} · {s.id.slice(0, 8)}</option>)}</select></label>
    {run?.id === id && <>
      <p>Snapshot {run.id} · {run.status} · {run.active ? 'ACTIVE WEO selection' : 'Not active'}.
        {' '}Release published {run.report.publicationDate ?? 'Unknown'}; retrieved/stored {run.createdAt}. Freshness unverified.</p>
      {run.status === 'running' && <><pre className="text-xs">{JSON.stringify(run.progress, null, 2)}</pre>
        <button className={button} disabled={busy} onClick={() => void mutate('cancel')}>Cancel WEO pull</button></>}
      {!!run.report.errors?.length && <p className="text-rose-300">{run.report.errors.join('; ')}</p>}
      <p>{run.report.rowCount ?? 0} annual records; {run.report.seriesCount ?? 0} source series.
        {' '}Years {run.report.firstYear ?? '?'}–{run.report.lastYear ?? '?'}.
        {' '}Economies with data: {run.report.availableEconomies ?? '?'} / {run.report.countries?.length ?? '?'} requested.
        {' '}Indicators with data: {run.report.availableIndicators ?? '?'} / {run.report.indicators?.length ?? '?'} catalog.
        {' '}Absent pairs: {run.report.absentPairs ?? '?'} / {run.report.requiredPairs ?? '?'}.</p>
      <p>Series with missing/unmapped analytical metadata: {run.report.analysisBlockedSeries ?? 'Not reported'}.
        {' '}Numeric rows with unknown actual/projection classification: {run.report.unknownClassificationRows ?? 'Not reported'}.
        Unknown values are never presented as observed actuals.</p>
      <button className={button} disabled={busy || !online || run.active || !['staged', 'committed'].includes(run.status) || !!error} onClick={() => void mutate('commit')}>
        {run.status === 'committed' ? 'Activate WEO snapshot' : 'Commit WEO release'}
      </button>
      {run.status === 'committed' && <button className={`${button} ml-2`} disabled={busy || !online} onClick={() => void mutate('rollback')}>Roll back WEO snapshot</button>}
      {run.report.countries && <>
        <label className="block">Search WEO economies <input className={`${input} ml-2`} value={economySearch} onChange={e => setEconomySearch(e.target.value)} /></label>
        <label className="block">WEO economy <select className={`${input} ml-2`} value={currentCountry} onChange={e => { setCountry(e.target.value); setData(null); setOffset(0); }}>
          {run.report.countries.filter(c => c.code === currentCountry || `${c.code} ${c.name}`.toLowerCase().includes(economySearch.toLowerCase())).map(c =>
            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select></label>
        <label className="block">Search WEO indicators <input className={`${input} ml-2`} value={indicatorSearch} onChange={e => setIndicatorSearch(e.target.value)} /></label>
        <label className="block">WEO indicator <select className={`${input} ml-2 max-w-full`} value={currentIndicator} onChange={e => { setIndicator(e.target.value); setData(null); }}>
          {run.report.indicators?.filter(i => i.code === currentIndicator || `${i.code} ${i.name}`.toLowerCase().includes(indicatorSearch.toLowerCase())).map(i =>
            <option key={i.code} value={i.code}>{i.code}: {i.name}</option>)}
        </select></label>
        <p className="text-xs">{run.report.indicators?.find(i => i.code === currentIndicator)?.description}</p>
      </>}
      {run.status === 'quarantined' && <p className="text-amber-200">Quarantined preview only; not active research data.</p>}
      {data && <AnnualChart data={data} />}
      <details><summary>WEO coverage and gaps</summary>
        <label className="block"><input type="checkbox" checked={globalCoverage} onChange={e => { setGlobalCoverage(e.target.checked); setOffset(0); }} /> Show every economy/indicator pair</label>
        <p>{coverage?.total ?? 0} pairs in this view. Missing values are not zero. Unknown fiscal boundaries/units block comparative analyses.</p>
        <div className="overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Economy</th><th>Indicator</th><th>Valid years</th><th>Actual through</th><th>Gaps</th></tr></thead>
          <tbody>{coverage?.rows.map(r => <tr key={`${r.country}-${r.indicator}`} className="border-t border-slate-700">
            <td>{r.name}</td><td>{r.indicator}: {r.indicatorName}</td><td>{r.validCount}{r.absent ? ' · ABSENT' : ''}</td>
            <td>{r.latestActualYear ?? 'Unknown'}{r.analysisBlocked ? ' · analysis blocked' : ''}</td>
            <td><details><summary>{r.missingYears.length} years</summary>{r.missingYears.join(', ')}</details></td>
          </tr>)}</tbody>
        </table></div>
        <button className={button} disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous WEO coverage page</button>
        <button className={`${button} ml-2`} disabled={!coverage || offset + 50 >= coverage.total} onClick={() => setOffset(offset + 50)}>Next WEO coverage page</button>
      </details>
      <details><summary>WEO release manifest, definitions and raw responses</summary>
        <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(run.report, null, 2)}</pre>
        <ul>{run.sources.map(s => <li key={s.ordinal} className="break-all text-xs my-2">
          <a href={`/api/weo/${encodeURIComponent(id)}/sources/${s.ordinal}`} download>Download WEO response #{s.ordinal}</a>
          {' '}HTTP {s.httpStatus}; {s.bytes} bytes; SHA-256 {s.sha256}; {s.path}
        </li>)}</ul>
      </details>
      <a className={`${button} inline-block`} href={`/api/weo/${encodeURIComponent(id)}/export`} download>Export WEO annual release and lineage (NDJSON)</a>
    </>}
  </section>;
}
