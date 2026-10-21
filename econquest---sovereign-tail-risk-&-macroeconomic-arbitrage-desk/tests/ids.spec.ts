import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import type { WorldBankObservations, WorldBankRun } from '../src/services/worldbankApi';

test('IDS is separate from WDI: source-6 consent, unknown metadata, gaps, manual activation and failure retention (mock source)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, ids: [] };
  const run: WorldBankRun = {
    id: 'ids-browser-fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false, progress: {},
    sources: [{ ordinal: 1, path: '/ids-fixture-not-empirical.json', httpStatus: 200, bytes: 7, sha256: 'a'.repeat(64) }],
    report: { errors: [], sourceId: '6', counterpart: 'WLD', numericCount: 4, firstYear: 2022, lastYear: 2026,
      rowCount: 5, requiredPairs: 2, absentPairs: 1, excludedFutureRows: 6, excludedFutureNumericRows: 2,
      wdiOverlapCodes: ['DT.DOD.DECT.CD'], countries: [{ code: 'ARG', name: 'Argentina' }],
      indicators: [{ code: 'DEBT', name: 'Fixture debt', description: 'Synthetic fixture, not empirical.',
        sourceOrganization: 'Browser fixture', unit: '', sourceHash: 'a'.repeat(64) },
      { code: 'ABSENT', name: 'Absent indicator', description: 'No values in fixture.',
        sourceOrganization: 'Browser fixture', unit: '', sourceHash: 'a'.repeat(64) }] }
  };
  const data: WorldBankObservations = {
    rows: [2022, 2023, 2024, 2025, 2026].map((year, i) => ({
      country: 'ARG', indicator: 'DEBT', year, value: year === 2024 ? null : -1e9 + i, rawValue: year === 2024 ? null : -1e9 + i,
      sourceId: '6', counterpart: 'WLD', attributes: year === 2026 ? { obs_status: 'Fixture unknown' } : {},
      sourceHash: 'a'.repeat(64), classification: 'reported_unverified',
    })),
    total: 5, limit: 400, offset: 0,
    series: { country: 'ARG', indicator: 'DEBT', firstYear: 2022, lastYear: 2026,
      validCount: 4, validYears: [2022, 2023, 2025, 2026], missingYears: [2024], missingCount: 1,
      flaggedCount: 1, analysisBlocked: true, limitation: 'Synthetic fixture, actual/estimate boundary unknown.' }
  };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/ids/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    state = { ...state, ids: [run] };
    await route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/ids/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/coverage')) return route.fulfill({ json: {
      rows: [{ country: 'ARG', name: 'Argentina', indicator: 'DEBT', indicatorName: 'Fixture debt', validCount: 4,
        absent: false, missingYears: [2024], analysisBlocked: true },
      { country: 'ARG', name: 'Argentina', indicator: 'ABSENT', indicatorName: 'Absent indicator', validCount: 0,
        absent: true, missingYears: [2022, 2023, 2024, 2025, 2026], analysisBlocked: true }],
      total: 2, offset: 0, limit: 50
    } });
    if (url.pathname.endsWith('/observations')) return route.fulfill({ json: url.searchParams.get('indicator') === 'ABSENT'
      ? { rows: [], total: 0, offset: 0, limit: 400, series: null } : data });
    if (url.pathname.endsWith('/commit')) {
      run.status = 'committed'; run.active = true;
      state = { ...state, ids: [run] };
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
  await page.getByRole('button', { name: 'IDS research', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull World Bank IDS history' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /fixed World Bank IDS basket/ }).check();
  await pull.click();
  await expect(page.getByRole('img', { name: 'IDS annual native history with gaps' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Entire series absent', exact: true })).toBeVisible();
  await expect(page.getByText(/not independent evidence/)).toBeVisible();
  expect(state.ids![0].active).toBe(false);
  expect(await page.locator('svg[role="img"] polyline').count()).toBe(1);
  expect(await page.locator('svg[role="img"] circle').count()).toBe(2);
  await page.getByText('Annual values, native units, status and footnotes', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Unknown / unverified', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /Fixture unknown/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export IDS native history' })).toHaveAttribute('href', /\/api\/ids\//);
  await page.getByRole('button', { name: 'Activate IDS snapshot', exact: true }).click();
  await expect.poll(() => state.ids![0].active).toBe(true);
  await expect(page.getByRole('button', { name: 'Activate IDS snapshot', exact: true })).toBeDisabled();
  for (const key of ['datasets', 'worldbank', 'weo', 'macro', 'fred', 'bis'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('combobox', { name: 'IDS indicator', exact: true }).selectOption('ABSENT');
  await expect(page.getByText('No valid IDS values for this economy/indicator.', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'IDS indicator', exact: true }).selectOption('DEBT');
  await expect(page.getByRole('img', { name: 'IDS annual native history with gaps' })).toBeVisible();
  await page.route('**/api/providers/ids/pull', route => route.abort('failed'));
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('Last valid review retained');
  await expect(page.getByRole('img', { name: 'IDS annual native history with gaps' })).toBeVisible();
  await page.getByRole('button', { name: 'World Bank research', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pull World Bank WDI history' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'World Bank snapshot', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'IDS research', exact: true }).click();
  await expect(page.getByRole('img', { name: 'IDS annual native history with gaps' })).toBeVisible();
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});
