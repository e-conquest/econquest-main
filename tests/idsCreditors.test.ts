import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsChinaUrl, idsCreditorSeries, idsCreditorsUrl, parseIdsCreditors } from '../src/utils/idsCreditors.ts';
import { countrySeries } from '../src/utils/seriesHistory.ts';

// Shaped like the World Bank sources API answers of 2026-11-07 (Zambia, 2024 values as served).
const row = (series: string, cp: string, year: number, value: number | null) => ({
  variable: [
    { concept: 'Country', id: 'ZMB' },
    { concept: 'Series', id: series },
    { concept: 'Counterpart-Area', id: cp },
    { concept: 'Time', id: `YR${year}` },
  ],
  value,
});
const WORLD = {
  source: [
    {
      data: [
        row('DT.DOD.MLAT.CD', 'WLD', 2024, 4588078960.8),
        row('DT.DOD.BLAT.CD', 'WLD', 2024, 4826358156.9),
        row('DT.DOD.PBND.CD', 'WLD', 2024, 2738545000),
        row('DT.DOD.PCBK.CD', 'WLD', 2024, 3026035802.2),
        row('DT.DOD.DPPG.CD', 'WLD', 2024, 15524167919.9),
        row('DT.DOD.DPPG.CD', 'WLD', 2023, 14000000000),
        row('DT.INR.OFFT', 'WLD', 2024, 3.6353),
        row('DT.INR.PRVT', 'WLD', 2024, 0),
        row('DT.MAT.OFFT', 'WLD', 2024, 25.0272),
        row('DT.MAT.PRVT', 'WLD', 2024, 0),
        row('DT.INR.PRVT', 'WLD', 2023, 7.5),
        row('DT.MAT.PRVT', 'WLD', 2023, 10),
        row('DT.CUR.USDL.ZS', 'WLD', 2024, 84.0135),
        row('DT.CUR.USDL.ZS', 'WLD', 2022, null),
      ],
    },
  ],
};
const CHINA = { source: [{ data: [row('DT.DOD.DPPG.CD', '730', 2024, 4000000000)] }] };

test('IDS creditor mix: shares of the PPG total, China, terms; zero private maturity means no point', () => {
  assert.match(idsCreditorsUrl('ZMB'), /sources\/6\/country\/ZMB\/series\/DT\.DOD\.MLAT\.CD;.*\/counterpart-area\/WLD\/time\/all/);
  assert.match(idsChinaUrl('ZMB'), /counterpart-area\/730\//);
  const c = parseIdsCreditors(WORLD, CHINA, '2026-11-07T15:00:00Z')!;
  const out = Object.fromEntries(idsCreditorSeries(c).map((s) => [s.id, s]));
  const v = (id: string, year: string) => ('points' in out[id] ? out[id].points.find((p) => p.date === year)?.value : undefined);
  assert.equal(v('ppg_external_usd', '2024'), 15.52);
  assert.equal(v('ppg_multilateral_share', '2024'), 29.6);
  assert.equal(v('ppg_bilateral_share', '2024'), 31.1);
  assert.equal(v('ppg_bonds_share', '2024'), 17.6);
  assert.equal(v('ppg_banks_share', '2024'), 19.5);
  assert.equal(v('ppg_china_share', '2024'), 25.8);
  assert.equal(v('ppg_usd_share', '2024'), 84.01);
  assert.equal(v('new_loans_rate_official', '2024'), 3.64);
  assert.equal(v('new_loans_maturity_official', '2024'), 25.03);
  assert.equal(v('new_loans_rate_private', '2024'), undefined);
  assert.equal(v('new_loans_maturity_private', '2024'), undefined);
  assert.equal(v('new_loans_rate_private', '2023'), 7.5);
  assert.ok('points' in out.ppg_external_usd && out.ppg_external_usd.freq === 'annual' && out.ppg_external_usd.points[0].date === '2023');
  // Without the China answer that share is Missing; the rest stand.
  const noChina = idsCreditorSeries(parseIdsCreditors(WORLD, null, 'x'));
  assert.ok(noChina.some((s) => s.id === 'ppg_china_share' && 'reason' in s));
  assert.equal(parseIdsCreditors('nonsense', null, 'x'), null);
  assert.ok(idsCreditorSeries(null).every((s) => 'reason' in s && /not answered yet/.test(s.reason)));
  const empty = idsCreditorSeries(parseIdsCreditors({ source: [{ data: [] }] }, null, 'x'));
  assert.ok(empty.every((s) => 'reason' in s && /low- and middle-income countries only/.test(s.reason)));
});

test('country series include the creditor mix', () => {
  const set = countrySeries('ZMB', { idsCreditors: parseIdsCreditors(WORLD, CHINA, '2026-11-07T15:00:00Z') });
  assert.ok(set.series.some((s) => s.id === 'ppg_china_share' && s.source === 'World Bank International Debt Statistics'));
});
