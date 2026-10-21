import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bisHistory } from './bisMonitoring';
import { BisRow, BisSeries, getBisObservations, startBis, validBisSummary } from '../services/bisApi';

const row = (period: string, value: number | null, flagged = false): BisRow => ({
  country: 'US', indicator: 'lbs_claims', period, value, rawValue: value === null ? 'NaN' : String(value),
  attributes: { UNIT_MEASURE: 'USD', UNIT_MULT: '6', OBS_CONF: 'F', OBS_STATUS: value === null ? 'M' : flagged ? 'B' : 'A' },
  sourceHash: 'a'.repeat(64), flagged,
});
const rows = [row('2023-Q1', -1), row('2023-Q2', null, true), row('2023-Q3', 2), row('2023-Q4', 3, true), row('2024-Q1', 4)];
const series: BisSeries = { country: 'US', indicator: 'lbs_claims', validCount: 4, missingCount: 1, flaggedCount: 2,
  missingPeriods: [], firstPeriod: '2023-Q1', lastPeriod: '2024-Q1', latestValidPeriod: '2024-Q1',
  analysisBlocked: true, reason: '', unit: 'Millions of US dollars' };

test('BIS native quarterly lines disconnect nulls, omitted periods, break flags and unit changes', () => {
  assert.deepEqual(bisHistory(rows).segments.map(s => s.map(r => r.period)), [['2023-Q1'], ['2023-Q3'], ['2023-Q4'], ['2024-Q1']]);
  const continuous = [row('2022-Q4', -1), row('2023-Q1', 2), row('2023-Q3', 4), { ...row('2023-Q4', 5), attributes: { UNIT_MEASURE: 'USD', UNIT_MULT: '0' } }];
  assert.deepEqual(bisHistory(continuous).segments.map(s => s.length), [2, 1, 1]);
  assert.deepEqual(bisHistory([]), { sorted: [], segments: [] });
});

test('BIS reads complete native history before accepting a paginated series', async () => {
  const original = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async input => {
    const offset = new URL(String(input), 'http://localhost').searchParams.get('offset')!;
    offsets.push(offset);
    return Response.json({ rows: rows.slice(Number(offset), Number(offset) + 2), series, total: rows.length, offset: Number(offset), limit: 2 });
  };
  try {
    const data = await getBisObservations('fixture', 'US', 'lbs_claims');
    assert.deepEqual(offsets, ['0', '2', '4']);
    assert.deepEqual(data.rows, rows);
    assert.equal(data.rows[0].value, -1);
  } finally { globalThis.fetch = original; }
});

test('BIS rejects truncated, mixed, duplicate and inconsistent native API histories', async () => {
  const original = globalThis.fetch;
  const good = { rows, series, total: rows.length, offset: 0, limit: 1000 };
  const bad = [
    { ...good, rows: rows.slice(0, 2) },
    { ...good, rows: [rows[0], rows[0], ...rows.slice(2)] },
    { ...good, rows: [{ ...rows[0], country: 'CA' }, ...rows.slice(1)] },
    { ...good, rows: [{ ...rows[0], rawValue: '12' }, ...rows.slice(1)] },
    { ...good, series: { ...series, validCount: 9 } },
    { ...good, series: { ...series, firstPeriod: '2022-Q1' } },
  ];
  try {
    for (const value of bad) {
      globalThis.fetch = async () => Response.json(value);
      await assert.rejects(getBisObservations('fixture', 'US', 'lbs_claims'), /BIS/);
    }
  } finally { globalThis.fetch = original; }
});

test('BIS start sends only research consent with the mutation token; failed summaries remain explicit', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/session')) return Response.json({ token: 'fixture-token' });
    assert.equal(String(input), '/api/providers/bis/pull');
    assert.deepEqual(JSON.parse(String(options?.body)), { researchUse: true });
    assert.equal(new Headers(options?.headers).get('X-Research-Token'), 'fixture-token');
    return Response.json({ id: 'fixture', createdAt: '2026-10-20T00:00:00Z', status: 'running', active: false, progress: {}, report: {}, sources: [] });
  };
  try {
    assert.equal((await startBis()).status, 'running');
    assert.equal(validBisSummary({ id: 'failure', createdAt: '2026-10-20T00:00:00Z', status: 'interrupted',
      active: false, progress: {}, report: { errors: ['Source unavailable'] } }), true);
  } finally { globalThis.fetch = original; }
});
