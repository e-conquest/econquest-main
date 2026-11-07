import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isJump, openIssues, watchFigures, WATCHED_FIGURES, type FigureLedger } from '../src/utils/figureWatch.ts';
import { figureWatchFiles, readEvents, readLedger, saveWatch } from '../src/utils/figureWatchStore.ts';
import type { LiveWatchlistItem } from '../src/types/council.ts';

const row = (extra: Partial<LiveWatchlistItem>): LiveWatchlistItem => ({ iso3: 'BRA', countryName: 'Brazil', region: '', currencyCode: 'BRL', focusTheme: '', ...extra }) as LiveWatchlistItem;
const t = (iso: string) => new Date(iso);

test('first sight records the figures and raises nothing', () => {
  const { ledger, events } = watchFigures(null, [row({ policyRatePct: 13.75, policyRateDate: '2026-11-04', debtToGdpPct: 87 })], t('2026-11-06T06:00:00Z'));
  assert.deepEqual(events, []);
  assert.equal(ledger.figures['BRA:policy'].value, 13.75);
  assert.equal(ledger.figures['BRA:policy'].period, '2026-11-04');
});

test('a figure is Missing only when still gone 30 minutes later, and Back when it returns', () => {
  let l: FigureLedger = watchFigures(null, [row({ debtToGdpPct: 87 })], t('2026-11-06T06:00:00Z')).ledger;
  let r = watchFigures(l, [row({})], t('2026-11-06T06:04:00Z'));
  assert.deepEqual(r.events, [], 'a slow feed on a cold start is not an alert');
  r = watchFigures(r.ledger, [row({ debtToGdpPct: 87 })], t('2026-11-06T06:08:00Z'));
  assert.deepEqual(r.events, []);
  assert.equal(r.ledger.figures['BRA:debt'].missingSeenAt, undefined, 'the gap is forgotten once filled');

  r = watchFigures(r.ledger, [row({})], t('2026-11-06T07:00:00Z'));
  r = watchFigures(r.ledger, [row({})], t('2026-11-06T07:31:00Z'));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'missing');
  assert.match(r.events[0].detail, /Last seen 87 % of GDP/);
  assert.deepEqual(openIssues(r.ledger).map((o) => [o.figure, o.kind]), [['debt', 'missing']]);

  r = watchFigures(r.ledger, [row({})], t('2026-11-06T09:00:00Z'));
  assert.deepEqual(r.events, [], 'one alert per gap');
  l = r.ledger;
  r = watchFigures(l, [row({ debtToGdpPct: 88 })], t('2026-11-06T10:00:00Z'));
  assert.deepEqual(r.events.map((e) => e.kind), ['back']);
  assert.deepEqual(openIssues(r.ledger), []);
});

test('the same period with a new value is a revision; a new period is checked for a jump', () => {
  let r = watchFigures(null, [row({ cpiInflationPct: 4.8, cpiMonth: '2026-09' })], t('2026-11-01T06:00:00Z'));
  r = watchFigures(r.ledger, [row({ cpiInflationPct: 4.9, cpiMonth: '2026-09' })], t('2026-11-02T06:00:00Z'));
  assert.equal(r.events[0].kind, 'revised');
  assert.match(r.events[0].detail, /2026-09 revised from 4.8% to 4.9%/);
  r = watchFigures(r.ledger, [row({ cpiInflationPct: 5.2, cpiMonth: '2026-10' })], t('2026-11-15T06:00:00Z'));
  assert.deepEqual(r.events, [], 'a normal monthly move');
  r = watchFigures(r.ledger, [row({ cpiInflationPct: 52, cpiMonth: '2026-11' })], t('2026-12-15T06:00:00Z'));
  assert.equal(r.events[0].kind, 'jump', 'a tenfold move in a month (a units slip, most likely)');
});

test('policy rate jump and out of range use the stated thresholds', () => {
  const policy = WATCHED_FIGURES.find((f) => f.id === 'policy')!;
  assert.equal(isJump(policy, 13.75, 14.25), false);
  assert.equal(isJump(policy, 13.75, 19), true);
  const cpi = WATCHED_FIGURES.find((f) => f.id === 'cpi')!;
  assert.equal(isJump(cpi, 200, 230), false, 'high-inflation countries move by many points without halving or doubling');
  assert.equal(isJump(cpi, 2, 9), true);
  const reserves = WATCHED_FIGURES.find((f) => f.id === 'reserves_months')!;
  assert.equal(isJump(reserves, 10, 14), false);
  assert.equal(isJump(reserves, 10, 2), true);

  let r = watchFigures(null, [row({ yield10YPct: 13.1, yield10YPeriod: '2026-11-04' })], t('2026-11-05T06:00:00Z'));
  r = watchFigures(r.ledger, [row({ yield10YPct: 1310, yield10YPeriod: '2026-11-05' })], t('2026-11-06T06:00:00Z'));
  assert.deepEqual(r.events.map((e) => e.kind), ['out_of_range']);
  r = watchFigures(r.ledger, [row({ yield10YPct: 1310, yield10YPeriod: '2026-11-05' })], t('2026-11-06T07:00:00Z'));
  assert.deepEqual(r.events, [], 'said once, not at every rebuild');
});

test('a figure older than usual is flagged once, and cleared when a newer period comes', () => {
  let r = watchFigures(null, [row({ iso3: 'POL', countryName: 'Poland', cpiInflationPct: 3, cpiMonth: '2026-09', cpiSource: 'oecd' })], t('2026-11-06T06:00:00Z'));
  assert.deepEqual(r.events, []);
  r = watchFigures(r.ledger, [row({ iso3: 'POL', countryName: 'Poland', cpiInflationPct: 3, cpiMonth: '2026-09', cpiSource: 'oecd' })], t('2027-01-06T06:00:00Z'));
  assert.deepEqual(r.events.map((e) => e.kind), ['stale']);
  assert.match(r.events[0].detail, /4 months old \(usually 2 at most\)/);
  r = watchFigures(r.ledger, [row({ iso3: 'POL', countryName: 'Poland', cpiInflationPct: 3, cpiMonth: '2026-09', cpiSource: 'oecd' })], t('2027-01-07T06:00:00Z'));
  assert.deepEqual(r.events, []);
  assert.deepEqual(openIssues(r.ledger).map((o) => o.kind), ['stale']);
  r = watchFigures(r.ledger, [row({ iso3: 'POL', countryName: 'Poland', cpiInflationPct: 3.1, cpiMonth: '2026-12', cpiSource: 'oecd' })], t('2027-01-20T06:00:00Z'));
  assert.deepEqual(openIssues(r.ledger), []);
});

test('ledger and alerts are saved and read back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'econquest-watch-'));
  try {
    const files = figureWatchFiles(dir);
    assert.deepEqual(readLedger(files).figures, {});
    const a = watchFigures(null, [row({ policyRatePct: 13.75, policyRateDate: '2026-11-04' })], t('2026-11-05T06:00:00Z'));
    saveWatch(files, a.ledger, a.events);
    const b = watchFigures(readLedger(files), [row({ policyRatePct: 20, policyRateDate: '2026-11-05' })], t('2026-11-06T06:00:00Z'));
    saveWatch(files, b.ledger, b.events);
    assert.equal(readLedger(files).figures['BRA:policy'].value, 20);
    assert.deepEqual(readEvents(files).map((e) => e.kind), ['jump']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
