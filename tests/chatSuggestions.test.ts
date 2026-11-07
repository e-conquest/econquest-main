import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatSuggestions } from '../src/utils/chatSuggestions.ts';
import type { Holding } from '../src/utils/holdings.ts';
import type { LiveWatchlistItem } from '../src/types/council.ts';

const NOW = new Date('2026-11-06T12:00:00Z');
const EXAMPLES = ['Which central banks look behind the curve?', 'Who is most exposed to a Hormuz closure?', 'Whose government debt is on a rising path?', 'What is coming up in the next month?'];
const item = (iso3: string, countryName: string, extra: Partial<LiveWatchlistItem> = {}) => ({ iso3, countryName, currencyCode: '', region: '', focusTheme: '', ...extra }) as LiveWatchlistItem;
const hold = (iso3: string, assetClass: Holding['assetClass'], notionalUsdMm: number): Holding => ({ id: `${iso3}${assetClass}`, iso3, instrument: 'x', assetClass, side: 'LONG', notionalUsdMm });

test('nothing to go on: the fixed examples, as before', () => {
  const s = chatSuggestions({ holdings: [], items: [], recent: [], examples: EXAMPLES, now: NOW });
  assert.deepEqual(s.map((x) => x.text), EXAMPLES);
  assert.ok(s.every((x) => x.kind === 'example' && x.why === ''));
});

test('your largest holding is asked about the way its asset class is judged', () => {
  const items = [item('BRA', 'Brazil', { currencyCode: 'BRL' }), item('ZAF', 'South Africa', { currencyCode: 'ZAR' })];
  const bonds = chatSuggestions({ holdings: [hold('BRA', 'HC_BOND', 25), hold('ZAF', 'FX', 8)], items, recent: [], examples: EXAMPLES, now: NOW });
  assert.equal(bonds[0].kind, 'book');
  assert.equal(bonds[0].text, "Are Brazil's bonds cheap or rich against peers?");
  assert.match(bonds[0].why, /Brazil, \$25mm/);
  const fx = chatSuggestions({ holdings: [hold('ZAF', 'FX', 30), hold('BRA', 'LC_BOND', 10)], items, recent: [], examples: EXAMPLES, now: NOW });
  assert.equal(fx[0].text, 'Is the ZAR strong or weak for its history?');
  const lc = chatSuggestions({ holdings: [hold('BRA', 'LC_BOND', 10), hold('BRA', 'HC_BOND', 4)], items, recent: [], examples: EXAMPLES, now: NOW });
  assert.equal(lc[0].text, "Is Brazil's central bank behind the curve?");
});

test('watchlist: recent BIS rate move, big official yield change, rising debt path; old or unofficial ones ignored', () => {
  const items = [
    item('BRA', 'Brazil', { policyRateSource: 'bis', policyRateBank: 'Banco Central do Brasil', policyRateLastMove: { period: '2026-10-29', fromPct: 15, toPct: 14.5 } }),
    item('TUR', 'Turkey', { policyRateSource: 'bis', policyRateLastMove: { period: '2026-03-01', fromPct: 50, toPct: 40 } }),
    item('MEX', 'Mexico', { yield10YSource: 'official', yield10YChange3mPts: 0.8, yield10YPeriod: '2026-09' }),
    item('IDN', 'Indonesia', { yield10YSource: 'ai_estimate', yield10YChange3mPts: 3 } as Partial<LiveWatchlistItem>),
    item('EGY', 'Egypt', { isBenchmark: true, yield10YSource: 'official', yield10YChange3mPts: 5 }),
  ];
  const s = chatSuggestions({ holdings: [], items, recent: [], examples: EXAMPLES, now: NOW });
  const w = s.filter((x) => x.kind === 'watchlist');
  assert.equal(w.length, 2);
  assert.deepEqual(w.map((x) => x.text).sort(), ["Is Brazil's central bank behind the curve?", "What is driving Mexico's bond yields?"]);
  assert.match(w.find((x) => x.text.includes('Brazil'))!.why, /Banco Central do Brasil cut its rate from 15% to 14\.5% \(2026-10-29; BIS\)/);
  assert.match(w.find((x) => x.text.includes('Mexico'))!.why, /up 0\.8 points in three months \(to 2026-09\)/);
  assert.equal(s.length, 4, 'examples fill the row');
});

test('a rising debt path of five points or more is offered', () => {
  const items = [item('ZAF', 'South Africa', { debtSustainability: { year: '2025', debtNow: 76.4, base: { label: 'Baseline on IMF inputs', end: 88.2, year: '2031' }, method: 'x' } })];
  const s = chatSuggestions({ holdings: [], items, recent: [], examples: EXAMPLES, now: NOW });
  assert.equal(s[0].text, "Is South Africa's government debt on a rising path?");
  assert.match(s[0].why, /76% to 88% of GDP by 2031/);
});

test('your latest saved question comes back once, not duplicating an example', () => {
  const recent = [
    { question: 'Is Turkey running out of reserves?', askedAt: '2026-11-04T10:00:00Z' },
    { question: 'How is Chile doing?', askedAt: '2026-11-05T10:00:00Z' },
    { question: EXAMPLES[0], askedAt: '2026-11-06T10:00:00Z' },
  ];
  const s = chatSuggestions({ holdings: [], items: [], recent, examples: EXAMPLES, now: NOW });
  assert.equal(s[0].kind, 'recent');
  assert.equal(s[0].text, 'How is Chile doing?');
  assert.match(s[0].why, /2026-11-05; asking again shows what changed/);
  assert.equal(s.filter((x) => x.text === EXAMPLES[0]).length, 1);
  assert.equal(s.length, 4);
});
