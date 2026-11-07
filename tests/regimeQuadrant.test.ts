import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadrantFor, regimeFor, regimeMap } from '../src/utils/regimeQuadrant.ts';

const cli = (change6m?: number) => ({ iso3: 'X', month: '2026-05', level: 100.5, ...(change6m !== undefined ? { change6m } : {}) }) as any;
const cpi = (change3mPts?: number) => ({ iso3: 'X', month: '2026-09', yoyPct: 4, basis: 'oecd_yoy', ...(change3mPts !== undefined ? { change3mPts } : {}) }) as any;

test('quadrants: above zero is up, zero or below is down', () => {
  assert.equal(quadrantFor(0.4, 0.2), 'growth up, inflation up');
  assert.equal(quadrantFor(0.4, -0.2), 'growth up, inflation down');
  assert.equal(quadrantFor(-0.1, 0.3), 'growth down, inflation up');
  assert.equal(quadrantFor(0, 0), 'growth down, inflation down');
});

test('a country is placed only with both live figures; otherwise it says what is missing', () => {
  const ok = regimeFor({ iso3: 'BRA', countryName: 'Brazil', oecdCli: cli(0.6), oecdCpi: cpi(-0.3) });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual([ok.point.growthPts, ok.point.inflationPts, ok.point.quadrant, ok.point.cliMonth, ok.point.cpiMonth], [0.6, -0.3, 'growth up, inflation down', '2026-05', '2026-09']);
  const noCli = regimeFor({ iso3: 'EGY', countryName: 'Egypt', oecdCpi: cpi(0.2) });
  assert.deepEqual(noCli.ok ? [] : noCli.missing, ['a 6-month change in the OECD leading indicator']);
  const none = regimeFor({ iso3: 'TUR', countryName: 'Turkey', oecdCli: cli(undefined), oecdCpi: cpi(undefined) });
  assert.equal(none.ok ? 0 : none.missing.length, 2);
  const map = regimeMap([{ iso3: 'BRA', countryName: 'Brazil', oecdCli: cli(0.6), oecdCpi: cpi(-0.3) }, { iso3: 'EGY', countryName: 'Egypt' }]);
  assert.deepEqual([map.points.length, map.missing.length], [1, 1]);
});
