import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import type { WorldBankCoverage, WorldBankObservations, WorldBankRun } from '../src/services/worldbankApi';

test('World Bank review keeps gaps and flags, explicitly activates only its own monitoring and retains failed reviews (mock source)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, worldbank: [] };
  const run: WorldBankRun = {
    id: 'worldbank-browser-fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false, progress: {},
    sources: [{ ordinal: 1, path: '/worldbank-fixture-not-empirical.json', httpStatus: 200, bytes: 7, sha256: 'a'.repeat(64) }],
    report: { errors: [], sourceLastUpdated: '2026-10-08', firstYear: 2022, lastYear: 2026, rowCount: 5,
      requiredPairs: 2, absentPairs: 1, countries: [{ code: 'CAN', name: 'Canada' }],
      indicators: [{ code: 'GDP', name: 'Fixture GDP', description: 'Synthetic fixture, not empirical.',
        sourceOrganization: 'Browser fixture', unit: '', sourceHash: 'a'.repeat(64) },
      { code: 'ABSENT', name: 'Absent indicator', description: 'No values in fixture.',
        sourceOrganization: 'Browser fixture', unit: '', sourceHash: 'a'.repeat(64) }] }
  };
  const data: WorldBankObservations = {
    rows: [2022, 2023, 2024, 2025, 2026].map((year, i) => ({
      country: 'CAN', indicator: 'GDP', year, value: year === 2024 ? null : 1e9 + i, rawValue: year === 2024 ? null : 1e9 + i,
      status: '', unit: '', footnote: year === 2026 ? 'Fixture methodology note' : '', decimal: 1,
      sourceHash: 'a'.repeat(64), classification: 'reported_unverified',
    })),
    total: 5, limit: 400, offset: 0,
    series: { country: 'CAN', indicator: 'GDP', firstYear: 2022, lastYear: 2026,
      validCount: 4, validYears: [2022, 2023, 2025, 2026], missingYears: [2024], missingCount: 1,
      flaggedCount: 1, analysisBlocked: true, limitation: 'Synthetic fixture.' }
  };
  const coverage: WorldBankCoverage[] = [
    { country: 'CAN', name: 'Canada', indicator: 'GDP', indicatorName: 'Fixture GDP', validCount: 4,
      absent: false, missingYears: [2024], analysisBlocked: true },
    { country: 'CAN', name: 'Canada', indicator: 'ABSENT', indicatorName: 'Absent indicator', validCount: 0,
      absent: true, missingYears: [2022, 2023, 2024, 2025, 2026], analysisBlocked: true }
  ];
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/worldbank/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    state = { ...state, worldbank: [run] };
    await route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/worldbank/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/coverage')) return route.fulfill({ json: { rows: coverage, total: 2, offset: 0, limit: 50 } });
    if (url.pathname.endsWith('/observations')) return route.fulfill({ json: url.searchParams.get('indicator') === 'ABSENT'
      ? { rows: [], total: 0, offset: 0, limit: 400, series: null } : data });
    if (url.pathname.endsWith('/commit')) {
      run.status = 'committed'; run.active = true;
      state = { ...state, worldbank: [run] };
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
  await page.getByRole('button', { name: 'World Bank research', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull World Bank WDI history' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm research use of the fixed World Bank/ }).check();
  await pull.click();
  await expect(page.getByRole('img', { name: 'World Bank annual native history with gaps' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Entire series absent', exact: true })).toBeVisible();
  expect(state.worldbank![0].active).toBe(false);
  expect(await page.locator('svg[role="img"] polyline').count()).toBe(1);
  expect(await page.locator('svg[role="img"] circle').count()).toBe(2);
  await page.getByText('Annual values, native units, status and footnotes', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Fixture methodology note' })).toBeVisible();
  await page.getByRole('button', { name: 'Activate World Bank snapshot', exact: true }).click();
  await expect.poll(() => state.worldbank![0].active).toBe(true);
  await expect(page.getByRole('button', { name: 'Activate World Bank snapshot', exact: true })).toBeDisabled();
  expect(state.worldbank![0].active).toBe(true);
  expect(state.datasets).toEqual(initial.datasets);
  expect(state.weo).toEqual(initial.weo);
  expect(state.macro).toEqual(initial.macro);
  await page.getByRole('combobox', { name: 'World Bank indicator', exact: true }).selectOption('ABSENT');
  await expect(page.getByText('No valid World Bank values for this economy/indicator.', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'World Bank indicator', exact: true }).selectOption('GDP');
  await expect(page.getByRole('img', { name: 'World Bank annual native history with gaps' })).toBeVisible();
  await page.route('**/api/providers/worldbank/pull', route => route.abort('failed'));
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('Last valid review retained');
  await expect(page.getByRole('img', { name: 'World Bank annual native history with gaps' })).toBeVisible();
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});
