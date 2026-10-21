import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { activateDataset, commitImport, Dataset, downloadDatabaseBackup, ImportPreview, loadImportPreview, loadResearchEvents, loadResearchState, pullYahoo, ResearchEvent, ResearchState, stageImport, YahooReport } from '../services/dataApi';
import { ANNUAL_FEATURE_LABELS, ANNUAL_FEATURES, FITTED_MODELS } from '../math/fittedModels';
import { annualResearch, freshness, marketSeries } from '../math/researchMonitoring';

const HistoricalEvaluation = lazy(() => import('./RegulatoryBacktesting').then(module => ({ default: module.RegulatoryBacktesting })));
const MacroMonitoring = lazy(() => import('./MacroMonitoring').then(module => ({ default: module.MacroMonitoring })));
const WeoMonitoring = lazy(() => import('./WeoMonitoring').then(module => ({ default: module.WeoMonitoring })));
const WorldBankMonitoring = lazy(() => import('./WorldBankMonitoring').then(module => ({ default: module.WorldBankMonitoring })));
const FredMonitoring = lazy(() => import('./FredMonitoring').then(module => ({ default: module.FredMonitoring })));
const BisMonitoring = lazy(() => import('./BisMonitoring').then(module => ({ default: module.BisMonitoring })));
const ComtradeMonitoring = lazy(() => import('./ComtradeMonitoring').then(module => ({ default: module.ComtradeMonitoring })));
const GdeltMonitoring = lazy(() => import('./GdeltMonitoring').then(module => ({ default: module.GdeltMonitoring })));
const AcledMonitoring = lazy(() => import('./AcledMonitoring').then(module => ({ default: module.AcledMonitoring })));

const panel = 'rounded-lg border border-slate-700 bg-[#0e1524] p-5 space-y-3';
const button = 'rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-40';
const input = 'rounded border border-slate-500 bg-slate-950 px-3 py-2';
type Tab = 'Annual research' | 'Observed monitoring' | 'Monthly IMF' | 'WEO research' | 'World Bank research' | 'IDS research' | 'FRED / ALFRED' | 'BIS research' | 'UN Comtrade' | 'GDELT research' | 'ACLED research' | 'Provider pulls' | 'File ingestion' | 'Data health' | 'Historical evaluation';

function ProviderReport({ report }: { report: YahooReport }) {
  return <div className="space-y-3">
    <p>{report.semantics ?? 'Acquisition failed; no valid price history was staged.'}</p>
    <p className="text-xs">Requested {report.startedAt ?? 'Unknown'}; retrieved {report.retrievedAt ?? 'Unknown'}.
      {' '}{report.library} · {report.adapterVersion}. {report.calendar}</p>
    <p className="text-xs">{report.timestampConvention}</p>
    {report.errors.length > 0 && <p className="text-rose-300">{report.errors.join('; ')}</p>}
    <div className="overflow-auto"><table className="w-full text-left text-sm">
      <thead><tr><th>ETF / identity</th><th>Sessions</th><th>Latest Yahoo Close</th><th>Actions / warnings</th></tr></thead>
      <tbody>{report.summaries?.map(row => <tr key={row.symbol} className="border-t border-slate-700">
        <td>{row.symbol}: {row.name}<br />{row.exchange} · {row.currency} · {row.timezone}</td>
        <td>{row.rows}; {row.firstSession} to {row.lastSession}<br />Missing: {row.missingSessions}</td>
        <td>{row.lastClose} USD/share<br />{row.lastCloseAt}</td><td>{row.actions.length} action dates; {row.warnings.length} warnings</td>
      </tr>)}</tbody>
    </table></div>
    <details><summary>Inspect query, corporate actions, warnings and source checksum</summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(report, null, 2)}</pre>
    </details>
  </div>;
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected data-service failure.';
}

function ObservedChart({ dataset, symbol }: { dataset: Dataset; symbol: string }) {
  const { rows, latest, previous, change } = marketSeries(dataset, symbol);
  const times = rows.map(row => Date.parse(row.observedAt!));
  const values = rows.map(row => row.value!);
  const first = times[0], last = times[times.length - 1];
  const low = Math.min(...values), high = Math.max(...values);
  const points = values.map((v, i) => `${20 + 760 * (times[i] - first) / (last - first || 1)},${180 - 160 * (v - low) / (high - low || 1)}`).join(' ');
  return (
    <div className="space-y-3">
      <p>{symbol}: {latest.value} {dataset.unit} · observed {latest.observedAt}</p>
      <p>Change from preceding observation: {change === null ? 'Unavailable (one observation)' : `${change.toFixed(6)} ${dataset.unit}`}
        {previous && ` since ${previous.observedAt}`}. Not an adjusted return or a trading signal.</p>
      <svg role="img" aria-label={`Observed history for ${symbol}`} viewBox="0 0 800 210" className="w-full max-h-64 rounded bg-slate-950">
        <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="2" />
        {values.length === 1 && <circle cx="20" cy="180" r="4" fill="#22d3ee" />}
        <text x="20" y="205" fill="#94a3b8" fontSize="12">{rows[0].observedAt}</text>
        <text x="780" y="205" fill="#94a3b8" fontSize="12" textAnchor="end">{latest.observedAt}</text>
      </svg>
      <p className="text-xs text-slate-400">Vertical range: {low} to {high} {dataset.unit}. Horizontal spacing uses actual timestamps.
        Lines connect supplied observations; no missing periods are filled. Publication time: {latest.publishedAt ?? 'Unknown'}.</p>
      <details><summary>Inspect source observations ({rows.length})</summary>
        <div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Observed UTC</th><th>Value</th><th>Published UTC</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.observedAt}><td>{row.observedAt}</td><td>{row.value}</td><td>{row.publishedAt ?? 'Unknown'}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}

export function ResearchDashboard() {
  const [tab, setTab] = useState<Tab>('Annual research');
  const [state, setState] = useState<ResearchState | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [kind, setKind] = useState<'annual' | 'market'>('annual');
  const [source, setSource] = useState('');
  const [unit, setUnit] = useState('');
  const [freshnessDays, setFreshnessDays] = useState('');
  const [sheet, setSheet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [symbol, setSymbol] = useState('');
  const [personalUse, setPersonalUse] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const nextState = await loadResearchState();
      const nextEvents = await loadResearchEvents();
      setState(nextState);
      setEvents(nextEvents);
      setOnline(true);
      setError(null);
      setNow(Date.now());
    } catch (cause) {
      console.error('Research data refresh failed:', cause);
      setError(describeError(cause));
      setOnline(false);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(clock);
  }, [refresh]);

  const annual = state?.datasets.find(d => d.active && d.kind === 'annual');
  const market = state?.datasets.find(d => d.active && d.kind === 'market');
  const modelResults = useMemo(() => {
    try { return { rows: annualResearch(annual), error: null }; }
    catch (cause) { return { rows: [], error: describeError(cause) }; }
  }, [annual]);
  const symbols = [...new Set(market?.observations.map(row => row.symbol!).filter(Boolean) ?? [])].sort();
  const selectedSymbol = symbols.includes(symbol) ? symbol : symbols[0];
  const marketHealth = market ? freshness(market, now) : null;
  const annualHealth = annual ? freshness(annual, now) : null;
  const failedLatestRun = ['quarantined', 'interrupted'].includes(state?.runs.at(-1)?.status ?? '') ||
    state?.providers.some(provider => ['quarantined', 'interrupted'].includes(provider.status));

  const acquireYahoo = async () => {
    setBusy(true); setError(null); setPreview(null);
    try {
      const result = await pullYahoo();
      setPreview(result);
      if (result.run.errors.length) setError(result.run.errors.join('\n'));
      setState(await loadResearchState()); setOnline(true); setNow(Date.now());
    } catch (cause) {
      console.error('Yahoo pull failed:', cause);
      setError(describeError(cause));
    } finally { setBusy(false); }
  };

  const review = async (runId: string) => {
    setBusy(true); setError(null);
    try {
      const result = await loadImportPreview(runId);
      setPreview(result);
      setTab(result.providerReport ? 'Provider pulls' : 'File ingestion');
    } catch (cause) { console.error('Preview reload failed:', cause); setError(describeError(cause)); }
    finally { setBusy(false); }
  };

  const importFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) { setError('Select a CSV or XLSX file.'); return; }
    setBusy(true); setError(null); setPreview(null);
    try {
      const form = new FormData();
      form.set('file', file); form.set('kind', kind); form.set('source', source.trim());
      form.set('unit', kind === 'annual' ? 'model-feature-units' : unit.trim());
      if (freshnessDays !== '') form.set('freshnessDays', freshnessDays);
      if (sheet !== '') form.set('sheet', sheet);
      const result = await stageImport(form);
      setPreview(result);
      if (result.run.status === 'quarantined') setError(result.run.errors.join('\n'));
      const nextState = await loadResearchState();
      setState(nextState); setOnline(true);
    } catch (cause) {
      console.error('Research import failed:', cause);
      setError(describeError(cause));
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!preview || preview.run.status !== 'staged') return;
    setBusy(true); setError(null);
    try {
      if (preview.run.kind === 'annual') annualResearch({
        id: preview.run.id, version: preview.run.id, kind: 'annual', source: preview.run.source,
        unit: 'model-feature-units', createdAt: preview.run.createdAt, freshnessDays: null,
        active: true, observations: preview.preview
      });
      setState(await commitImport(preview.run.id));
      setPreview(null); setOnline(true); setNow(Date.now());
    } catch (cause) {
      console.error('Research commit failed:', cause);
      setError(describeError(cause));
    } finally { setBusy(false); }
  };

  const restore = async (dataset: Dataset) => {
    if (!confirm(`Activate version ${dataset.version}? This replaces the active ${dataset.kind} dataset; history is retained.`)) return;
    setBusy(true); setError(null);
    try {
      if (dataset.kind === 'annual') annualResearch(dataset);
      setState(await activateDataset(dataset.id)); setOnline(true); setNow(Date.now());
    } catch (cause) { console.error('Dataset activation failed:', cause); setError(describeError(cause)); }
    finally { setBusy(false); }
  };

  const backup = async () => {
    setBusy(true); setError(null);
    try { await downloadDatabaseBackup(); }
    catch (cause) { console.error('Database backup failed:', cause); setError(describeError(cause)); }
    finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className={panel}>
        <h1 className="text-2xl font-bold">Research and observed monitoring</h1>
        <p className="text-amber-200">Research only. No trading recommendations, validated VaR/ES, or live streaming quotes.
          Annual models use revised data and do not beat the constant-rate holdout baseline on Brier/log loss.
          Market observations never modify the annual hazard or HMM.</p>
        <div className="flex flex-wrap items-center gap-4">
          <span>{online ? 'Local data service available' : 'Local data service unavailable / checking'}</span>
          <span>Manual provider adapters: {state?.providers.length ?? 'unknown'} · scheduled / streaming: 0</span>
          <button className={button} disabled={busy} onClick={() => void refresh()}>Refresh stored data</button>
          <button className={button} disabled={busy || !online} onClick={() => void backup()}>Download database backup</button>
        </div>
        <p className="text-xs text-slate-400">Service availability and stored observations are checked on refresh, not continuously polled.
          Observation ages update locally. Yahoo ETF freshness uses completed US sessions; refresh after the next session close.
          No automatic pulls or financial threshold alerts are enabled.</p>
        {!online && <p className="text-amber-200">Current signals blocked. Previously loaded data is retained in this session.
          The bundled annual snapshot below is a historical reference, not a replacement for an unavailable active dataset.</p>}
        {failedLatestRun && <p className="text-amber-200">Latest ingestion did not succeed. Last committed data retained; inspect Data health.</p>}
        {error && <p role="alert" className="whitespace-pre-wrap text-rose-300">{error}</p>}
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Research views">
        {(['Annual research', 'Observed monitoring', 'Monthly IMF', 'WEO research', 'World Bank research', 'IDS research', 'FRED / ALFRED', 'BIS research', 'UN Comtrade', 'GDELT research', 'ACLED research', 'Provider pulls', 'File ingestion', 'Data health', 'Historical evaluation'] as Tab[]).map(name =>
          <button key={name} aria-pressed={tab === name} className={`${button} ${tab === name ? 'bg-slate-700' : ''}`} onClick={() => setTab(name)}>{name}</button>)}
      </nav>

      {tab === 'Annual research' && <section className={panel}>
        <h2 className="text-xl">Fitted annual default-onset estimates and HMM</h2>
        <p>Model {FITTED_MODELS.modelVersion}. {annual ? `Active annual input version ${annual.version}; source ${annual.source}.` :
          'Bundled historical baseline only; no active imported annual dataset is loaded.'}</p>
        <p>Annual source freshness: {annualHealth?.state ?? 'historical baseline / no operational freshness policy'}.
          Estimates below are research diagnostics, not financial signals. Countries already in default are out of scope for onset forecasting.</p>
        {modelResults.error && <p role="alert" className="text-rose-300">Annual analysis unavailable: {modelResults.error}. No fallback estimate substituted.</p>}
        <div className="overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Country</th><th>Observed / target year</th><th>Firth</th><th>LightGBM</th><th>Blend</th><th>HMM Calm / Stressed / Crisis</th><th>Applicability</th></tr></thead>
          <tbody>{modelResults.rows.map(row => <tr key={row.code} className="border-t border-slate-700">
            <td className="py-3">{row.name} ({row.code})</td><td>{row.observationYear} / {row.forecastYear}</td>
            <td>{(row.firthLogitProb * 100).toFixed(2)}%</td><td>{(row.lightgbmProb * 100).toFixed(2)}%</td>
            <td>{(row.reconciledHazard * 100).toFixed(2)}%</td>
            <td>{Object.values(row.regimeProbabilities).map(p => `${(p * 100).toFixed(2)}%`).join(' / ')}</td>
            <td>{row.inDefault ? 'Already in default: diagnostic only' : 'Conditional on no current default'}; {row.imported ? 'imported' : 'bundled historical'}</td>
          </tr>)}</tbody>
        </table></div>
        <details><summary>Input lineage, missingness and exact feature definitions</summary>
          <ul className="my-3">{ANNUAL_FEATURES.map(key => <li key={key}>{key}: {ANNUAL_FEATURE_LABELS[key]}</li>)}</ul>
          {modelResults.rows.map(row => <p key={row.code} className="my-2 break-all text-xs">{row.code}: {row.source}; input version {row.inputVersion};
            imputed latest features: {row.imputedFeatures.join(', ') || 'none'}. Publication availability is not established by model fitting.</p>)}
        </details>
        <button className={button} disabled={modelResults.rows.length === 0} onClick={() => downloadJson('econquest-research-annual.json', {
          status: 'research-only', exportedAt: new Date().toISOString(), backendAvailable: online,
          freshness: annualHealth, limitation: 'Retrospective revised data; no point-in-time or trading validation.',
          transformationVersion: 'annual-asinh-training-preprocessor-v1', activeInputDataset: annual ?? null, results: modelResults.rows
        })}>Export annual research with input lineage (JSON)</button>
      </section>}

      {tab === 'Observed monitoring' && <section className={panel}>
        <h2 className="text-xl">Observed market history</h2>
        {!market ? <p>No committed market observations. Review a Yahoo provider pull or import a CSV/Excel dataset. No fixture prices are substituted.</p> : <>
          <p>Source: {market.source} · version {market.version} · unit {market.unit} · freshness {marketHealth!.state}.</p>
          <p className="text-amber-200">{online && marketHealth!.eligible ? 'Observed history meets its freshness policy. No trading signals are generated.' :
            'Current signals blocked: offline, stale, or freshness policy unverified. Last valid history remains visible.'}</p>
          <label>Instrument <select className={`${input} ml-3`} value={selectedSymbol} onChange={event => setSymbol(event.target.value)}>
            {symbols.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <ObservedChart dataset={market} symbol={selectedSymbol} />
          {market.sessionPolicy && <p className="text-xs">Expected completed close: {market.sessionPolicy.expectedCloseAt}.
            Calendar freshness must be refreshed at {market.sessionPolicy.nextCheckAt}; eligibility expires locally then.</p>}
          {market.providerReport && <details><summary>Yahoo source and validation lineage</summary><ProviderReport report={market.providerReport} /></details>}
          <button className={button} onClick={() => downloadJson('econquest-observed-history.json', {
            status: 'observed-research', exportedAt: new Date().toISOString(), backendAvailable: online,
            freshness: marketHealth, dataset: market
          })}>Export observed dataset and lineage (JSON)</button>
        </>}
      </section>}

      {tab === 'Provider pulls' && <section className={panel}>
        <h2 className="text-xl">Yahoo Finance / yfinance: manual research acquisition</h2>
        <p>EMB and PCY are emerging-market bond ETFs; ECH is Chile equity and TUR is Turkey equity.
          All are USD ETF share prices, not sovereign yields, CDS spreads, country default probabilities or total returns.</p>
        <p>Five years of completed daily sessions, explicit Close with auto_adjust=False; OHLCV, adjusted close and corporate actions
          retained in the source snapshot. No repaired, forward-filled or simulated prices.
          Identity, currency, daily frequency, OHLC consistency and every expected US session are checked for all four ETFs.</p>
        <p className="text-amber-200">Unofficial Yahoo access via yfinance; availability, accuracy and access are not guaranteed.
          Local personal research only, no redistribution. A valid provider response is not independent price verification.
          Review the report before committing: this replaces the entire active market dataset, never annual model inputs.</p>
        {state?.providers.filter(provider => provider.id === 'yfinance').map(provider => <p key={provider.id}>Adapter: {provider.status}; last attempt {provider.lastAttemptAt ?? 'Never'};
          {' '}last validated pull {provider.lastValidatedAt ?? 'Never'}. {provider.errors.join('; ')}</p>)}
        <label className="block"><input type="checkbox" checked={personalUse} onChange={event => setPersonalUse(event.target.checked)} />
          {' '}I confirm local personal research use and no redistribution.</label>
        <button className={button} disabled={busy || !online || !personalUse} onClick={() => void acquireYahoo()}>
          Pull and validate Yahoo history
        </button>
        <p className="text-xs">Manual only. Up to 90 seconds per pull; 60-second cooldown. Nothing activates until commit.
          Prices are stamped at actual exchange close UTC (including early closes and DST); publication times stay unknown.
          Sessions become eligible 30 minutes after close. Missing sessions quarantine the whole batch.</p>
      </section>}

      <div hidden={tab !== 'Monthly IMF' && tab !== 'Provider pulls'}>
        {(tab === 'Monthly IMF' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading Monthly IMF...</p>}>
          <MacroMonitoring summaries={state?.macro ?? []} online={online} onRefresh={refresh} />
        </Suspense>}
      </div>
      {(tab === 'WEO research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading WEO research...</p>}>
        <WeoMonitoring summaries={state?.weo ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'World Bank research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading World Bank research...</p>}>
        <WorldBankMonitoring summaries={state?.worldbank ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'IDS research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading IDS research...</p>}>
        <WorldBankMonitoring key="ids" provider="ids" summaries={state?.ids ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'UN Comtrade' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading UN Comtrade...</p>}>
        <ComtradeMonitoring summaries={state?.comtrade ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'GDELT research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading GDELT research...</p>}>
        <GdeltMonitoring summaries={state?.gdelt ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'ACLED research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading ACLED research...</p>}>
        <AcledMonitoring summaries={state?.acled ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'FRED / ALFRED' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading FRED/ALFRED research...</p>}>
        <FredMonitoring summaries={state?.fred ?? []} online={online} onRefresh={refresh} />
      </Suspense>}
      {(tab === 'BIS research' || tab === 'Provider pulls') && <Suspense fallback={<p>Loading BIS research...</p>}>
        <BisMonitoring summaries={state?.bis ?? []} online={online} onRefresh={refresh} />
      </Suspense>}

      {tab === 'File ingestion' && <section className={panel}>
        <h2 className="text-xl">Validated file ingestion</h2>
        <p>Explicit schema, staging preview, then atomic activation. One active dataset per kind; a new version replaces the
          entire previous dataset for that kind. No implicit source blending. Original files and all versions are retained in SQLite.</p>
        <p>Annual inference explicitly overlays the active annual dataset onto bundled history: matching years replace bundled rows,
          consecutive new years append, and omitted countries/years retain their labeled historical baseline.
          A replacement import does not inherit observations from earlier imports.</p>
        <p className="text-amber-200">Only upload files you are permitted to store. CSV/XLSX, at most 5 MiB and 10,000 rows.
          Values-only workbooks recommended; formulas without cached values are rejected. No macros or legacy XLS.</p>
        <form onSubmit={event => void importFile(event)} className="flex flex-col items-start gap-3">
          <label>Dataset kind <select className={`${input} ml-3`} value={kind} onChange={event => { setKind(event.target.value as 'annual' | 'market'); setPreview(null); }}>
            <option value="annual">Annual model inputs</option><option value="market">Observed market history</option>
          </select></label>
          <label>Source / provider / release <input required maxLength={200} className={`${input} ml-3`} value={source} onChange={event => { setSource(event.target.value); setPreview(null); }} /></label>
          {kind === 'market' && <label>Exact units and convention (e.g. USD per EUR, yield percent, CDS bps)
            <input required maxLength={100} className={`${input} ml-3`} value={unit} onChange={event => { setUnit(event.target.value); setPreview(null); }} /></label>}
          <label>Maximum observation age (days; blank = unverified, signals blocked)
            <input type="number" min="0" max="36500" step="1" className={`${input} ml-3 w-28`} value={freshnessDays} onChange={event => { setFreshnessDays(event.target.value); setPreview(null); }} /></label>
          <p className="text-xs text-slate-400">This is a user-supplied age policy, not a verified provider publication/calendar policy.
            Import time is not observation time; retrieval history cannot prove historical publication availability.</p>
          <label>Excel sheet (blank selects first; available names shown after staging)
            <input className={`${input} ml-3`} value={sheet} onChange={event => { setSheet(event.target.value); setPreview(null); }} /></label>
          <label>Select CSV or XLSX <input type="file" accept=".csv,.xlsx" className="ml-3" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
          <button className={button} disabled={busy || !online} type="submit">Validate and stage file</button>
        </form>
        <details open><summary>Required file schemas (not sample historical evidence)</summary>
          <pre className="overflow-auto text-xs py-3">{kind === 'annual'
            ? `country_code,year,in_default,${ANNUAL_FEATURES.join(',')},published_at`
            : 'symbol,observed_at,value,published_at'}</pre>
          <p className="text-sm">{kind === 'annual' ? 'Use supported ISO3 countries, consecutive completed annual periods (at least two per included country), explicit in_default 0/1, and exact model-feature units. At least four predictors must be observed; reserves, growth and inflation cannot be missing.' :
            'Use UTC ISO observation timestamps, stable instrument identifiers and numeric values. One common unit per dataset. No automatic FX inversion, corporate-action adjustment or futures rolling.'}
            {' '}published_at is optional. Unknown remains unknown; do not invent dates.</p>
        </details>
      </section>}

      {preview && tab === (preview.providerReport ? 'Provider pulls' : 'File ingestion') && <section className={panel}>
          <h3>Staged run {preview.run.id}: {preview.run.status} · {preview.run.rowCount} rows</h3>
          {preview.providerReport && <ProviderReport report={preview.providerReport} />}
          <p>Source: {preview.providerReport ? 'captured yfinance library response (not raw HTTP)' : preview.sheets.join(', ') || 'CSV'}; first ten rows below.</p>
          <pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(preview.preview.slice(0, 10), null, 2)}</pre>
          <button className={button} disabled={busy || !online || preview.run.status !== 'staged'} onClick={() => void commit()}>Commit staged version</button>
          <a className={`${button} inline-block ml-3`} href={`/api/imports/${encodeURIComponent(preview.run.id)}/original`} download>Download original source snapshot</a>
          <p className="text-xs">Commit replaces the entire active {preview.run.kind} dataset. Original bytes and older versions remain in SQLite.</p>
      </section>}

      {tab === 'Data health' && <section className={panel}>
        <h2 className="text-xl">Data health, revisions and recovery</h2>
        <p>Yahoo ETF provider and file jobs run on demand; no live scheduler is claimed.
          Unknown freshness blocks signals. Health notices are state summaries, not financial-event alerts.</p>
        {!state && <p>Backend state unavailable. Start the local Python service, then refresh. No durable dataset status can be inferred.</p>}
        {state?.datasets.map(dataset => {
          const health = freshness(dataset, now);
          return <div key={dataset.id} className="rounded border border-slate-700 p-3 space-y-2">
            <h3>{dataset.kind} · {dataset.active ? 'ACTIVE' : 'archived'} · {dataset.source}</h3>
            <p className="break-all text-xs">Version {dataset.version}; stored {dataset.createdAt}; {dataset.observations.length} rows.
              Import age {health.importAgeDays.toFixed(2)} days; source freshness {health.state}. Provider retrieval time unknown for uploaded files.</p>
            <ul className="text-xs">{health.ages.map(item => <li key={item.series}>{item.series}: latest observed {new Date(item.latest).toISOString()},
              {' '}{item.ageDays.toFixed(2)} days old</li>)}</ul>
            {!dataset.active && <button className={button} disabled={busy || !online} onClick={() => void restore(dataset)}>Activate this version</button>}
          </div>;
        })}
        <h3 className="text-lg">Persisted ingestion runs</h3>
        <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Run / time</th><th>Source</th><th>Status</th><th>Rows</th><th>Errors</th></tr></thead>
          <tbody>{state?.runs.map(run => <tr key={run.id} className="border-t border-slate-700">
            <td className="py-2">{run.id}<br />{run.createdAt}
              <button className={`${button} block`} disabled={busy || !online} onClick={() => void review(run.id)}>Review stored run</button>
            </td><td>{run.source}</td><td>{run.status}</td><td>{run.rowCount}</td><td>{run.errors.join('; ') || 'None'}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="text-sm">Backups include raw source files, revisions and run lineage. Use the documented offline restore command into a new database path;
          verify the restored data before switching. No automated retention deletion is enabled.</p>
        <h3 className="text-lg">Persisted audit and health events</h3>
        <p className="text-xs text-slate-400">Refresh stored data to update this history. Events use actual timestamps and stable identities;
          unchanged health is deduplicated. No background push or financial-event detection is implied.</p>
        <div className="max-h-80 overflow-auto">
          {events.length === 0 ? <p>No loaded audit events.</p> : events.map(event =>
            <details key={event.sequence} className="border-t border-slate-700 py-2 text-xs">
              <summary>#{event.sequence} · {event.createdAt} · {event.event}</summary>
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(event, null, 2)}</pre>
            </details>)}
        </div>
      </section>}

      {tab === 'Historical evaluation' && <Suspense fallback={<p>Loading historical evaluation...</p>}><HistoricalEvaluation /></Suspense>}
    </main>
  );
}
