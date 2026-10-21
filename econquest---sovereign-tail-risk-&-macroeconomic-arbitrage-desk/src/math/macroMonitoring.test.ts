import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMacroPage, MacroRow, validMacroSummary } from '../services/imfApi';
import { validateResearchState } from '../services/dataApi';
import { macroSeries, monthNumber } from './macroMonitoring';

const row = (period: string, value: number | null, changes: Partial<MacroRow> = {}): MacroRow => ({
  country: 'CAN', indicator: 'cpi', period, value, rawValue: value === null ? null : String(value),
  scale: '0', unit: 'Native CPI index', status: null, sourceHash: 'a'.repeat(64),
  attributes: { REFERENCE_PERIOD: '2010A', COMMON_REFERENCE_PERIOD: '2010A' }, ...changes,
});

describe('IMF native monthly monitoring', () => {
  it('only calculates adjacent comparable native changes without mutating input', () => {
    const rows = [row('2025-03', 102), row('2025-01', 100), row('2025-02', 101)];
    const before = structuredClone(rows);
    const result = macroSeries(rows);
    assert.equal(result.change, 1);
    assert.equal(result.segments.length, 1);
    assert.deepEqual(rows, before);
  });

  it('never draws across implicit/explicit gaps or rebasings/definition breaks', () => {
    for (const rows of [
      [row('2025-01', 100), row('2025-03', 102)],
      [row('2025-01', 100), row('2025-02', null), row('2025-03', 102)],
      [row('2025-01', 100), row('2025-02', 102, { status: 'B' })],
      [row('2025-01', 100), row('2025-02', 102, { attributes: { REFERENCE_PERIOD: '2020A' } })],
      [row('2025-01', 100), row('2025-02', 102, { attributes: { COMMON_REFERENCE_PERIOD: '2020A' } })],
      [row('2025-01', 100), row('2025-02', 102, { scale: '6' })],
    ]) {
      const result = macroSeries(rows);
      assert.equal(result.change, null);
      assert.equal(result.segments.length, 2);
    }
  });

  it('blocks reserve and unknown-scale changes rather than multiplying source values', () => {
    for (const changes of [{ indicator: 'reserves', scale: '6' }, { scale: '6' }]) {
      const result = macroSeries([row('2025-01', 125165368431.7875, changes), row('2025-02', 125165368432.7875, changes)]);
      assert.equal(result.change, null);
      assert.equal(result.sorted[0].value, 125165368431.7875);
    }
  });

  it('rejects mixed, duplicate, invalid and nonfinite periods instead of synthesizing a chart', () => {
    for (const rows of [
      [row('2025-01', 1), row('2025-01', 2)],
      [row('2025-01', 1), row('2025-02', Infinity)],
      [row('2025-01', 1), row('2025-02', 2, { country: 'USA' })],
      [row('2025-13', 1)],
    ]) assert.throws(() => macroSeries(rows));
    assert.throws(() => monthNumber('2025-1'));
    assert.equal(macroSeries([]).latest, undefined);
  });

  it('validates independent IMF summaries without accepting unsupported provider claims', () => {
    const macro = { id: 'fixture', createdAt: '2025-04-01T00:00:00Z', status: 'quarantined', active: false,
      report: { errors: ['Absent pairs'], rowCount: 3 }, progress: {} };
    assert.equal(validMacroSummary(macro), true);
    const state = { schemaVersion: 1, datasets: [], runs: [], providers: [], macro: [macro] };
    assert.doesNotThrow(() => validateResearchState(state));
    assert.throws(() => validateResearchState({ ...state, macro: [{ ...macro, active: 'true' }] }));
    assert.throws(() => validateResearchState({ ...state, macro: [{ ...macro, report: { rowCount: NaN } }] }));
  });

  it('excludes unknown source flags without losing their original value or connecting gaps', () => {
    const rows = [row('2025-01', 100), row('2025-02', null, {
      status: 'T', rawValue: '101', exclusionReason: 'Unknown source observation status',
    }), row('2025-03', 102)];
    const h = macroSeries(rows);
    assert.equal(h.change, null);
    assert.equal(h.segments.length, 2);
    assert.equal(h.sorted[1].rawValue, '101');
    assert.throws(() => macroSeries([row('2025-01', 101, { exclusionReason: 'Unknown source observation status' })]));
    assert.equal(validMacroSummary({ id: 'v2', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false,
      report: { contractVersion: 'imf-monthly-native-v2', coveragePolicy: 'available-monthly-pairs', absentPairs: 419, unknownStatusRows: 9, numericCount: 90848 }, progress: {} }), true);
  });

  it('rejects truncated/mixed monthly history, duplicate periods and exclusion reasons on numeric values', async () => {
    const original = globalThis.fetch;
    const rows = [row('2025-01', 100), row('2025-02', null, { status: 'T', rawValue: '101', exclusionReason: 'Unknown source observation status' })];
    const data = { rows, total: 2, offset: 0, limit: 240 };
    const serve = (v: unknown) => { globalThis.fetch = async () => new Response(JSON.stringify(v)); };
    try {
      serve(data);
      assert.equal((await getMacroPage('v2', 'observations', 'CAN', 'cpi')).rows[1].value, null);
      for (const bad of [
        { ...data, total: 3 }, { ...data, total: 241 }, { ...data, offset: 1 }, { ...data, limit: 0 },
        { ...data, rows: [rows[0], rows[0]] },
        { ...data, rows: rows.map(r => ({ ...r, country: 'USA' })) },
        { ...data, rows: rows.map(r => ({ ...r, exclusionReason: 'Excluded' })) },
      ]) {
        serve(bad);
        await assert.rejects(getMacroPage('v2', 'observations', 'CAN', 'cpi'), /IMF/);
      }
    } finally { globalThis.fetch = original; }
  });
});
