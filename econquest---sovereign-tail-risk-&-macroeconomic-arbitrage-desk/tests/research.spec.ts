import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Dataset, ImportPreview, ResearchState, YahooReport } from '../src/services/dataApi';
import type { MacroCoverage, MacroRow, MacroRun } from '../src/services/imfApi';

const artifact: {
  features: string[];
  countries: { TUR: { year: number; inDefault: boolean; values: (number | null)[] }[] };
} = JSON.parse(readFileSync(new URL('../src/data/fittedAnnualModels.json', import.meta.url), 'utf8'));

test('Monthly IMF incomplete coverage, independent commit, validation quarantine and outage retention (mock source only)', async ({ page }) => {
  let state: ResearchState = await (await page.request.get('/api/state')).json();
  const observations: MacroRow[] = ['2025-01', '2025-03'].map((period, i) => ({
    country: 'CAN', indicator: 'cpi', period, value: 100 + i, rawValue: String(100 + i),
    scale: '0', unit: 'Native CPI index', status: null, sourceHash: 'a'.repeat(64),
    attributes: { REFERENCE_PERIOD: '2010A' }
  }));
  observations.splice(1, 0, {
    ...observations[0], period: '2025-02', value: null, rawValue: '100.5', status: 'T',
    exclusionReason: 'Unknown source observation status',
  });
  const matrix: MacroCoverage[] = [{
    country: 'CAN', name: 'Canada', indicator: 'cpi', validCount: 2, firstPeriod: '2025-01',
    latestPeriod: '2025-03', missingCount: 1, missingPeriods: ['2025-02'], absent: false, freshness: 'unknown'
  }, {
    country: 'CAN', name: 'Canada', indicator: 'fx', validCount: 0, firstPeriod: null,
    latestPeriod: null, missingCount: 3, missingPeriods: ['2025-01', '2025-02', '2025-03'], absent: true, freshness: 'unknown'
  }];
  let run: MacroRun = {
    id: 'imf-browser-fixture', status: 'staged', active: false, createdAt: '2025-04-01T00:00:00Z',
    progress: {}, sources: [{ ordinal: 1, path: '/data/fixture-not-empirical', httpStatus: 200, sha256: 'a'.repeat(64), bytes: 15 }],
    report: { errors: [], contractVersion: 'imf-monthly-native-v2', coveragePolicy: 'available-monthly-pairs', numericCount: 2, unknownStatusRows: 1,
      countries: [{ code: 'CAN', name: 'Canada', iso3: 'CAN' }],
      indicators: [{ id: 'cpi', name: 'Fixture CPI, not empirical', unit: 'Native index', flow: 'CPI', key: 'CPI._T.IX.M' },
        { id: 'fx', name: 'Absent fixture FX', unit: 'Native units', flow: 'ER', key: 'XDC_USD.PA_RT.M' }],
      rowCount: 3, startPeriod: '2025-01', endPeriod: '2025-03', requiredPairs: 2, absentPairs: 1,
      valueConvention: 'Native fixture values; no real IMF acquisition' }
  };
  let fail = false;
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/imf/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    if (fail) run = { ...run, id: 'imf-quarantined-fixture', active: false, status: 'quarantined',
      report: { ...run.report, errors: ['Fixture: invalid monthly response'], absentPairs: 1 } };
    state = { ...state, macro: [...(state.macro ?? []), run] };
    await route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/macro/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/coverage')) return route.fulfill({ json: { rows: matrix, total: 2, offset: 0, limit: 50 } });
    if (path.endsWith('/observations')) return route.fulfill({ json: new URL(route.request().url()).searchParams.get('indicator') === 'fx'
      ? { rows: [], total: 0, offset: 0, limit: 240 } : { rows: observations, total: 3, offset: 0, limit: 240 } });
    if (path.endsWith('/commit')) {
      run = { ...run, active: true, status: 'committed' };
      state = { ...state, macro: [run] };
      return route.fulfill({ json: state });
    }
    return route.fulfill({ json: run });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  const annual = await page.locator('tbody').first().innerText();
  await page.getByRole('button', { name: 'Monthly IMF', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull and validate IMF monthly basket' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm authorized local research use/ }).check();
  await pull.click();
  await expect(page.getByRole('button', { name: 'Commit IMF basket' })).toBeEnabled();
  expect(state.macro![0].active).toBe(false);
  await expect(page.getByRole('img', { name: 'IMF native monthly history with gaps' })).toBeVisible();
  await expect(page.getByText('Consecutive-month change:', { exact: false })).toContainText('Blocked');
  expect(await page.locator('svg[role="img"] polyline').count()).toBe(0);
  expect(await page.locator('svg[role="img"] circle').count()).toBe(2);
  await page.getByText('IMF coverage and missing-pair report', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Canada (CAN)' }).first()).toBeVisible();
  await expect(page.getByText('Completely missing pairs remain unavailable;', { exact: false })).toBeVisible();
  await expect(page.getByText('ABSENT', { exact: true })).toBeVisible();
  await page.getByText('Inspect native values, status and inherited source metadata', { exact: true }).click();
  await expect(page.locator('pre').filter({ hasText: 'Unknown source observation status' }).first()).toContainText('100.5');
  await page.getByRole('button', { name: 'Commit IMF basket' }).click();
  await expect(page.getByRole('button', { name: 'Activate IMF revision' })).toBeDisabled();
  expect(state.macro![0].active).toBe(true);
  await page.getByRole('combobox', { name: 'IMF indicator', exact: true }).selectOption('fx');
  await expect(page.getByText('No source observations for this selection; history unavailable, nothing filled.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'IMF indicator', exact: true }).selectOption('cpi');
  await expect(page.getByRole('img', { name: 'IMF native monthly history with gaps' })).toBeVisible();
  await page.route('**/api/macro/**/observations?**', route => new URL(route.request().url()).searchParams.get('indicator') === 'fx' ? route.abort('failed') : route.fallback());
  await page.getByRole('combobox', { name: 'IMF indicator', exact: true }).selectOption('fx');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/Retained previous selection; not the current selectors/)).toContainText('CAN · cpi');
  await expect(page.getByRole('img', { name: 'IMF native monthly history with gaps' })).toBeVisible();
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  await page.getByRole('button', { name: 'Monthly IMF', exact: true }).click();
  fail = true;
  await page.getByRole('checkbox', { name: /I confirm authorized local research use/ }).check();
  await pull.click();
  await expect(page.getByText('Fixture: invalid monthly response. No activation permitted.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit IMF basket' })).toBeDisabled();
  expect(state.macro!.find(s => s.active)?.id).toBe('imf-browser-fixture');
  await page.route('**/api/providers/imf/pull', route => route.abort('failed'));
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('Last loaded history retained');
  await expect(page.getByRole('img', { name: 'IMF native monthly history with gaps' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Yahoo review, explicit activation, stored provenance and failure retention (mock provider; no Yahoo requests)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  const observations = ['EMB', 'PCY', 'ECH', 'TUR'].flatMap((symbol, i) => [
    { symbol, observedAt: '2025-07-02T20:00:00Z', value: 100 + i, publishedAt: null },
    { symbol, observedAt: '2025-07-03T17:00:00Z', value: 101 + i, publishedAt: null }
  ]);
  const report: YahooReport = {
    adapterVersion: 'e2e-fixture-not-empirical', library: 'mock provider, no network',
    startedAt: '2025-07-07T18:00:00Z', retrievedAt: '2025-07-07T18:01:00Z',
    semantics: 'E2E fixture of Yahoo Close convention; not empirical evidence or total returns.',
    timestampConvention: 'Session close UTC; publication unknown', calendar: 'Mock calendar fixture',
    pullId: 'test-pull', originalSha256: 'a'.repeat(64), errors: [],
    summaries: ['EMB', 'PCY', 'ECH', 'TUR'].map((symbol, i) => ({
      symbol, name: `Test fixture ${symbol}`, currency: 'USD', exchange: 'NGM', timezone: 'America/New_York',
      rows: 2, firstSession: '2025-07-02', lastSession: '2025-07-03', lastClose: 101 + i,
      lastCloseAt: '2025-07-03T17:00:00Z', missingSessions: 0, actions: [], warnings: []
    }))
  };
  let current = structuredClone(initial);
  const staged: ImportPreview = {
    run: { id: 'yahoo-e2e', status: 'staged', kind: 'market', source: 'E2E Yahoo fixture, not empirical',
      createdAt: '2025-07-07T18:01:00Z', datasetId: null, rowCount: observations.length, errors: [] },
    preview: observations, sheets: [], providerReport: report
  };
  let fail = false;
  let attempts = 0;
  await page.route('**/api/state', route => route.fulfill({ json: current }));
  await page.route('**/api/providers/yfinance/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ personalUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    attempts++;
    const result: ImportPreview = fail ? {
      ...staged, run: { ...staged.run, id: 'failed-yahoo-e2e', status: 'quarantined', errors: ['Fixture: missing required sessions'], rowCount: 0 },
      preview: [], providerReport: { ...report, summaries: [], errors: ['Fixture: missing required sessions'] }
    } : staged;
    current = { ...current, runs: [...current.runs, result.run] };
    await route.fulfill({ json: result });
  });
  await page.route('**/api/imports/yahoo-e2e/commit', async route => {
    const dataset: Dataset = {
      id: 'yahoo-market-e2e', version: 'test-only', kind: 'market', source: staged.run.source,
      unit: 'USD per ETF share', createdAt: staged.run.createdAt, freshnessDays: null, active: true,
      observations, providerReport: report,
      sessionPolicy: { expectedCloseAt: '2025-07-03T17:00:00Z', nextCheckAt: '2025-07-07T20:30:00Z', checkedAt: '2025-07-07T18:01:00Z' }
    };
    current = {
      ...current, datasets: [...current.datasets.map(d => d.kind === 'market' ? { ...d, active: false } : d), dataset],
      runs: current.runs.map(run => run.id === staged.run.id ? { ...run, status: 'committed', datasetId: dataset.id } : run)
    };
    await route.fulfill({ json: current });
  });
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  const annualBefore = await page.locator('tbody').first().innerText();
  await page.getByRole('button', { name: 'Provider pulls', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull and validate Yahoo history' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm local personal research/ }).check();
  await pull.click();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeEnabled();
  expect(current.datasets.some(d => d.id === 'yahoo-market-e2e')).toBe(false);
  await expect(page.getByRole('cell', { name: /EMB: Test fixture EMB/ })).toBeVisible();
  await page.getByRole('button', { name: 'Commit staged version' }).click();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await page.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('EMB');
  await expect(page.getByText('EMB: 101 USD per ETF share', { exact: false })).toBeVisible();
  await expect(page.getByText('Current signals blocked:', { exact: false })).toBeVisible();
  await page.getByText('Yahoo source and validation lineage', { exact: true }).click();
  await expect(page.getByText(report.semantics!, { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export observed dataset and lineage (JSON)' }).click();
  const downloaded = await downloadEvent;
  const exported = JSON.parse(readFileSync((await downloaded.path())!, 'utf8'));
  expect(exported.dataset.providerReport.originalSha256).toBe(report.originalSha256);
  expect(exported.dataset.observations[1].value).toBe(101);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annualBefore);
  await page.getByRole('button', { name: 'Provider pulls', exact: true }).click();
  fail = true;
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('missing required sessions');
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeDisabled();
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('EMB: 101 USD per ETF share', { exact: false })).toBeVisible();
  expect(attempts).toBe(2);
});

test('research ingestion, revisions, model isolation, stale data, outage and experimental boundaries', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('econquest_data_feeds', JSON.stringify([{ status: 'Connected', enabled: true, latencyMs: 15 }]));
  });
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await expect(page.getByText('Manual provider adapters: 10 · scheduled / streaming: 0')).toBeVisible();
  await expect(page.getByText('Bundled historical baseline only;', { exact: false })).toBeVisible();
  const baseline = await page.locator('tbody').first().innerText();

  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('No committed market observations.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await page.getByLabel('Dataset kind').selectOption('market');
  await page.getByLabel('Source / provider / release').fill('E2E fixture, not empirical');
  await page.getByLabel('Exact units and convention', { exact: false }).fill('USD per EUR');
  await page.getByLabel('Maximum observation age', { exact: false }).fill('1');
  const upload = async (value: number) => {
    await page.getByLabel('Select CSV or XLSX').setInputFiles({
      name: 'test.csv', mimeType: 'text/csv',
      buffer: Buffer.from(`symbol,observed_at,value,published_at\nEURUSD,2020-01-01T00:00:00Z,1.1,\nEURUSD,2020-01-03T00:00:00Z,${value},\n`)
    });
    await page.getByRole('button', { name: 'Validate and stage file' }).click();
    await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeEnabled();
    await page.getByRole('button', { name: 'Commit staged version' }).click();
    await expect(page.getByRole('button', { name: 'Commit staged version' })).toHaveCount(0);
  };
  await upload(1.2);
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();
  await expect(page.getByText('Current signals blocked:', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Observed history for EURUSD' })).toBeVisible();

  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(baseline);
  await page.reload();
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await page.getByLabel('Dataset kind').selectOption('market');
  await page.getByLabel('Source / provider / release').fill('E2E fixture, not empirical');
  await page.getByLabel('Exact units and convention', { exact: false }).fill('USD per EUR');
  await page.getByLabel('Maximum observation age', { exact: false }).fill('1');
  await upload(1.3);
  await page.getByRole('button', { name: 'Refresh stored data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh stored data' })).toBeEnabled();
  await page.getByRole('button', { name: 'Data health', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Persisted audit and health events' })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: 'data_health_changed' }).first()).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Activate this version' }).first().click();
  await expect(page.getByRole('button', { name: 'Refresh stored data' })).toBeEnabled();
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await page.getByLabel('Dataset kind').selectOption('annual');
  const years = artifact.countries.TUR.slice(-2);
  const header = `country_code,year,in_default,${artifact.features.join(',')}`;
  const content = [header, ...years.map(row => `TUR,${row.year},${Number(row.inDefault)},${row.values.map((v, i) => i === 4 ? 0 : v ?? '').join(',')}`)].join('\n');
  await page.getByLabel('Select CSV or XLSX').setInputFiles({ name: 'annual.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: 'Validate and stage file' }).click();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeEnabled();
  await page.getByRole('button', { name: 'Commit staged version' }).click();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).not.toBe(baseline);
  await page.reload();
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  expect(await page.locator('tbody').first().innerText()).not.toBe(baseline);

  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await page.getByLabel('Dataset kind').selectOption('market');
  await page.getByLabel('Source / provider / release').fill('Invalid test fixture');
  await page.getByLabel('Exact units and convention', { exact: false }).fill('USD');
  await page.getByLabel('Select CSV or XLSX').setInputFiles({
    name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('symbol,observed_at,value\nX,invalid,NaN\n')
  });
  await page.getByRole('button', { name: 'Validate and stage file' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeDisabled();
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download database backup', exact: true }).click();
  const backup = await backupDownload;
  const backupPath = await backup.path();
  expect(readFileSync(backupPath!).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  await page.route('**/api/state', route => route.abort());
  await page.getByRole('button', { name: 'Refresh stored data' }).click();
  await expect(page.getByText('Local data service unavailable / checking', { exact: true })).toBeVisible();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Refresh stored data' }).click();
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open experimental sandbox' }).click();
  await expect(page.getByText('EXPERIMENTAL SANDBOX', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Return to research dashboard' }).click();
  await expect(page.getByText('EURUSD: 1.2 USD per EUR', { exact: false })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('initial backend outage is explicit and cannot resurrect old connected feed settings', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('econquest_data_feeds', JSON.stringify([{ status: 'Connected', enabled: true }]));
  });
  await page.route('**/api/state', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('Local data service unavailable / checking', { exact: true })).toBeVisible();
  await expect(page.getByText('Bundled historical baseline only;', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Manual provider adapters: unknown · scheduled / streaming: 0')).toBeVisible();
  await page.getByRole('button', { name: 'Observed monitoring', exact: true }).click();
  await expect(page.getByText('No committed market observations.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Validate and stage file' })).toBeDisabled();
});

test('built release serves the dashboard and same-origin ingestion through Python', async ({ page }) => {
  await page.goto('http://127.0.0.1:8766/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Research and observed monitoring' })).toBeVisible();
  await page.getByRole('button', { name: 'File ingestion', exact: true }).click();
  await page.getByLabel('Dataset kind').selectOption('market');
  await page.getByLabel('Source / provider / release').fill('Built-release test fixture');
  await page.getByLabel('Exact units and convention', { exact: false }).fill('USD');
  await page.getByLabel('Select CSV or XLSX').setInputFiles({
    name: 'release-test.csv', mimeType: 'text/csv', buffer: Buffer.from('symbol,observed_at,value\nTEST,2020-01-01T00:00:00Z,1\n')
  });
  await page.getByRole('button', { name: 'Validate and stage file' }).click();
  await expect(page.getByRole('button', { name: 'Commit staged version' })).toBeEnabled();
});
