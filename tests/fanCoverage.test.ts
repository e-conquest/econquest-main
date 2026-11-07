import test from 'node:test';
import assert from 'node:assert/strict';
import { dsaInputsFromEdition, fanCoverageCases, judgeFanCoverage, latestOutturns, originEditions, type FanCase, type FanCoverageSpec } from '../src/utils/fanCoverage.ts';
import type { WeoEdition, WeoVintageStore } from '../src/utils/weoVintages.ts';

const spec = (over: Partial<FanCoverageSpec['passMark']> = {}): FanCoverageSpec => ({
  id: 'debt_fan_coverage',
  version: 1,
  target: 'debt_fan_coverage',
  params: { originMonth: 10, fallbackMonth: 9, horizons: 5, resamples: 500, seed: 7 },
  sample: { from: '2005' },
  passMark: { minCoverage: 0.7, maxCoverage: 0.9, maxPValue: 0.1, minCasesPerHorizon: 20, minYears: 4, ...over },
});

// One country with steady figures plus a deterministic wobble, so every edition can run the fan.
const wobble = (y: number) => Math.sin(y * 1.7);
function edition(vintage: string): WeoEdition {
  const vy = Number(vintage.slice(0, 4));
  const years = (f: (y: number) => number) => Object.fromEntries(Array.from({ length: vy + 6 - 1980 }, (_, k) => 1980 + k).map((y) => [String(y), Number(f(y).toFixed(2))]));
  const est = vy - 2;
  return {
    vintage,
    publishedBy: `${vintage}-28`,
    file: `WEO${vintage}.xls`,
    rows: {
      AAA: {
        GGXWDG_NGDP: { estimatesAfter: est, years: years((y) => 50 + (y - 1980) * 0.3 + wobble(y)) },
        GGXONLB_NGDP: { estimatesAfter: est, years: years((y) => 0.5 + wobble(y + 1)) },
        GGXCNL_NGDP: { estimatesAfter: est, years: years((y) => -1.5 + wobble(y + 1)) },
        NGDP_RPCH: { estimatesAfter: est, years: years((y) => 3 + 2 * wobble(y + 2)) },
        PCPIPCH: { estimatesAfter: est, years: years((y) => 4 + wobble(y + 3)) },
      },
    },
  };
}

test('origins: one edition a year, October, else September, inside the sample', () => {
  const store: WeoVintageStore = { editions: ['2004-10', '2005-09', '2006-04', '2006-10', '2007-09', '2007-10'].map(edition), skipped: [] };
  assert.deepEqual(originEditions(store, spec()).map((e) => e.vintage), ['2005-09', '2006-10', '2007-10']);
});

test('an edition\'s estimates and projections are not history, and outturns come from the latest edition', () => {
  const e = edition('2010-10');
  const inp = dsaInputsFromEdition(e, 'AAA');
  const p2009 = inp.debt!.points.find((p) => p.date === '2009');
  const p2008 = inp.debt!.points.find((p) => p.date === '2008');
  assert.equal(p2009?.note, 'IMF projection', 'year after estimatesAfter counts as a projection');
  assert.equal(p2008?.note, undefined);
  const store: WeoVintageStore = { editions: [edition('2010-10'), edition('2020-10')], skipped: [] };
  const out = latestOutturns(store, 'AAA');
  assert.ok(out.has('2018') && !out.has('2019') && !out.has('2020'));
});

test('cases: the fan built on each edition is scored against later outturns only', () => {
  const store: WeoVintageStore = { editions: Array.from({ length: 16 }, (_, k) => edition(`${2005 + k}-10`)), skipped: [] };
  const { cases, origins } = fanCoverageCases(store, spec());
  assert.equal(origins.length, 16);
  assert.ok(cases.length > 0);
  for (const c of cases) {
    assert.ok(Number(c.year) > Number(c.origin.slice(0, 4)) - 2, 'target after the origin\'s last actual year');
    assert.ok(Number(c.year) <= 2019, 'only years that are actuals in the latest edition');
    assert.ok(c.p10 <= c.p90);
  }
});

const mk = (n: number, h: number, insideShare: number): FanCase[] =>
  Array.from({ length: n }, (_, k) => ({ where: `C${k % 7}`, origin: '2010-10', h, year: String(2010 + (k % 10)), actual: 1, p10: 0, p90: 2, inside: k % 100 < insideShare * 100 }));

test('judge: calibrated coverage passes, a narrow band fails, thin samples are too few cases', () => {
  const good = [1, 2, 3, 4, 5].flatMap((h) => mk(200, h, 0.8));
  const r = judgeFanCoverage(spec(), good, ['2010-10']);
  assert.equal(r.status, 'passed', r.verdict);
  assert.ok(r.pValue <= 0.1);
  const narrow = [1, 2, 3, 4, 5].flatMap((h) => mk(200, h, h >= 4 ? 0.55 : 0.8));
  const f = judgeFanCoverage(spec(), narrow, ['2010-10']);
  assert.equal(f.status, 'failed');
  assert.match(f.verdict, /outside 70%-90% at 4y, 5y/);
  const thin = [1, 2, 3, 4].flatMap((h) => mk(200, h, 0.8));
  assert.equal(judgeFanCoverage(spec(), thin, ['2010-10']).status, 'too_few_cases');
});

test('WEO edition file names read back as their edition, and every layout is tried', async () => {
  const { vintageFromFileName, weoEditionFileName, weoEditionUrls } = await import('../src/utils/weoVintages.ts');
  for (const v of ['2005-09', '2012-04', '2024-10']) assert.equal(vintageFromFileName(weoEditionFileName(v)), v);
  const urls = weoEditionUrls('2019-10');
  assert.equal(urls.length, 3);
  assert.ok(urls.some((u) => u.endsWith('/weo/2019/02/weodata/WEOOct2019all.xls')));
  assert.ok(urls.some((u) => u.includes('/2019/October/WEOOct2019all.ashx')));
});
