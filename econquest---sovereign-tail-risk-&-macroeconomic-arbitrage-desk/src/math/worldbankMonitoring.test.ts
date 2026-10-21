import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateResearchState } from '../services/dataApi';
import { getWorldBankCoverage, getWorldBankObservations, getWorldBankRun, validWorldBankSummary, WorldBankRow, WorldBankSeries } from '../services/worldbankApi';
import { worldbankHistory } from './worldbankMonitoring';

const row = (year: number, value: number | null): WorldBankRow => ({
  country: 'CAN', indicator: 'GDP', year, value, rawValue: value, classification: 'reported_unverified',
  status: '', unit: '', footnote: '', decimal: 1, sourceHash: 'a'.repeat(64),
});
const series: WorldBankSeries = {
  country: 'CAN', indicator: 'GDP', firstYear: 2023, lastYear: 2025, validCount: 2, validYears: [2023, 2025],
  missingCount: 1, missingYears: [2024], flaggedCount: 0, analysisBlocked: true, limitation: 'Synthetic fixture, not empirical.',
};

describe('World Bank native annual monitoring', () => {
  it('preserves native negative values and breaks explicit/implicit gaps, flags, footnotes and units', () => {
    for (const rows of [
      [row(2023, -1), row(2025, 1e9)],
      [row(2023, -1), row(2024, null), row(2025, 1e9)],
      [row(2023, -1), { ...row(2024, 1), status: 'unmapped' }],
      [row(2023, -1), { ...row(2024, 1), footnote: 'Break' }],
      [row(2023, -1), { ...row(2024, 1), unit: 'Other' }],
    ]) {
      const before = structuredClone(rows);
      assert.equal(worldbankHistory(rows).segments.length, 2);
      assert.deepEqual(rows, before);
      assert.equal(worldbankHistory(rows).sorted[0].value, -1);
    }
    assert.equal(worldbankHistory([]).segments.length, 0);
    assert.equal(worldbankHistory([row(2023, null)]).segments.length, 0);
  });
  it('rejects mixed, duplicate, nonfinite and invalid years', () => {
    for (const rows of [
      [row(2023, 1), row(2023, 2)], [row(2023, Infinity)], [row(2023.1, 1)],
      [row(2023, 1), { ...row(2024, 1), country: 'USA' }],
      [row(2023, 1), { ...row(2024, 1), indicator: 'Other' }],
    ]) assert.throws(() => worldbankHistory(rows));
  });
  it('validates the fourth provider and independent summaries but not invalid updates and active claims', () => {
    const summary = { id: 'fixture', status: 'staged', active: false, createdAt: '2026-10-20T00:00:00Z', progress: {},
      report: { sourceLastUpdated: '2026-10-08', firstYear: 1960, lastYear: 2025, rowCount: 3, absentPairs: 2 } };
    assert.equal(validWorldBankSummary(summary), true);
    assert.equal(validWorldBankSummary({ ...summary, active: true }), false);
    assert.equal(validWorldBankSummary({ ...summary, report: { firstYear: '1960' } }), false);
    assert.equal(validWorldBankSummary({ ...summary, report: { sourceLastUpdated: 'not-date' } }), false);
    const state = { schemaVersion: 1, datasets: [], runs: [], worldbank: [summary],
      providers: [{ id: 'worldbank', name: 'WDI', mode: 'manual', status: 'staged', lastAttemptAt: null, lastValidatedAt: null, errors: [] }] };
    assert.doesNotThrow(() => validateResearchState(state));
    assert.throws(() => validateResearchState({ ...state, worldbank: [{ ...summary, report: { rowCount: NaN } }] }));
  });
  it('rejects truncated, mixed, duplicate, inconsistent and relabeled actual series at the runtime boundary', async () => {
    const original = globalThis.fetch;
    const page = { rows: [row(2023, -1), row(2024, null), row(2025, 1e9)], total: 3, offset: 0, limit: 400, series };
    const serve = (data: unknown) => { globalThis.fetch = async () => new Response(JSON.stringify(data)); };
    try {
      serve(page);
      assert.equal((await getWorldBankObservations('fixture', 'CAN', 'GDP')).rows[2].value, 1e9);
      for (const bad of [
        { ...page, total: 4 }, { ...page, series: { ...series, validCount: 9 } }, { ...page, series: null },
        { ...page, rows: page.rows.map(r => ({ ...r, country: 'USA' })) },
        { ...page, rows: [page.rows[0], page.rows[0], page.rows[2]] },
        { ...page, rows: page.rows.map(r => ({ ...r, classification: 'actual' })) },
        { ...page, rows: page.rows.map(r => ({ ...r, rawValue: 123 })) },
        { ...page, rows: page.rows.map(r => ({ ...r, decimal: null })) },
      ]) {
        serve(bad);
        await assert.rejects(getWorldBankObservations('fixture', 'CAN', 'GDP'), /contract/);
      }
      serve({ rows: [], series: null, total: 0, offset: 0, limit: 400 });
      assert.equal((await getWorldBankObservations('fixture', 'CAN', 'GDP')).series, null);
      serve({ sources: [], report: {} });
      await assert.rejects(getWorldBankRun('fixture'), /contract/);
    } finally { globalThis.fetch = original; }
  });
  it('checks coverage filters, totals and absent-pair semantics', async () => {
    const original = globalThis.fetch;
    const coverage = { country: 'CAN', name: 'Canada', indicator: 'GDP', indicatorName: 'Fixture GDP',
      validCount: 0, absent: true, missingYears: [2023], analysisBlocked: true };
    const serve = (data: unknown) => { globalThis.fetch = async () => new Response(JSON.stringify(data)); };
    try {
      serve({ rows: [coverage], total: 1, offset: 0, limit: 50 });
      assert.equal((await getWorldBankCoverage('fixture', 'CAN')).rows[0].absent, true);
      await assert.rejects(getWorldBankCoverage('fixture', 'USA'), /contract/);
      serve({ rows: [{ ...coverage, validCount: 1 }], total: 1, offset: 0, limit: 50 });
      await assert.rejects(getWorldBankCoverage('fixture'), /contract/);
      serve({ rows: [coverage], total: 3, offset: 0, limit: 50 });
      await assert.rejects(getWorldBankCoverage('fixture'), /contract/);
    } finally { globalThis.fetch = original; }
  });
});
