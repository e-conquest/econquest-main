import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingAgent, timingSetup, timingSignals } from '../src/utils/timingAgent.ts';
import { gdeltToneShift, toneTurn } from '../src/utils/gdeltTone.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import { positioningFor, type CftcWeek } from '../src/utils/cftcPositioning.ts';

const NOW = new Date('2026-11-05T00:00:00Z');

const item = (o: Record<string, unknown> = {}) =>
  ({ iso3: 'MEX', countryName: 'Mexico', compositeRisk: 0.5, ...o }) as never;

test('GDELT: latest week against the earlier days of the same timeline', () => {
  const series = Array.from({ length: 35 }, (_, i) => ({ date: `2026${String(9 + Math.floor(i / 30)).padStart(2, '0')}${String((i % 30) + 1).padStart(2, '0')}T000000Z`, value: i < 28 ? -1 : -3 }));
  const s = gdeltToneShift(series)!;
  assert.equal(s.recent, -3);
  assert.equal(s.earlier, -1);
  assert.equal(s.shift, -2);
  assert.equal(s.earlierDays, 28);
  assert.equal(s.earlierFrom, '2026-09-01');
  assert.equal(toneTurn(s.shift), 'turning more negative');
  assert.equal(gdeltToneShift(series.slice(0, 20)), null); // too short for a baseline
  assert.equal(gdeltToneShift('nope'), null);
});

test('CFTC: 4-week change in leveraged-fund positioning', () => {
  const weeks: CftcWeek[] = Array.from({ length: 60 }, (_, i) => ({ date: `w${i}`, openInterest: 100, levNet: i < 56 ? 10 : 2, assetMgrNet: 0 }));
  const p = positioningFor('MEX', new Map([['095741', weeks]]));
  assert.equal(p!.levNetPctOiChange4w, -8);
});

test('crowded and turning, a recent CLI turn and a negative tone shift count as change underway', () => {
  const it = item({
    cftc: { iso3: 'MEX', ccy: 'MXN', market: 'x', reportDate: '2026-10-28', openInterest: 1, levNetContracts: 1, levNetPctOi: 30, levNetPctOiChange4w: -5, assetMgrNetPctOi: 0, percentile: 95, weeks: 156, pulledAt: 'x' },
    oecdCli: { iso3: 'MEX', month: '2026-05', level: 99.8, change1m: -0.2, phase: 'slowdown', phaseSince: '2026-04', monthsInPhase: 2, lastTurn: { month: '2026-03', kind: 'peak', level: 100.3 }, pulledAt: 'x' },
    gdelt: { pulledAt: '2026-11-01T00:00:00Z', tone: -3, toneShift: { recent: -3, earlier: -1.5, shift: -1.5, earlierDays: 80 } },
    tic: { iso3: 'MEX', month: '2026-08', holdingsUsdBn: 50, change12mPct: -12, pulledAt: 'x' },
  });
  const s = timingSignals(it, NOW);
  const pressing = s.signals.filter((x) => x.pressure).map((x) => x.key).sort();
  assert.deepEqual(pressing, ['cycle', 'flows', 'news', 'positioning']);
  assert.match(s.signals.find((x) => x.key === 'positioning')!.text, /crowded long the MXN \(95th percentile\) and have started to cut, −5\.0 pts/);
  const a = timingAgent([it], NOW);
  assert.equal(a.findings.length, 1);
  assert.match(a.findings[0].reading, /^4 signals point to change underway/);
  assert.match(a.findings[0].reading, /not a forecast\.$/);
  assert.ok(!/probab|\d+% chance|will (?:rise|fall)/i.test(a.findings[0].reading));
});

test('nothing pressing reads as no change underway; missing feeds are named', () => {
  assert.equal(timingSetup([{ key: 'policy', text: 'x', pressure: false }]), 'No signal points to a change underway.');
  assert.match(timingSetup([], 12), /next dated catalyst is 12 days away/);
  const s = timingSignals(item({ iso3: 'ZZZ', countryName: 'Nowhere' }), NOW);
  assert.ok(s.missing.some((m) => /no BIS policy-rate history/.test(m)));
  assert.ok(s.missing.some((m) => /no GDELT pull/.test(m)));
});

test('council: a "when" question about turns brings in the Timing Agent', () => {
  const it = item({ yield10YPct: 9, yield10YSource: 'official', yield10YPeriod: '2026-09', yield10YChange3mPts: 0.6 });
  const plan = planCouncil('When could the cycle turn in Mexico?', [it]);
  assert.ok(plan.agents.some((a) => a.id === 'timing'));
  const t = runCouncil('When could the cycle turn in Mexico?', plan, [it], NOW).find((a) => a.id === 'timing')!;
  assert.equal(t.name, 'Timing');
  assert.match(t.findings[0].reading, /10Y yield \+60 bps over 3 months to Sep 2026: a large move/);
});
