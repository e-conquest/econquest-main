import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMTRADE_CONTRACT, ComtradeRow, ComtradeSummary, getComtradeConfig, getComtradeSeries, startComtrade, validComtradeRow, validComtradeSummary } from '../services/comtradeApi';
import { validateResearchState } from '../services/dataApi';
import { checkMonthlyImfContract } from '../services/imfApi';

const row = (): ComtradeRow => ({
  reporter: 152, partner: 32, flow: 'M', year: 2024, value: 0, rawValue: 0, exclusionReason: null,
  partnerKind: 'individual', classification: 'H6', datasetCode: '20152202401052600',
  sourceHash: 'a'.repeat(64), unit: 'Current US dollars',
  attributes: { isOriginalClassification: true, isReported: true, primaryValue: 0, reporterCode: 152, partnerCode: 32,
    typeCode: 'C', freqCode: 'A', period: '2024', aggrLevel: 0, classificationSearchCode: 'HS',
    flowCode: 'M', refYear: 2024, cmdCode: 'TOTAL', partner2Code: 0, motCode: 0, customsCode: 'C00', classificationCode: 'H6' },
});
const summary = (): ComtradeSummary => ({
  id: 'fixture-not-empirical', createdAt: '2026-01-01T00:00:00Z', status: 'staged', active: false, progress: {},
  report: { contractVersion: COMTRADE_CONTRACT, errors: [], transportComplete: true, rowCount: 1, numericCount: 1,
    taskCount: 2, completedTasks: 2, phase: 'complete' },
});

describe('UN Comtrade strict research contracts', () => {
  it('retains zero native values, original attributes and lossless large dataset identifiers', () => {
    assert.equal(validComtradeRow(row()), true);
    assert.equal(row().datasetCode, '20152202401052600');
    assert.equal(validComtradeRow({ ...row(),
      attributes: { ...row().attributes, isReported: false } }), true);
    for (const change of [{ value: NaN }, { value: -1 }, { rawValue: 1 }, { exclusionReason: 'excluded' },
      { datasetCode: 20152202401052600 }, { attributes: { ...row().attributes, isOriginalClassification: false } },
      { attributes: { ...row().attributes, freqCode: 'M' } }, { attributes: { ...row().attributes, period: '2023' } }]) {
      assert.equal(validComtradeRow({ ...row(), ...change }), false);
    }
  });
  it('rejects complete-shaped partial snapshots and preserves independent provider state', () => {
    assert.equal(validComtradeSummary(summary()), true);
    for (const change of [{ transportComplete: false }, { completedTasks: 1 }, { numericCount: 0 }, { errors: ['failed'] }]) {
      assert.equal(validComtradeSummary({ ...summary(), report: { ...summary().report, ...change } }), false);
    }
    assert.equal(validComtradeSummary({ ...summary(), status: 'staged', active: true }), false);
    const state = { schemaVersion: 1, datasets: [], runs: [], providers: [], comtrade: [summary()] };
    const before = structuredClone(state);
    assert.doesNotThrow(() => validateResearchState(state));
    assert.deepEqual(state, before);
  });
  it('blocks old backends and never starts a pull without private server configuration', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = async input => { calls.push(String(input)); return new Response('', { status: 404 }); };
      await assert.rejects(getComtradeConfig(), /restart required/);
      await assert.rejects(checkMonthlyImfContract(), /restart required/);
      globalThis.fetch = async input => {
        calls.push(String(input));
        return Response.json({ contractVersion: COMTRADE_CONTRACT, configured: false, firstYear: 1962,
          passRequests: 40, passSeconds: 300, dailyRequestBudget: 450, manualResume: true });
      };
      await assert.rejects(startComtrade(), /privately/);
      assert.equal(calls.some(url => url.endsWith('/pull')), false);
      globalThis.fetch = async () => Response.json({ contractVersion: 'older', coveragePolicy: 'strict' });
      await assert.rejects(checkMonthlyImfContract(), /mismatch/);
    } finally { globalThis.fetch = original; }
  });
  it('requires exact pages, selection identity, ordered distinct years and complete series', async () => {
    const original = globalThis.fetch;
    try {
      let data = { rows: [row()], offset: 0, limit: 100, total: 1 };
      globalThis.fetch = async () => Response.json(data);
      assert.deepEqual(await getComtradeSeries('fixture', 152, 32, 'M'), [row()]);
      for (const change of [{ total: 2 }, { offset: 1 }, { rows: [row(), row()], total: 2 },
        { rows: [{ ...row(), reporter: 999 }] }, { limit: 500 }]) {
        data = { rows: [row()], offset: 0, limit: 100, total: 1, ...change };
        await assert.rejects(getComtradeSeries('fixture', 152, 32, 'M'), /Comtrade/);
      }
    } finally { globalThis.fetch = original; }
  });
});
