import { useEffect, useState } from 'react';
import { ComtradeConfig, ComtradeRow, ComtradeRun, ComtradeSummary, ComtradeTask, getComtradeConfig, getComtradeRun, getComtradeSeries, getComtradeTasks, mutateComtrade, startComtrade } from '../services/comtradeApi';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
const describe = (error: unknown) => error instanceof Error ? error.message : 'Comtrade operation failed.';
interface History { id: string; reporter: number; reporterName: string; partner: number; partnerName: string; flow: 'M' | 'X'; rows: ComtradeRow[] }

export function ComtradeMonitoring({ summaries, online, onRefresh }: { summaries: ComtradeSummary[]; online: boolean; onRefresh: () => Promise<void> }) {
  const [config, setConfig] = useState<ComtradeConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<ComtradeRun | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reporter, setReporter] = useState('');
  const [partner, setPartner] = useState('0');
  const [flow, setFlow] = useState<'M' | 'X'>('M');
  const [history, setHistory] = useState<History | null>(null);
  const [taskOffset, setTaskOffset] = useState(0);
  const [tasks, setTasks] = useState<{ id: string; offset: number; rows: ComtradeTask[]; total: number } | null>(null);
  const id = selected || summaries.at(-1)?.id || '';

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setConfigError('');
    if (online) void getComtradeConfig().then(value => { if (!cancelled) setConfig(value); })
      .catch(cause => { if (!cancelled) setConfigError(describe(cause)); });
    return () => { cancelled = true; };
  }, [online]);

  useEffect(() => {
    let cancelled = false;
    if (online && id) void getComtradeRun(id).then(value => {
      if (!cancelled) { setRun(value); setError(''); }
    }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    return () => { cancelled = true; };
  }, [id, online, summaries]);

  useEffect(() => {
    let cancelled = false;
    if (!online || run?.id !== id || run.status !== 'running') return;
    const timer = setInterval(() => {
      void getComtradeRun(id).then(async value => {
        if (cancelled) return;
        setRun(value);
        if (value.status !== 'running') await onRefresh();
      }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, id, run?.id, run?.status, onRefresh]);

  const reporters = run?.report.reporters?.filter(area => !area.isGroup) ?? [];
  const partners = run?.report.partners ?? [];
  const reporterCode = reporter || String(reporters[0]?.code ?? '');
  useEffect(() => {
    let cancelled = false;
    if (online && run?.id === id && reporterCode && partners.some(p => String(p.code) === partner)) {
      const reporterArea = reporters.find(r => String(r.code) === reporterCode);
      const partnerArea = partners.find(p => String(p.code) === partner);
      if (reporterArea && partnerArea) void getComtradeSeries(id, reporterArea.code, partnerArea.code, flow).then(rows => {
        if (!cancelled) setHistory({ id, reporter: reporterArea.code, reporterName: reporterArea.name,
          partner: partnerArea.code, partnerName: partnerArea.name, flow, rows });
      }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    }
    return () => { cancelled = true; };
  }, [online, id, run?.id, run?.report.rowCount, run?.report.reporters, run?.report.partners, reporterCode, partner, flow]);

  useEffect(() => {
    let cancelled = false;
    if (online && run?.id === id) void getComtradeTasks(id, taskOffset).then(value => {
      if (!cancelled) setTasks({ id, offset: taskOffset, rows: value.rows, total: value.total });
    }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    return () => { cancelled = true; };
  }, [online, id, run?.id, run?.report.completedTasks, taskOffset]);

  async function action(kind: 'pull' | 'resume' | 'cancel' | 'commit' | 'rollback') {
    setBusy(true); setError('');
    try {
      if (kind === 'pull' || kind === 'resume') {
        const value = await startComtrade(kind === 'resume' ? id : undefined);
        setRun(value); setSelected(value.id); setTaskOffset(0);
      } else {
        if ((kind === 'commit' || kind === 'rollback') && !window.confirm(`${kind === 'commit' ? 'Activate' : 'Roll back'} this separate UN Comtrade research snapshot? Annual fitted models remain unchanged.`)) return;
        await mutateComtrade(id, kind);
        setRun(await getComtradeRun(id));
      }
      await onRefresh();
    } catch (cause) { setError(describe(cause)); }
    finally { setBusy(false); }
  }

  const running = summaries.some(s => s.status === 'running') || run?.status === 'running';
  const canPull = online && !!config?.configured && consent && !busy && !running;
  const matches = run?.id === id;
  const historyMatches = history?.id === id && String(history.reporter) === reporterCode && String(history.partner) === partner && history.flow === flow;
  const tasksMatch = tasks?.id === id && tasks.offset === taskOffset;
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl font-semibold">UN Comtrade annual merchandise trade</h2>
    <p>All source reporting economies and historical reporting areas; all available completed-year history from 1962; imports and exports,
      TOTAL products, all partners. Original classifications only. No mirror replacement or estimated Trade Matrix.</p>
    <p className="text-sm text-amber-200">Manual resumable passes only. A partial download is not a complete snapshot and cannot activate.
      The Basic plan permits 500 calls/day and 100,000 records/call. This connector reserves at most {config?.dailyRequestBudget ?? 450} requests per rolling 24 hours
      with {500 - (config?.dailyRequestBudget ?? 450)} calls of headroom; other applications using your key can exhaust the provider quota sooner.
      Each pass stops after at most {config?.passRequests ?? 40} requests or {config?.passSeconds ?? 300} seconds (plus any in-flight bounded socket operation).
      Multiple days may be needed; nothing resumes automatically.</p>
    {configError && <p role="alert" className="text-rose-300">{configError}</p>}
    {config && !config.configured && <p>COMTRADE_API_KEY is not configured. Use the hidden backend terminal prompt, never chat or a browser field.</p>}
    {error && <p role="alert" className="text-rose-300">{error} Last valid review retained; check its displayed identity.</p>}
    <label className="block"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> I accept UN Comtrade access terms and the fixed global annual research scope.</label>
    <button className={button} disabled={!canPull} onClick={() => void action('pull')}>Start new Comtrade acquisition</button>
    <label className="block">Comtrade snapshot <select className={input} aria-label="Comtrade snapshot" value={id}
      onChange={event => { setSelected(event.target.value); setTaskOffset(0); }}>
      {!summaries.length && <option value="">No saved acquisitions</option>}
      {summaries.map(s => <option key={s.id} value={s.id}>{s.createdAt} · {s.status} · {s.active ? 'active' : 'inactive'} · {s.id}</option>)}
      {run && !summaries.some(s => s.id === run.id) && <option value={run.id}>{run.id} · {run.status}</option>}
    </select></label>
    {run && <>
      <h3 className="font-semibold">Review {run.id} · {run.status} · {run.active ? 'active' : 'inactive'}</h3>
      {!matches && <p>Previous snapshot retained while the selected snapshot loads or is unavailable.</p>}
      <p>Phase: {run.report.phase ?? 'initializing'}; verified tasks {run.report.completedTasks ?? 0} / {run.report.taskCount ?? 'not yet planned'}.
        {' '}Saved observations: {run.report.rowCount ?? 0}. Usable native values: {run.report.numericCount ?? 'counted at completion'}.
        {' '}Available reporter-years: {run.report.availableReporterYears ?? 'discovery incomplete'}.</p>
      <p>{run.report.pauseReason}</p>
      {run.report.notBefore && <p>Do not resume before {new Date(run.report.notBefore * 1000).toISOString()}.</p>}
      {!!run.report.errors?.length && <p role="alert" className="text-rose-300">{run.report.errors.join('; ')}</p>}
      <p>{run.report.transportComplete ? 'All planned chunks verified; review before activation.' : 'Incomplete global acquisition; activation blocked. Saved chunks below are partial evidence only.'}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!canPull || !matches || run.status !== 'interrupted' || !!(run.report.notBefore && Date.now() < run.report.notBefore * 1000)}
          onClick={() => void action('resume')}>Resume Comtrade pass</button>
        <button className={button} disabled={!online || busy || !matches || run.status !== 'running'} onClick={() => void action('cancel')}>Cancel Comtrade pass</button>
        <button className={button} disabled={!online || busy || !matches || !run.report.transportComplete || !!run.report.errors?.length ||
          !['staged', 'committed'].includes(run.status) || run.active} onClick={() => void action('commit')}>Activate Comtrade snapshot</button>
        <button className={button} disabled={!online || busy || !matches || run.status !== 'committed'} onClick={() => void action('rollback')}>Roll back Comtrade snapshot</button>
        <a className={button} href={`/api/comtrade/${encodeURIComponent(run.id)}/export`}>Export Comtrade native history and task manifest</a>
      </div>
      <p className="text-sm text-slate-400">{run.report.limitation}</p>
      <div className="flex flex-wrap gap-3">
        <label>Reporter <select className={input} aria-label="Comtrade reporter" value={reporterCode} onChange={event => setReporter(event.target.value)}>
          {!reporters.length && <option value="">Metadata unavailable</option>}
          {reporters.map(a => <option key={a.code} value={a.code}>{a.name} [{a.code}]{a.expired ? ' · historical' : ''}</option>)}
        </select></label>
        <label>Partner <select className={input} aria-label="Comtrade partner" value={partner} onChange={event => setPartner(event.target.value)}>
          {!partners.length && <option value="0">Metadata unavailable</option>}
          {partners.map(a => <option key={a.code} value={a.code}>{a.name} [{a.code}] · {a.kind}</option>)}
        </select></label>
        <label>Flow <select className={input} aria-label="Comtrade flow" value={flow} onChange={event => setFlow(event.target.value === 'X' ? 'X' : 'M')}>
          <option value="M">Imports</option><option value="X">Exports</option>
        </select></label>
      </div>
      <p>World totals, regional groups, special and unreviewed categories are not individual bilateral partners and must not be added to their components.
        Unmatched reporter/partner identities remain unreviewed, not inferred from ISO strings; all returned categories remain inspectable.
        Omitted years/partners mean unknown or unavailable, never zero. Native isReported=false values are retained and flagged, not asserted to be directly reported;
        this flag alone does not distinguish a calculated aggregate from an estimate. Quantity-estimation flags are not treated as value-estimation flags.</p>
      {history && <div>
        <h3 className="font-semibold">Saved history: {history.reporterName} [{history.reporter}] → {history.partnerName} [{history.partner}] · {history.flow} · {history.id}</h3>
        {!historyMatches && <p>Previous selection retained; not the currently selected series.</p>}
        {!history.rows.length ? <p>No saved rows for this selection. Coverage is unknown until all planned chunks are verified; absence is not zero trade.</p> :
          <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>
            <th>Year</th><th>Native current USD</th><th>Source value</th><th>Classification / partner category</th><th>Flags and provenance</th>
          </tr></thead><tbody>{history.rows.map(row => <tr key={row.year} className="border-t border-slate-700">
            <td>{row.year}</td><td>{row.value ?? 'Excluded / missing'}</td><td>{row.rawValue ?? 'Missing'}</td>
            <td>{row.classification} · {row.partnerKind}</td><td><details><summary>{row.exclusionReason ??
              (row.attributes.isReported ? 'Source isReported=true' : 'Not directly reported; inspect source flags')}</summary>
              <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(row, null, 2)}</pre></details></td>
          </tr>)}</tbody></table></div>}
      </div>}
      <details><summary>Acquisition tasks, missing availability and original responses</summary>
        <p>Availability covers {run.report.firstYear ?? 1962}–{run.report.lastYear ?? 'last completed year'}.
          Discovery results identify source-available original reporter/year datasets; omitted reporter-years are unavailable, not fabricated.</p>
        {tasks && <><p>Tasks for {tasks.id}: {tasks.offset + 1}–{tasks.offset + tasks.rows.length} of {tasks.total}.
          {!tasksMatch && ' Previous task page retained.'}</p>
          <button className={button} disabled={taskOffset === 0} onClick={() => setTaskOffset(value => Math.max(0, value - 100))}>Previous Comtrade tasks</button>
          <button className={button} disabled={!tasksMatch || taskOffset + 100 >= tasks.total} onClick={() => setTaskOffset(value => value + 100)}>Next Comtrade tasks</button>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(tasks.rows, null, 2)}</pre></>}
        <p>{run.sources.length} immutable responses, SHA-256 and per-request retrieval times; first 20 linked here, complete list in manifest/export.</p>
        {run.sources.slice(0, 20).map(source => <p key={source.ordinal} className="text-xs break-all"><a href={`/api/comtrade/${encodeURIComponent(run.id)}/sources/${source.ordinal}`}>
          Original {source.ordinal}</a> · {source.retrievedAt} · HTTP {source.httpStatus} · {source.bytes} bytes · {source.sha256} · {source.path}</p>)}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.report, null, 2)}</pre>
      </details>
    </>}
  </section>;
}
