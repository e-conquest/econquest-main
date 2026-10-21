import { useEffect, useState } from 'react';
import { checkMonthlyImfContract, getMacroPage, getMacroRun, MacroCoverage, MacroRow, MacroRun, MacroSummary, mutateMacro, startImf } from '../services/imfApi';
import { macroSeries, monthNumber } from '../math/macroMonitoring';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';

function MacroChart({ rows }: { rows: MacroRow[] }) {
  const { sorted, segments, latest, change } = macroSeries(rows);
  if (!latest) return <p>No valid observations for this economy/indicator. Missing values are not replaced.</p>;
  const values = sorted.filter(r => r.value !== null).map(r => r.value!);
  const low = Math.min(...values), high = Math.max(...values);
  const first = monthNumber(sorted[0].period), last = monthNumber(sorted.at(-1)!.period);
  const point = (row: MacroRow) => `${20 + 760 * (monthNumber(row.period) - first) / (last - first || 1)},${180 - 160 * (row.value! - low) / (high - low || 1)}`;
  return <div className="space-y-2">
    <p>Latest available: {latest.period} · {latest.value} · {latest.unit} · source SCALE {latest.scale}.
      {' '}Status: {latest.status ?? 'Not supplied'}; publication time for this observation unknown.</p>
    <p>Consecutive-month change: {change === null ? 'Blocked: missing adjacent month, definition break or unverified scaling' : `${change} native units`}.
      No cross-country CPI-level or policy-rate comparability is asserted.</p>
    <svg role="img" aria-label="IMF native monthly history with gaps" viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
      {segments.map((segment, i) => segment.length === 1
        ? <circle key={i} cx={point(segment[0]).split(',')[0]} cy={point(segment[0]).split(',')[1]} r="3" fill="#22d3ee" />
        : <polyline key={i} points={segment.map(point).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="2" />)}
      <text x="20" y="205" fill="#94a3b8" fontSize="12">{sorted[0].period}</text>
      <text x="780" y="205" textAnchor="end" fill="#94a3b8" fontSize="12">{sorted.at(-1)!.period}</text>
    </svg>
    <p className="text-xs">Period labels are monthly observations, not release dates or trading timestamps.
      Gaps and reference-base/definition breaks are not connected. Values remain native; no scaling conversion or fill.</p>
    <details><summary>Inspect native values, status and inherited source metadata</summary>
      <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(sorted, null, 2)}</pre>
    </details>
  </div>;
}

export function MacroMonitoring({ summaries, online, onRefresh }: {
  summaries: MacroSummary[]; online: boolean; onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<MacroRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [consent, setConsent] = useState(false);
  const [country, setCountry] = useState('');
  const [indicator, setIndicator] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [coverage, setCoverage] = useState<{ rows: MacroCoverage[]; total: number } | null>(null);
  const [history, setHistory] = useState<{ rows: MacroRow[]; runId: string; country: string; indicator: string } | null>(null);
  const [contract, setContract] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });
  const id = selected || summaries.at(-1)?.id || '';
  const currentCountry = country || run?.report.countries?.[0]?.code || '';
  const currentIndicator = indicator || run?.report.indicators?.[0]?.id || '';
  const message = (cause: unknown) => cause instanceof Error ? cause.message : 'IMF operation failed.';

  useEffect(() => {
    setContract({ ready: false, error: null });
    if (!online) return;
    let cancelled = false;
    void checkMonthlyImfContract().then(() => {
      if (!cancelled) setContract({ ready: true, error: null });
    }).catch(cause => {
      if (!cancelled) {
        console.error('Monthly IMF contract check failed:', cause);
        setContract({ ready: false, error: message(cause) });
      }
    });
    return () => { cancelled = true; };
  }, [online, reload]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await getMacroRun(id);
        if (cancelled) return;
        setRun(next); setError(null);
        if (next.status === 'running') timer = setTimeout(() => void load(), 2000);
        else if (summaries.find(s => s.id === id)?.status === 'running') void onRefresh();
      } catch (cause) {
        if (!cancelled) { console.error('IMF job refresh failed:', cause); setError(message(cause)); }
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, summaries, onRefresh, reload]);

  useEffect(() => {
    if (!run || run.id !== id || run.status === 'running') return;
    let cancelled = false;
    setCoverage(null);
    void getMacroPage(id, 'coverage', '', '', offset).then(next => {
      if (!cancelled) setCoverage(next);
    }).catch(cause => {
      if (!cancelled) { console.error('IMF coverage failed:', cause); setError(message(cause)); }
    });
    return () => { cancelled = true; };
  }, [id, run, offset]);

  useEffect(() => {
    if (!run || run.id !== id || run.status === 'running' || !currentCountry || !currentIndicator) return;
    let cancelled = false;
    void getMacroPage(id, 'observations', currentCountry, currentIndicator).then(next => {
      if (!cancelled) setHistory({ rows: next.rows, runId: id, country: currentCountry, indicator: currentIndicator });
    }).catch(cause => {
      if (!cancelled) { console.error('IMF observations failed:', cause); setError(message(cause)); }
    });
    return () => { cancelled = true; };
  }, [id, run, currentCountry, currentIndicator]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = await startImf();
      setSelected(next.id); setRun(next); setCoverage(null); setOffset(0);
      await onRefresh();
    } catch (cause) { console.error('IMF acquisition failed:', cause); setError(message(cause)); }
    finally { setBusy(false); }
  };
  const mutate = async (action: 'commit' | 'rollback' | 'cancel') => {
    if (!run) return;
    if (action !== 'cancel' && !confirm(`${action} IMF basket ${run.id}? This affects only the IMF macro selection, never Yahoo or annual models.`)) return;
    setBusy(true); setError(null);
    try {
      await mutateMacro(run.id, action);
      setRun(await getMacroRun(run.id));
      await onRefresh();
    } catch (cause) { console.error('IMF revision operation failed:', cause); setError(message(cause)); }
    finally { setBusy(false); }
  };

  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl">Monthly IMF</h2>
    <p>120 completed months; all current ISO-matched IMF economies/territories. All-items CPI index, published YoY
      inflation, period-average domestic currency/USD, total reserves with gold at market value, and
      nationally defined monetary policy-related rates. This is not a harmonized policy-rate panel.</p>
    <p className="text-amber-200">Available monthly coverage: missing economy/indicator pairs and internal gaps stay missing,
      with affected histories/changes unavailable. Unknown-status values are excluded but preserved in source originals.
      Invalid responses, changed definitions and incomplete transport still block activation. No annual-model integration, forecasts,
      auto-fill or trading signals. Source-native values only: scaling conversion remains unverified,
      so standardized monetary comparisons are blocked.</p>
    <label className="block"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
      {' '}I confirm authorized local research use of Monthly IMF data with incomplete coverage disclosed, not filled.</label>
    {contract.error && <p role="alert" className="text-amber-200">{contract.error}</p>}
    <button className={button} disabled={busy || !online || !contract.ready || !consent || run?.status === 'running'} onClick={() => void start()}>Pull and validate IMF monthly basket</button>
    <button className={`${button} ml-2`} disabled={busy || !id} onClick={() => setReload(value => value + 1)}>Refresh IMF job/review</button>
    <p className="text-xs">Public SDMX access verified for the selected query routes; no browser credentials.
      Manual acquisition only. At most 128 requests, 16 MiB per response, 96 MiB per basket and 600 seconds;
      no automatic retries. Job-status polling is not scheduled acquisition.</p>
    {error && <p role="alert" className="text-rose-300">{error}. Last loaded history retained; current eligibility blocked.</p>}
    {!online && <p className="text-amber-200">Backend unavailable. Last loaded IMF data is retained, not refreshed.</p>}
    <label className="block">IMF revision <select className={`${input} ml-2`} value={id} onChange={e => {
      setSelected(e.target.value); setRun(null); setCoverage(null); setOffset(0); setCountry(''); setIndicator('');
    }}><option value="">No IMF acquisition</option>{summaries.map(s =>
      <option key={s.id} value={s.id}>{s.createdAt} · {s.status} {s.active ? '· ACTIVE' : ''}</option>)}</select></label>
    {run && run.id === id && <>
      <p>Run {run.id} · {run.status} {run.active ? '· ACTIVE' : '· not active'} · freshness unknown.
        Stored {run.createdAt}; observation availability is separate from retrieval success.</p>
      {run.status === 'running' && <>
        <pre className="overflow-auto text-xs">{JSON.stringify(run.progress, null, 2)}</pre>
        <button className={button} disabled={busy} onClick={() => void mutate('cancel')}>Cancel IMF acquisition</button>
      </>}
      {(run.report.errors?.length ?? 0) > 0 && <p className="text-rose-300">{run.report.errors!.join('; ')}. No activation permitted.</p>}
      <p>Window {run.report.startPeriod ?? 'Not resolved'} to {run.report.endPeriod ?? 'Not resolved'}.
        {' '}Rows {run.report.rowCount ?? 0}; absent pairs {run.report.absentPairs ?? 'Not evaluated'} / {run.report.requiredPairs ?? 'Unknown'}.</p>
      <p className="text-xs">{run.report.coverageLimitation} {run.report.valueConvention} {run.report.limitation}</p>
      <p>Coverage policy: {run.report.coveragePolicy === 'available-monthly-pairs' ? 'Available monthly pairs; missing coverage disclosed' : 'Legacy strict completeness (unchanged)'}.
        {' '}Usable numeric rows: {run.report.numericCount ?? 'Not reported in legacy snapshot'}; unknown-status exclusions: {run.report.unknownStatusRows ?? 'Not reported in legacy snapshot'}.</p>
      <button className={button} disabled={busy || !online || !['staged', 'committed'].includes(run.status) || run.active || !!run.report.errors?.length} onClick={() => void mutate('commit')}>
        {run.status === 'committed' ? 'Activate IMF revision' : 'Commit IMF basket'}
      </button>
      {run.status === 'committed' && <button className={`${button} ml-2`} disabled={busy || !online} onClick={() => void mutate('rollback')}>Roll back IMF revision</button>}
      <details><summary>IMF coverage and missing-pair report</summary>
        <p>{coverage?.total ?? 0} economy/indicator pairs. {run.report.coveragePolicy === 'available-monthly-pairs'
          ? 'Completely missing pairs remain unavailable; they do not block other validated monthly history.'
          : 'Legacy strict snapshot: every completely missing pair blocks basket activation.'}</p>
        <div className="overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Economy</th><th>Indicator</th><th>Valid months</th><th>Latest</th><th>Missing</th></tr></thead>
          <tbody>{coverage?.rows.map(r => <tr key={`${r.country}-${r.indicator}`} className="border-t border-slate-700">
            <td>{r.name} ({r.country})</td><td>{r.indicator}</td><td>{r.validCount}</td><td>{r.latestPeriod ?? 'None'}</td>
            <td><details><summary>{r.absent ? 'ABSENT' : `${r.missingCount} months`}</summary>{r.missingPeriods.join(', ')}</details></td>
          </tr>)}</tbody>
        </table></div>
        <button className={button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous coverage page</button>
        <button className={`${button} ml-2`} disabled={!coverage || offset + 50 >= coverage.total} onClick={() => setOffset(offset + 50)}>Next coverage page</button>
      </details>
      <label className="block">Search IMF economies <input className={`${input} ml-2`} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label className="block">IMF economy <select className={`${input} ml-2`} value={currentCountry} onChange={e => setCountry(e.target.value)}>
        {run.report.countries?.filter(c => c.code === currentCountry || `${c.name} ${c.code}`.toLowerCase().includes(search.toLowerCase())).map(c =>
          <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
      </select></label>
      <label className="block">IMF indicator <select className={`${input} ml-2`} value={currentIndicator} onChange={e => setIndicator(e.target.value)}>
        {run.report.indicators?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select></label>
      {run.status === 'quarantined' && <p className="text-amber-200">Quarantined preview below is for source inspection only, not active monitoring.</p>}
      {history && <>
        <p>Displayed monthly history: {history.country} · {history.indicator} · snapshot {history.runId}.
          {(history.runId !== id || history.country !== currentCountry || history.indicator !== currentIndicator) &&
            ' Retained previous selection; not the current selectors.'}</p>
        {history.rows.length > 0 ? <MacroChart rows={history.rows} /> : <p>No source observations for this selection; history unavailable, nothing filled.</p>}
      </>}
      <details><summary>Raw response manifest, excluded areas and definitions</summary>
        <pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(run.report, null, 2)}</pre>
        <ul>{run.sources.map(source => <li key={source.ordinal} className="break-all text-xs my-2">
          <a href={`/api/macro/${encodeURIComponent(run.id)}/sources/${source.ordinal}`} download>Download raw response #{source.ordinal}</a>
          {' '}HTTP {source.httpStatus} · {source.bytes} bytes · SHA-256 {source.sha256} · {source.path}
        </li>)}</ul>
      </details>
      <a className={`${button} inline-block`} href={`/api/macro/${encodeURIComponent(run.id)}/export`} download>Export IMF native history and lineage (NDJSON)</a>
    </>}
  </section>;
}
