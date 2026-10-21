import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import type { BisRun, BisRow, BisSeries } from '../src/services/bisApi';

test('BIS research preserves native units, breaks, missing coverage and independent activation (mock source)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, bis: [] };
  const run: BisRun = { id: 'bis-fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false, progress: {}, sources: [],
    report: { errors: [], rowCount: 4, numericCount: 3, requiredPairs: 4, absentPairs: 2, availableIndicators: 2,
      countries: [{ code: 'CA', name: 'Canada', iso3: 'CAN' }, { code: 'US', name: 'United States', iso3: 'USA' }],
      indicators: [{ code: 'lbs_claims', name: 'Cross-border banking claims fixture', flow: 'WS_LBS_D_PUB', template: 'fixture', unit: 'Millions of US dollars' },
        { code: 'credit_government', name: 'Government credit fixture', flow: 'WS_TC', template: 'fixture', unit: 'Percentage of GDP' }] } };
  const info = (country: string, indicator: string): BisSeries => ({
    country, indicator, validCount: country === 'US' ? 3 : 0, missingCount: country === 'US' ? 1 : 0, flaggedCount: country === 'US' ? 2 : 0,
    missingPeriods: [], firstPeriod: country === 'US' ? '2023-Q1' : null, lastPeriod: country === 'US' ? '2023-Q4' : null,
    latestValidPeriod: country === 'US' ? '2023-Q4' : null, analysisBlocked: true, reason: country === 'CA' ? 'No data in synthetic fixture.' : '',
    unit: indicator === 'lbs_claims' ? 'Millions of US dollars' : 'Percentage of GDP',
  });
  const values = (country: string, indicator: string): BisRow[] => country === 'CA' ? [] : ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4'].map((period, i) => ({
    country, indicator, period, value: i === 1 ? null : -1.25 + i, rawValue: i === 1 ? 'NaN' : String(-1.25 + i), sourceHash: 'a'.repeat(64),
    attributes: { UNIT_MEASURE: indicator === 'lbs_claims' ? 'USD' : '367', UNIT_MULT: indicator === 'lbs_claims' ? '6' : '0',
      OBS_STATUS: i === 1 ? 'M' : i === 2 ? 'B' : 'A', OBS_CONF: 'F', ...(i === 2 ? { OBS_PRE_BREAK: '0.5' } : {}) },
    flagged: i === 1 || i === 2,
  }));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/bis/pull', async route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    state = { ...state, bis: [run] };
    await route.fulfill({ status: 202, json: run });
  });
  await page.route('**/api/bis/**', async route => {
    const url = new URL(route.request().url());
    const country = url.searchParams.get('country') || 'US', indicator = url.searchParams.get('indicator') || 'lbs_claims';
    if (url.pathname.endsWith('/coverage')) {
      const countries = url.searchParams.get('country') ? run.report.countries!.filter(c => c.code === country) : run.report.countries!;
      const rows = countries.flatMap(c => run.report.indicators!.map(i => ({ ...info(c.code, i.code), name: c.name, indicatorName: i.name, absent: c.code === 'CA' })));
      return route.fulfill({ json: { rows, total: rows.length, offset: 0, limit: 50 } });
    }
    if (url.pathname.endsWith('/observations')) {
      const rows = values(country, indicator);
      return route.fulfill({ json: { rows, series: info(country, indicator), total: rows.length, offset: 0, limit: 1000 } });
    }
    if (url.pathname.endsWith('/commit') || url.pathname.endsWith('/rollback')) {
      run.active = url.pathname.endsWith('/commit'); run.status = run.active ? 'committed' : 'rolled_back';
      state = { ...state, bis: [run] };
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
  await page.getByRole('button', { name: 'BIS research', exact: true }).click();
  const pull = page.getByRole('button', { name: 'Pull BIS quarterly history' });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm authorized research use of the fixed BIS/ }).check();
  await pull.click();
  await expect(page.getByText('No numeric BIS history', { exact: false })).toBeVisible();
  expect(run.active).toBe(false);
  await page.getByRole('combobox', { name: 'BIS economy', exact: true }).selectOption('US');
  await expect(page.getByRole('img', { name: 'BIS quarterly native history with gaps and breaks' })).toBeVisible();
  expect(await page.locator('svg[role="img"] circle').count()).toBe(3);
  await expect(page.getByText('Native unit:', { exact: false })).toContainText('Millions of US dollars');
  await expect(page.getByText('Full-window/derived analysis blocked', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Activate BIS snapshot', exact: true }).click();
  await expect.poll(() => run.active).toBe(true);
  await page.getByRole('combobox', { name: 'BIS indicator', exact: true }).selectOption('credit_government');
  await expect(page.getByText('Native unit:', { exact: false })).toContainText('Percentage of GDP');
  await page.route('**/api/providers/bis/pull', route => route.abort('failed'));
  await pull.click();
  await expect(page.getByRole('alert')).toContainText('Last valid review retained');
  await expect(page.getByRole('img', { name: 'BIS quarterly native history with gaps and breaks' })).toBeVisible();
  await page.getByRole('button', { name: 'Rollback BIS snapshot', exact: true }).click();
  await expect.poll(() => run.active).toBe(false);
  for (const key of ['datasets', 'macro', 'weo', 'worldbank', 'fred'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});
