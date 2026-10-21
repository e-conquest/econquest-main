import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Dataset, ResearchState, downloadDatabaseBackup, loadResearchEvents, loadResearchState, validatePreview, validateResearchState } from '../services/dataApi';
import { annualResearch, freshness, marketSeries, RESEARCH_COUNTRIES } from './researchMonitoring';
import { ANNUAL_FEATURES, getAnnualHistory } from './fittedModels';
import { fetchYFinanceQuote } from '../services/yfinanceService';
import { DEFAULT_DATA_FEEDS } from '../data/defaultDataFeeds';

const market: Dataset = {
  id: 'test', version: 'test-v1', kind: 'market', source: 'unit test fixture, not empirical',
  unit: 'USD per EUR', createdAt: '2025-01-04T00:00:00Z', freshnessDays: 2, active: true,
  observations: [
    { symbol: 'EURUSD', observedAt: '2025-01-01T00:00:00Z', value: 1.1, publishedAt: null },
    { symbol: 'EURUSD', observedAt: '2025-01-03T00:00:00Z', value: 1.2, publishedAt: null }
  ]
};

describe('Research data boundaries and monitoring', () => {
  it('never reports configured feeds as operational or returns generated quotes', async () => {
    assert.ok(DEFAULT_DATA_FEEDS.every(feed => !feed.enabled && feed.status === 'Idle' && !feed.lastSyncTimestamp));
    await assert.rejects(fetchYFinanceQuote('EMB'), /No browser quote connector configured/);
    await assert.rejects(fetchYFinanceQuote('arbitrary'), /No browser quote connector configured/);
  });

  it('distinguishes unknown freshness, source staleness and import age using a controlled clock', () => {
    const now = Date.parse('2025-01-04T00:00:00Z');
    assert.equal(freshness(market, now).eligible, true);
    assert.equal(freshness(market, now).importAgeDays, 0);
    const stale = freshness(market, now + 2 * 86400000);
    assert.equal(stale.state, 'stale');
    assert.equal(stale.eligible, false);
    assert.equal(stale.ages[0].ageDays, 3);
    assert.equal(freshness({ ...market, freshnessDays: null }, now).state, 'unverified');
    assert.equal(freshness({ ...market, freshnessDays: null }, now).eligible, false);
    const mixed = { ...market, observations: [...market.observations,
      { symbol: 'OLD', observedAt: '2024-01-01T00:00:00Z', value: 2, publishedAt: null }] };
    assert.equal(freshness(mixed, now).eligible, false);
    assert.throws(() => freshness(market, Date.parse('2024-01-01T00:00:00Z')), /Invalid observation/);
  });

  it('uses real timestamps, sorts without mutation and only computes comparable absolute changes', () => {
    const reversed = { ...market, observations: [...market.observations].reverse() };
    const before = structuredClone(reversed);
    const result = marketSeries(reversed, 'EURUSD');
    assert.ok(Math.abs(result.change! - .1) < 1e-10);
    assert.equal(result.previous!.observedAt, '2025-01-01T00:00:00Z');
    assert.equal(Date.parse(result.latest.observedAt!) - Date.parse(result.previous!.observedAt!), 2 * 86400000);
    assert.deepEqual(reversed, before);
    assert.equal(marketSeries({ ...market, observations: market.observations.slice(0, 1) }, 'EURUSD').change, null);
    assert.throws(() => marketSeries(market, 'MISSING'), /No valid market/);
  });

  it('requires the expected completed session for every ETF and expires calendar checks locally', () => {
    const dataset: Dataset = {
      ...market, freshnessDays: null,
      sessionPolicy: {
        expectedCloseAt: '2025-01-03T00:00:00Z', nextCheckAt: '2025-01-05T20:30:00Z', checkedAt: '2025-01-04T00:00:00Z'
      }
    };
    assert.equal(freshness(dataset, Date.parse('2025-01-04T00:00:00Z')).state, 'current');
    assert.equal(freshness(dataset, Date.parse('2025-01-05T20:29:59Z')).eligible, true);
    assert.equal(freshness(dataset, Date.parse('2025-01-05T20:30:00Z')).state, 'unverified');
    assert.equal(freshness(dataset, Date.parse('2025-01-05T20:30:00Z')).eligible, false);
    assert.equal(freshness({ ...dataset, observations: [...dataset.observations,
      { symbol: 'MISSING_LATEST', observedAt: '2025-01-01T00:00:00Z', value: 1, publishedAt: null }]
    }, Date.parse('2025-01-04T00:00:00Z')).state, 'stale');
  });

  it('runs only fitted annual estimates and preserves explicit baseline/overlay lineage', () => {
    const baseline = annualResearch();
    assert.equal(baseline.length, 9);
    assert.ok(baseline.every(row => !row.imported && row.modelVersion && row.inputVersion));
    assert.ok(baseline.every(row => !('var99' in row) && !('arbitrageDivergence' in row) && !('calibratedPosteriorHazard' in row)));
    const entity = RESEARCH_COUNTRIES.find(s => s.code === 'TUR')!;
    const observation = structuredClone(getAnnualHistory(entity).at(-1)!);
    observation.values[4] = 0;
    const dataset: Dataset = {
      ...market, kind: 'annual', unit: 'model-feature-units',
      observations: [{ country: 'TUR', ...observation, publishedAt: null }]
    };
    const updated = annualResearch(dataset);
    const original = baseline.find(row => row.code === 'TUR')!;
    const changed = updated.find(row => row.code === 'TUR')!;
    assert.equal(changed.inputVersion, dataset.version);
    assert.equal(changed.baselineSha256, original.baselineSha256);
    assert.equal(changed.imported, true);
    assert.notDeepEqual(changed.regimeProbabilities, original.regimeProbabilities);
    assert.ok(changed.source.includes('overlaid'));
    assert.equal(updated.find(row => row.code === 'CHL')!.imported, false);
    assert.deepEqual(annualResearch(), baseline);
    assert.throws(() => annualResearch(market), /Annual research requires/);
    const gap = structuredClone(dataset);
    gap.observations[0].year! += 2;
    assert.throws(() => annualResearch(gap), /consecutive/);
    assert.equal(ANNUAL_FEATURES.length, 6);
  });

  it('rejects malformed/stale backend contracts rather than reporting success', () => {
    const state: ResearchState = { schemaVersion: 1, datasets: [market], runs: [], providers: [] };
    validateResearchState(state);
    assert.throws(() => validateResearchState({ ...state, providers: [{ status: 'Connected' }] }), /invalid research/);
    assert.throws(() => validateResearchState({ ...state, datasets: [market, market] }), /competing/);
    assert.throws(() => validateResearchState({ ...state, datasets: [{ ...market, freshnessDays: -1 }] }), /invalid research/);
    validateResearchState({ ...state, datasets: [{ ...market, freshnessDays: 0 }] });
    assert.throws(() => validateResearchState({ ...state, datasets: [{ ...market, freshnessDays: .5 }] }), /invalid research/);
    assert.throws(() => validateResearchState({ ...state, datasets: [{ ...market, sessionPolicy: { expectedCloseAt: 'not-a-date' } }] }), /invalid research/);
    const provider = { id: 'yfinance', name: 'Yahoo', mode: 'manual', status: 'available', lastAttemptAt: null, lastValidatedAt: null, errors: [] };
    validateResearchState({ ...state, providers: [provider] });
    assert.throws(() => validateResearchState({ ...state, providers: [{ ...provider, status: 'Connected' }] }), /invalid research/);
    assert.throws(() => validateResearchState({ ...state, datasets: [{ ...market, observations: [{ value: NaN }] }] }), /invalid research/);
    assert.throws(() => validatePreview({ run: { status: 'Connected' }, preview: [], sheets: [] }), /invalid import/);
  });

  it('surfaces HTTP and network failures without manufacturing data', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('database unavailable', { status: 503 });
      await assert.rejects(loadResearchState(), /503: database unavailable/);
      await assert.rejects(downloadDatabaseBackup(), /backup failed: HTTP 503/);
      globalThis.fetch = async () => { throw new Error('connection lost'); };
      await assert.rejects(loadResearchState(), /connection lost/);
      globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: 999 }), { status: 200 });
      await assert.rejects(loadResearchState(), /invalid research/);
      await assert.rejects(downloadDatabaseBackup(), /valid SQLite backup/);
    } finally { globalThis.fetch = original; }
  });

  it('evaluates real health before reading persisted event identities and rejects malformed health', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    const event = {
      sequence: 1, event: 'data_health_changed', createdAt: '2025-01-01T00:00:00Z',
      runId: null, datasetId: null, details: { healthId: 'service', status: 'ok' }
    };
    try {
      globalThis.fetch = async path => {
        calls.push(String(path));
        return new Response(JSON.stringify(String(path) === '/api/health' ? {
          status: 'ok', connectorsActive: false,
          observations: [{ id: 'service', status: 'ok', checkedAt: '2025-01-01T00:00:00Z', details: {} }]
        } : { events: [event] }));
      };
      assert.deepEqual(await loadResearchEvents(), [event]);
      assert.deepEqual(calls, ['/api/health', '/api/events']);
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'Connected' }));
      await assert.rejects(loadResearchEvents(), /invalid data-health/);
    } finally { globalThis.fetch = original; }
  });
});
