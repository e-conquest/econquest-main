import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateResearchState } from '../services/dataApi';
import { getWorldBankObservations, getWorldBankRun, validIdsSummary, WorldBankRow } from '../services/worldbankApi';
import { worldbankHistory } from './worldbankMonitoring';

const row = (year: number, value: number | null): WorldBankRow => ({
  country: 'ARG', indicator: 'DEBT', year, value, rawValue: value, classification: 'reported_unverified',
  sourceId: '6', counterpart: 'WLD', attributes: {}, sourceHash: 'a'.repeat(64),
});
const summary = {
  id: 'ids-fixture', status: 'staged', active: false, createdAt: '2026-10-20T00:00:00Z', progress: {},
  report: { sourceId: '6', counterpart: 'WLD', numericCount: 2, rowCount: 3, firstYear: 2023, lastYear: 2025 },
};

describe('IDS separate source-6 native contracts', () => {
  it('rejects wrong source/counterpart, invalid counts and false active claims without affecting WDI', () => {
    assert.equal(validIdsSummary(summary), true);
    for (const bad of [
      { ...summary, report: {} }, { ...summary, active: true },
      { ...summary, report: { ...summary.report, sourceId: '2' } },
      { ...summary, report: { ...summary.report, counterpart: 'ARG' } },
      { ...summary, report: { ...summary.report, numericCount: 0 } },
      { ...summary, report: { ...summary.report, excludedFutureNumericRows: -1 } },
    ]) assert.equal(validIdsSummary(bad), false);
    const state = { schemaVersion: 1, datasets: [], runs: [], ids: [summary], worldbank: [],
      providers: [{ id: 'ids', name: 'IDS', mode: 'manual', status: 'staged', lastAttemptAt: null, lastValidatedAt: null, errors: [] }] };
    assert.doesNotThrow(() => validateResearchState(state));
    assert.throws(() => validateResearchState({ ...state, ids: [{ ...summary, report: { ...summary.report, sourceId: '2' } }] }));
    assert.equal(validIdsSummary({ ...summary, status: 'running', report: {} }), true);
  });
  it('keeps source attributes unknown, retains negative values and breaks at gaps or supplied attributes', () => {
    const rows = [row(2022, -1), row(2023, 1), row(2024, null), row(2025, 2),
      { ...row(2026, 3), attributes: { obs_status: 'E', nested: { original: true } } }];
    const before = structuredClone(rows);
    const h = worldbankHistory(rows);
    assert.deepEqual(h.segments.map(s => s.length), [2, 1, 1]);
    assert.deepEqual(rows, before);
    assert.throws(() => worldbankHistory([row(2023, 1), { ...row(2024, 2), sourceId: undefined }]), /mixed/);
    assert.throws(() => worldbankHistory([row(2023, 1), { ...row(2024, 2), counterpart: undefined }]), /mixed/);
  });
  it('routes to IDS independently and rejects invented WDI metadata, mixed rows and invalid manifests', async () => {
    const original = globalThis.fetch;
    const data = { rows: [row(2023, -1), row(2024, null), row(2025, 2)], total: 3, offset: 0, limit: 400,
      series: { country: 'ARG', indicator: 'DEBT', validCount: 2, missingCount: 1, validYears: [2023, 2025],
        missingYears: [2024], firstYear: 2023, lastYear: 2025, flaggedCount: 0, analysisBlocked: true, limitation: 'Synthetic fixture.' } };
    const serve = (v: unknown) => {
      globalThis.fetch = async input => {
        assert.match(String(input), /^\/api\/ids\//);
        return new Response(JSON.stringify(v));
      };
    };
    try {
      serve(data);
      const r = await getWorldBankObservations('fixture', 'ARG', 'DEBT', 'ids');
      assert.equal(r.rows[0].value, -1);
      assert.equal(r.rows[0].status, undefined);
      for (const delta of [
        { sourceId: '2' }, { counterpart: 'ARG' }, { status: '' }, { decimal: 0 }, { footnote: '' }, { unit: '' },
        { attributes: null }, { classification: 'actual' },
      ]) {
        serve({ ...data, rows: data.rows.map(r => ({ ...r, ...delta })) });
        await assert.rejects(getWorldBankObservations('fixture', 'ARG', 'DEBT', 'ids'), /contract/);
      }
      serve({ ...summary, sources: [] });
      assert.equal((await getWorldBankRun('fixture', 'ids')).report.sourceId, '6');
      serve({ ...summary, report: { ...summary.report, sourceId: '2' }, sources: [] });
      await assert.rejects(getWorldBankRun('fixture', 'ids'), /contract/);
    } finally { globalThis.fetch = original; }
  });
});
