import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bisAllMarketsUrl, bisIntlUrl, parseBisAllMarkets, parseBisCsv, parseBisIntl } from '../src/utils/bisDebtSecurities.ts';
import { bankerBrief } from '../src/utils/bankerNote.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { CouncilAssessmentRun } from '../src/types/council.ts';

const NOW = new Date('2026-11-04T12:00:00Z');

// Copied from live BIS answers for Brazil on 2026-11-04 (columns as served).
const INTL_HEAD =
  'FREQ,ISSUER_RES,ISSUER_NAT,ISSUER_BUS_IMM,ISSUER_BUS_ULT,MARKET,ISSUE_TYPE,ISSUE_CUR_GROUP,ISSUE_CUR,ISSUE_OR_MAT,ISSUE_RE_MAT,ISSUE_RATE,ISSUE_RISK,ISSUE_COL,MEASURE,DECIMALS,UNIT_MEASURE,UNIT_MULT,COLLECTION,TIME_FORMAT,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_PRE_BREAK,OBS_CONF';
const intlRow = (cur: string, re: string, v: string, period = '2026-Q2') =>
  `Q,BR,3P,2,1,C,A,${cur},TO1,A,${re},A,A,A,I,0,USD,6,,,${period},${v},A,,F`;
export const BR_INTL = [INTL_HEAD, intlRow('A', 'A', '65916'), intlRow('A', 'U', '1833'), intlRow('F', 'A', '64972'), intlRow('F', 'U', '1833'), intlRow('D', 'A', '944'), intlRow('D', 'U', '0')].join('\n');

const ALL_HEAD =
  'FREQ,ADJUSTMENT,REF_AREA,COUNTERPART_AREA,REF_SECTOR,COUNTERPART_SECTOR,CONSOLIDATION,ACCOUNTING_ENTRY,STO,INSTR_ASSET,MATURITY,EXPENDITURE,UNIT_MEASURE,CURRENCY_DENOM,VALUATION,PRICES,TRANSFORMATION,CUST_BREAKDOWN,TITLE,UNIT_MULT,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
const allRow = (val: string, v: string, period = '2026-Q1') =>
  `Q,N,BR,XW,S13,S1,N,L,LE,F3,T,_Z,USD,_T,${val},V,N,_T,"Brazil - Debt sec, issued by gen govt, all markets",9,${period},${v},A`;
export const BR_ALL = [ALL_HEAD, allRow('M', '2131.3750619829'), allRow('N', '2195.0071551819')].join('\r\n');

test('URLs: general government, international markets, open on currency group and remaining maturity; all markets with 18 key positions', () => {
  assert.match(bisIntlUrl('BR'), /WS_DEBT_SEC2_PUB\/Q\.BR\.3P\.2\.1\.C\.A\.\.TO1\.A\.\.A\.A\.A\.I\/all\?lastNObservations=1&format=csv$/);
  const key = bisAllMarketsUrl('BR').match(/WS_NA_SEC_DSS\/([^/]+)\//)![1];
  assert.equal(key.split('.').length, 18);
  assert.equal(key, 'Q.N.BR.XW.S13.S1.N.L.LE.F3.T._Z.USD._T..V.N._T');
});

test('CSV: quoted fields with commas are kept whole', () => {
  const rows = parseBisCsv(BR_ALL);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].TITLE, 'Brazil - Debt sec, issued by gen govt, all markets');
  assert.equal(rows[0].OBS_VALUE, '2131.3750619829');
});

test('international: total, due within a year and foreign currency, in US$ bn', () => {
  const x = parseBisIntl(BR_INTL)!;
  assert.equal(x.asOf, '2026Q2');
  assert.equal(x.outstandingUsdBn.toFixed(3), '65.916');
  assert.equal(x.dueWithin1yUsdBn!.toFixed(3), '1.833');
  assert.equal(x.foreignCcyUsdBn!.toFixed(3), '64.972');
});

test('international: a country without a domestic-currency row (Turkey) still parses; nothing usable gives null', () => {
  const tr = [INTL_HEAD, intlRow('F', 'A', '100359'), intlRow('F', 'U', '9555'), intlRow('A', 'A', '100359'), intlRow('A', 'U', '9555')].join('\n');
  assert.equal(parseBisIntl(tr)!.dueWithin1yUsdBn!.toFixed(3), '9.555');
  assert.equal(parseBisIntl(''), null);
  assert.equal(parseBisIntl('<html>error</html>'), null);
  assert.equal(parseBisIntl([INTL_HEAD, intlRow('A', 'U', '1833')].join('\n')), null); // no total
  assert.equal(parseBisIntl([INTL_HEAD, intlRow('A', 'A', '')].join('\n')), null);
});

test('international: the due-within-a-year figure must be from the same quarter as the total', () => {
  const x = parseBisIntl([INTL_HEAD, intlRow('A', 'A', '65916'), intlRow('A', 'U', '1833', '2025-Q4')].join('\n'))!;
  assert.equal(x.dueWithin1yUsdBn, undefined);
});

test('all markets: nominal value preferred, market value when that is all there is', () => {
  const x = parseBisAllMarkets(BR_ALL)!;
  assert.equal(x.valuation, 'nominal');
  assert.equal(Math.round(x.outstandingUsdBn), 2195);
  assert.equal(x.asOf, '2026Q1');
  const cl = parseBisAllMarkets([ALL_HEAD, allRow('M', '148.98408235559')].join('\n'))!;
  assert.equal(cl.valuation, 'market');
  assert.equal(parseBisAllMarkets(ALL_HEAD), null);
});

function run(withBis: boolean): CouncilAssessmentRun {
  const openData = buildBaselineOpenData('BRA');
  openData.dataStatus = { verifiedLiveSources: [], checkedAt: NOW.toISOString() };
  if (withBis)
    openData.debtSchedule = { bis: { intl: parseBisIntl(BR_INTL)!, all: parseBisAllMarkets(BR_ALL)! }, fetchedAt: NOW.toISOString() };
  return { iso3: 'BRA', countryName: 'Brazil', openData } as unknown as CouncilAssessmentRun;
}

test('banker brief: BIS rows are official and dated; without BIS there are none', () => {
  const b = bankerBrief(run(true), [], NOW);
  const need = b.groups.find((g) => g.title === 'Financing need')!;
  const due = need.rows.find((r) => r.label === 'Government bonds due within a year, international markets')!;
  assert.equal(due.value, '$1.8 bn');
  assert.ok(due.verified && due.source === 'BIS debt securities, end of Q2 2026');
  const out = need.rows.find((r) => r.label === 'Government bonds outstanding, international markets')!;
  assert.equal(out.value, '$65.9 bn (99% foreign currency)');
  const all = need.rows.find((r) => r.label === 'Government debt securities, all markets incl. domestic')!;
  assert.equal(all.value, '$2,195 bn (nominal value)');
  assert.equal(all.source, 'BIS debt securities, end of Q1 2026');
  assert.ok(
    b.judgements.some((j) =>
      /BIS counts \$65\.9 bn of government bonds in international markets at the end of Q2 2026, \$1\.8 bn of it due within a year and 99% in foreign currency; all government debt securities, domestic included, come to \$2,195 bn\./.test(j)
    )
  );

  const plain = bankerBrief(run(false), [], NOW);
  assert.ok(!plain.groups.find((g) => g.title === 'Financing need')!.rows.some((r) => /BIS/.test(r.source)));
  assert.ok(!plain.judgements.some((j) => /BIS/.test(j)));
});
