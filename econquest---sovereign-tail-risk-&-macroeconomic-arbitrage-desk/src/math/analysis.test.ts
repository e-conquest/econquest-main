import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deskAnalysis } from '../../tests/fixtures/analysis';
import { loadDeskBundle, loadDeskBundles, loadDeskPreview, saveDeskBundle, validateDeskAnalysis } from '../services/analysisApi';

describe('Macro desk evidence contracts', () => {
  it('accepts native evidence without mutating or promoting estimates', () => {
    const value = deskAnalysis(), before = structuredClone(value);
    validateDeskAnalysis(value);
    assert.deepEqual(value, before);
    assert.equal(value.countries[0].metrics[0].latestActual?.year, 2024);
    assert.equal(value.countries[0].metrics[0].rows.at(-1)?.classification, 'estimate_projection');
  });

  it('rejects public rights, missing evidence, duplicate identities and invalid changes', () => {
    const changes: ((v: ReturnType<typeof deskAnalysis>) => void)[] = [
      v => Object.assign(v, { publicAllowed: true }),
      v => { v.source.sources = []; },
      v => { v.countries.push(structuredClone(v.countries[0])); },
      v => { v.countries[0].watchlisted = false; },
      v => { v.unmappedWatchlist = ['USA']; },
      v => { v.countries[0].metrics[0].changePp = 20; },
      v => { v.countries[0].metrics[0].changePp = NaN; },
      v => { v.countries[0].metrics[0].rows[2].classification = 'actual'; },
      v => { v.countries[0].metrics[0].rows.reverse(); },
      v => { v.countries[0].metrics[0].evidenceId = 'different-source'; },
      v => { v.countries[0].metrics[0].series!.unit = 'USD'; },
      v => { v.countries[0].metrics[0].series!.scale = '9'; },
      v => { v.countries[0].metrics[0].series!.analysisBlocked = true; },
      v => { v.countries[0].metrics[0].series!.latestActualYear = 2023; },
      v => { v.countries[0].metrics[0].rows[1].attributes = { ...v.countries[0].metrics[0].rows[1].attributes, METHODOLOGY: 'Changed' }; },
      v => { v.countries[0].metrics[0].rows[1].status = 'B'; },
      v => { v.countries[0].metrics[0].rows[0].sourceHash = 'c'.repeat(64); },
      v => { v.countries[0].metrics[0].missingActualYears = [2024]; },
    ];
    for (const change of changes) {
      const value = deskAnalysis();
      change(value);
      assert.throws(() => validateDeskAnalysis(value));
    }
  });

  it('accepts explicit absent series rather than synthesizing metrics', () => {
    const value = deskAnalysis();
    Object.assign(value.countries[0].metrics[0], { rows: [], series: null, latestActual: null,
      previousActual: null, changePp: null, changeBlockedReason: 'Series absent' });
    assert.doesNotThrow(() => validateDeskAnalysis(value));
  });

  it('validates selection and save identity and uses guarded manual mutations', async () => {
    const original = globalThis.fetch;
    const analysis = deskAnalysis();
    const bundle = { id: 'bundle-1', createdAt: '2026-10-21T00:00:00Z', reviewNote: 'Reviewed fixture', analysis };
    let saved: unknown;
    globalThis.fetch = async (url, init) => {
      const path = String(url);
      if (path === '/api/session') return Response.json({ token: 'synthetic-session' });
      if (init?.method === 'POST') {
        assert.equal(new Headers(init.headers).get('X-Research-Token'), 'synthetic-session');
        saved = JSON.parse(String(init.body));
        return Response.json(bundle);
      }
      if (path.includes('/preview/')) return Response.json(analysis);
      if (path.endsWith('/bundles')) return Response.json([{ id: bundle.id, createdAt: bundle.createdAt,
        runId: analysis.source.runId, digest: analysis.digest, reviewNote: bundle.reviewNote }]);
      return Response.json(bundle);
    };
    try {
      assert.deepEqual(await loadDeskPreview(analysis.source.runId), analysis);
      await assert.rejects(loadDeskPreview('wrong'), /mismatch/);
      assert.equal((await loadDeskBundles()).length, 1);
      assert.deepEqual(await loadDeskBundle('bundle-1'), bundle);
      await assert.rejects(loadDeskBundle('wrong'), /mismatch/);
      assert.deepEqual(await saveDeskBundle(analysis, 'Reviewed fixture'), bundle);
      assert.deepEqual(saved, { runId: analysis.source.runId, expectedDigest: analysis.digest,
        reviewNote: 'Reviewed fixture', researchUse: true });
      globalThis.fetch = async () => Response.json([]);
      await assert.rejects(loadDeskPreview('wrong'), /contract/);
      await assert.rejects(loadDeskBundle('wrong'), /metadata/);
    } finally { globalThis.fetch = original; }
  });
});
