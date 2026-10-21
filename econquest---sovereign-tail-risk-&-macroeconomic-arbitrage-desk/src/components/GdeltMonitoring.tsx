import { useEffect, useState } from 'react';
import { checkGdeltContract, GdeltPage, GdeltRun, GdeltSummary, getGdeltPage, getGdeltRun, mutateGdelt, safeGdeltLink, startGdelt } from '../services/gdeltApi';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
const describe = (cause: unknown) => cause instanceof Error ? cause.message : 'GDELT operation failed.';
const ROOTS = ['Make public statement', 'Appeal', 'Express intent to cooperate', 'Consult', 'Engage in diplomatic cooperation',
  'Engage in material cooperation', 'Provide aid', 'Yield', 'Investigate', 'Demand', 'Disapprove', 'Reject', 'Threaten',
  'Protest', 'Exhibit force posture', 'Reduce relations', 'Coerce', 'Assault', 'Fight', 'Use unconventional mass violence'];

export function GdeltMonitoring({ summaries, online, onRefresh }: { summaries: GdeltSummary[]; online: boolean; onRefresh: () => Promise<void> }) {
  const [capability, setCapability] = useState<{ day: string } | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<GdeltRun | null>(null);
  const [country, setCountry] = useState('');
  const [root, setRoot] = useState('');
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<GdeltPage | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = selected || summaries.at(-1)?.id || '';

  useEffect(() => {
    let cancelled = false;
    setCapability(null); setCapabilityError('');
    if (online) void checkGdeltContract().then(value => { if (!cancelled) setCapability(value); })
      .catch(cause => { if (!cancelled) setCapabilityError(describe(cause)); });
    return () => { cancelled = true; };
  }, [online]);
  useEffect(() => {
    let cancelled = false;
    if (online && id) void getGdeltRun(id).then(value => { if (!cancelled) { setRun(value); setError(''); } })
      .catch(cause => { if (!cancelled) setError(describe(cause)); });
    return () => { cancelled = true; };
  }, [online, id, summaries]);
  useEffect(() => {
    let cancelled = false;
    if (!online || run?.id !== id || run.status !== 'running') return;
    const timer = setInterval(() => {
      void getGdeltRun(id).then(async value => {
        if (cancelled) return;
        setRun(value);
        if (value.status !== 'running') await onRefresh();
      }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, id, run?.id, run?.status, onRefresh]);
  useEffect(() => {
    let cancelled = false;
    if (online && run?.id === id) void getGdeltPage(id, country, root, offset).then(value => {
      if (!cancelled) setEvents(value);
    }).catch(cause => { if (!cancelled) setError(describe(cause)); });
    return () => { cancelled = true; };
  }, [online, id, run?.id, run?.report.completedIntervals, country, root, offset]);

  async function action(kind: 'pull' | 'cancel' | 'commit' | 'rollback') {
    setBusy(true); setError('');
    try {
      if (kind === 'pull') {
        const value = await startGdelt();
        setSelected(value.id); setRun(value); setOffset(0);
      } else {
        if ((kind === 'commit' || kind === 'rollback') && !window.confirm(`${kind === 'commit' ? 'Activate' : 'Roll back'} this separate GDELT research snapshot? Fitted models remain unchanged.`)) return;
        await mutateGdelt(id, kind);
        setRun(await getGdeltRun(id));
      }
      await onRefresh();
    } catch (cause) { setError(describe(cause)); }
    finally { setBusy(false); }
  }
  const running = summaries.some(s => s.status === 'running') || run?.status === 'running';
  const matches = run?.id === id;
  const pageMatches = events?.runId === id && events.country === country && events.root === root && events.offset === offset;
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-4">
    <h2 className="text-xl font-semibold">GDELT global daily events</h2>
    <p>GDELT 2.0 Events via gdeltPyR, latest completed UTC export day: {capability?.day ?? 'checking backend'}.
      All 96 quarter-hour export archives, global source records. No API key, news-keyword search, Mentions or GKG acquisition.</p>
    <p className="text-amber-200">Machine-coded news records, not independently verified incidents. Coverage, language and media biases apply.
      Multiple stories/IDs may describe one incident. Tone and Goldstein scale are native descriptive fields, not sovereign risk scores.
      No automatic alerts, model changes or scheduled downloads.</p>
    {capabilityError && <p role="alert" className="text-rose-300">{capabilityError}</p>}
    {error && <p role="alert" className="text-rose-300">{error} Last valid review retained; check its displayed identity.</p>}
    <label className="block"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I acknowledge GDELT source limitations and the fixed global daily research scope.</label>
    <button className={button} disabled={!online || !capability || busy || running || !consent} onClick={() => void action('pull')}>Pull latest completed GDELT day</button>
    <label className="block">GDELT snapshot <select className={input} aria-label="GDELT snapshot" disabled={busy} value={id} onChange={e => { setSelected(e.target.value); setOffset(0); }}>
      {!summaries.length && <option value="">No saved snapshots</option>}
      {summaries.map(s => <option key={s.id} value={s.id}>{s.report.day ?? s.createdAt} · {s.status} · {s.active ? 'active' : 'inactive'} · {s.id}</option>)}
      {run && !summaries.some(s => s.id === run.id) && <option value={run.id}>{run.id} · {run.status}</option>}
    </select></label>
    {run && <>
      <h3 className="font-semibold">GDELT review {run.id} · {run.status} · {run.active ? 'active' : 'inactive'}</h3>
      {!matches && <p>Previous snapshot retained; selected snapshot unavailable or loading.</p>}
      <p>UTC export day {run.report.day ?? 'unknown'}; verified intervals {run.report.completedIntervals ?? 0} / 96;
        {' '}{run.report.rowCount ?? 0} saved event records.
        {' '}{run.report.transportComplete ? 'All requested intervals verified; not proof of exhaustive real-world event coverage.' : 'Incomplete day; activation blocked.'}</p>
      {!!run.report.errors?.length && <p role="alert" className="text-rose-300">{run.report.errors.join('; ')}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!online || busy || !matches || run.status !== 'running'} onClick={() => void action('cancel')}>Cancel GDELT pull</button>
        <button className={button} disabled={!online || busy || !matches || run.active || !run.report.transportComplete ||
          run.report.completedIntervals !== 96 || !!run.report.errors?.length || !['staged', 'committed'].includes(run.status)} onClick={() => void action('commit')}>Activate GDELT snapshot</button>
        <button className={button} disabled={!online || busy || !matches || run.status !== 'committed'} onClick={() => void action('rollback')}>Roll back GDELT snapshot</button>
        <a className={button} href={`/api/gdelt/${encodeURIComponent(run.id)}/export`}>Export GDELT native events</a>
      </div>
      <p className="text-sm text-slate-400">{run.report.limitation}</p>
      <p>Country filter uses <strong>action-location GDELT geography codes, not ISO2</strong> (for example, RS is Russia in this code system).
        Actor-country fields use separate CAMEO codes. Unknown locations are retained; no inferred mappings.
        Event date can be older than the export day. Article publication time remains unknown.</p>
      <div className="flex flex-wrap gap-3">
        <label>Action-location country <select className={input} aria-label="GDELT action country" value={country} onChange={e => { setCountry(e.target.value); setOffset(0); }}>
          <option value="">All source locations</option><option value="UNKNOWN">Unknown / missing location</option>
          {(run.report.countries ?? []).filter(c => c.code !== null).map(c => <option key={c.code} value={c.code!}>{c.code} · {c.count} records</option>)}
          {country && country !== 'UNKNOWN' && !run.report.countries?.some(c => c.code === country) && <option value={country}>{country} · retained selection</option>}
        </select></label>
        <label>Event root <select className={input} aria-label="GDELT event root" value={root} onChange={e => { setRoot(e.target.value); setOffset(0); }}>
          <option value="">All event categories</option>
          {ROOTS.map((label, i) => { const code = String(i + 1).padStart(2, '0'); return <option key={code} value={code}>{code}: {label}</option>; })}
        </select></label>
      </div>
      {events && <div className="space-y-3">
        <p>Displayed event page: {events.runId} · country {events.country || 'all'} · root {events.root || 'all'}.
          {' '}{events.rows.length ? events.offset + 1 : 0}–{events.offset + events.rows.length} of {events.total}.
          {!pageMatches && ' Previous selection retained; not the current requested page.'}</p>
        <button className={button} disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 100))}>Previous GDELT events</button>
        <button className={button} disabled={!pageMatches || offset + 100 >= events.total} onClick={() => setOffset(v => v + 100)}>Next GDELT events</button>
        {!events.rows.length ? <p>No saved event records for this selection. This is not evidence that no real-world events occurred.</p> :
          <div className="max-h-[32rem] overflow-auto"><table className="w-full text-left text-sm"><thead><tr>
            <th>Source ID / coded event date</th><th>Actors / action location</th><th>CAMEO / tone / Goldstein</th><th>Mentions / sources / articles</th><th>Source and native fields</th>
          </tr></thead><tbody>{events.rows.map(event => <tr key={event.eventId} className="border-t border-slate-700">
            <td>{event.eventId}<br />Event: {event.eventDate}<br />Added: {event.dateAdded}</td>
            <td>{event.attributes.Actor1Name || 'Unknown actor'} [{event.actor1Country ?? 'unknown'}] → {event.attributes.Actor2Name || 'Unknown actor'} [{event.actor2Country ?? 'unknown'}]
              <br />{event.attributes.ActionGeo_FullName || 'Unknown location'} [{event.country ?? 'unknown'}]</td>
            <td>{event.eventCode} (root {event.eventRootCode})<br />Tone: {event.tone}<br />Goldstein: {event.goldstein}</td>
            <td>{event.mentions} / {event.sources} / {event.articles}<br />Not unique incident counts</td>
            <td>{event.sourceUrlSafe && safeGdeltLink(event.sourceUrl) ? <a href={event.sourceUrl!} target="_blank" rel="noopener noreferrer">Source article</a> : 'No safe source link'}
              <details><summary>Inspect 61 native source fields</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(event, null, 2)}</pre></details></td>
          </tr>)}</tbody></table></div>}
      </div>}
      <details><summary>Interval completeness, raw archives, hashes and library provenance</summary>
        <p>{run.sources.length} captured responses; {run.chunks.length} verified intervals. Missing/error intervals block activation.
          Interrupted pulls are not automatically resumed; a new manual pull requests the latest completed day again.</p>
        <p>gdeltPyR is GPL-3.0 licensed. This integration targets private local research; review license obligations before redistribution.
          Linked article text is neither downloaded nor redistributed.</p>
        {run.sources.map(s => <p key={s.ordinal} className="text-xs break-all"><a href={`/api/gdelt/${encodeURIComponent(run.id)}/sources/${s.ordinal}`}>GDELT original {s.ordinal}</a>
          {' '}· {s.retrievedAt} · HTTP {s.httpStatus} · {s.bytes} bytes · SHA-256 {s.sha256} · {s.path}</p>)}
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ report: run.report, chunks: run.chunks }, null, 2)}</pre>
      </details>
    </>}
  </section>;
}
