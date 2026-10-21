import { useEffect, useState } from 'react';
import { AcledPage, AcledRun, AcledSummary, checkAcledContract, getAcledPage, getAcledRun, mutateAcled, startAcled } from '../services/acledApi';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
const describe = (cause: unknown) => cause instanceof Error ? cause.message : 'ACLED operation failed.';
const precision = (code: number) => `${code} (${code === 1 ? 'highest native precision' : code === 2 ? 'approximate' : 'lowest native precision'}; see ACLED codebook)`;

export function AcledMonitoring({ summaries, online, onRefresh }: { summaries: AcledSummary[]; online: boolean; onRefresh: () => Promise<void> }) {
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof checkAcledContract>> | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<AcledRun | null>(null);
  const [country, setCountry] = useState('');
  const [eventType, setEventType] = useState('');
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<AcledPage | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = selected || summaries.at(-1)?.id || '';
  useEffect(() => {
    let cancelled = false;
    setCapability(null); setCapabilityError('');
    if (online) void checkAcledContract().then(v => { if (!cancelled) setCapability(v); })
      .catch(e => { if (!cancelled) setCapabilityError(describe(e)); });
    return () => { cancelled = true; };
  }, [online]);
  useEffect(() => {
    let cancelled = false;
    if (online && id) void getAcledRun(id).then(v => { if (!cancelled) { setRun(v); setError(''); } })
      .catch(e => { if (!cancelled) setError(describe(e)); });
    return () => { cancelled = true; };
  }, [online, id, summaries]);
  useEffect(() => {
    let cancelled = false;
    if (!online || run?.id !== id || run.status !== 'running') return;
    const timer = setInterval(() => {
      void getAcledRun(id).then(async v => {
        if (cancelled) return;
        setRun(v);
        if (v.status !== 'running') await onRefresh();
      }).catch(e => { if (!cancelled) setError(describe(e)); });
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, id, run?.id, run?.status, onRefresh]);
  useEffect(() => {
    let cancelled = false;
    if (online && run?.id === id) void getAcledPage(run, country, eventType, offset).then(v => {
      if (!cancelled) setEvents(v);
    }).catch(e => { if (!cancelled) setError(describe(e)); });
    return () => { cancelled = true; };
  }, [online, id, run, country, eventType, offset]);
  async function action(kind: 'pull' | 'cancel' | 'commit' | 'rollback') {
    setBusy(true); setError('');
    try {
      if (kind === 'pull') {
        const v = await startAcled();
        setRun(v); setSelected(v.id); setOffset(0);
      } else {
        if ((kind === 'commit' || kind === 'rollback') && !window.confirm(`${kind === 'commit' ? 'Activate' : 'Roll back'} this separate private ACLED snapshot? GDELT and fitted models remain unchanged.`)) return;
        await mutateAcled(id, kind);
        setRun(await getAcledRun(id));
      }
      await onRefresh();
    } catch (e) { setError(describe(e)); }
    finally { setBusy(false); }
  }
  const matches = run?.id === id;
  const pageMatches = events?.runId === id && events.country === country && events.eventType === eventType && events.offset === offset;
  const running = summaries.some(s => s.status === 'running') || run?.status === 'running';
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl font-semibold">ACLED conflict and protest research</h2>
    <p>Core dyadic events via acled==1.0.2, global request for the latest 30 completed UTC days:
      {' '}{capability ? `${capability.startDate} through ${capability.endDate}` : 'checking backend'}.
      All event types; no CAST forecasts, monadic duplication or automatic GDELT merge.</p>
    <p className="text-amber-200">Account-accessible records only: successful pagination does not prove unrestricted global coverage.
      Recent events may not yet be reported. Fatalities are reported estimates; zero does not establish no deaths.
      Dates and locations carry native precision codes. No sovereign-risk scores, alerts or model changes.</p>
    <p>Source: <a href="https://acleddata.com/" target="_blank" rel="noopener noreferrer">ACLED</a>.
      {' '}Use subject to your account entitlements and <a href="https://acleddata.com/terms-and-conditions" target="_blank" rel="noopener noreferrer">ACLED terms and attribution policy</a>.
      Package is unofficial and GPL-3.0 licensed; review redistribution obligations. Do not publicly redistribute these private exports without permission.</p>
    {capabilityError && <p role="alert" className="text-rose-300">{capabilityError}</p>}
    {capability && !capability.configured && <p>myACLED email/password not configured. Use the backend hidden terminal prompts; never paste credentials into chat or browser fields.</p>}
    {error && <p role="alert" className="text-rose-300">{error} Last valid review retained; check its displayed identity.</p>}
    <label className="block"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I acknowledge ACLED account access, usage terms, attribution and source limitations for private research.</label>
    <button className={button} disabled={!online || !capability?.configured || !consent || busy || running} onClick={() => void action('pull')}>Pull ACLED 30-day snapshot</button>
    <label className="block">ACLED snapshot <select aria-label="ACLED snapshot" className={input} value={id} disabled={busy}
      onChange={e => { setSelected(e.target.value); setOffset(0); }}>
      {!summaries.length && <option value="">No saved snapshots</option>}
      {summaries.map(s => <option key={s.id} value={s.id}>{s.report.startDate}–{s.report.endDate} · {s.status} · {s.active ? 'active' : 'inactive'} · {s.id}</option>)}
      {run && !summaries.some(s => s.id === run.id) && <option value={run.id}>{run.id} · {run.status}</option>}
    </select></label>
    {run && <>
      <h3 className="font-semibold">ACLED review {run.id} · {run.status} · {run.active ? 'active' : 'inactive'}</h3>
      {!matches && <p>Previous snapshot retained; selected snapshot unavailable or loading.</p>}
      <p>Event-date window {run.report.startDate} through {run.report.endDate}; {run.report.rowCount ?? 0} saved records.
        {' '}{run.report.transportComplete && run.report.consistencyVerified ? 'Pagination totals and two complete reads verified; account-accessible coverage only.' : 'Incomplete or unverified snapshot; activation blocked.'}</p>
      <p>Progress: {String(run.progress.phase ?? 'not started')} · page {String(run.progress.page ?? 0)} · requests {String(run.progress.requests ?? 0)}.</p>
      {!!run.report.errors?.length && <p role="alert" className="text-rose-300">{run.report.errors.join('; ')}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!online || busy || !matches || run.status !== 'running'} onClick={() => void action('cancel')}>Cancel ACLED pull</button>
        <button className={button} disabled={!online || busy || !matches || run.active || !run.report.transportComplete || !run.report.consistencyVerified ||
          !!run.report.errors?.length || !['staged', 'committed'].includes(run.status)} onClick={() => void action('commit')}>Activate ACLED snapshot</button>
        <button className={button} disabled={!online || busy || !matches || run.status !== 'committed'} onClick={() => void action('rollback')}>Roll back ACLED snapshot</button>
        <a className={button} href={`/api/acled/${encodeURIComponent(run.id)}/export`}>Export private ACLED native events</a>
      </div>
      <p className="text-sm text-slate-400">{run.report.limitation}</p>
      <div className="flex flex-wrap gap-3">
        <label>Source country <select className={input} aria-label="ACLED country" value={country} onChange={e => { setCountry(e.target.value); setOffset(0); }}>
          <option value="">All account-accessible countries</option>
          {(run.report.countries ?? []).map(c => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}
          {country && !run.report.countries?.some(c => c.name === country) && <option value={country}>{country} · retained selection</option>}
        </select></label>
        <label>Event type <select className={input} aria-label="ACLED event type" value={eventType} onChange={e => { setEventType(e.target.value); setOffset(0); }}>
          <option value="">All core event types</option>{(run.report.eventTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
          {eventType && !run.report.eventTypes?.includes(eventType) && <option value={eventType}>{eventType} · retained selection</option>}
        </select></label>
      </div>
      {events && <>
        <p>Displayed ACLED page: {events.runId} · country {events.country || 'all'} · type {events.eventType || 'all'} ·
          {' '}{events.rows.length ? events.offset + 1 : 0}–{events.offset + events.rows.length} of {events.total}.
          {!pageMatches && ' Previous selection retained; not the current requested page.'}</p>
        <button className={button} disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 100))}>Previous ACLED events</button>
        <button className={button} disabled={!pageMatches || offset + 100 >= events.total} onClick={() => setOffset(v => v + 100)}>Next ACLED events</button>
        {!events.rows.length ? <p>No stored ACLED records for this selection; not evidence that no events occurred.</p> :
          <div className="max-h-[32rem] overflow-auto"><table className="w-full text-left text-sm"><thead><tr>
            <th>Source ID / date / precision</th><th>Event / actors</th><th>Location / precision</th><th>Reported fatality estimate</th><th>Source / update / native fields</th>
          </tr></thead><tbody>{events.rows.map(e => <tr key={e.eventId} className="border-t border-slate-700">
            <td>{e.eventId}<br />{e.eventDate}<br />Time: {precision(e.timePrecision)}</td>
            <td>{e.disorderType} / {e.eventType} / {e.subEventType}<br />{String(e.attributes.actor1 ?? 'Unknown actor')} → {String(e.attributes.actor2 || 'Unknown actor')}</td>
            <td>{e.country} · {String(e.attributes.location ?? 'Unknown location')}<br />Geography: {precision(e.geoPrecision)}<br />{e.latitude ?? 'unknown'}, {e.longitude ?? 'unknown'}</td>
            <td>{e.fatalities ?? 'Unknown'}<br />Not an audited death count</td>
            <td>{String(e.attributes.source)} · {String(e.attributes.source_scale)}<br />Source updated: {e.updatedAt}<br />Article publication: unknown
              <details><summary>Inspect native ACLED record</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(e, null, 2)}</pre></details></td>
          </tr>)}</tbody></table></div>}
      </>}
      <details><summary>Original pages, hashes and completeness report</summary>
        <p>Two reads must agree on native event IDs/fields and total counts. Revisions, deletion or pagination drift block staging.
          Each pull is a full replacement snapshot, not a merge into prior data. No scheduler or automatic resume.</p>
        {run.sources.map(s => <p key={s.ordinal} className="text-xs break-all"><a href={`/api/acled/${encodeURIComponent(run.id)}/sources/${s.ordinal}`}>ACLED original {s.ordinal}</a>
          {' '}· {s.retrievedAt} · HTTP {s.httpStatus} · {s.bytes} bytes · SHA-256 {s.sha256} · {s.path}</p>)}
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ report: run.report, progress: run.progress, chunks: run.chunks }, null, 2)}</pre>
      </details>
    </>}
  </section>;
}
