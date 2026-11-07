import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countrySeries } from '../src/utils/seriesHistory';
import { activityMissing, bcbSgsSinceUrl, eurostatIpUrl, parseEurostatIp, parseIbcBr } from '../src/utils/monthlyActivity';

test('IBC-Br: SGS rows into a monthly series, blanks left out', () => {
  const s = parseIbcBr([{ data: '01/07/2026', valor: '150.12' }, { data: '01/08/2026', valor: '' }, { data: '01/09/2026', valor: '151,40' }])!;
  assert.deepEqual(s.points, [{ period: '2026-07', value: 150.12 }, { period: '2026-09', value: 151.4 }]);
  assert.equal(parseIbcBr([]), null);
  assert.match(bcbSgsSinceUrl(24364), /sgs\.24364\/dados\?formato=json&dataInicial=01%2F01%2F2003/);
});

test('Eurostat industrial production: JSON-stat by geo into ISO3 series', () => {
  const json = {
    id: ['freq', 'indic_bt', 'nace_r2', 's_adj', 'unit', 'geo', 'time'],
    size: [1, 1, 1, 1, 1, 2, 3],
    dimension: { geo: { category: { index: { PL: 0, TR: 1 } } }, time: { category: { index: { '2026-06': 0, '2026-07': 1, '2026-08': 2 } } } },
    value: { '0': 110.1, '1': 111.2, '2': 112.3, '4': 120.5 },
  };
  const s = parseEurostatIp(json, ['POL', 'TUR', 'HUN']);
  assert.deepEqual(s.POL.points.map((p) => p.value), [110.1, 111.2, 112.3]);
  assert.deepEqual(s.TUR.points, [{ period: '2026-07', value: 120.5 }]);
  assert.equal(s.HUN, undefined);
  assert.match(eurostatIpUrl(['PL']), /sts_inpr_m\?.*nace_r2=B-D&s_adj=SCA&unit=I21&geo=PL/);
});

test('history: activity series where a source exists, Missing with the reason otherwise', () => {
  const activity = { pulledAt: '2026-11-06T00:00:00Z', series: { BRA: parseIbcBr([{ data: '01/09/2026', valor: '151.4' }])! } };
  const s = countrySeries('BRA', { activity }).series.find((x) => x.id === 'activity_monthly')!;
  assert.equal(s.label, 'Activity index, monthly (BCB IBC-Br)');
  assert.match(countrySeries('MEX', { activity }).missing.find((x) => x.id === 'activity_monthly')!.reason, /No free, timely monthly activity index/);
  assert.match(activityMissing('POL', false), /Eurostat has not answered/);
});
