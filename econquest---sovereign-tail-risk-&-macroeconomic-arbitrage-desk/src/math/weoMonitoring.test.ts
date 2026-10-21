import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateResearchState } from '../services/dataApi';
import { getWeoCoverage, getWeoObservations, getWeoRun, validWeoSummary, WeoRow, WeoSeries } from '../services/weoApi';
import { weoHistory } from './weoMonitoring';

const row = (year: number, value: number | null, classification: WeoRow['classification'] = 'actual'): WeoRow => ({
  country: 'CAN', indicator: 'BCA', year, value, rawValue: value === null ? null : String(value), classification,
  status: null, sourceHash: 'a'.repeat(64), attributes: {},
});
const series: WeoSeries = {
  country: 'CAN', indicator: 'BCA', unit: 'USD', unitLabel: 'US dollar', scale: '9', scaleLabel: 'Billions',
  latestActualYear: 2024, validCount: 3, missingCount: 0, missingYears: [], attributes: {}, sourceHash: 'a'.repeat(64), analysisBlocked: false,
};

describe('WEO annual native monitoring', () => {
  it('separates actuals from estimates/projections without labeling past estimates as actuals', () => {
    const rows = [row(2026, 130, 'estimate_projection'), row(2023, 100), row(2024, 110, 'estimate_projection'), row(2025, 120, 'estimate_projection')];
    const before = structuredClone(rows);
    const result = weoHistory(rows, series);
    assert.equal(result.latestActual?.year, 2023);
    assert.equal(result.estimates.length, 3);
    assert.equal(result.segments.length, 2);
    assert.deepEqual(rows, before);
  });

  it('breaks implicit and explicit gaps, status breaks and unknown classifications', () => {
    for (const rows of [
      [row(2023, 100), row(2025, 110)],
      [row(2023, 100), row(2024, null), row(2025, 110)],
      [row(2023, 100), { ...row(2024, 110), status: 'B' }],
      [row(2023, 100), row(2024, 110, 'unknown')],
    ]) assert.equal(weoHistory(rows, series).segments.length, 2);
    const result = weoHistory([row(2025, 1e9, 'unknown')], { ...series, latestActualYear: null });
    assert.equal(result.latestActual, undefined);
    assert.equal(result.unknownCount, 1);
    assert.equal(result.sorted[0].value, 1e9);
  });

  it('rejects duplicate mixed nonfinite invalid and absent-series records', () => {
    for (const rows of [
      [row(2025, 1), row(2025, 2)], [row(2025, Infinity)], [row(2025.1, 1)],
      [{ ...row(2025, 1), country: 'USA' }], [{ ...row(2025, 1), indicator: 'OTHER' }],
    ]) assert.throws(() => weoHistory(rows, series));
    assert.throws(() => weoHistory([row(2025, 1)], null));
    assert.equal(weoHistory([], null).latestActual, undefined);
  });

  it('validates independent WEO summaries without accepting invalid annual bounds or provider claims', () => {
    const summary = { id: 'fixture', status: 'staged', active: false, createdAt: '2026-10-20T00:00:00Z', progress: {},
      report: { publicationDate: '2026-10-13T02:00:00Z', firstYear: 1980, lastYear: 2031, rowCount: 3, absentPairs: 2 } };
    assert.equal(validWeoSummary(summary), true);
    assert.equal(validWeoSummary({ ...summary, active: true }), false);
    assert.equal(validWeoSummary({ ...summary, report: { firstYear: '1980' } }), false);
    assert.doesNotThrow(() => validateResearchState({ schemaVersion: 1, datasets: [], runs: [], providers: [], weo: [summary] }));
    assert.throws(() => validateResearchState({ schemaVersion: 1, datasets: [], runs: [], providers: [], weo: [{ ...summary, report: { rowCount: NaN } }] }));
  });

  it('runtime-checks WEO pages, identity, finite values and truncation before drawing', async () => {
    const original = globalThis.fetch;
    const page = { rows: [row(2023, 1)], total: 1, offset: 0, limit: 400, series };
    const serve = (data: unknown) => { globalThis.fetch = async () => new Response(JSON.stringify(data)); };
    try {
      serve(page);
      assert.equal((await getWeoObservations('fixture', 'CAN', 'BCA')).rows[0].value, 1);
      serve({ ...page, total: 2 });
      await assert.rejects(getWeoObservations('fixture', 'CAN', 'BCA'), /truncated/);
      serve({ ...page, rows: [{ ...row(2023, 1), country: 'USA' }] });
      await assert.rejects(getWeoObservations('fixture', 'CAN', 'BCA'), /contract/);
      serve({ ...page, rows: [{ ...row(2023, 1), classification: 'forecast-is-actual' }] });
      await assert.rejects(getWeoObservations('fixture', 'CAN', 'BCA'), /contract/);
      serve({ ...page, rows: [], series: null, total: 0 });
      assert.equal((await getWeoObservations('fixture', 'CAN', 'BCA')).series, null);
      serve({ rows: [{ country: 'CAN', name: 'Canada', indicator: 'BCA', indicatorName: 'Current account', validCount: 0,
        absent: true, missingYears: [2023, 2024], latestActualYear: null, analysisBlocked: true }], total: 1, offset: 0, limit: 50 });
      assert.equal((await getWeoCoverage('fixture')).rows[0].absent, true);
      serve({ report: {}, sources: [] });
      await assert.rejects(getWeoRun('fixture'), /contract/);
    } finally { globalThis.fetch = original; }
  });
});
