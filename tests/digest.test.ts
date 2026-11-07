import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, factsFor, visitFrom, YIELD_MOVE_PTS } from '../src/utils/digest.ts';

const NOW = new Date('2026-11-05T12:00:00Z');

const row = (over: Record<string, unknown> = {}) =>
  ({
    iso3: 'BRA',
    countryName: 'Brazil',
    policyRatePct: 13.75,
    policyRateSource: 'bis',
    policyRateDate: '2026-10-29',
    oecdCpi: { iso3: 'BRA', month: '2026-09', yoyPct: 4.4, basis: 'national', long: 'IBGE IPCA via BCB', pulledAt: '2026-11-01' },
    oecdCli: { iso3: 'BRA', month: '2026-05', level: 100.2, phase: 'expansion', pulledAt: '2026-11-01' },
    yield10YPct: 13.1,
    yield10YSource: 'official',
    yield10YPeriod: '2026-11-04',
    ...over,
  }) as any;

test('only live figures are recorded at a visit', () => {
  const f = factsFor(row({ policyRateSource: 'sample', yield10YSource: 'ai_estimate', oecdCpi: undefined, oecdCli: undefined }));
  assert.deepEqual(f, {});
  const live = factsFor(row());
  assert.deepEqual(live, { policyRatePct: 13.75, cpiMonth: '2026-09', cpiPct: 4.4, cliPhase: 'expansion', cliMonth: '2026-05', yield10YPct: 13.1 });
});

test('first visit: recent BIS policy moves only, within 30 days', () => {
  const it = row({
    policyRateMoves: [
      { period: '2026-10-29', fromPct: 14.25, toPct: 13.75 },
      { period: '2026-06-18', fromPct: 14.75, toPct: 14.25 },
    ],
  });
  const d = buildDigest([it], null, [], NOW);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'policy');
  assert.match(d[0].text, /cut its policy rate from 14\.25% to 13\.75%/);
  assert.equal(d[0].when, '2026-10-29');
});

test('since the last visit: new inflation print, cycle turn, 10Y move and new alert', () => {
  const last = {
    savedAt: '2026-10-20T09:00:00Z',
    rows: { BRA: { policyRatePct: 13.75, cpiMonth: '2026-08', cpiPct: 4.9, cliPhase: 'slowdown', cliMonth: '2026-04', yield10YPct: 13.6 } },
    alerts: ['old|BRA'],
  };
  const alerts = [
    { key: 'old|BRA', iso3: 'BRA', countryName: 'Brazil', text: 'still firing' },
    { key: 'new|BRA', iso3: 'BRA', countryName: 'Brazil', text: 'debt above 90%' },
  ];
  const d = buildDigest([row({ policyRateMoves: [{ period: '2026-10-29', fromPct: 14.25, toPct: 13.75 }] })], last, alerts, NOW);
  assert.deepEqual(
    d.map((x) => x.kind),
    ['inflation', 'cycle', 'yield', 'alert']
  );
  assert.match(d[0].text, /4\.9% to 4\.4% \(new print for 2026-09\)/);
  assert.match(d[1].text, /from slowdown to expansion/);
  assert.match(d[2].text, /down 50 bp to 13\.10%/);
  assert.match(d[3].text, /debt above 90%/);
});

test('an unchanged rate and small yield move list nothing', () => {
  const last = { savedAt: '2026-11-01T09:00:00Z', rows: { BRA: { policyRatePct: 13.75, cpiMonth: '2026-09', cpiPct: 4.4, cliPhase: 'expansion', yield10YPct: 13.1 + YIELD_MOVE_PTS / 2 } } };
  const d = buildDigest([row({ policyRateMoves: [{ period: '2026-11', fromPct: 14.25, toPct: 13.75 }] })], last, [], NOW);
  assert.deepEqual(d, []);
});

test('a rate change with no dated move falls back to comparing rates', () => {
  const last = { savedAt: '2026-10-01T09:00:00Z', rows: { BRA: { policyRatePct: 14.25 } } };
  const d = buildDigest([row()], last, [], NOW);
  assert.equal(d.filter((x) => x.kind === 'policy').length, 1);
  assert.match(d[0].text, /from 14\.25% to 13\.75%/);
});

test('visitFrom keeps each row and the firing alerts', () => {
  const v = visitFrom([row()], ['a|BRA'], NOW);
  assert.equal(v.savedAt, NOW.toISOString());
  assert.deepEqual(v.alerts, ['a|BRA']);
  assert.equal(v.rows.BRA.policyRatePct, 13.75);
});

test('an empty digest says Missing when no feed answered, and Nothing moved only with live figures', async () => {
  const { digestEmptyNote } = await import('../src/utils/digest.ts');
  assert.match(digestEmptyNote([], false), /^Missing: the watchlist has no countries/);
  assert.match(digestEmptyNote([{ dataMode: 'unverified' }, { dataMode: 'sample' }], false), /^Missing: no data feed has answered/);
  assert.equal(digestEmptyNote([{ dataMode: 'live' }, { dataMode: 'unverified' }], true), 'Nothing moved since then in the live figures (live figures for 1 of 2 countries).');
  assert.equal(digestEmptyNote([{ dataMode: 'partial' }], false), 'Nothing moved in the live figures.');
});
