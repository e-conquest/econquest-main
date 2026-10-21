import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acledEvent, acledRun } from '../../tests/fixtures/acled';
import { checkAcledContract, getAcledPage, getAcledRun, startAcled, validAcledEvent, validAcledRun, validAcledSummary } from '../services/acledApi';
import { validateResearchState } from '../services/dataApi';

describe('ACLED private research contracts (synthetic only)', () => {
  it('preserves native types, uncertain zeros, precision codes, country identities and unknown publication', () => {
    assert.equal(validAcledEvent(acledEvent()), true);
    const row = acledEvent();
    assert.equal(validAcledEvent({ ...row, fatalities: null, attributes: { ...row.attributes, fatalities: null } }), true);
    for (const change of [{ fatalities: 1 }, { fatalities: NaN }, { timePrecision: 1 }, { isoNumeric: 0 }, { latitude: null },
      { updatedAt: '2026-10-21T00:00:00Z' }, { publishedAt: '2026-10-20' }, { country: 'Guessed successor' },
      { attributes: { ...row.attributes, fatalities: true } }, { attributes: { ...row.attributes, fatalities: '0.5' } },
      { attributes: { ...row.attributes, notes: { nested: 'bad' } } }]) assert.equal(validAcledEvent({ ...row, ...change }), false);
  });
  it('rejects incomplete/revised snapshots masquerading as staged and malformed original scopes', () => {
    const run = acledRun(true);
    assert.equal(validAcledRun(run), true);
    assert.equal(validAcledSummary(acledRun()), true);
    for (const change of [{ consistencyVerified: false }, { transportComplete: false }, { errors: ['revision'] },
      { rowCount: 0 }, { startDate: '2026-09-20' }]) {
      assert.equal(validAcledSummary({ ...run, report: { ...run.report, ...change } }), false);
    }
    for (const path of ['bad URL', 'https://evil.example/api/acled/read', run.sources[0].path.replace('dyadic', 'monadic')]) {
      assert.equal(validAcledRun({ ...run, sources: run.sources.map(s => ({ ...s, path })) }), false);
    }
    assert.equal(validAcledRun({ ...run, sources: run.sources.slice(0, 1) }), false);
    assert.doesNotThrow(() => validateResearchState({ schemaVersion: 1, datasets: [], runs: [], providers: [], acled: [run] }));
  });
  it('blocks old backends and unconfigured credentials before requesting a session or acquisition', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = async input => { calls.push(String(input)); return new Response('', { status: 404 }); };
      await assert.rejects(startAcled(), /restart required/);
      globalThis.fetch = async input => {
        calls.push(String(input));
        return Response.json({ contractVersion: 'acled-global-core-30d-v1', library: 'acled==1.0.2', auth: 'oauth',
          configured: false, days: 30, scope: 'global-account-accessible', startDate: '2026-09-21', endDate: '2026-10-20' });
      };
      await assert.rejects(startAcled(), /privately/);
      assert.equal(calls.some(p => p.endsWith('/pull') || p.endsWith('/session')), false);
      globalThis.fetch = async () => Response.json({ configured: true, contractVersion: 'legacy' });
      await assert.rejects(checkAcledContract(), /Incompatible/);
    } finally { globalThis.fetch = original; }
  });
  it('requires exact page boundaries, selection identity, distinct IDs and captured-original hashes', async () => {
    const original = globalThis.fetch;
    const run = acledRun(true);
    const value = { rows: [acledEvent()], total: 1, offset: 0, limit: 100, runId: run.id, country: 'Synthetic country', eventType: 'Protests' };
    try {
      globalThis.fetch = async () => Response.json(value);
      assert.deepEqual(await getAcledPage(run, 'Synthetic country', 'Protests', 0), value);
      for (const change of [{ total: 2 }, { limit: 500 }, { runId: 'other' }, { country: '' }, { offset: 1 },
        { rows: [acledEvent(), acledEvent()], total: 2 }, { rows: [{ ...acledEvent(), sourceHash: 'b'.repeat(64) }] }]) {
        globalThis.fetch = async () => Response.json({ ...value, ...change });
        await assert.rejects(getAcledPage(run, 'Synthetic country', 'Protests', 0), /identity/);
      }
      globalThis.fetch = async () => Response.json(run);
      assert.deepEqual(await getAcledRun(run.id), run);
      await assert.rejects(getAcledRun('other'), /contract/);
    } finally { globalThis.fetch = original; }
  });
});
