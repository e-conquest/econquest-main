import test from 'node:test';
import assert from 'node:assert/strict';
import { eventPath, eventSentence, eventStudy, rateEvents } from '../src/utils/eventStudy.ts';

const day = (k: number) => new Date(Date.UTC(2010, 0, 1) + k * 86400000).toISOString().slice(0, 10);

test('rate events: changes only, close repeats dropped', () => {
  const pts = Array.from({ length: 100 }, (_, k) => ({ period: day(k), pct: k < 20 ? 5 : k < 25 ? 5.25 : k < 60 ? 5.5 : 5 }));
  const ev = rateEvents(pts, 10);
  assert.deepEqual(ev.map((e) => [e.date, e.change]), [[day(20), 0.25], [day(60), -0.5]], 'the change on day 25 is within 10 days of day 20');
});

test('event path: day 0 is the first FX day on or after the event, measured from the day before', () => {
  const days = Array.from({ length: 50 }, (_, k) => day(k));
  const val = new Map(days.map((d, k) => [d, k < 20 ? 10 : 11]));
  const p = eventPath(days, val, day(20), 2, 3)!;
  assert.equal(p.length, 6);
  assert.equal(p[1], 0, 'day -1 is the base');
  assert.ok(Math.abs(p[2] - 100 * Math.log(1.1)) < 1e-9, 'day 0 carries the jump');
  assert.equal(eventPath(days, val, day(48), 2, 3), null, 'window runs past the data');
});

test('event study: hikes strengthen this currency by 1% on the day; too few cuts are Missing', () => {
  const N = 2000;
  const policy: Array<{ period: string; pct: number }> = [];
  let rate = 2;
  const hikeDays = new Set(Array.from({ length: 8 }, (_, k) => 100 + k * 200));
  const fx: Array<{ date: string; value: number }> = [];
  let s = 10;
  for (let k = 0; k < N; k++) {
    if (hikeDays.has(k)) {
      rate += 0.25;
      s *= 0.99;
    }
    policy.push({ period: day(k), pct: rate });
    fx.push({ date: day(k), value: s });
  }
  const st = eventStudy('own', policy, fx, { resamples: 200 });
  const h = st.groups.find((g) => g.kind === 'hike')!;
  assert.equal(h.ok, true);
  assert.equal(h.n, 8);
  assert.ok(Math.abs(h.dayZero! - 100 * Math.log(0.99)) < 0.01);
  const c = st.groups.find((g) => g.kind === 'cut')!;
  assert.equal(c.ok, false);
  assert.match(c.reason!, /0 cuts.*needs 5/);
  assert.match(eventSentence('Testland', st), /after 8 hikes the currency was on average 1\.0% stronger/);
});
