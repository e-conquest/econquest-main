import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareModeFromValue, withheldReason, withholdForSharing } from '../src/utils/shareMode.ts';
import { shareForSource } from '../src/utils/licenceLookup.ts';
import { FIGURES_HEADER, SERIES_HEADER } from '../src/utils/csvExport.ts';
import { References } from '../src/utils/citations.ts';

test('the switch is on only when saved as "1"', () => {
  assert.equal(shareModeFromValue('1'), true);
  assert.equal(shareModeFromValue('0'), false);
  assert.equal(shareModeFromValue(null), false);
});

test('free sharing follows the register: IMF, BIS and World Bank pass; restricted and unclear sources are held back', () => {
  assert.equal(withheldReason('IMF WEO, 2025'), null);
  assert.equal(withheldReason('BIS, 2026-10-27'), null);
  assert.equal(withheldReason('World Bank, 2024'), null);
  assert.match(withheldReason('ExchangeRate-API spot') ?? '', /^Withheld in sharing mode: do not pass on \(ExchangeRate-API/);
  assert.match(withheldReason('Kalshi odds') ?? '', /do not pass on/);
  assert.match(withheldReason('official, OECD via FRED, Sep 2026') ?? '', /sharing unclear/);
  // The app's own calculation, naming no outside source, passes.
  assert.equal(withheldReason('model, from figures above'), null);
});

test('a figure built from several sources takes the strictest sharing class', () => {
  assert.equal(shareForSource('model: IMF reserves over World Bank imports')?.share, 'allowed');
  assert.equal(shareForSource('IMF and FRED')?.share, 'unclear');
  assert.equal(shareForSource('FRED and Kalshi')?.share, 'restricted');
  assert.equal(shareForSource('estimate'), null);
});

test('figure rows keep source and say Withheld, with the reason; missing rows are untouched', () => {
  const at = (n: string) => FIGURES_HEADER.indexOf(n);
  const row = (value: number | null, source: string, status: string, reason = '') => {
    const r: (string | number | null)[] = FIGURES_HEADER.map(() => '');
    r[at('value')] = value;
    r[at('source')] = source;
    r[at('status')] = status;
    r[at('reason_if_missing')] = reason;
    return r;
  };
  const out = withholdForSharing(FIGURES_HEADER, [row(4.1, 'official, OECD via FRED', 'Live'), row(13.75, 'BIS, 2026-10-27', 'Live'), row(null, '', 'Missing', 'IMF did not answer')]);
  assert.equal(out[0][at('value')], null);
  assert.equal(out[0][at('status')], 'Withheld');
  assert.equal(out[0][at('source')], 'official, OECD via FRED');
  assert.match(String(out[0][at('reason_if_missing')]), /^Withheld in sharing mode: sharing unclear/);
  assert.equal(out[1][at('value')], 13.75);
  assert.equal(out[2][at('reason_if_missing')], 'IMF did not answer');
});

test('series rows without a status column read Withheld in the value cell', () => {
  const v = SERIES_HEADER.indexOf('value');
  const s = SERIES_HEADER.indexOf('source');
  const mk = (value: number, source: string) => SERIES_HEADER.map((h, i) => (i === v ? value : i === s ? source : h));
  const out = withholdForSharing(SERIES_HEADER, [mk(5.1, 'FRED'), mk(10.5, 'CFTC')]);
  assert.equal(out[0][v], 'Withheld');
  assert.equal(out[1][v], 10.5);
});

test('a table without value and source columns is returned as it is', () => {
  const rows = [['a', 1]];
  assert.equal(withholdForSharing(['x', 'y'], rows), rows);
});

test('references end with which ones cannot be passed on, and say nothing when all can', () => {
  const ok = new References();
  ok.cite('World Bank, 2024');
  ok.cite('IMF WEO, 2025');
  assert.equal(ok.lines('2026-11-06').length, 2);
  const mixed = new References();
  mixed.cite('World Bank, 2024');
  mixed.cite('official, OECD via FRED');
  mixed.cite('Kalshi');
  assert.match(mixed.lines('2026-11-06').at(-1) ?? '', /^Before sharing: \[2\], \[3\] come from sources whose terms do not let the figures be passed on/);
});
