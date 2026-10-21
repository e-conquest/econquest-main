import { useEffect, useState } from 'react';
import { DeskAnalysis, DeskBundle, DeskBundleSummary, DeskMetric, loadDeskBundle, loadDeskBundles, loadDeskPreview, saveDeskBundle } from '../services/analysisApi';
import { WeoSummary } from '../services/weoApi';

const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const classification = { actual: 'Actual per IMF boundary (revisable)', estimate_projection: 'IMF estimate/projection', unknown: 'Unknown classification' };

function MetricValue({ metric }: { metric: DeskMetric }) {
  const latest = metric.latestActual;
  const supported = metric.series?.unit === 'PT' && metric.series.scale === '0';
  const unit = supported ? metric.unit : `${metric.series?.unitLabel ?? 'Unit unknown'} (native SCALE ${metric.series?.scale ?? 'unknown'})`;
  return <div className="space-y-1">
    <p>{latest !== null && latest.value !== null ? `${number(latest.value)} ${unit} (${latest.year})` : 'Actual unavailable'}</p>
    <p className="text-xs text-slate-400">{metric.changePp === null
      ? `Change unavailable: ${metric.changeBlockedReason}`
      : `${metric.changePp > 0 ? '+' : ''}${number(metric.changePp)} pp vs ${metric.previousActual?.year}`}</p>
    {metric.missingActualYears.length > 0 && <p className="text-xs text-amber-200">Missing actual years: {metric.missingActualYears.join(', ')}</p>}
  </div>;
}

export function MacroDesk({ summaries, online }: { summaries: WeoSummary[]; online: boolean }) {
  const [runId, setRunId] = useState('');
  const [bundles, setBundles] = useState<DeskBundleSummary[]>([]);
  const [bundleId, setBundleId] = useState('');
  const [loaded, setLoaded] = useState<{ analysis: DeskAnalysis; bundle: DeskBundle | null } | null>(null);
  const [country, setCountry] = useState('');
  const [watchOnly, setWatchOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [consent, setConsent] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = summaries.filter(s => s.status === 'staged' || s.status === 'committed');
  const reportError = (cause: unknown) => {
    console.error('Macro desk operation failed:', cause);
    setError(cause instanceof Error ? cause.message : 'Macro desk operation failed.');
  };
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void loadDeskBundles().then(next => { if (!cancelled) setBundles(next); })
      .catch(cause => { if (!cancelled) reportError(cause); });
    return () => { cancelled = true; };
  }, [online]);

  const load = async (kind: 'preview' | 'bundle') => {
    setBusy(true); setError(null);
    try {
      if (kind === 'preview') {
        const analysis = await loadDeskPreview(runId);
        setLoaded({ analysis, bundle: null });
      } else {
        const bundle = await loadDeskBundle(bundleId);
        setLoaded({ analysis: bundle.analysis, bundle });
      }
      setCountry(''); setConsent(false); setReviewNote('');
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!loaded || loaded.bundle || !consent || !reviewNote.trim()) return;
    setBusy(true); setError(null);
    try {
      const bundle = await saveDeskBundle(loaded.analysis, reviewNote.trim());
      setLoaded({ analysis: bundle.analysis, bundle });
      setBundles(previous => [...previous, { id: bundle.id, runId: bundle.analysis.source.runId,
        createdAt: bundle.createdAt, digest: bundle.analysis.digest, reviewNote: bundle.reviewNote }]);
      setBundleId(bundle.id); setConsent(false); setReviewNote('');
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const analysis = loaded?.analysis;
  const visible = analysis?.countries.filter(c => (!watchOnly || c.watchlisted) &&
    `${c.name} ${c.code} ${c.iso3 ?? ''}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selected = analysis?.countries.find(c => c.code === country);
  return <section className="rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-5">
    <h2 className="text-xl">Macro trend desk: global overview and country dossiers</h2>
    <p>Private local research. Four annual WEO indicators; no current predictive risk score.
      Select and inspect a stored snapshot, then explicitly save a reviewed evidence bundle.
      This does not acquire data, activate providers or modify model inputs.</p>
    <p className="text-amber-200">Public publication blocked: provider redistribution rights and dependency licensing have not been cleared.
      User accounts, public hosting, alerts and forecasting remain outside this first slice.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label>WEO source snapshot<select aria-label="Desk WEO source snapshot" className={`${input} block max-w-full`} disabled={busy || !online}
        value={runId} onChange={e => setRunId(e.target.value)}>
        <option value="">Select explicitly</option>
        {eligible.map(s => <option key={s.id} value={s.id}>{s.id} · {s.status} · {s.report.publicationDate ?? 'Publication unknown'}</option>)}
      </select></label>
      <button className={button} disabled={!online || busy || !runId} onClick={() => void load('preview')}>Preview source evidence</button>
    </div>
    {eligible.length === 0 && <p>No eligible stored WEO source. Review Data operations / WEO research; unavailable values are not filled.</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label>Reviewed bundle<select aria-label="Desk reviewed bundle" className={`${input} block`} disabled={busy || !online}
        value={bundleId} onChange={e => setBundleId(e.target.value)}>
        <option value="">Select saved bundle</option>
        {bundles.map(b => <option key={b.id} value={b.id}>{b.id} · {b.createdAt}</option>)}
      </select></label>
      <button className={button} disabled={!online || busy || !bundleId} onClick={() => void load('bundle')}>Load reviewed bundle</button>
    </div>
    {busy && <p role="status">Loading or saving evidence; source selection is locked.</p>}
    {error && <p role="alert" className="text-rose-300">{error} Last successfully loaded analysis, if any, is retained with its original source label.</p>}
    {!online && <p className="text-amber-200">Service unavailable. Retained evidence is historical; no live status is implied.</p>}
    {analysis && <>
      <div className="rounded border border-slate-600 p-3 space-y-2">
        <h3 className="font-semibold">{loaded.bundle ? `Reviewed bundle ${loaded.bundle.id}` : 'UNREVIEWED source preview'}</h3>
        {loaded.bundle && <p>Saved {loaded.bundle.createdAt}. Review note: {loaded.bundle.reviewNote}</p>}
        <p className="break-all text-sm">Displayed source: {analysis.source.runId}. Publication: {analysis.source.publicationDate ?? 'Unknown'}.
          {' '}Acquisition started: {analysis.source.acquisitionStartedAt}; retrieved: {analysis.source.retrievedAt ?? 'Unknown'}.
          {' '}Evidence SHA-256: {analysis.digest}.</p>
        <p className="text-sm">Freshness unverified. Actual years vary by country/indicator. No global average or ranking is inferred.</p>
        {!loaded.bundle && <>
          <label className="block">Review note<input aria-label="Desk review note" maxLength={400} className={`${input} block w-full`}
            disabled={busy} value={reviewNote} onChange={e => setReviewNote(e.target.value)} /></label>
          <label className="block"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />
            {' '}I reviewed the evidence and limitations and confirm authorized local research use; not public redistribution.</label>
          <button className={button} disabled={busy || !online || !consent || !reviewNote.trim()} onClick={() => void save()}>Save reviewed local bundle</button>
        </>}
      </div>
      <ul className="list-disc pl-5 text-sm text-slate-300">{analysis.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      {analysis.unmappedWatchlist.length > 0 && <p className="text-amber-200">Watchlist ISO3 codes absent from source catalog: {analysis.unmappedWatchlist.join(', ')}.</p>}
      <div className="flex flex-wrap gap-4 items-center">
        <label><input type="checkbox" checked={watchOnly} onChange={e => setWatchOnly(e.target.checked)} /> Focused watchlist only</label>
        <label>Search countries <input className={input} value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      <p>{visible.length} of {analysis.countries.length} source economies shown; {analysis.countries.filter(c => c.watchlisted).length} watchlisted.
        {' '}Comparable actual changes: {analysis.countries.flatMap(c => c.metrics).filter(m => m.changePp !== null).length}
        /{analysis.countries.length * 4} economy-indicator pairs.</p>
      <div className="overflow-auto"><table className="w-full text-left text-sm">
        <caption className="text-left font-semibold">Latest available actuals by economy (not synchronized reporting years)</caption>
        <thead><tr><th>Economy / dossier</th>{analysis.indicators.map(i => <th key={i.code}>{i.label}</th>)}</tr></thead>
        <tbody>{visible.map(c => <tr key={c.code} className="border-t border-slate-700">
          <td className="p-2"><button className={button} onClick={() => setCountry(c.code)}>{c.name} ({c.code})</button>
            {c.watchlisted && <span className="block text-xs">Watchlisted</span>}</td>
          {c.metrics.map(m => <td key={m.code} className="p-2 align-top"><MetricValue metric={m} /></td>)}
        </tr>)}</tbody>
      </table></div>
      {selected && <section aria-label="Country dossier" className="space-y-4 border-t border-slate-600 pt-4">
        <h3 className="text-xl">Country dossier: {selected.name}</h3>
        <p>Native WEO code {selected.code}; source-reviewed ISO3 mapping {selected.iso3 ?? 'Unknown'}.
          This is an annual macro evidence dossier, not a complete geopolitical or portfolio assessment.</p>
        {selected.metrics.map(m => <article key={m.code} className="rounded border border-slate-700 p-3 space-y-2">
          <h4 className="font-semibold">{m.label} · {m.code}</h4>
          <MetricValue metric={m} />
          <p className="break-all text-xs">Evidence: {m.evidenceId}. Unit: {m.series?.unitLabel ?? 'Unknown'}; native scale {m.series?.scale ?? 'Unknown'}.
            No multiplier applied. Actual boundary: {m.series?.latestActualYear ?? 'Unknown'}.</p>
          <details><summary>Annual history, estimates/projections and native evidence</summary>
            <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm">
              <thead><tr><th>Reporting year</th><th>Native value ({m.series?.unitLabel ?? 'Unit unknown'}; SCALE {m.series?.scale ?? 'unknown'})</th><th>Classification</th><th>Status</th></tr></thead>
              <tbody>{m.rows.map(r => <tr key={r.year}><td>{r.year}</td><td>{r.value === null ? 'Missing' : number(r.value)}</td>
                <td>{classification[r.classification]}</td><td>{r.status ?? 'Not supplied'}</td></tr>)}</tbody>
            </table></div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ series: m.series, rows: m.rows }, null, 2)}</pre>
          </details>
        </article>)}
        <p>Monthly/market, trade and geopolitical sections are not merged into this bundle. Their existing provider panels remain separate.</p>
      </section>}
      <details><summary>Retained originals and source checksums</summary>
        <ul className="space-y-2 text-xs break-all">{analysis.source.sources.map(s => <li key={s.ordinal}>
          Original {s.ordinal}: {s.path}; HTTP {s.httpStatus}; {s.bytes} bytes; SHA-256 {s.sha256}.
          Inspect/download through WEO research using source snapshot {analysis.source.runId}.
        </li>)}</ul>
      </details>
    </>}
  </section>;
}
