import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hamiltonCycle, hpTrend, logLevelFromGrowth, outputGapFromGrowth, outputGapSeries, outputGapSentence, realTimeOutputGap } from '../src/utils/outputGap';
import { markImfProjections } from '../src/utils/officialHistory';
import { countrySeries } from '../src/utils/seriesHistory';
import { taylorCheck, taylorMethod } from '../src/utils/taylorRule';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rec = path.join(root, 'tests', 'fixtures', 'recorded');

/** IMF real growth for a country from the recorded feed replies, as yearly points. */
function recordedGrowth(iso3: string) {
  const idx = JSON.parse(readFileSync(path.join(rec, 'index.json'), 'utf8'));
  const q = idx.requests.find((r: { url: string }) => r.url.endsWith(`/NGDP_RPCH/${iso3}`));
  const body = JSON.parse(gunzipSync(readFileSync(path.join(rec, 'bodies', q.body))).toString());
  return Object.entries(body.values.NGDP_RPCH[iso3] as Record<string, number>).map(([date, value]) => ({ date, value }));
}

test('HP trend: a straight line is its own trend; a large lambda flattens toward a line', () => {
  const line = [1, 2, 3, 4, 5, 6, 7];
  hpTrend(line, 100).forEach((v, i) => assert.ok(Math.abs(v - line[i]) < 1e-9));
  const zig = [0, 2, 0, 2, 0, 2, 0, 2, 0, 2];
  const t = hpTrend(zig, 1e6);
  // Mean is preserved by the HP filter.
  assert.ok(Math.abs(t.reduce((s, v) => s + v, 0) / t.length - 1) < 1e-6);
  // ...and its second differences vanish (the trend becomes a straight line).
  for (let i = 2; i < t.length; i++) assert.ok(Math.abs(t[i] - 2 * t[i - 1] + t[i - 2]) < 1e-3);
});

test('Hamilton cycle: none for the first two years, zero on a straight line', () => {
  const c = hamiltonCycle([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(c[0], undefined);
  assert.equal(c[1], undefined);
  c.slice(2).forEach((v) => assert.ok(Math.abs(v!) < 1e-9));
});

test('log level: a missing year breaks the chain instead of bridging it', () => {
  const lv = logLevelFromGrowth([{ date: '2000', value: 2 }, { date: '2001', value: 2 }, { date: '2003', value: 3 }, { date: '2004', value: 1 }]);
  assert.deepEqual(lv.map((p) => p.year), ['2003', '2004']);
});

test('too little history: Missing with the reason, never a number', () => {
  const r = outputGapFromGrowth([{ date: '2020', value: 1 }, { date: '2021', value: 2 }]);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /at least 15/);
  assert.equal(outputGapFromGrowth(undefined).ok, false);
});

test('recorded IMF growth: every country gets a reading inside its band, projections marked', { skip: existsSync(path.join(rec, 'index.json')) ? false : 'no recording' }, () => {
  const now = new Date('2026-11-05T00:00:00Z');
  for (const iso3 of ['BRA', 'GBR', 'TUR', 'JPN', 'EGY']) {
    const r = outputGapFromGrowth(markImfProjections(recordedGrowth(iso3), now));
    assert.ok(r.ok, iso3);
    if (!r.ok) continue;
    assert.equal(r.latest.projection, false, `${iso3} latest is an outturn`);
    assert.ok(Number(r.latest.year) < 2026);
    assert.ok(r.latest.low <= r.latest.central && r.latest.central <= r.latest.high, iso3);
    assert.ok(Math.abs(r.latest.central) < 15, `${iso3} reading is plausible`);
    // 2020 was a recession year in each of these but Egypt.
    const y2020 = r.years.find((g) => g.year === '2020')!;
    if (iso3 !== 'EGY') assert.ok(y2020.central! < -2, `${iso3} 2020 below potential`);
    assert.ok(r.years.some((g) => g.projection && g.hamilton === undefined), 'Hamilton has no projection years');
    assert.match(outputGapSentence(r), /not an official figure/);
    const s = outputGapSeries(r);
    assert.equal(s.id, 'output_gap');
    assert.ok(s.points.some((p) => p.note === 'IMF projection'));
  }
});

test('History: the app estimate fills output_gap only where the IMF has none, and says so', () => {
  const growth = Array.from({ length: 30 }, (_, i) => ({ date: String(1995 + i), value: 2 + Math.sin(i) }));
  const official = { iso3: 'XXX', pulledAt: '2026-11-01T00:00:00Z', series: { gdp_growth: { points: growth } } };
  const set = countrySeries('XXX', { official });
  const gap = set.series.find((s) => s.id === 'output_gap');
  assert.ok(gap);
  assert.match(gap!.source, /App estimate/);
  const withImf = countrySeries('XXX', { official: { ...official, series: { ...official.series, output_gap: { points: [{ date: '2024', value: -1 }] } } } });
  assert.match(withImf.series.find((s) => s.id === 'output_gap')!.source, /IMF World Economic Outlook/);
});

test('Taylor check names the app estimate as the output gap source', () => {
  const t = taylorCheck({ iso3: 'BRA', policyRatePct: 15, policyRateSource: 'bis', cpiInflationPct: 5, cpiSource: 'oecd', cpiMonth: '2026-09', outputGap: { pct: 1.1, year: '2025', source: 'estimate', low: 0.6, high: 2 } });
  assert.ok(t.ok);
  if (!t.ok) return;
  assert.equal(t.reading.outputGapSource, 'estimate');
  assert.equal(t.reading.withoutOutputGap, false);
  assert.match(taylorMethod(t.reading), /app estimate 2025, HP and Hamilton filters/);
});

test('real-time gap: each year uses only years up to it (adding later years never changes it)', () => {
  const growth = Array.from({ length: 30 }, (_, i) => ({ date: String(1990 + i), value: 2 + 2 * Math.sin(i / 2) }));
  const full = realTimeOutputGap(growth);
  const cut = realTimeOutputGap(growth.slice(0, 22));
  assert.equal(full[0].year, '2004');
  for (const g of cut) assert.deepEqual(full.find((f) => f.year === g.year), g);
  // Projections are never used.
  const withProj = realTimeOutputGap([...growth, { date: '2020', value: 9, note: 'IMF projection' }]);
  assert.equal(withProj.length, full.length);
});
