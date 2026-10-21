import { expect, test } from '@playwright/test';
import { GDELT_CONTRACT } from '../src/services/gdeltApi';
import type { ResearchState } from '../src/services/dataApi';
import { gdeltEvent, gdeltRun } from './fixtures/gdelt';

test('GDELT global native events: incomplete gate, filters, safe links, manual activation/rollback, retained page (synthetic)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  const complete = gdeltRun(true);
  complete.id = 'gdelt-synthetic-complete';
  const partial = gdeltRun();
  let state: ResearchState = { ...initial, gdelt: [complete, partial] };
  let failPage = false;
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/gdelt/config', route => route.fulfill({ json: {
    contractVersion: GDELT_CONTRACT, library: 'gdelt==0.1.14', requiresKey: false, table: 'events',
    latestCompletedDay: '2026-10-20', intervalCount: 96, scope: 'global',
  } }));
  await page.route('**/api/providers/gdelt/pull', route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    return route.fulfill({ status: 202, json: partial });
  });
  await page.route('**/api/gdelt/**', route => {
    const url = new URL(route.request().url());
    const run = url.pathname.includes(complete.id) ? complete : partial;
    if (url.pathname.endsWith('/events')) {
      if (failPage) return route.abort('failed');
      const country = url.searchParams.get('country') ?? '';
      const root = url.searchParams.get('root') ?? '';
      const rows = country === 'UNKNOWN' || (root && root !== '01') ? [] : [gdeltEvent()];
      return route.fulfill({ json: { rows, total: rows.length, offset: 0, limit: 100, runId: run.id, country, root } });
    }
    if (url.pathname.endsWith('/commit')) {
      complete.status = 'committed'; complete.active = true;
      state = { ...state, gdelt: [complete, partial] };
      return route.fulfill({ json: state });
    }
    if (url.pathname.endsWith('/rollback')) {
      complete.status = 'rolled_back'; complete.active = false;
      state = { ...state, gdelt: [complete, partial] };
      return route.fulfill({ json: state });
    }
    return route.fulfill({ json: run });
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  const annual = await page.locator('tbody').first().innerText();
  await page.getByRole('button', { name: 'GDELT research', exact: true }).click();
  await expect(page.getByText(/Incomplete day; activation blocked/)).toBeVisible();
  const activate = page.getByRole('button', { name: 'Activate GDELT snapshot', exact: true });
  await expect(activate).toBeDisabled();
  const pull = page.getByRole('button', { name: 'Pull latest completed GDELT day', exact: true });
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /acknowledge GDELT/ }).check();
  await pull.click();
  await expect(pull).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'GDELT snapshot', exact: true })).toHaveValue(partial.id);
  await page.getByRole('combobox', { name: 'GDELT snapshot', exact: true }).selectOption(complete.id);
  await expect(page.getByText(/All requested intervals verified/)).toBeVisible();
  await expect(activate).toBeEnabled();
  await expect(page.getByRole('cell', { name: /010 \(root 01\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source article', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('cell', { name: /Event: 2025-10-20/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'GDELT action country', exact: true }).selectOption('RS');
  await expect(page.getByText(/Displayed event page:.*country RS/)).toBeVisible();
  await activate.click();
  await expect(activate).toBeDisabled();
  await expect.poll(() => complete.active).toBe(true);
  await page.getByRole('button', { name: 'Roll back GDELT snapshot', exact: true }).click();
  await expect.poll(() => complete.status).toBe('rolled_back');
  failPage = true;
  await page.getByRole('combobox', { name: 'GDELT action country', exact: true }).selectOption('UNKNOWN');
  await expect(page.getByText(/Previous selection retained; not the current requested page/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Last valid review retained' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /SYNTHETIC ACTOR/ })).toBeVisible();
  for (const key of ['datasets', 'macro', 'weo', 'worldbank', 'ids', 'fred', 'bis', 'comtrade'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});

test('old backend explicitly blocks GDELT pulls until restart', async ({ page }) => {
  await page.route('**/api/providers/gdelt/config', route => route.fulfill({ status: 404, json: { detail: 'Old backend' } }));
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GDELT research', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backend restart required');
  await page.getByRole('checkbox', { name: /acknowledge GDELT/ }).check();
  await expect(page.getByRole('button', { name: 'Pull latest completed GDELT day' })).toBeDisabled();
});
