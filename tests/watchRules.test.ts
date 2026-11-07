import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, metricValue, parseRule, parseRules, ruleText, type WatchRule } from '../src/utils/watchRules.ts';

const rule = (o: Partial<WatchRule>): WatchRule => ({ id: 'r', iso3: '*', metric: 'cftc_percentile', op: '>=', value: 90, createdAt: '2026-11-05', ...o });
const MEX = { iso3: 'MEX', countryName: 'Mexico', cftc: { percentile: 95 }, yield10YChange3mPts: 0.62, policyRatePct: 7, policyRateSource: 'bis' } as never;
const ZAF = { iso3: 'ZAF', countryName: 'South Africa', cftc: { percentile: 40 }, policyRatePct: 7, policyRateSource: 'ai_estimate' } as never;
const EGY = { iso3: 'EGY', countryName: 'Egypt' } as never;

test('rules cross on sourced figures only; a missing figure never triggers and is counted', () => {
  const { hits, noFigure } = evaluateRules([rule({}), rule({ id: 'y', iso3: 'MEX', metric: 'yield_3m_bps', value: 50 })], [MEX, ZAF, EGY]);
  assert.deepEqual(hits.map((h) => `${h.rule.id}:${h.iso3}`), ['r:MEX', 'y:MEX']);
  assert.match(hits[0].text, /^Mexico: CFTC positioning percentile \(3 years\) is 95th percentile \(your rule: at or above 90th percentile; CFTC TFF\)\.$/);
  assert.match(hits[1].text, /is 62 bps/);
  assert.deepEqual(noFigure.map((n) => n.iso3), ['EGY']);
  // A policy rate that is not from the BIS does not count.
  assert.equal(metricValue(ZAF, 'policy_rate'), undefined);
  assert.equal(metricValue(MEX, 'policy_rate'), 7);
});

test('at or below works; rule text reads in words', () => {
  const r = rule({ iso3: 'ZAF', op: '<=', value: 50 });
  assert.equal(evaluateRules([r], [ZAF]).hits.length, 1);
  assert.equal(ruleText(r, 'South Africa'), 'South Africa: CFTC positioning percentile (3 years) at or below 50th percentile');
  assert.equal(ruleText(rule({ metric: 'policy_rate', value: 10.5 })), 'Any country: Policy rate at or above 10.50%');
});

test('rules from the page are checked', () => {
  assert.equal(parseRule({ iso3: 'mex', metric: 'cftc_percentile', op: '>=', value: 1 }), null);
  assert.equal(parseRule({ iso3: 'MEX', metric: 'nope', op: '>=', value: 1 }), null);
  assert.equal(parseRule({ iso3: 'MEX', metric: 'cftc_percentile', op: '>', value: 1 }), null);
  assert.equal(parseRule({ iso3: 'MEX', metric: 'cftc_percentile', op: '>=', value: Number.NaN }), null);
  assert.equal(parseRules({ rules: [{ iso3: '*', metric: 'shock_alerts', op: '>=', value: 1 }] }).length, 1);
  assert.deepEqual(parseRules('x'), []);
});
