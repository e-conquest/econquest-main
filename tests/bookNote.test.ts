import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookView,
  buildBookSections,
  buildClientReviewSections,
  BOOK_SECTIONS,
  CLIENT_REVIEW_SECTIONS,
  clientBrief,
  effectiveNames,
  pmBookBrief,
} from '../src/utils/bookNote.ts';
import { SOVEREIGN_CATALOG } from '../src/data/presetsAndBaselines.ts';
import type { Holding } from '../src/utils/holdings.ts';
import type { WatchlistItem } from '../src/types/council.ts';
import { withTestFigures } from './helpers/testRows.ts';

const NOW = new Date('2026-11-04T12:00:00Z');
const cat = (iso: string) => SOVEREIGN_CATALOG.find((c) => c.iso3 === iso)!;
/** The catalogue as if every CDS were your own. */
const LIVE: WatchlistItem[] = withTestFigures(SOVEREIGN_CATALOG).map((c) => ({ ...c, cds5YSource: 'own', cds5YProvider: 'CSV', cds5YDate: '2026-11-03' }));
const h = (iso3: string, notional: number, extra: Partial<Holding> = {}): Holding => ({
  id: `${iso3}-${notional}`,
  iso3,
  instrument: `${iso3} 2035`,
  assetClass: 'HC_BOND',
  side: 'LONG',
  notionalUsdMm: notional,
  durationYears: 7,
  ...extra,
});

test('effective number of countries: equal weights give the count', () => {
  const v = bookView([], SOVEREIGN_CATALOG, SOVEREIGN_CATALOG.slice(0, 4));
  assert.equal(effectiveNames(v.lines).toFixed(6), '4.000000');
  assert.equal(v.fromHoldings, false);
});

test('a concentrated book is called concentrated, with its DV01 cost of a 10 bp move', () => {
  const v = bookView([h('EGY', 60), h('MEX', 20), h('ZAF', 20)], LIVE, []);
  const b = pmBookBrief(v, [], NOW);
  assert.match(b.judgements[0], /^Concentrated: Egypt .* 60% of the book/);
  // DV01 = 100mm x 7y x 100 / 1000 = $70k per bp, so 10 bp = $0.7mm.
  assert.ok(b.judgements.some((j) => /10 bp widening .* \$0\.7mm/.test(j)));
  assert.ok(b.judgements.some((j) => /60% of the book is in countries with 5Y CDS at 400 bps or wider/.test(j)));
});

test('the brief never shows a holdings figure as verified, and official events are dated', () => {
  const v = bookView([h('BRA', 50), h('MEX', 50)], SOVEREIGN_CATALOG, []);
  const b = pmBookBrief(v, [], NOW);
  const book = b.groups.find((g) => g.title === 'The book')!;
  assert.ok(book.rows.every((r) => !r.verified));
  const events = b.groups.find((g) => g.title === 'Next 30 days')!;
  assert.ok(events.rows.length > 0 && events.rows.every((r) => r.verified && /Nov 2026/.test(r.value)));
});

test('portfolio review: every section, in order, and the figures list covers each country', () => {
  const v = bookView([h('BRA', 50), h('TUR', 30), h('POL', 20)], LIVE, []);
  const s = buildBookSections(v, [], () => true, NOW);
  assert.deepEqual(s.map((x) => x.id), Object.keys(BOOK_SECTIONS));
  const figs = s.find((x) => x.id === 'figures')!;
  assert.equal(figs.lines.length, 3);
  assert.ok(figs.lines.every((l) => /5Y CDS \d+ bps/.test(l) && !/risk score/i.test(l)));
  assert.equal(buildBookSections(v, [], (id) => id !== 'trades', NOW).some((x) => x.id === 'trades'), false);
});

test('client review is plain language: no bps, DV01, scores or trade levels', () => {
  const v = bookView([h('EGY', 40), h('CHL', 60)], LIVE, []);
  const text = JSON.stringify(buildClientReviewSections(v, () => true, NOW));
  assert.doesNotMatch(text, /bps|DV01|risk score|0\.\d\d|conviction|stop/i);
  assert.match(text, /Egypt[^"]*: markets already price a real chance of difficulty/);
  assert.doesNotMatch(text, /higher risk|lower risk|moderate risk/);
  assert.deepEqual(buildClientReviewSections(v, () => true, NOW).map((x) => x.id), Object.keys(CLIENT_REVIEW_SECTIONS));
  const brief = clientBrief(v, NOW);
  assert.match(brief.headline, /The client’s portfolio: 2 countries\./);
});

test('without holdings the client review says it is a draft from the watchlist', () => {
  const v = bookView([], SOVEREIGN_CATALOG, [cat('BRA'), cat('MEX')]);
  const holdings = buildClientReviewSections(v, () => true, NOW).find((x) => x.id === 'holdings')!;
  assert.ok(holdings.lines.some((l) => /import the client’s holdings/.test(l)));
});

test('no built-in figures: without live sources the book names what is missing and fills nothing in', () => {
  // The catalogue's own numbers have no live source, so none of them may appear.
  const v = bookView([h('EGY', 60), h('MEX', 40)], SOVEREIGN_CATALOG, []);
  const b = pmBookBrief(v, [], NOW);
  assert.match(b.headline, /Largest positions: Egypt[^;]* 60%; Mexico 40%/);
  assert.ok(!b.judgements.some((j) => /CDS at 400/.test(j)), 'no stress reading without CDS');
  const book = b.groups.find((g) => g.title === 'The book')!;
  for (const label of ['Weighted 5Y CDS', 'Weighted 10Y yield']) {
    const r = book.rows.find((x) => x.label === label)!;
    assert.equal(r.value, 'Missing', label);
    assert.ok(r.help, `${label} says how to fill it`);
  }
  assert.ok(!book.rows.some((x) => /risk score/i.test(x.label)));
  const figs = buildBookSections(v, [], (id) => id === 'figures', NOW)[0];
  assert.ok(figs.lines.every((l) => /5Y CDS: Missing/.test(l)));
  const client = clientBrief(v, NOW);
  assert.match(client.headline, /2 countries\./);
  assert.ok(!JSON.stringify(client).includes('higher risk'));
});
