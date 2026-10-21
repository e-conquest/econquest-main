import { expect, test } from '@playwright/test';
import type { DeskBundle } from '../src/services/analysisApi';
import { deskAnalysis } from './fixtures/analysis';

test('macro desk explicitly reviews immutable evidence without provider activation (synthetic only)', async ({ page }) => {
  const original = await (await page.request.get('/api/state')).json();
  const analysis = deskAnalysis();
  const runId = analysis.source.runId;
  let bundle: DeskBundle | null = null;
  await page.route('**/api/state', route => route.fulfill({ json: { ...original, weo: [{
    id: runId, createdAt: analysis.source.acquisitionStartedAt, status: 'staged', active: false, progress: {},
    report: { publicationDate: analysis.source.publicationDate, rowCount: 12 }
  }] } }));
  await page.route('**/api/analysis/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/preview/')) return route.fulfill({ json: analysis });
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-research-token']).toBeTruthy();
      expect(route.request().postDataJSON()).toEqual({ runId, expectedDigest: analysis.digest,
        reviewNote: 'Reviewed synthetic evidence', researchUse: true });
      bundle = { id: 'reviewed-fixture', createdAt: '2026-10-21T00:00:00Z',
        reviewNote: 'Reviewed synthetic evidence', analysis };
      return route.fulfill({ json: bundle, status: 201 });
    }
    if (url.pathname.endsWith('/bundles')) return route.fulfill({ json: bundle ? [{
      id: bundle.id, createdAt: bundle.createdAt, reviewNote: bundle.reviewNote, runId, digest: analysis.digest
    }] : [] });
    return route.fulfill({ json: bundle });
  });
  const mutations: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Macro trend desk', exact: true }).click();
  const preview = page.getByRole('button', { name: 'Preview source evidence' });
  await expect(preview).toBeDisabled();
  await page.getByLabel('Desk WEO source snapshot').selectOption(runId);
  await preview.click();
  await expect(page.getByText('UNREVIEWED source preview', { exact: true })).toBeVisible();
  await expect(page.getByText('Public publication blocked:', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('2 % annual change (2024)').first()).toBeVisible();
  await expect(page.getByText('+2 pp vs 2023').first()).toBeVisible();
  await page.getByRole('button', { name: 'United States (USA)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Country dossier: United States' })).toBeVisible();
  await page.getByText('Annual history, estimates/projections and native evidence', { exact: true }).first().click();
  await expect(page.getByRole('cell', { name: 'IMF estimate/projection', exact: true })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save reviewed local bundle', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('Desk review note').fill('Reviewed synthetic evidence');
  await page.getByRole('checkbox', { name: /I reviewed the evidence/ }).check();
  await save.click();
  await expect(page.getByRole('heading', { name: 'Reviewed bundle reviewed-fixture', exact: true })).toBeVisible();
  expect(mutations).toEqual(['/api/analysis/bundles']);
  await page.reload();
  await page.getByRole('button', { name: 'Macro trend desk', exact: true }).click();
  await page.getByLabel('Desk reviewed bundle').selectOption('reviewed-fixture');
  await page.getByRole('button', { name: 'Load reviewed bundle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviewed bundle reviewed-fixture', exact: true })).toBeVisible();
  await page.route('**/api/analysis/preview/**', route => route.abort('failed'));
  await page.getByLabel('Desk WEO source snapshot').selectOption(runId);
  await preview.click();
  await expect(page.getByRole('alert')).toContainText('Last successfully loaded analysis');
  await expect(page.getByRole('heading', { name: 'Reviewed bundle reviewed-fixture', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
