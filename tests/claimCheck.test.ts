import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksClaim, checkFigures, checkRank, claimAnswer, rankClaim } from '../src/utils/claimCheck.ts';
import { planCouncil, runCouncil } from '../src/utils/askCouncil.ts';
import type { WatchlistItem } from '../src/types/council.ts';

const row = (iso3: string, countryName: string, cpi?: number, debt?: number) =>
  ({
    iso3,
    countryName,
    ...(cpi !== undefined ? { cpiInflationPct: cpi, cpiSource: 'live' } : {}),
    ...(debt !== undefined ? { fiscal: { debtPctGdp: { value: debt, year: '2025' } } } : {}),
  }) as unknown as WatchlistItem;

const TUR = row('TUR', 'Turkey', 33.1, 25);
const ARG = row('ARG', 'Argentina', 41.0, 80);
const BRA = row('BRA', 'Brazil', 4.6, 87.3);
const DEU = row('DEU', 'Germany', 2.1, 63);
const NGA = row('NGA', 'Nigeria', 24);
const ALL = [TUR, ARG, BRA, DEU, NGA];

test('a figure in the sentence is checked against the app, with the tolerance', () => {
  const ok = checkFigures("Turkey's inflation is 33%", TUR);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].verdict, 'matches');
  const bad = checkFigures('Turkish inflation stands at 45%', TUR);
  assert.equal(bad[0].verdict, 'differs');
  assert.match(bad[0].reading, /\+11\.90 pts/);
  assert.equal(checkFigures('Inflation is 4%', row('XXX', 'Nowhere'))[0].verdict, 'no app figure');
});

test('a year in the sentence that is not the year of the app figure is a different period', () => {
  const r = checkFigures('Brazil government debt was 70% of GDP in 2015', BRA);
  assert.equal(r[0].verdict, 'different period');
  assert.match(r[0].reading, /2015.*2025/);
  assert.equal(checkFigures('Brazil government debt was 87% of GDP in 2025', BRA)[0].verdict, 'matches');
});

test('ranking claims: parsed, disproved by a higher member, supported only as far as the group is covered', () => {
  const rc = rankClaim("Is it true Turkey's inflation is the highest in the G20?")!;
  assert.deepEqual({ m: rc.measure, d: rc.direction, g: rc.group }, { m: 'cpi', d: 'max', g: 'G20' });
  const no = checkRank(rc, TUR, ALL);
  assert.equal(no.verdict, 'does not hold');
  assert.match(no.reading, /ranks 2 of 4 of the 19 members.*Argentina is higher at 41\.0%/);
  // Without Argentina, Turkey tops the covered members, but 16 members have no figure.
  const some = checkRank(rc, TUR, [TUR, BRA, DEU, NGA]);
  assert.equal(some.verdict, 'holds among covered');
  assert.match(some.reading, /no figure for 16 members/);
  // Nigeria is not in the G20; "lowest debt on the watchlist" ranks within the watchlist.
  assert.equal(checkRank(rc, NGA, ALL).verdict, 'cannot check');
  const wl = rankClaim('Turkey has the lowest government debt on the watchlist')!;
  assert.equal(wl.group, 'watchlist');
  assert.equal(checkRank(wl, TUR, ALL).verdict, 'holds among covered'); // Nigeria has no debt figure
  assert.equal(checkRank(wl, TUR, [TUR, ARG, BRA, DEU]).verdict, 'holds');
  assert.equal(checkRank(rankClaim('the highest inflation in the world')!, TUR, ALL).verdict, 'cannot check');
});

test('targets, forecasts and plain questions are not claims', () => {
  assert.equal(asksClaim('What is the outlook for Turkey?'), false);
  assert.equal(asksClaim('Turkey expects inflation of 20% next year'), false);
  assert.equal(asksClaim("Turkey's inflation is 33%"), true);
});

test('Council chat adds the Claim Check answer when the question states a figure or a ranking', () => {
  const q = "Is it true Turkey's inflation is the highest in the G20?";
  const answers = runCouncil(q, planCouncil(q, ALL), ALL);
  const c = answers.find((a) => a.id === 'claim');
  assert.ok(c);
  assert.equal(c!.findings[0].iso3, 'TUR');
  assert.match(c!.findings[0].reading, /not the highest/);
  assert.ok(!runCouncil('How is Turkey doing?', planCouncil('How is Turkey doing?', ALL), ALL).some((a) => a.id === 'claim'));
  const none = claimAnswer('Inflation is 33%', [], ALL)!;
  assert.match(none.missing[0], /names no watchlist country/);
});
