import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCitable, References, sourceUrl, withNoteReferences } from '../src/utils/citations.ts';

test('the same source keeps its number; publisher pages are matched on the source text', () => {
  const r = new References();
  assert.equal(r.cite('IMF WEO, 2025'), 1);
  assert.equal(r.cite('BIS, 2026-10-27 (Central Bank of Brazil)'), 2);
  assert.equal(r.cite('IMF WEO, 2025'), 1);
  assert.deepEqual(r.lines('2026-11-05T12:00:00Z'), [
    '[1] IMF WEO, 2025. https://www.imf.org/external/datamapper/ Read by the app on 2026-11-05. Licence: Permission needed for client or commercial use.',
    '[2] BIS, 2026-10-27 (Central Bank of Brazil). https://data.bis.org/topics/CBPOL Read by the app on 2026-11-05. Licence: Allowed with conditions.',
  ]);
  assert.equal(sourceUrl('CFTC Traders in Financial Futures'), 'https://publicreporting.cftc.gov/');
  assert.equal(sourceUrl('Your data, Bloomberg'), undefined);
});

test('rule readings, missing figures and empty sources are not references', () => {
  assert.equal(isCitable('model: policy rate minus inflation'), false);
  assert.equal(isCitable('IMF WEO', 'model'), false);
  assert.equal(isCitable('Missing: feed did not answer'), false);
  assert.equal(isCitable(''), false);
  assert.equal(isCitable('World Bank, 2024'), true);
});

test('notes: sourced rows get a marker and a References section; model and Missing rows keep their text', () => {
  const out = withNoteReferences(
    [
      { heading: 'Fiscal', lines: ['- Debt / GDP: 77.7% (IMF WEO, 2025)', '- Debt path: rising (model: IMF projection less 2025)', '- Reserves: Missing (World Bank did not answer)', 'Plain sentence.'] },
      { heading: 'External', lines: ['- Current account: -2.3% of GDP (World Bank, 2024)', '- Debt again: 77.7% (IMF WEO, 2025)'] },
    ],
    '2026-11-05T00:00:00Z'
  );
  assert.deepEqual(out[0].lines, ['- Debt / GDP: 77.7% [1]', '- Debt path: rising (model: IMF projection less 2025)', '- Reserves: Missing (World Bank did not answer)', 'Plain sentence.']);
  assert.deepEqual(out[1].lines, ['- Current account: -2.3% of GDP [2]', '- Debt again: 77.7% [1]']);
  assert.equal(out[2].heading, 'References');
  assert.equal(out[2].lines.length, 2);
  // Nothing to cite: no References section.
  assert.equal(withNoteReferences([{ heading: 'A', lines: ['- X: Missing (no source)'] }], '2026-11-05').length, 1);
});
