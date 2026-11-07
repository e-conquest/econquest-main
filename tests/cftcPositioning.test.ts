/**
 * CFTC currency futures positioning: read the public report the way the app does, call crowding
 * only by the stated percentile rule, and say why a country has no figure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CFTC_CURRENCY_CODES,
  cftcMissing,
  cftcUrl,
  parseCftcRows,
  positioningFor,
  positioningLabel,
  positioningSentence,
} from '../src/utils/cftcPositioning.ts';
import { runCouncil, planCouncil } from '../src/utils/askCouncil.ts';
import { positioningRows } from '../src/utils/marketsMacro.ts';
import { COLUMN_BY_ID } from '../src/utils/watchlistView.ts';
import type { WatchlistItem } from '../src/types/council.ts';

/** A row as the CFTC site returns it (numbers as strings, dates with a time). Values from the 2026-10-27 peso report. */
const row = (date: string, levLong: number, levShort: number, oi = 279359, code = '095741') => ({
  report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
  cftc_contract_market_code: code,
  open_interest_all: String(oi),
  asset_mgr_positions_long: '48101',
  asset_mgr_positions_short: '73302',
  lev_money_positions_long: String(levLong),
  lev_money_positions_short: String(levShort),
});

/** n weeks ending 2026-10-27, leveraged funds net rising week by week; the last two are the real peso weeks. */
function history(n: number) {
  const rows = [];
  for (let i = n - 1; i >= 2; i--) {
    const d = new Date(Date.UTC(2026, 9, 27) - i * 7 * 86400000).toISOString().slice(0, 10);
    rows.push(row(d, 40000 + (n - i) * 100, 30000));
  }
  rows.push(row('2026-10-20', 91748, 27934, 278165), row('2026-10-27', 99625, 31290));
  return rows;
}

test('reads the CFTC report: net share of open interest, week change, percentile', () => {
  const p = positioningFor('MEX', parseCftcRows(history(156)))!;
  assert.equal(p.reportDate, '2026-10-27');
  assert.equal(p.ccy, 'MXN');
  assert.equal(p.levNetContracts, 68335);
  assert.equal(p.levNetPctOi, 24.5);
  assert.equal(p.assetMgrNetPctOi, -9);
  assert.equal(p.levNetWeekChange, 68335 - (91748 - 27934));
  assert.equal(p.weeks, 156);
  assert.equal(p.percentile, 100);
  assert.equal(positioningLabel(p.percentile!), 'crowded long');
  assert.match(positioningSentence(p), /net long MXN futures, \+24\.5% of open interest \(CFTC, 2026-10-27\), at the 100th percentile of three years: crowded long/);
});

test('no percentile with under a year of reports; bad rows are dropped; uncovered currencies are null', () => {
  const short = positioningFor('MEX', parseCftcRows(history(20)))!;
  assert.equal(short.percentile, undefined);
  assert.doesNotMatch(positioningSentence(short), /percentile/);
  const weeks = parseCftcRows([{ cftc_contract_market_code: '095741', report_date_as_yyyy_mm_dd: '2026-10-27', open_interest_all: '' }, 'junk', null]);
  assert.equal(weeks.size, 0);
  assert.equal(positioningFor('TUR', parseCftcRows(history(60))), null);
  assert.equal(parseCftcRows({ error: true }).size, 0);
});

test('the stated crowding rule', () => {
  assert.equal(positioningLabel(90), 'crowded long');
  assert.equal(positioningLabel(89), 'not stretched');
  assert.equal(positioningLabel(10), 'crowded short');
  assert.equal(positioningLabel(11), 'not stretched');
});

test('one request for every covered future, about three years, only the columns read', () => {
  const u = decodeURIComponent(cftcUrl(new Date('2026-11-05T00:00:00Z')));
  assert.match(u, /^https:\/\/publicreporting\.cftc\.gov\/resource\/gpe5-46if\.json\?/);
  for (const c of Object.values(CFTC_CURRENCY_CODES)) assert.ok(u.includes(`'${c.code}'`));
  assert.match(u, /report_date_as_yyyy_mm_dd >= '2023-10/);
  assert.match(u, /lev_money_positions_long/);
});

test('missing reasons: no future for the currency, or the feed did not answer', () => {
  assert.equal(cftcMissing('TUR').short, 'No CFTC-reported future');
  assert.equal(cftcMissing('BRA').short, 'CFTC did not answer');
});

const cftc = { ...positioningFor('MEX', parseCftcRows(history(156)))!, pulledAt: '2026-11-05T02:00:00Z' };
const MEX = { iso3: 'MEX', countryName: 'Mexico', cftc } as WatchlistItem;
const TUR = { iso3: 'TUR', countryName: 'Turkey', reerGapPct: -12, reerPeriod: '2026-09' } as WatchlistItem;

test('FX Valuation agent: CFTC figures are official with the report date, the crowding call is its own model reading', () => {
  const q = 'Is positioning in the peso crowded?';
  const plan = planCouncil(q, [MEX, TUR]);
  assert.ok(plan.agents.some((a) => a.id === 'fx'));
  const fx = runCouncil(q, plan, [MEX, TUR]).find((a) => a.id === 'fx')!;
  const mex = fx.findings.find((f) => f.iso3 === 'MEX')!;
  const net = mex.figures.find((f) => /Leveraged funds net MXN/.test(f.label))!;
  assert.equal(net.tag, 'official');
  assert.equal(net.value, '+24.5%');
  assert.match(net.source, /as of 2026-10-27/);
  assert.equal(mex.figures.find((f) => /last 3 years/.test(f.label))!.tag, 'model');
  assert.ok(mex.weight >= 0.9);
  assert.ok(fx.missing.some((m) => /Turkey: futures positioning missing \(No CFTC-reported future\)/.test(m)));
});

test('Country tab and watchlist: figures with report and pull dates, Missing with the reason otherwise', () => {
  const rows = positioningRows(MEX, 'MEX');
  assert.equal(rows[0].value, '+24.5%');
  assert.match(rows[0].source, /CFTC as of 2026-10-27 \(pulled 2026-11-05\)/);
  assert.equal(rows[0].verified, true);
  const bra = positioningRows(undefined, 'BRA');
  assert.equal(bra[0].value, 'Missing');
  assert.equal(bra[0].source, 'CFTC did not answer');
  assert.equal(positioningRows(TUR, 'TUR')[0].verified, false);
  const col = COLUMN_BY_ID.positioning;
  assert.equal(col.text(MEX), '+24.5%');
  assert.equal(col.note!(MEX), 'CFTC, 2026-10-27, crowded long');
  assert.equal(col.text(TUR), '–');
  assert.equal(col.note!(TUR), 'No CFTC-reported future');
});
