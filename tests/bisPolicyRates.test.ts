/**
 * BIS central bank policy rates: read the BIS answer the way the app does, take the daily figure
 * with its date, the 12-month change and the last move from the month-end series, and say why a
 * country has no figure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CBPOL_AREA,
  cbpolDailyUrl,
  cbpolMissing,
  cbpolMonthlyUrl,
  currentRateName,
  parseCbpolCsv,
  policyRateFor,
  policyRateSentence,
  type CbpolPull,
} from '../src/utils/bisPolicyRates.ts';
import { CBPOL_DAILY_LIVE, CBPOL_MONTHLY, CBPOL_HEAD } from './fixtures/bisCbpol.mjs';

const NOW = new Date('2026-11-05T03:00:00Z');
const pull = (): CbpolPull => ({
  pulledAt: '2026-11-05T02:50:00Z',
  daily: parseCbpolCsv(CBPOL_DAILY_LIVE, 'D'),
  monthly: parseCbpolCsv(CBPOL_MONTHLY, 'M'),
});

test('reads the live BIS daily answer: rate, date, central bank and which rate it is', () => {
  const d = parseCbpolCsv(CBPOL_DAILY_LIVE, 'D');
  assert.deepEqual(Object.keys(d).sort(), ['GB', 'MX', 'US', 'XM']);
  assert.deepEqual(d.MX.points, [{ period: '2026-10-27', pct: 6.5 }]);
  assert.equal(d.MX.bank, 'Bank of Mexico');
  assert.equal(d.MX.rate, 'Central Bank target, money-market overnight rate');
  assert.equal(d.US.points[0].pct, 3.875);
  assert.equal(d.US.rate, 'mid-point of the Federal Reserve target rate');
  assert.equal(d.GB.rate, 'official bank rate');
  assert.equal(d.XM.bank, 'European Central Bank');
  // The monthly parser ignores daily rows and the other way round.
  assert.deepEqual(parseCbpolCsv(CBPOL_DAILY_LIVE, 'M'), {});
});

test('daily figure wins; 12-month change and a move after the last month-end come from the monthly series', () => {
  const mx = policyRateFor('MEX', pull(), NOW)!;
  assert.equal(mx.ratePct, 6.5);
  assert.equal(mx.date, '2026-10-27');
  assert.equal(mx.freq, 'daily');
  assert.equal(mx.change12mPts, -0.5);
  assert.deepEqual(mx.lastMove, { period: '2026-10', fromPct: 6.75, toPct: 6.5 });
  assert.equal(mx.stale, false);
  assert.equal(mx.pulledAt, '2026-11-05T02:50:00Z');
  assert.equal(
    policyRateSentence(mx),
    'Bank of Mexico Central Bank target, money-market overnight rate 6.5% (BIS, 2026-10-27); last moved in 2026-10, from 6.75% to 6.5%.'
  );
});

test('monthly only (Turkey): end-of-month figure, last move found in the month-end series', () => {
  const tr = policyRateFor('TUR', pull(), NOW)!;
  assert.equal(tr.ratePct, 37);
  assert.equal(tr.date, '2026-09');
  assert.equal(tr.freq, 'monthly');
  assert.equal(tr.change12mPts, -9);
  assert.deepEqual(tr.lastMove, { period: '2026-07', fromPct: 40.5, toPct: 37 });
  assert.equal(tr.stale, false, 'end of September is 36 days before 5 November');
  assert.match(policyRateSentence(tr), /^Central Bank of the Republic of Turkey 1 week official repo rate 37% \(BIS, end of 2026-09\); last moved in 2026-07, from 40\.5% to 37%\.$/);
  // Indonesia: two months, no move, no year-ago figure.
  const id = policyRateFor('IDN', pull(), NOW)!;
  assert.equal(id.lastMove, undefined);
  assert.equal(id.change12mPts, undefined);
});

test('EU benchmark reads the ECB rate; an old figure is flagged stale', () => {
  const eu = policyRateFor('EUU', pull(), NOW)!;
  assert.equal(eu.ratePct, 2.5);
  assert.equal(eu.bank, 'European Central Bank');
  const later = policyRateFor('GBR', pull(), new Date('2027-01-15T00:00:00Z'))!;
  assert.equal(later.stale, true);
  assert.match(policyRateSentence(later), /may be out of date/);
});

test('no figure: Egypt is not in the dataset; a covered country says whether the BIS answered', () => {
  assert.equal(policyRateFor('EGY', pull(), NOW), null);
  assert.equal(policyRateFor('BRA', pull(), NOW), null);
  assert.equal(policyRateFor('BRA', null, NOW), null);
  assert.equal(cbpolMissing('EGY', true).short, 'Not in BIS policy rates');
  assert.equal(cbpolMissing('XYZ', true).short, 'Not in BIS policy rates');
  assert.equal(cbpolMissing('BRA', true).short, 'No BIS series returned');
  assert.equal(cbpolMissing('BRA', false).short, 'BIS did not answer');
});

test('rows that are not percent, have no value or a bad date are dropped; junk gives nothing', () => {
  const csv = [CBPOL_HEAD, 'D,BR,999,0,,x,4,BCB,,t,2026-10-27,15,A,F,', 'D,BR,368,0,,x,4,BCB,,t,2026-10-27,,A,F,', 'D,BR,368,0,,x,4,BCB,,t,27/10/2026,15,A,F,'].join('\n');
  assert.deepEqual(parseCbpolCsv(csv, 'D'), {});
  assert.deepEqual(parseCbpolCsv('<html>error</html>', 'D'), {});
  assert.deepEqual(parseCbpolCsv(undefined, 'M'), {});
});

test('URLs: one request per frequency for every area, euro area once, 25 months of month-ends', () => {
  const d = cbpolDailyUrl();
  assert.match(d, /^https:\/\/stats\.bis\.org\/api\/v1\/data\/WS_CBPOL\/D\.[A-Z+]+\/all\?lastNObservations=1&format=csv$/);
  assert.equal(d.match(/XM/g)!.length, 1);
  for (const a of ['BR', 'MX', 'TR', 'US', 'CN', 'RU', 'IN', 'GB', 'JP']) assert.ok(d.includes(a), a);
  assert.equal(cbpolMonthlyUrl(['MX'], NOW), 'https://stats.bis.org/api/v1/data/WS_CBPOL/M.MX/all?startPeriod=2024-10&format=csv');
  assert.equal(CBPOL_AREA.EUU, 'XM');
  assert.equal(currentRateName(''), undefined);
  assert.equal(currentRateName('Policy rate'), 'Policy rate');
});

/* ---- Wired into the Central Bank Watcher, the stance check and the watchlist ---- */
import { checkBrief, planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import { policyTag } from '../src/utils/divergences.ts';
import { toLive } from '../src/utils/liveFigures.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const mexRate = policyRateFor('MEX', pull(), NOW)!;
const MEX = toLive({
  iso3: 'MEX',
  countryName: 'Mexico',
  cpiInflationPct: 3.8,
  cpiSource: 'live',
  policyRatePct: mexRate.ratePct,
  policyRateSource: 'bis',
  policyRateDate: mexRate.date,
  policyRateBank: mexRate.bank,
  policyRateStale: mexRate.stale,
  policyRateChange12mPts: mexRate.change12mPts,
  policyRateLastMove: mexRate.lastMove,
} as WatchlistItem);

test('Central Bank Watcher: the BIS rate is an official figure with its date, plus the 12-month change and last move', () => {
  assert.deepEqual(policyTag(MEX), { q: 'live', src: 'BIS (Bank of Mexico), 2026-10-27' });
  const q = 'Is the Mexico central bank tight?';
  const [cb] = runCouncil(q, planCouncil(q, [MEX]), [MEX], NOW);
  const f = cb.findings[0];
  const fig = (label: string) => f.figures.find((x) => x.label === label)!;
  assert.deepEqual([fig('Policy rate').value, fig('Policy rate').tag, fig('Policy rate').source], ['6.50%', 'official', 'BIS (Bank of Mexico), 2026-10-27']);
  assert.equal(fig('Policy rate change over 12 months').value, '-0.50 pts');
  assert.equal(fig('Last policy rate move').value, '6.75% to 6.50% in 2026-10');
  assert.equal(fig('Real policy rate').value, '2.7%');
  assert.equal(f.stance![0].dim, 'policy');
});

test('stance check now fires on policy: a summary calling Mexico the opposite way is removed', () => {
  const q = 'Is the Mexico central bank tight?';
  const answers = runCouncil(q, planCouncil(q, [MEX]), [MEX], NOW);
  const call = answers[0].findings[0].stance![0].call;
  const opposite = call === 'loose' ? 'tight' : 'loose';
  const { brief, contradicted } = checkBrief(
    { headline: '', points: [`Mexico's monetary policy is ${opposite}.`, `Mexico's monetary policy is ${call}.`], disagreements: [], gaps: [] },
    q,
    answers
  );
  assert.deepEqual(brief.points, [`Mexico's monetary policy is ${call}.`]);
  assert.match(contradicted[0].reason, new RegExp(`Central Bank Watcher Agent reads it as ${call}`));
});

test('Country tab: the 12-month change and last move appear under the policy rate', async () => {
  const { policyHistoryRows } = await import('../src/utils/marketsMacro.ts');
  const { iso3: _i, area: _a, ...b } = mexRate;
  const rows = policyHistoryRows(b);
  assert.deepEqual(rows.map((r) => r.label), ['Policy rate change over 12 months', 'Last policy rate move']);
  assert.equal(rows[0].value, '-0.50 pts');
  assert.match(rows[1].value, /^6\.75% to 6\.50% in /);
  assert.deepEqual(policyHistoryRows(undefined), []);
});
