import { useEffect, useState } from 'react';
import { BisCoverage, BisObservations, BisRun, BisSummary, getBisCoverage, getBisObservations, getBisRun, mutateBis, startBis } from '../services/bisApi';
import { bisHistory, bisQuarter } from '../math/bisMonitoring';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';

function NativeChart({ data }: { data: BisObservations }) {
  const history = bisHistory(data.rows);
  const values = history.sorted.filter(r => r.value !== null).map(r => r.value!);
  if (!values.length) return <p>No numeric BIS history for this economy/indicator. {data.series.reason} Nothing is filled.</p>;
  const min = Math.min(...values), max = Math.max(...values);
  const first = history.sorted[0].period, last = history.sorted.at(-1)!.period;
  const x = (p: string) => 20 + 760 * (bisQuarter(p) - bisQuarter(first)) / (bisQuarter(last) - bisQuarter(first) || 1);
  const y = (value: number) => 180 - 160 * (value - min) / (max - min || 1);
  return <div className="space-y-2">
    <p>Native unit: {data.series.unit}. {data.series.validCount} numeric values; {data.series.missingCount} explicit missing values;
      {' '}{data.series.missingPeriods.length} absent interior quarters; {data.series.flaggedCount} flagged observations.
      Latest numeric period: {data.series.latestValidPeriod}. Current freshness unverified.</p>
    <svg role="img" aria-label="BIS quarterly native history with gaps and breaks" viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
      {history.segments.map((s, i) => s.length === 1
        ? <circle key={i} cx={x(s[0].period)} cy={y(s[0].value!)} r="3" fill="#22d3ee" />
        : <polyline key={i} points={s.map(r => `${x(r.period)},${y(r.value!)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="2" />)}
      <text x="20" y="205" fill="#94a3b8" fontSize="12">{first}</text>
      <text x="780" y="205" textAnchor="end" fill="#94a3b8" fontSize="12">{last}</text>
    </svg>
    <p>Native range: {min} to {max}. Missing quarters, nulls, flagged values and unit changes disconnect lines.
      LBS numbers are already in millions of USD; UNIT_MULT=6 is retained, not applied again. No resampling or conversion.</p>
    {data.series.analysisBlocked && <p className="text-amber-200">Full-window/derived analysis blocked by missing history or source flags/breaks. No synthetic values.</p>}
    <details><summary>Quarterly observations, exact source values and flags</summary>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm">
        <thead><tr><th>Period</th><th>Native value</th><th>Status</th><th>Pre-break value</th><th>Unit / multiplier</th></tr></thead>
        <tbody>{history.sorted.map(r => <tr key={r.period}><td>{r.period}</td><td>{r.rawValue ?? 'Missing'}</td>
          <td>{r.attributes.OBS_STATUS}</td><td>{r.attributes.OBS_PRE_BREAK ?? 'Not supplied'}</td>
          <td>{r.attributes.UNIT_MEASURE} / {r.attributes.UNIT_MULT}</td></tr>)}</tbody>
      </table></div>
    </details>
    <details><summary>Exact dimensions, native attributes and source lineage</summary>
      <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(data, null, 2)}</pre>
    </details>
  </div>;
}

export function BisMonitoring({ summaries, online, onRefresh }: {
  summaries: BisSummary[]; online: boolean; onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<BisRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reload, setReload] = useState(0);
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [global, setGlobal] = useState(false);
  const [view, setView] = useState<{ runId: string; country: string; indicator: string; name: string; data: BisObservations } | null>(null);
  const [coverage, setCoverage] = useState<{ runId: string; scope: string; rows: BisCoverage[]; total: number; offset: number } | null>(null);
  const id = selected || summaries.find(s => s.active)?.id || summaries.at(-1)?.id || '';
  const currentCountry = country || run?.report.countries?.[0]?.code || '';
  const currentIndicator = indicator || run?.report.indicators?.[0]?.code || '';
  const reportError = (cause: unknown) => {
    console.error('BIS operation failed:', cause);
    setError(`${cause instanceof Error ? cause.message : 'BIS operation failed.'} Last valid review retained.`);
  };
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getBisRun(id);
        if (cancelled) return;
        setRun(next); setError(null);
        if (next.status === 'running') timer = setTimeout(() => void load(), 2000);
        else if (summaries.find(s => s.id === id)?.status === 'running') void onRefresh().catch(reportError);
      } catch (cause) { if (!cancelled) reportError(cause); }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, reload, summaries, onRefresh]);
  useEffect(() => {
    if (!run || run.id !== id || !run.report.countries || run.status === 'running') return;
    const definition = run.report.indicators?.find(i => i.code === currentIndicator);
    if (!definition) return;
    let cancelled = false;
    void getBisObservations(id, currentCountry, currentIndicator).then(data => {
      if (!cancelled) setView({ runId: id, country: currentCountry, indicator: currentIndicator, name: definition.name, data });
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, currentCountry, currentIndicator]);
  useEffect(() => {
    if (!run || run.id !== id || !run.report.countries || run.status === 'running') return;
    let cancelled = false;
    void getBisCoverage(id, global ? '' : currentCountry, offset).then(next => {
      if (!cancelled) setCoverage({ ...next, runId: id, scope: global ? 'All economies' : currentCountry });
    }).catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [id, run, global, currentCountry, offset]);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startBis();
      setSelected(next.id); setRun(next); setCountry(''); setIndicator(''); setOffset(0);
      await onRefresh();
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const mutate = async (action: 'commit' | 'rollback' | 'cancel') => {
    if (!run || (action !== 'cancel' && !confirm(`${action} BIS snapshot ${run.id}? Only BIS monitoring changes. All fitted models and other providers remain unchanged.`))) return;
    setBusy(true); setError(null);
    try { await mutateBis(run.id, action); setRun(await getBisRun(run.id)); await onRefresh(); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl">BIS quarterly banking and credit research</h2>
    <p>Six reviewed indicators, current individual economies and all available quarterly history. No key required.
      LBS: cross-border claims/liabilities from all reporting banking locations, all counterparty sectors, currencies and instruments.
      Credit: all lenders, adjusted for breaks; government at nominal value, private sector/households/corporations at market value.</p>
    <p className="text-amber-200">Monitoring only; fitted Firth, LightGBM and HMM inputs unchanged.
      Not sovereign-only exposure, a bilateral contagion matrix or consolidated banking statistics.
      Credit sectors overlap; do not add private totals to households/corporations.
      Current revised snapshots are not historical publication vintages. No automatic freshness, trading or backtest claims.</p>
    <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I confirm authorized research use of the fixed BIS banking and credit basket.</label>
    <button className={button} disabled={!online || !consent || busy || summaries.some(s => s.status === 'running')} onClick={() => void start()}>Pull BIS quarterly history</button>
    <button className={button} disabled={!online || busy} onClick={() => setReload(r => r + 1)}>Reload BIS review</button>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <label className="block">BIS saved snapshot <select className={input} value={id} onChange={e => { setSelected(e.target.value); setCountry(''); setIndicator(''); setOffset(0); }}>
      <option value="">No saved snapshot</option>{summaries.map(s => <option key={s.id} value={s.id}>{s.status} · {s.active ? 'active · ' : ''}{s.id}</option>)}
    </select></label>
    {run && <div className="space-y-4">
      <p>Reviewed BIS snapshot {run.id}: {run.status} / {run.active ? 'active' : 'inactive'}. Retrieved: {run.report.retrievedAt ?? 'Not completed'}.
        Numeric observations: {run.report.numericCount ?? 'Pending'}; absent economy/indicator pairs: {run.report.absentPairs ?? 'Pending'} / {run.report.requiredPairs ?? 'Pending'}.</p>
      {run.status === 'running' && <div><pre>{JSON.stringify(run.progress)}</pre><button className={button} disabled={busy} onClick={() => void mutate('cancel')}>Cancel BIS pull</button></div>}
      {run.report.errors?.map((e, i) => <p role="alert" key={i}>{e}</p>)}
      {run.report.countries && <div className="flex flex-wrap gap-3">
        <label>Find BIS economy <input className={input} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label>BIS economy <select className={input} value={currentCountry} onChange={e => { setCountry(e.target.value); setOffset(0); }}>
          {run.report.countries.filter(c => c.code === currentCountry || `${c.name} ${c.code} ${c.iso3}`.toLowerCase().includes(search.toLowerCase())).map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select></label>
        <label>BIS indicator <select className={input} value={currentIndicator} onChange={e => setIndicator(e.target.value)}>
          {run.report.indicators?.map(i => <option key={i.code} value={i.code}>{i.name}</option>)}
        </select></label>
      </div>}
      {view && <div className="space-y-2">
        <h3>Displayed {view.country} / {view.name}</h3>
        <p>Chart snapshot {view.runId}. {view.runId !== id || view.country !== currentCountry || view.indicator !== currentIndicator ? 'Previous view retained; requested view is loading or failed.' : 'Selected view.'}</p>
        <NativeChart data={view.data} />
      </div>}
      {coverage && <details><summary>BIS coverage and missing history</summary>
        <p>Coverage snapshot {coverage.runId}; scope {coverage.scope}. Missing interior quarters are bounded by each series, not a claim of complete leading/trailing history.</p>
        <label><input type="checkbox" checked={global} onChange={e => { setGlobal(e.target.checked); setOffset(0); }} />All BIS economies</label>
        <table className="w-full text-left text-sm"><thead><tr><th>Economy</th><th>Indicator</th><th>Numeric</th><th>Missing quarters</th><th>Reason / analysis</th></tr></thead>
          <tbody>{coverage.rows.map(r => <tr key={`${r.country}/${r.indicator}`}><td>{r.name}</td><td>{r.indicatorName}</td><td>{r.validCount}</td>
            <td>{r.missingCount} explicit / {r.missingPeriods.length} absent</td><td>{r.reason || (r.analysisBlocked ? 'Blocked: flags or missing history' : 'Reported values; freshness unverified')}</td></tr>)}</tbody>
        </table>
        <button className={button} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 50))}>Previous BIS coverage</button>
        <button className={button} disabled={coverage.offset + coverage.rows.length >= coverage.total} onClick={() => setOffset(o => o + 50)}>Next BIS coverage</button>
      </details>}
      <div className="flex gap-3">
        <button className={button} disabled={!online || busy || run.id !== id || !['staged', 'committed'].includes(run.status) || !!run.report.errors?.length || run.active} onClick={() => void mutate('commit')}>Activate BIS snapshot</button>
        <button className={button} disabled={!online || busy || run.id !== id || run.status !== 'committed'} onClick={() => void mutate('rollback')}>Rollback BIS snapshot</button>
        <a href={`/api/bis/${encodeURIComponent(run.id)}/export`}>Export BIS quarterly history</a>
      </div>
      <details><summary>BIS contract, definitions and captured originals</summary>
        <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(run, null, 2)}</pre>
        {run.sources.map(s => <p key={s.ordinal}><a href={`/api/bis/${encodeURIComponent(run.id)}/sources/${s.ordinal}`}>Original {s.ordinal}</a> · HTTP {s.httpStatus} · {s.bytes} bytes · SHA256 {s.sha256}</p>)}
      </details>
    </div>}
  </section>;
}
