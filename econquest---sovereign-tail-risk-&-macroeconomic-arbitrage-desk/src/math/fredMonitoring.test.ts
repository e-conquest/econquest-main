import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateResearchState } from '../services/dataApi';
import { fredDate, FredRow, FredRun, FredSeries, getFredCatalog, getFredConfig, getFredHistory, startFred, validFredSummary } from '../services/fredApi';
import { fredHistory } from './fredMonitoring';

const asOf = '2026-10-20';
const row = (date: string, value: number | null): FredRow => ({
  seriesId: 'GDP', date, value, rawValue: value === null ? '.' : String(value),
  realtimeStart: asOf, realtimeEnd: asOf, sourceHash: 'a'.repeat(64),
});
const series: FredSeries = {
  id: 'GDP', name: 'Nominal GDP', metadata: { id: 'GDP', title: 'Fixture GDP', units: 'Billions of dollars', units_short: 'Bil. $',
    frequency: 'Quarterly', frequency_short: 'Q', seasonal_adjustment: 'Seasonally Adjusted Annual Rate', seasonal_adjustment_short: 'SAAR',
    last_updated: '2026-10-19 10:00:00-05', observation_start: '2000-01-01', observation_end: '2026-07-01',
    realtime_start: asOf, realtime_end: asOf },
  metadataAsOf: asOf, metadataSourceHash: 'a'.repeat(64), vintageSourceHashes: ['a'.repeat(64)],
  vintageDates: ['2000-02-01', '2026-10-19'], firstArchivedVintage: '2000-02-01', latestEligibleVintage: '2026-10-19',
  status: 'available', reason: '', validCount: 2, missingCount: 1,
  firstObservation: '2000-01-01', lastObservation: '2000-07-01', latestValidObservation: '2000-07-01', analysisBlocked: true,
};
const run: FredRun = { id: 'fixture', createdAt: '2026-10-20T00:00:00Z', status: 'staged', active: false, progress: {}, sources: [],
  report: { mode: 'current', asOf, errors: [], seriesCount: 1, rowCount: 3, numericCount: 2, availableSeries: 1 } };

describe('FRED / ALFRED native monitoring', () => {
  it('separates daily, monthly and quarterly periods without filling dots, weekends or calendar gaps', () => {
    assert.equal(fredHistory([row('2000-01-01', -1), row('2000-04-01', 2)], 'Q').segments.length, 1);
    assert.equal(fredHistory([row('2000-01-01', -1), row('2000-07-01', 2)], 'Q').segments.length, 2);
    assert.equal(fredHistory([row('2000-01-01', -1), row('2000-02-01', 2)], 'M').segments.length, 1);
    const rows = [row('2000-01-07', -1), row('2000-01-10', 2), row('2000-01-11', null), row('2000-01-12', 3)];
    const before = structuredClone(rows);
    assert.equal(fredHistory(rows, 'D').segments.length, 3);
    assert.deepEqual(rows, before);
    assert.equal(fredHistory([], 'D').segments.length, 0);
  });
  it('rejects duplicate, mixed, nonfinite and invalid dates and distinguishes current/historical identity', () => {
    for (const rows of [
      [row('2000-01-01', 1), row('2000-01-01', 2)], [row('2000-02-31', 1)], [row('2000-01-01', Infinity)],
      [row('2000-01-01', 1), { ...row('2000-04-01', 2), seriesId: 'UNRATE' }],
      [row('2000-01-01', 1), { ...row('2000-04-01', 2), realtimeStart: '2005-01-01' }],
    ]) assert.throws(() => fredHistory(rows, 'Q'));
    assert.equal(fredDate('2000-02-31'), false);
    assert.equal(validFredSummary(run), true);
    assert.equal(validFredSummary({ ...run, report: { ...run.report, mode: 'live' } }), false);
    assert.equal(validFredSummary({ ...run, active: true }), false);
    assert.doesNotThrow(() => validateResearchState({ schemaVersion: 1, datasets: [], runs: [], providers: [], fred: [run] }));
    assert.throws(() => validateResearchState({ schemaVersion: 1, datasets: [], runs: [], providers: [], fred: [{ ...run, report: {} }] }));
  });
  it('validates native text, series counts, as-of bounds, chronological order and complete pages', async () => {
    const original = globalThis.fetch;
    const page = { rows: [row('2000-01-01', -1.25), row('2000-04-01', null), row('2000-07-01', 2)],
      total: 3, offset: 0, limit: 5000, series };
    const serve = (v: unknown) => { globalThis.fetch = async () => new Response(JSON.stringify(v)); };
    try {
      serve(page);
      assert.equal((await getFredHistory(run, 'GDP')).rows[0].value, -1.25);
      for (const bad of [
        { ...page, total: 4 }, { ...page, series: { ...series, validCount: 3 } },
        { ...page, rows: page.rows.map(r => ({ ...r, rawValue: '5' })) },
        { ...page, rows: page.rows.map(r => ({ ...r, realtimeStart: '2005-01-01' })) },
        { ...page, rows: [page.rows[0], page.rows[0], page.rows[2]] },
        { ...page, rows: page.rows.map(r => ({ ...r, seriesId: 'OTHER' })) },
      ]) {
        serve(bad);
        await assert.rejects(getFredHistory(run, 'GDP'));
      }
      serve({ ...page, rows: [], total: 0, series: { ...series, status: 'unavailable', validCount: 0, missingCount: 0,
        firstObservation: null, lastObservation: null, latestValidObservation: null, reason: 'No archive' } });
      assert.equal((await getFredHistory(run, 'GDP')).rows.length, 0);
    } finally { globalThis.fetch = original; }
  });
  it('assembles multiple observation pages and rejects a changing total rather than drawing a prefix', async () => {
    const original = globalThis.fetch;
    const rows = Array.from({ length: 5001 }, (_, i) => row(new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10), i));
    const info = { ...series, validCount: 5001, missingCount: 0, firstObservation: rows[0].date, lastObservation: rows.at(-1)!.date };
    let changing = false;
    globalThis.fetch = async input => {
      const offset = Number(new URL(String(input), 'http://localhost').searchParams.get('offset'));
      return new Response(JSON.stringify({ rows: rows.slice(offset, offset + 5000), total: changing && offset ? 5002 : 5001,
        offset, limit: 5000, series: info }));
    };
    try {
      assert.equal((await getFredHistory(run, 'GDP')).rows.length, 5001);
      changing = true;
      await assert.rejects(getFredHistory(run, 'GDP'), /truncated/);
    } finally { globalThis.fetch = original; }
  });
  it('validates catalog identity and configuration and sends only consent/mode/asOf, never a key', async () => {
    const original = globalThis.fetch;
    const requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      requests.push({ url, body: options?.body ? JSON.parse(String(options.body)) : null });
      if (url === '/api/session') return new Response(JSON.stringify({ token: 'fixture' }));
      if (url.endsWith('/config')) return new Response(JSON.stringify({ configured: false, today: asOf, earliestDate: '1776-07-04', series: [] }));
      if (url.endsWith('/series')) return new Response(JSON.stringify({ runId: run.id, mode: 'current', asOf, series: [series] }));
      if (url.endsWith('/pull')) {
        const body = JSON.parse(String(options?.body));
        return new Response(JSON.stringify({ ...run, report: { ...run.report, mode: body.mode, asOf: body.asOf ?? asOf } }));
      }
      return new Response(JSON.stringify(run));
    };
    try {
      assert.equal((await getFredConfig()).configured, false);
      assert.equal((await getFredCatalog(run))[0].metadata.units, 'Billions of dollars');
      await assert.rejects(getFredCatalog({ ...run, report: { ...run.report, mode: 'historical' } }));
      await startFred('current', '');
      await startFred('historical', '2010-01-01');
      const pulls = requests.filter(r => r.url.endsWith('/pull'));
      assert.deepEqual(pulls.map(r => r.body), [
        { researchUse: true, mode: 'current' }, { researchUse: true, mode: 'historical', asOf: '2010-01-01' },
      ]);
      assert.equal(JSON.stringify(requests).includes('api_key'), false);
      globalThis.fetch = async input => new Response(JSON.stringify(String(input) === '/api/session' ? { token: 'fixture' } : run));
      await assert.rejects(startFred('historical', '2010-01-01'), /identity/);
    } finally { globalThis.fetch = original; }
  });
});
