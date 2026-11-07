import test from 'node:test';
import assert from 'node:assert/strict';
import { localProjections, lpSentence, monthly } from '../src/utils/localProjections.ts';

const ym = (k: number) => `${2000 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;

// Random rate moves (seeded); inflation falls 0.5 points per rate point, 6 months later, plus small noise.
function data(n = 240) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rate: number[] = [];
  let r = 5;
  for (let k = 0; k < n; k++) {
    const u = rand();
    if (u < 0.15) r += 0.25;
    else if (u < 0.3) r -= 0.25;
    else if (u < 0.33) r += 1;
    rate.push(r);
  }
  const cpi = rate.map((_, k) => 4 - 0.5 * (k >= 6 ? rate[k - 6] - 5 : 0) + 0.05 * (rand() - 0.5));
  return {
    rate: rate.map((value, k) => ({ date: ym(k), value })),
    cpi: cpi.map((value, k) => ({ date: ym(k), value })),
  };
}

test('LP: recovers a delayed negative response with bands', () => {
  const { rate, cpi } = data();
  const r = localProjections(cpi, rate);
  assert.ok(r.ok);
  if (!r.ok) return;
  const h0 = r.steps.find((s) => s.h === 0)!;
  const h12 = r.steps.find((s) => s.h === 12)!;
  assert.ok(Math.abs(h0.beta) < 0.1, `no response on impact, got ${h0.beta}`);
  assert.ok(Math.abs(h12.beta + 0.5) < 0.1, `about -0.5 at 12 months, got ${h12.beta}`);
  assert.ok(h12.lo <= h12.beta && h12.beta <= h12.hi);
  assert.match(lpSentence(r, 'Testland'), /12 months after a 1-point policy rate rise/);
});

test('LP: Missing with a reason on short samples; daily points become month-ends', () => {
  const { rate, cpi } = data(40);
  const r = localProjections(cpi, rate);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /need 60/);
  const m = monthly([{ date: '2026-01-05', value: 1 }, { date: '2026-01-30', value: 2 }]);
  assert.equal(m.get('2026-01'), 2);
});
