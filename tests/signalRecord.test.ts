import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliTurnToPolicyRecord, crowdingUnwindRecord, recordText } from '../src/utils/signalRecord.ts';
import { cliTurns } from '../src/utils/oecdCli.ts';
import { signalRecordRows } from '../src/utils/marketsMacro.ts';
import type { CftcWeek } from '../src/utils/cftcPositioning.ts';

const series = (vals: number[], end: string) => {
  const [y, m] = end.split('-').map(Number);
  return vals.map((value, i) => ({ period: new Date(Date.UTC(y, m - vals.length + i, 1)).toISOString().slice(0, 7), value }));
};

test('CLI: every confirmed turn in the run, oldest first', () => {
  // up, up, up (peak), down, down, down (trough), up, up
  const t = cliTurns(series([100, 100.2, 100.4, 100.6, 100.4, 100.2, 100, 100.2, 100.4], '2026-06'));
  assert.deepEqual(t.map((x) => `${x.kind}@${x.month}`), ['peak@2026-01', 'trough@2026-04']);
});

test('turn -> policy record: matching move within 6 months, only turns with 6 months of BIS after them', () => {
  const turns = [
    { month: '2025-01', kind: 'peak' as const, level: 100.5 },
    { month: '2025-08', kind: 'trough' as const, level: 99.2 },
    { month: '2026-08', kind: 'peak' as const, level: 100.3 }, // too recent to test
  ];
  const moves = [
    { period: '2025-04', fromPct: 10, toPct: 9.5 }, // cut after the peak: followed
    { period: '2025-10', fromPct: 9.5, toPct: 9 }, // cut after the trough: not a hike
  ];
  const r = cliTurnToPolicyRecord(turns, moves, '2024-10', '2026-10')!;
  assert.equal(r.tested, 2);
  assert.equal(r.followed, 1);
  assert.deepEqual(r.cases.map((c) => c.followed), [true, false]);
  assert.match(recordText(r, 'x'), /^Followed 1 of 2 times \(x\); too few cases to lean on\.$/);
  assert.equal(cliTurnToPolicyRecord([], moves, '2024-10', '2026-10'), null);
  assert.equal(cliTurnToPolicyRecord(turns, undefined, undefined, undefined), null);
});

test('crowding record: entries into the top or bottom 10% and whether they came back 3 pts within 8 weeks', () => {
  const vals: number[] = [];
  for (let i = 0; i < 100; i++) vals.push(Math.sin(i / 6) * 10); // swings between about -10 and +10 of open interest
  const weeks: CftcWeek[] = vals.map((v, i) => ({ date: `2025-w${String(i).padStart(3, '0')}`, openInterest: 100, levNet: v, assetMgrNet: 0 }));
  const r = crowdingUnwindRecord(weeks)!;
  assert.ok(r.tested >= 4);
  assert.equal(r.followed, r.tested); // a smooth swing always comes back
  assert.equal(crowdingUnwindRecord(weeks.slice(0, 30)), null); // under a year of weeks
});

test('Country tab rows say how often, over what span, and name missing history', () => {
  const rows = signalRecordRows({
    iso3: 'MEX',
    signalRecord: { cliTurnToPolicy: { tested: 6, followed: 4, from: '2024-10', to: '2026-10', cases: [{ when: '2025-01', what: 'x', followed: true }] } },
  } as never);
  assert.match(rows[0].value, /^Followed 4 of 6 times \(Oct 2024 to Oct 2026\)\.$/);
  assert.match(rows[0].source, /Jan 2025 yes/);
  assert.equal(rows[1].label, 'Crowded positioning, then an unwind');
  assert.match(rows[1].help!, /Needs a CFTC currency future/);
});
