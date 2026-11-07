/**
 * Inflation targets as they stood over time, for the Taylor-gap backtest only (Sam, 2026-11-05).
 * A backtest that used today's target for every past year would judge 2008 Brazil against a 3%
 * target set in 2023. Each row is the point target (the midpoint where the bank sets a range)
 * from the month it took effect; a country is tested only from its first row.
 *
 * Left out on purpose: Turkey (targets revised and missed for years, unorthodox policy 2021-23),
 * pegs and managed rates (Saudi Arabia, China), and banks whose target path was not confirmed
 * from a primary or well-documented source when this table was written. Add a country only with
 * its source, and register a new test version: the table is part of the test.
 *
 * Browser-safe.
 */
export interface TargetSpell {
  /** First month the target applied, YYYY-MM. */
  from: string;
  pct: number;
  source: string;
}

export const TARGET_HISTORY: Record<string, TargetSpell[]> = {
  USA: [{ from: '2012-01', pct: 2, source: 'FOMC Statement on Longer-Run Goals, 25 Jan 2012' }],
  EUU: [{ from: '1999-01', pct: 2, source: 'ECB: below 2% (1998), below but close to 2% (2003), symmetric 2% (Jul 2021)' }],
  GBR: [{ from: '2004-01', pct: 2, source: 'HM Treasury remit: CPI target of 2% from 10 Dec 2003' }],
  JPN: [{ from: '2013-01', pct: 2, source: 'Bank of Japan price stability target, 22 Jan 2013' }],
  KOR: [{ from: '2016-01', pct: 2, source: 'Bank of Korea: 2% CPI target from 2016, kept from 2019' }],
  BRA: [
    { from: '2006-01', pct: 4.5, source: 'CMN inflation targets (BCB), 2006-2018' },
    { from: '2019-01', pct: 4.25, source: 'CMN Resolution 4,582 (2017)' },
    { from: '2020-01', pct: 4, source: 'CMN Resolution 4,582 (2017)' },
    { from: '2021-01', pct: 3.75, source: 'CMN Resolution 4,671 (2018)' },
    { from: '2022-01', pct: 3.5, source: 'CMN Resolution 4,724 (2019)' },
    { from: '2023-01', pct: 3.25, source: 'CMN Resolution 4,831 (2020)' },
    { from: '2024-01', pct: 3, source: 'CMN Resolution 4,918 (2021); continuous 3% target from 2025' },
  ],
  MEX: [{ from: '2003-01', pct: 3, source: 'Banxico permanent 3% target (±1 pt), from 2003' }],
  CHL: [{ from: '2001-01', pct: 3, source: 'Banco Central de Chile 3% target (2-4% range)' }],
  POL: [{ from: '2004-01', pct: 2.5, source: 'NBP continuous target of 2.5% (±1 pt) from 2004' }],
  ZAF: [
    { from: '2000-02', pct: 4.5, source: 'National Treasury/SARB 3-6% target range (midpoint), Feb 2000' },
    { from: '2025-11', pct: 3, source: 'National Treasury announcement of the new 3% target, 12 Nov 2025' },
  ],
  COL: [{ from: '2010-01', pct: 3, source: 'Banco de la República long-term 3% target (±1 pt) from 2010' }],
  PER: [{ from: '2007-01', pct: 2, source: 'BCRP 2% target (1-3% range) from 2007' }],
  HUN: [{ from: '2007-01', pct: 3, source: 'MNB medium-term 3% target from 2007' }],
  IND: [{ from: '2016-08', pct: 4, source: 'RBI Act amendment and Gazette notification: 4% CPI (±2 pts), Aug 2016' }],
};

/** The target in force in a month, or undefined before the country's first row. */
export function targetIn(iso3: string, month: string): TargetSpell | undefined {
  const spells = TARGET_HISTORY[iso3];
  if (!spells) return undefined;
  let hit: TargetSpell | undefined;
  for (const s of spells) if (s.from <= month) hit = s;
  return hit;
}
