import { test } from 'node:test';
import assert from 'node:assert/strict';
import { politicsFromSnapshot, stabilityBand, toneBand } from '../src/utils/politicsEvents.ts';
import { councilInputs } from '../src/utils/councilInputs.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import type { OpenDataSnapshot, WatchlistItem } from '../src/types/council.ts';

const snap = (o: Partial<OpenDataSnapshot> = {}): OpenDataSnapshot =>
  ({
    iso3: 'BRA',
    countryName: 'Brazil',
    currencyCode: 'BRL',
    gdeltMetrics: { averageTone: -2.4, conflictIntensityIndex: 60, articleCount24h: 0, topHeadlines: [{ title: 'Brazil congress passes budget', sourceDomain: 'reuters.com', publishedAt: '2026-11-01T10:00:00Z', toneScore: -1, url: 'https://x' }] },
    worldBankIndicators: { politicalStabilityPercentile: 31.6 },
    polymarketContracts: [
      { id: '1', question: 'Will Lula win the 2026 Brazil election?', probabilityPct: 54, volumeUsd: 2_300_000, category: 'Brazil Event', url: 'https://polymarket.com/event/a' },
      { id: '2', question: 'Fed cut in December?', probabilityPct: 70, volumeUsd: 9e6, category: 'Global Macro / Geopolitics', url: 'https://polymarket.com/event/b' },
    ],
    liveFields: {
      'gdelt.averageTone': 'GDELT, pulled 2026-11-02',
      'gdelt.topHeadlines': 'GDELT, pulled 2026-11-02',
      'wb.politicalStabilityPercentile': 'World Bank WGI, 2024',
      'polymarket.contracts': 'Polymarket, pulled 2026-11-05',
    },
    ...o,
  }) as unknown as OpenDataSnapshot;

test('politics figures: live only, each with its date; only contracts that name the country', () => {
  const p = politicsFromSnapshot(snap())!;
  assert.deepEqual(p.tone, { value: -2.4, pulledAt: '2026-11-02' });
  assert.deepEqual(p.stability, { percentile: 31.6, year: '2024' });
  assert.deepEqual(p.markets?.map((m) => m.question), ['Will Lula win the 2026 Brazil election?']);
  assert.equal(p.headlines?.[0].source, 'reuters.com');
  // The built-in example headlines and contracts (no live marker) never count.
  assert.equal(politicsFromSnapshot(snap({ liveFields: {} })), undefined);
});

test('the full council gets Polymarket only when the feed answered', () => {
  assert.ok(councilInputs(snap()).lines.some((l) => /Polymarket key contract: "Will Lula win.*54% odds, Polymarket, pulled 2026-11-05/.test(l)));
  assert.ok(councilInputs(snap({ liveFields: {} })).lines.some((l) => /Polymarket key contract: MISSING/.test(l)));
});

test('stated bands', () => {
  assert.equal(toneBand(-5), 'very negative');
  assert.equal(toneBand(-2.4), 'negative');
  assert.equal(toneBand(0), 'mixed');
  assert.equal(toneBand(1.5), 'positive');
  assert.equal(stabilityBand(10), 'low');
  assert.equal(stabilityBand(31.6), 'below the middle');
  assert.equal(stabilityBand(80), 'high');
});

test('Politics & Events Agent answers political questions from sourced figures', () => {
  const row = { iso3: 'BRA', countryName: 'Brazil', politics: politicsFromSnapshot(snap()) } as unknown as WatchlistItem;
  const q = 'What are the election odds and the news tone in Brazil?';
  const plan = planCouncil(q, [row]);
  assert.deepEqual(plan.agents.map((a) => a.id), ['politics', 'calendar']); // elections are dated on the calendar too
  // "price stability" is the central bank's, not politics.
  assert.ok(!planCouncil('Is price stability at risk with inflation this high?', [row]).agents.some((a) => a.id === 'politics'));
  const a = runCouncil(q, plan, [row]).find((x) => x.id === 'politics')!;
  const f = a.findings[0];
  assert.match(f.reading, /News coverage is negative in tone\. Political stability ranks below the middle among countries\. Prediction markets price one contract that names the country\./);
  const by = (l: string) => f.figures.find((g) => g.label.startsWith(l))!;
  assert.equal(by('News tone').source, 'GDELT news tone, pulled 2026-11-02');
  assert.equal(by('Prediction market').value, '54% yes ($2.3m traded)');
  assert.equal(by('Political stability rank').tag, 'official');
  const bare = [{ iso3: 'BRA', countryName: 'Brazil' } as WatchlistItem];
  const none = runCouncil(q, planCouncil(q, bare), bare).find((x) => x.id === 'politics')!;
  assert.match(none.missing[0], /no news tone, stability rank or prediction-market odds/);
});
