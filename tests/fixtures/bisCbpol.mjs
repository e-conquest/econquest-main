/**
 * BIS WS_CBPOL answers for tests. The daily rows are copied from the live answer on 2026-11-05
 * (stats.bis.org/api/v1/data/WS_CBPOL/D.MX+US+XM+GB/all?lastNObservations=2&format=csv), trimmed to
 * the last observation as the app asks. The monthly Turkey and Indonesia rows for 2026-08 and
 * 2026-09 are also from a live answer; the older monthly rows are made up for the tests (marked).
 */
export const CBPOL_HEAD =
  'FREQ,REF_AREA,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,COMPILATION,DECIMALS,SOURCE_REF,SUPP_INFO_BREAKS,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK';

export const CBPOL_DAILY_LIVE = [
  CBPOL_HEAD,
  'D,GB,368,0,,From 3 Aug 2006 onwards: official bank rate; from 6 May 1997 to 2 Aug 2006: repo rate; from 20 Aug 1981 to 5 May 1997: minimum Bank of England Band 1 dealing rate; from 16 Oct 1972 to 19 Aug 1981: minimum lending rate; from 1 Jan 1946 to 15 Oct 1972: bank rate.,4,Bank of England,, Central bank policy rates - United Kingdom - Daily - End of period,2026-10-26,3.75,A,F,',
  'D,MX,368,0,,"From 21 Jan 2008 onwards: Central Bank target, money-market overnight rate; from 3 Nov 1998 to 20 Jan 2008: bank funding rate.",4,Bank of Mexico,"As from 21 Jan 2008, the central bank target rate is used, which can be considered the official policy rate. From 3 Nov 1998 until 20 Jan 2008: the bank funding rate. ", Central bank policy rates - Mexico - Daily - End of period,2026-10-27,6.5,A,F,',
  'D,US,368,0,,From 19 Dec 1985 onwards: mid-point of the Federal Reserve target rate; from 1 Jul 1954 to 18 Dec 1985: US Fed Funds effective rate.,4,US Federal Reserve System,, Central bank policy rates - United States - Daily - End of period,2026-10-27,3.875,A,F,',
  'D,XM,368,0,,"From 18 Sep 2024 onwards: official central bank steering rate is the deposit facility rate, fixed rate; from 15 Oct 2008 to 17 Sep 2024: official central bank liquidity providing, main refinancing operations, fixed rate.",4,European Central Bank,, Central bank policy rates - Euro area - Daily - End of period,2026-10-27,2.5,A,F,',
].join('\n');

const tr = (period, v) =>
  `M,TR,368,0,,From 20 May 2010 onwards: 1 week official repo rate; from 20 Feb 2002 to 19 May 2010: Central Bank overnight borrowing rate.,4,Central Bank of the Republic of Turkey,This rate can be considered the official policy rate as from 20 May 2010., Central bank policy rates - Türkiye - Monthly - End of period,${period},${v},A,F,`;
const mx = (period, v) =>
  `M,MX,368,0,,"From 21 Jan 2008 onwards: Central Bank target, money-market overnight rate; from 3 Nov 1998 to 20 Jan 2008: bank funding rate.",4,Bank of Mexico,, Central bank policy rates - Mexico - Monthly - End of period,${period},${v},A,F,`;
const id = (period, v) => `M,ID,368,0,,From 19 Aug 2016 onwards: 7 day reverse repo rate.,4,Bank Indonesia,, Central bank policy rates - Indonesia - Monthly - End of period,${period},${v},A,F,`;

export const CBPOL_MONTHLY = [
  CBPOL_HEAD,
  // Made up for the tests: Turkey 46 a year earlier, cut to 40.5 in 2026-03, 37 from 2026-07.
  tr('2025-09', 46),
  tr('2026-03', 40.5),
  tr('2026-07', 37),
  // Live (2026-11-05):
  tr('2026-08', 37),
  tr('2026-09', 37),
  // Made up for the tests: Mexico 7.0 a year earlier, cut to 6.75 in 2026-06, held, then the
  // daily figure above (6.5) shows a move after the last month-end.
  mx('2025-09', 7),
  mx('2026-06', 6.75),
  mx('2026-09', 6.75),
  // Live (2026-11-05):
  id('2026-08', 5.75),
  id('2026-09', 5.75),
].join('\n');
