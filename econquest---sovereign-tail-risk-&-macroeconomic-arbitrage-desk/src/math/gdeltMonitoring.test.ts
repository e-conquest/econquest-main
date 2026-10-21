import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gdeltEvent, gdeltRun } from '../../tests/fixtures/gdelt';
import { checkGdeltContract, getGdeltPage, getGdeltRun, safeGdeltLink, startGdelt, validGdeltEvent, validGdeltSummary } from '../services/gdeltApi';

describe('GDELT lossless daily research contracts (synthetic)', () => {
  it('retains leading zeros, prior-year event dates, native country codes, zeros and unknown publication time', () => {
    assert.equal(validGdeltEvent(gdeltEvent()), true);
    for (const change of [{ eventCode: '10' }, { country: 'RU' }, { mentions: 1 }, { publishedAt: '2026-10-20' },
      { latitude: 0 }, { dateAdded: '2026-10-20T00:15:00Z' }, { sourceHash: 'bad' }, { sourceUrl: 'javascript:alert(1)' },
      { attributes: { ...gdeltEvent().attributes, EventCode: '10' } },
      { attributes: { ...gdeltEvent().attributes, MonthYear: '202610' } }]) {
      assert.equal(validGdeltEvent({ ...gdeltEvent(), ...change }), false);
    }
  });
  it('never renders unsafe schemes, credential links, whitespace or control characters', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://user:pass@example.com', 'https://example.com/\nfoo', 'https://example.com/a b']) {
      assert.equal(safeGdeltLink(value), false);
      assert.equal(validGdeltEvent({ ...gdeltEvent(), sourceUrl: value, sourceUrlSafe: false,
        attributes: { ...gdeltEvent().attributes, SOURCEURL: value } }), true);
    }
    assert.equal(safeGdeltLink('https://example.com/article'), true);
  });
  it('rejects incomplete days masquerading as staged and incompatible native intervals', () => {
    const run = gdeltRun(true);
    assert.equal(validGdeltSummary(run), true);
    assert.equal(validGdeltSummary(gdeltRun()), true);
    for (const change of [{ completedIntervals: 95 }, { transportComplete: false }, { errors: ['missing'] },
      { expectedIntervals: Array(96).fill('20261020000000') }]) {
      assert.equal(validGdeltSummary({ ...run, report: { ...run.report, ...change } }), false);
    }
  });
  it('blocks old backends before any pull and checks every saved interval in complete manifests', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = async input => { calls.push(String(input)); return new Response('', { status: 404 }); };
      await assert.rejects(checkGdeltContract(), /restart required/);
      await assert.rejects(startGdelt(), /restart required/);
      assert.equal(calls.some(c => c.endsWith('/pull')), false);
      const run = gdeltRun(true);
      globalThis.fetch = async () => Response.json(run);
      assert.deepEqual(await getGdeltRun(run.id), run);
      run.sources.pop();
      await assert.rejects(getGdeltRun(run.id), /contract/);
    } finally { globalThis.fetch = original; }
  });
  it('rejects wrong run/filter/page identities, duplicate IDs and mismatched row totals', async () => {
    const original = globalThis.fetch;
    const value = { rows: [gdeltEvent()], total: 1, offset: 0, limit: 100, runId: 'fixture', country: 'RS', root: '01' };
    try {
      globalThis.fetch = async () => Response.json(value);
      assert.deepEqual(await getGdeltPage('fixture', 'RS', '01', 0), value);
      for (const change of [{ runId: 'other' }, { country: 'RU' }, { root: '02' }, { offset: 1 }, { total: 2 },
        { rows: [gdeltEvent(), gdeltEvent()], total: 2 }]) {
        globalThis.fetch = async () => Response.json({ ...value, ...change });
        await assert.rejects(getGdeltPage('fixture', 'RS', '01', 0), /identity/);
      }
    } finally { globalThis.fetch = original; }
  });
});
