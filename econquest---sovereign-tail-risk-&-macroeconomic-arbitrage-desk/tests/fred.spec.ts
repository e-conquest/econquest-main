import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import type { FredRun, FredSeries, FredRow } from '../src/services/fredApi';

test('FRED current and ALFRED as-of snapshots stay separate, retain native gaps and leave models unchanged (mock source)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, fred: [] };
  let configured = false;
  const current: FredRun = { id: 'fred-current-fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false,
    sources: [], progress: {}, report: { mode: 'current', asOf: '2026-10-20', errors: [], rowCount: 4, seriesCount: 2, numericCount: 3, availableSeries: 2 } };
  const historical: FredRun = { ...structuredClone(current), id: 'alfred-historical-fixture',
    report: { ...current.report, mode: 'historical', asOf: '2010-01-01', rowCount: 3, numericCount: 2, availableSeries: 1, unavailableSeries: ['SOFR'] } };
  const info = (id: string, run: FredRun): FredSeries => {
    const unavailable = id === 'SOFR' && run.report.mode === 'historical';
    const asOf = unavailable ? '2026-10-20' : run.report.asOf;
    return { id, name: `${id} fixture`, metadata: { id, title: `${id} fixture`, units: 'Fixture native units', units_short: 'fixture',
      frequency: id === 'GDP' ? 'Quarterly' : 'Daily', frequency_short: id === 'GDP' ? 'Q' : 'D',
      seasonal_adjustment: 'Not Seasonally Adjusted', seasonal_adjustment_short: 'NSA', last_updated: '2026-10-19 10:00:00-05',
      observation_start: '2000-01-01', observation_end: '2026-07-01', realtime_start: asOf, realtime_end: asOf },
      metadataAsOf: asOf, metadataSourceHash: 'a'.repeat(64), vintageSourceHashes: ['a'.repeat(64)],
      vintageDates: id === 'SOFR' ? ['2018-04-03'] : ['2000-02-01'], firstArchivedVintage: id === 'SOFR' ? '2018-04-03' : '2000-02-01',
      latestEligibleVintage: unavailable ? null : id === 'SOFR' ? '2018-04-03' : '2000-02-01',
      status: unavailable ? 'unavailable' : 'available', reason: unavailable ? 'No archived vintage before requested date.' : '',
      validCount: unavailable ? 0 : id === 'GDP' ? 2 : 1, missingCount: id === 'GDP' ? 1 : 0,
      firstObservation: unavailable ? null : id === 'GDP' ? '2000-01-01' : '2026-10-01',
      lastObservation: unavailable ? null : id === 'GDP' ? '2000-07-01' : '2026-10-01',
      latestValidObservation: unavailable ? null : id === 'GDP' ? '2000-07-01' : '2026-10-01', analysisBlocked: unavailable || id === 'GDP' };
  };
  const rows = (id: string, run: FredRun): FredRow[] => {
    if (id === 'SOFR' && run.report.mode === 'historical') return [];
    return (id === 'GDP' ? ['2000-01-01', '2000-04-01', '2000-07-01'] : ['2026-10-01']).map((date, i) => ({
      seriesId: id, date, value: i === 1 ? null : -1.25 + i, rawValue: i === 1 ? '.' : String(-1.25 + i),
      realtimeStart: run.report.asOf, realtimeEnd: run.report.asOf, sourceHash: 'a'.repeat(64),
    }));
  };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/fred/config', route => route.fulfill({ json: { configured, today: '2026-10-20', earliestDate: '1776-07-04',
    series: [{ id: 'GDP', name: 'Nominal GDP fixture', frequency: 'Q' }, { id: 'SOFR', name: 'SOFR fixture', frequency: 'D' }] } }));
  await page.route('**/api/providers/fred/pull', async route => {
    const body = route.request().postDataJSON();
    expect(body.researchUse).toBe(true);
    expect(body.api_key).toBeUndefined();
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    const run = body.mode === 'historical' ? historical : current;
    if (body.mode === 'historical') expect(body.asOf).toBe('2010-01-01');
    state = { ...state, fred: [...(state.fred ?? []), run] };
    await route.fulfill({ status: 202, json: run });
  });
  await page.route('**/api/fred/**', async route => {
    const url = new URL(route.request().url());
    const run = url.pathname.includes(historical.id) ? historical : current;
    if (url.pathname.endsWith('/series')) return route.fulfill({ json: { runId: run.id, mode: run.report.mode, asOf: run.report.asOf,
      series: [info('GDP', run), info('SOFR', run)] } });
    if (url.pathname.endsWith('/observations')) {
      const id = url.searchParams.get('series_id')!;
      const values = rows(id, run);
      return route.fulfill({ json: { rows: values, series: info(id, run), total: values.length, offset: 0, limit: 5000 } });
    }
    if (url.pathname.endsWith('/commit')) {
      run.status = 'committed'; run.active = true;
      state = { ...state, fred: state.fred!.map(s => s.id === run.id ? run : s) };
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
  await page.getByRole('button', { name: 'FRED / ALFRED', exact: true }).click();
  await expect(page.getByText('Backend key:', { exact: false })).toContainText('Not configured');
  await page.getByRole('checkbox', { name: /I confirm authorized research use of FRED/ }).check();
  const pull = page.getByRole('button', { name: 'Pull current FRED history' });
  await expect(pull).toBeDisabled();
  configured = true;
  await page.getByRole('button', { name: 'Reload FRED configuration and review' }).click();
  await expect(pull).toBeEnabled();
  await pull.click();
  await expect(page.getByRole('img', { name: 'FRED native history at selected real-time date' })).toBeVisible();
  expect(await page.locator('svg[role="img"] circle').count()).toBe(2);
  expect(current.active).toBe(false);
  await page.getByRole('button', { name: 'Activate current FRED snapshot', exact: true }).click();
  await expect.poll(() => current.active).toBe(true);
  await page.getByRole('combobox', { name: 'FRED pull mode', exact: true }).selectOption('historical');
  await page.getByLabel('ALFRED as-of date', { exact: true }).fill('2010-01-01');
  await page.getByRole('button', { name: 'Pull ALFRED as-of snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Activate historical FRED snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Activate historical FRED snapshot', exact: true }).click();
  await expect.poll(() => historical.active).toBe(true);
  expect(current.active).toBe(true);
  await page.getByRole('combobox', { name: 'FRED series', exact: true }).selectOption('SOFR');
  await expect(page.getByText('No numeric history for this as-of date.', { exact: false })).toContainText('No current-vintage fallback');
  await page.getByRole('combobox', { name: 'FRED series', exact: true }).selectOption('GDP');
  await expect(page.getByRole('img', { name: 'FRED native history at selected real-time date' })).toBeVisible();
  await page.route('**/api/providers/fred/pull', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Pull ALFRED as-of snapshot' }).click();
  await expect(page.getByRole('alert')).toContainText('Last valid review retained');
  await expect(page.getByRole('img', { name: 'FRED native history at selected real-time date' })).toBeVisible();
  for (const key of ['datasets', 'macro', 'weo', 'worldbank'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});
