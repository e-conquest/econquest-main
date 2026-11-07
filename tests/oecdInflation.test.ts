/**
 * OECD monthly CPI inflation: read the OECD's y/y series by column name (or work it out from the
 * index), call the 3-month trend by the stated rule, use it as the app's inflation figure where
 * the OECD has one, and say why a country is missing. Figures are test fixtures, not real readings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpiFor, cpiMissing, cpiSentence, cpiTrend, cpiUrl, parseCpi } from '../src/utils/oecdInflation.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import { oecdCpiRows } from '../src/utils/marketsMacro.ts';
import { COLUMN_BY_ID } from '../src/utils/watchlistView.ts';
import { cpiTag } from '../src/utils/divergences.ts';
import { hasFigure } from '../src/utils/liveFigures.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const HEAD = 'STRUCTURE,STRUCTURE_ID,ACTION,REF_AREA,FREQ,METHODOLOGY,MEASURE,UNIT_MEASURE,EXPENDITURE,ADJUSTMENT,TRANSFORMATION,TIME_PERIOD,OBS_VALUE';
const row = (area: string, period: string, v: number | string, unit = 'PA', tr = 'GY', exp = '_T') =>
  `DATAFLOW,OECD.SDD.TPS:DSD_PRICES@DF_PRICES_ALL(1.0),I,${area},M,N,CPI,${unit},${exp},N,${tr},${period},${v}`;
const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
// Index only for Brazil: 12 months apart, 104 / 100 = +4.0%.
const braIndex = ['2025-06', '2025-09', '2026-06', '2026-09'].map((m, i) => row('BRA', m, [100, 100, 103.5, 104][i], 'IX', '_Z'));
const CSV = [
  HEAD,
  ...months.map((m, i) => row('TUR', m, (33 - i * 0.4).toFixed(1))),
  ...months.map((m, i) => row('EA20', m, (2.0 + i * 0.1).toFixed(1))),
  ...braIndex,
  // Food only: not headline, never read.
  ...months.map((m) => row('MEX', m, '9.9', 'PA', 'GY', 'CP01')),
].join('\n');

test('reads OECD y/y by column name; works it out from the index when only the index is there', () => {
  const s = parseCpi(CSV)!;
  assert.deepEqual(Object.keys(s).sort(), ['BRA', 'EA20', 'TUR']);
  const tur = cpiFor('TUR', s)!;
  assert.equal(tur.month, '2026-09');
  assert.equal(tur.yoyPct, 30.6);
  assert.equal(tur.change3mPts, -1.2);
  assert.equal(tur.trend, 'easing');
  assert.equal(tur.basis, 'oecd_yoy');
  const bra = cpiFor('BRA', s)!;
  assert.equal(bra.yoyPct, 4);
  assert.equal(bra.basis, 'from_index');
  assert.equal(bra.change3mPts, 0.5);
  assert.equal(cpiFor('EUU', s)!.yoyPct, 2.6);
  assert.equal(cpiFor('MEX', s), null);
  assert.match(cpiSentence(bra), /Inflation 4\.0% y\/y \(OECD via DBnomics, Sep 2026 \(y\/y worked out from the OECD CPI index\)\), \+0\.5 pts over 3 months: rising\./);
});

test('not SDMX-CSV, no series; the trend rule as stated; one call for every area', () => {
  assert.equal(parseCpi('<html/>'), null);
  assert.equal(cpiTrend(0.5), 'rising');
  assert.equal(cpiTrend(0.4), 'steady');
  assert.equal(cpiTrend(-0.5), 'easing');
  assert.equal(cpiMissing(true).short, 'OECD publishes no CPI');
  const u = new URL(cpiUrl());
  assert.equal(decodeURIComponent(u.pathname), '/v22/series/OECD/DSD_PRICES@DF_PRICES_ALL');
  assert.deepEqual(JSON.parse(u.searchParams.get('dimensions')!), { FREQ: ['M'], MEASURE: ['CPI'], EXPENDITURE: ['_T'], TRANSFORMATION: ['GY'] });
  assert.equal(JSON.parse(new URL(cpiUrl({ wide: true })).searchParams.get('dimensions')!).TRANSFORMATION, undefined);
});

const s = parseCpi(CSV)!;
const pulledAt = '2026-11-05T02:00:00Z';
const tur = cpiFor('TUR', s)!;
// As the server builds it: the OECD figure becomes the app's inflation figure.
const TUR = { iso3: 'TUR', countryName: 'Turkey', cpiInflationPct: tur.yoyPct, cpiSource: 'oecd', cpiMonth: tur.month, oecdCpi: { ...tur, pulledAt }, policyRatePct: 40, policyRateSource: 'bis' } as unknown as WatchlistItem;
const EGY = { iso3: 'EGY', countryName: 'Egypt', cpiInflationPct: 12, cpiSource: 'live', oecdCpiPulledAt: pulledAt } as WatchlistItem;

test('the OECD figure counts as live, says OECD with its month, and the watchlist note shows it', () => {
  assert.equal(hasFigure(TUR, 'cpi'), true);
  assert.deepEqual(cpiTag(TUR), { q: 'live', src: 'OECD monthly, Sep 2026' });
  assert.deepEqual(cpiTag(EGY), { q: 'live', src: 'IMF, live' });
  const col = COLUMN_BY_ID.cpi;
  assert.equal(col.text(TUR), '30.6%');
  assert.equal(col.note!(TUR), 'OECD, Sep 2026, easing');
  assert.equal(col.note!(EGY), 'Live, IMF');
});

test('Country tab: OECD rows with month and pull date, Missing with the reason', () => {
  const rows = oecdCpiRows(TUR);
  assert.equal(rows[0].value, '30.6%');
  assert.match(rows[0].source, /OECD via DBnomics, Sep 2026 \(pulled 2026-11-05\)/);
  assert.equal(rows.find((r) => r.label === 'Inflation trend')!.value, 'easing');
  const egy = oecdCpiRows(EGY);
  assert.equal(egy[0].value, 'Missing');
  assert.match(egy[0].help!, /publishes no monthly consumer price index/);
});

test('Central Bank Watcher: inflation from the OECD with its month, trend tagged as its own reading', () => {
  const q = 'Is inflation easing in Turkey?';
  const plan = planCouncil(q, [TUR]);
  assert.ok(plan.agents.some((a) => a.id === 'cb'));
  const cb = runCouncil(q, plan, [TUR]).find((a) => a.id === 'cb');
  // The policy rate counts as missing until a policy-rate feed is wired in, so the agent may say so.
  if (cb && cb.findings.length) {
    const f = cb.findings[0];
    assert.equal(f.figures.find((x) => x.label === 'CPI inflation')!.source, 'OECD monthly, Sep 2026');
    assert.equal(f.figures.find((x) => x.label === 'Inflation trend')!.tag, 'model');
    assert.match(f.reading, /Inflation 30\.6% y\/y \(OECD via DBnomics, Sep 2026\), -1\.2 pts over 3 months: easing\./);
  } else {
    assert.ok(cb!.missing.some((m) => /Turkey: missing policy rate/.test(m)));
    assert.ok(!cb!.missing.some((m) => /Turkey: missing inflation/.test(m)));
  }
});
