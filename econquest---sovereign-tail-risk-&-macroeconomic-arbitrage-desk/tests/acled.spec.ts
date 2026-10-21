import { expect, test } from '@playwright/test';
import type { ResearchState } from '../src/services/dataApi';
import { ACLED_CONTRACT } from '../src/services/acledApi';
import { acledEvent, acledRun } from './fixtures/acled';

test('ACLED consent, private scope, uncertainty, independent activation, filters and failure retention (synthetic)', async ({ page }) => {
  const initial: ResearchState = await (await page.request.get('/api/state')).json();
  const complete = acledRun(true);
  complete.id = 'acled-synthetic-complete';
  const partial = acledRun();
  let state: ResearchState = { ...initial, acled: [complete, partial] };
  let failPage = false;
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/providers/acled/config', route => route.fulfill({ json: {
    contractVersion: ACLED_CONTRACT, library: 'acled==1.0.2', configured: true, auth: 'oauth', days: 30,
    scope: 'global-account-accessible', startDate: '2026-09-21', endDate: '2026-10-20',
  } }));
  await page.route('**/api/providers/acled/pull', route => {
    expect(route.request().postDataJSON()).toEqual({ researchUse: true });
    expect(route.request().headers()['x-research-token']).toBeTruthy();
    return route.fulfill({ status: 202, json: partial });
  });
  await page.route('**/api/acled/**', route => {
    const url = new URL(route.request().url());
    const run = url.pathname.includes(complete.id) ? complete : partial;
    if (url.pathname.endsWith('/events')) {
      if (failPage) return route.abort('failed');
      const country = url.searchParams.get('country') ?? '', eventType = url.searchParams.get('event_type') ?? '';
      return route.fulfill({ json: { rows: [acledEvent()], total: 1, offset: 0, limit: 100, country, eventType, runId: run.id } });
    }
    if (url.pathname.endsWith('/commit')) {
      complete.status = 'committed'; complete.active = true; state = { ...state, acled: [complete, partial] };
      return route.fulfill({ json: state });
    }
    if (url.pathname.endsWith('/rollback')) {
      complete.status = 'rolled_back'; complete.active = false; state = { ...state, acled: [complete, partial] };
      return route.fulfill({ json: state });
    }
    return route.fulfill({ json: run });
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  const annual = await page.locator('tbody').first().innerText();
  await page.getByRole('button', { name: 'ACLED research', exact: true }).click();
  await expect(page.getByText(/Incomplete or unverified snapshot; activation blocked/)).toBeVisible();
  const activate = page.getByRole('button', { name: 'Activate ACLED snapshot', exact: true });
  const pull = page.getByRole('button', { name: 'Pull ACLED 30-day snapshot', exact: true });
  await expect(activate).toBeDisabled();
  await expect(pull).toBeDisabled();
  await page.getByRole('checkbox', { name: /acknowledge ACLED/ }).check();
  await pull.click();
  await expect(pull).toBeEnabled();
  await page.getByRole('combobox', { name: 'ACLED snapshot', exact: true }).selectOption(complete.id);
  await expect(page.getByText(/Pagination totals and two complete reads verified/)).toBeVisible();
  await expect(activate).toBeEnabled();
  await expect(page.getByRole('cell', { name: /Time: 2 \(approximate/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Geography: 3 \(lowest/ })).toBeVisible();
  expect(await page.getByRole('cell', { name: /Not an audited death count/ }).innerText()).toBe('0\nNot an audited death count');
  await page.getByRole('combobox', { name: 'ACLED country', exact: true }).selectOption('Synthetic country');
  await expect(page.getByText(/Displayed ACLED page:.*country Synthetic country/)).toBeVisible();
  await activate.click();
  await expect(activate).toBeDisabled();
  await expect.poll(() => complete.active).toBe(true);
  await page.getByRole('button', { name: 'Roll back ACLED snapshot', exact: true }).click();
  await expect.poll(() => complete.active).toBe(false);
  failPage = true;
  await page.getByRole('combobox', { name: 'ACLED event type', exact: true }).selectOption('Protests');
  await expect(page.getByText(/Previous selection retained; not the current requested page/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Last valid review retained' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Synthetic actor/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export private ACLED native events' })).toHaveAttribute('href', /\/api\/acled\//);
  for (const key of ['datasets', 'macro', 'weo', 'worldbank', 'ids', 'fred', 'bis', 'comtrade', 'gdelt'] as const) expect(state[key]).toEqual(initial[key]);
  await page.getByRole('button', { name: 'Annual research', exact: true }).click();
  expect(await page.locator('tbody').first().innerText()).toBe(annual);
  expect(errors).toEqual([]);
});

test('old backend blocks ACLED acquisition without credential fields in the browser', async ({ page }) => {
  await page.route('**/api/providers/acled/config', route => route.fulfill({ status: 404, json: { detail: 'Old backend' } }));
  await page.goto('/');
  await expect(page.getByText('Local data service available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ACLED research', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backend restart required');
  await page.getByRole('checkbox', { name: /acknowledge ACLED/ }).check();
  await expect(page.getByRole('button', { name: 'Pull ACLED 30-day snapshot' })).toBeDisabled();
  expect(await page.locator('input[type=password]').count()).toBe(0);
});
