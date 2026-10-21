import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import { COMTRADE_CONTRACT, type ComtradeRow, type ComtradeRun } from '../src/services/comtradeApi';

test('Comtrade partial pass cannot activate; explicit resume, native flags, independent activation and failure retention (synthetic)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  let state: ResearchState = { ...initial, comtrade: [] };
  let failSeries = false;
  const area = (code: number, name: string, iso3: string) => ({ code, name, iso3, effective: null, expired: null, isGroup: false });
  const run: ComtradeRun = {
    id: 'comtrade-synthetic-not-empirical', createdAt: '2026-01-01T00:00:00Z', status: 'interrupted', active: false, progress: {},
    report: { contractVersion: COMTRADE_CONTRACT, errors: [], phase: 'data', rowCount: 1, taskCount: 2, completedTasks: 1,
      transportComplete: false, pauseReason: 'Bounded pass finished; explicitly resume remaining chunks', firstYear: 1962, lastYear: 2025,
      reporters: [area(152, 'Fixture Chile', 'CHL')],
      partners: [{ ...area(0, 'World', 'W00'), kind: 'world' }, { ...area(32, 'Fixture Argentina', 'ARG'), kind: 'individual' }],
      limitation: 'Synthetic test fixture, not empirical trade evidence.' },
    sources: [{ ordinal: 1, path: '/synthetic-fixture', httpStatus: 200, bytes: 7, sha256: 'a'.repeat(64), retrievedAt: '2026-01-01T00:00:00Z' }],
  };
  const row: ComtradeRow = { reporter: 152, partner: 32, year: 2024, flow: 'M', value: 0, rawValue: 0, exclusionReason: null,
    partnerKind: 'individual', classification: 'H6', datasetCode: '20152202401052600', sourceHash: 'a'.repeat(64), unit: 'Current US dollars',
    attributes: { reporterCode: 152, partnerCode: 32, refYear: 2024, flowCode: 'M', primaryValue: 0, isReported: false,
      typeCode: 'C', freqCode: 'A', period: '2024', aggrLevel: 0, classificationSearchCode: 'HS',
      isOriginalClassification: true, classificationCode: 'H6', partner2Code: 0, motCode: 0, customsCode: 'C00', cmdCode: 'TOTAL' } };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/comtrade/config', route => route.fulfill({ json: {
    contractVersion: COMTRADE_CONTRACT, configured: true, firstYear: 1962, passRequests: 40, passSeconds: 300,
    dailyRequestBudget: 450, manualResume: true,
  } }));
  await page.route('**/api/providers/comtrade/pull', route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    state = { ...state, comtrade: [run] };
    return route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/providers/comtrade/*/resume', route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    run.status = 'staged';
    run.report = { ...run.report, phase: 'complete', completedTasks: 2, numericCount: 1, transportComplete: true, pauseReason: null };
    state = { ...state, comtrade: [run] };
    return route.fulfill({ json: run, status: 202 });
  });
  await page.route('**/api/comtrade/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/observations')) {
      if (failSeries) return route.abort('failed');
      const rows = url.searchParams.get('partner') === '32' ? [row] : [];
      return route.fulfill({ json: { rows, total: rows.length, offset: 0, limit: 100 } });
    }
    if (url.pathname.endsWith('/tasks')) return route.fulfill({ json: {
      rows: [{ key: 'availability:2024', kind: 'discovery', status: 'complete', spec: {}, result: {} },
        { key: 'data:152', kind: 'data', status: run.status === 'interrupted' ? 'pending' : 'complete', spec: {}, result: {} }],
      total: 2, offset: 0, limit: 100,
    } });
    if (url.pathname.endsWith('/commit')) {
      run.status = 'committed'; run.active = true; state = { ...state, comtrade: [run] };
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
  await page.getByRole('button', { name: 'UN Comtrade', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start new Comtrade acquisition', exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: /UN Comtrade access terms/ }).check();
  await start.click();
  await expect(page.getByText(/Incomplete global acquisition; activation blocked/)).toBeVisible();
  const activate = page.getByRole('button', { name: 'Activate Comtrade snapshot', exact: true });
  await expect(activate).toBeDisabled();
  await page.getByRole('combobox', { name: 'Comtrade partner', exact: true }).selectOption('32');
  await expect(page.getByText('Not directly reported; inspect source flags', { exact: true })).toBeVisible();
  expect(await page.getByRole('row').filter({ hasText: '2024' }).getByRole('cell').nth(1).innerText()).toBe('0');
  await page.getByRole('button', { name: 'Resume Comtrade pass', exact: true }).click();
  await expect(page.getByText(/All planned chunks verified/)).toBeVisible();
  await expect(activate).toBeEnabled();
  await activate.click();
  await expect.poll(() => state.comtrade![0].active).toBe(true);
  await expect(activate).toBeDisabled();
  failSeries = true;
  await page.getByRole('combobox', { name: 'Comtrade partner', exact: true }).selectOption('0');
  await expect(page.getByText('Previous selection retained; not the currently selected series.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Saved history:.*Fixture Argentina/ })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Last valid review retained');
  await expect(page.getByRole('link', { name: 'Export Comtrade native history and task manifest' })).toHaveAttribute('href', /\/api\/comtrade\//);
  for (const key of ['datasets', 'macro', 'weo', 'worldbank', 'ids', 'fred', 'bis'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});

test('old backend explicitly blocks Comtrade and Monthly IMF acquisition, without promising new contracts', async ({ page }) => {
  await page.route('**/api/providers/comtrade/config', route => route.fulfill({ status: 404, json: { detail: 'Old backend' } }));
  await page.route('**/api/providers/imf/config', route => route.fulfill({ status: 404, json: { detail: 'Old backend' } }));
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'UN Comtrade', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backend restart required');
  await page.getByRole('checkbox', { name: /UN Comtrade access terms/ }).check();
  await expect(page.getByRole('button', { name: 'Start new Comtrade acquisition' })).toBeDisabled();
  await page.getByRole('button', { name: 'Monthly IMF', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Backend restart required' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pull.*IMF/i })).toBeDisabled();
});
