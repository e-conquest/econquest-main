import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import type { WeoCoverage, WeoObservations, WeoRun } from '../src/services/weoApi';

test('WEO explicit activation allows gaps but isolates models and labels forecasts/unknowns (mock source only)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, weo: [] };
  const run: WeoRun = {
    id: 'weo-browser-fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false, progress: {},
    sources: [{ ordinal: 1, path: '/data/WEO/fixture-not-empirical', httpStatus: 200, bytes: 7, sha256: 'a'.repeat(64) }],
    report: { errors: [], publicationDate: '2026-10-13T02:00:00Z', firstYear: 2022, lastYear: 2026,
      rowCount: 5, seriesCount: 1, requiredPairs: 2, absentPairs: 1, availableEconomies: 1, availableIndicators: 1,
      countries: [{ code: 'CAN', name: 'Canada', iso3: 'CAN' }],
      indicators: [{ code: 'BCA', name: 'Current account fixture', description: 'Browser fixture, not empirical.' },
        { code: 'PCOM', name: 'Global-only fixture', description: 'No country-level data; not a failure of the entire WEO release.' }] }
  };
  const data: WeoObservations = {
    rows: [2022, 2023, 2024, 2025, 2026].map((year, i) => ({
      country: 'CAN', indicator: 'BCA', year, value: year === 2024 ? null : 1e9 + i,
      rawValue: year === 2024 ? null : String(1e9 + i), status: null, sourceHash: 'a'.repeat(64),
      classification: year <= 2024 ? 'actual' : 'estimate_projection', attributes: {}
    })),
    total: 5, limit: 400, offset: 0,
    series: { country: 'CAN', indicator: 'BCA', unit: 'USD', unitLabel: 'US dollar', scale: '9', scaleLabel: 'Billions',
      validCount: 4, latestActualYear: 2024, missingYears: [2024], missingCount: 1, analysisBlocked: false,
      sourceHash: 'a'.repeat(64), attributes: { LATEST_ACTUAL_ANNUAL_DATA: '2024', BASIS_OF_PROJECTIONS: 'Synthetic test fixture' } }
  };
  const coverage: WeoCoverage[] = [
    { country: 'CAN', name: 'Canada', indicator: 'BCA', indicatorName: 'Current account fixture', validCount: 4,
      absent: false, missingYears: [2024], latestActualYear: 2024, analysisBlocked: false },
    { country: 'CAN', name: 'Canada', indicator: 'PCOM', indicatorName: 'Global-only fixture', validCount: 0,
      absent: true, missingYears: [2022, 2023, 2024, 2025, 2026], latestActualYear: null, analysisBlocked: true }
  ];
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/imf-weo/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    state = { ...state, weo: [run] };
    await route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/weo/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/coverage')) return route.fulfill({ json: { rows: coverage, total: 2, offset: 0, limit: 50 } });
    if (url.pathname.endsWith('/observations')) return route.fulfill({ json: url.searchParams.get('indicator') === 'PCOM'
      ? { rows: [], total: 0, offset: 0, limit: 400, series: null } : data });
    if (url.pathname.endsWith('/commit')) {
      run.status = 'committed'; run.active = true;
      state = { ...state, weo: [run] };
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
  await page.getByRole('button', { name: 'WEO research', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull latest WEO release' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm authorized WEO research use/ }).check();
  await pull.click();
  await expect(page.getByRole('button', { name: 'Commit WEO release' })).toBeEnabled();
  expect(state.weo![0].active).toBe(false);
  await expect(page.getByRole('img', { name: 'WEO annual history and estimates with gaps' })).toBeVisible();
  await expect(page.getByText('Latest actual per IMF boundary:', { exact: false })).toContainText('2024');
  expect(await page.locator('svg[role="img"] polyline').count()).toBe(2);
  expect(await page.locator('svg[role="img"] polyline[stroke-dasharray]').count()).toBe(1);
  await page.getByText('Annual values and classifications', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'IMF estimate/projection', exact: true })).toHaveCount(2);
  await page.getByText('WEO coverage and gaps', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '0 · ABSENT', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Commit WEO release' }).click();
  await expect(page.getByRole('button', { name: 'Activate WEO snapshot' })).toBeDisabled();
  expect(state.weo![0].active).toBe(true);
  expect(state.datasets).toEqual(initial.datasets);
  expect(state.macro).toEqual(initial.macro);
  await page.getByRole('combobox', { name: 'WEO indicator', exact: true }).selectOption('PCOM');
  await expect(page.getByText('No valid WEO values for this economy/indicator.', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'WEO indicator', exact: true }).selectOption('BCA');
  await expect(page.getByRole('img', { name: 'WEO annual history and estimates with gaps' })).toBeVisible();
  await page.route('**/api/providers/imf-weo/pull', route => route.abort('failed'));
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('Last loaded WEO history retained');
  await expect(page.getByRole('img', { name: 'WEO annual history and estimates with gaps' })).toBeVisible();
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});
