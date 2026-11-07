/**
 * Geopolitical risk VaR (utils/grVar.ts): synthetic monthly series check the stress-month split,
 * the tail figures and the scenario hand-off. No real figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grVar, grVarSentence, percentile, tailStats } from '../src/utils/grVar.ts';
import type { GprTable } from '../src/utils/gprIndex.ts';
import type { ScenarioModel } from '../src/utils/scenarioEngine.ts';

const ym = (i: number) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

test('percentile and tail figures', () => {
  const xs = Array.from({ length: 101 }, (_, i) => i - 50); // -50..50
  assert.equal(percentile(xs, 95), 45);
  const t = tailStats(xs);
  assert.equal(t.var95, 45);
  assert.equal(t.es95, 47.5);
  assert.equal(t.mean, 0);
});

// 200 months; every 10th month is a GPR spike in which the currency falls 5% and the dollar rises 2%.
const N = 200;
const months = Array.from({ length: N }, (_, i) => ym(i));
const spike = (i: number) => i % 10 === 0;
const gpr: GprTable = {
  months,
  series: {
    GPR: months.map((_, i) => (spike(i) ? 300 : 100 + (i % 7))),
    GPRC_TUR: months.map((_, i) => (i < 50 ? null : spike(i) ? 2 : 0.5)),
  },
};
const fx = new Map(months.map((m, i) => [m, spike(i) ? 5 : ((i % 5) - 2) * 0.5]));
const dollar = new Map(months.map((m, i) => [m, spike(i) ? 2 : 0]));
const model: ScenarioModel = { response: 'fx', ok: true, factors: ['dollar'], beta: [1.5], se: [0.2], cov: [[0.04]], r2: 0.3, n: 180, from: months[0], to: months[N - 1], residualSd: 1, maxMove: [3] };

test('stress months are the top tenth of GPR; the currency tail is worse there; factors go through the model', () => {
  const g = grVar('TUR', fx, gpr, { dollar }, model);
  assert.ok(g.ok);
  if (!g.ok) return;
  const w = g.blocks.find((b) => b.basis === 'world')!;
  assert.equal(w.stress.months, 20);
  assert.equal(w.all.months, 200);
  assert.equal(w.stress.var95, 5);
  assert.ok(w.all.mean < w.stress.mean);
  assert.deepEqual(w.factorMoves, { dollar: 2 });
  assert.equal(w.scenario?.value, 3);
  assert.equal(w.recentStress[0], ym(190));
  // Country GPR covers 150 months with 15 spikes: too few stress months for its own block, and it says so.
  assert.equal(g.blocks.find((b) => b.basis === 'country'), undefined);
  assert.match(g.notes.join(), /Country GPR: only 15 stress months; needs 20/);
  assert.match(grVarSentence('Türkiye', g), /^Türkiye: in the 20 months of highest world geopolitical risk, the currency's 95% monthly VaR was 5% weaker/);
});

test('without a model there is no scenario line; too little overlap gives the reason', () => {
  const g = grVar('KEN', fx, gpr, { dollar }, null);
  assert.ok(g.ok && g.blocks.length === 1 && !g.blocks[0].scenario);
  const short = new Map([...fx].slice(0, 40));
  const s = grVar('KEN', short, gpr, {}, null);
  assert.ok(!s.ok);
  if (!s.ok) assert.match(s.reason, /only 40 months overlap/);
});
