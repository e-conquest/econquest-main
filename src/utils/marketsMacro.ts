/**
 * MarketEdge (Country tab and Today screen): what the economy is doing, what markets are pricing, and where the two
 * disagree. Every figure keeps its source tag; the readings in the agent groups (Central Bank Watcher Agent, Relative Value Agent) are simple, stated rules
 * on those figures (tagged model), never data.
 */
import { CDS_HIDDEN } from './cdsHidden';
import type { CouncilAssessmentRun, LiveWatchlistItem, OpenDataSnapshot, WatchlistItem } from '../types/council';
import { missingReason } from './liveFigures';
import { getSnapshotDataStatus } from './dataStatus';
import { formatPeriod } from './officialYields';
import { liveRow, missingNote, missingRow, noSourceRow, pct, pts, type BriefRow, type CountryBrief } from './countryNotes';
import { cdsSourceNote, yieldSourceNote } from './watchlistYield';
import { carryToVol, reerLabel } from './fxValuation';
import { formatMonth, ticMissing, ticTrend } from './ticHoldings';
import { formatImfPeriod, imfMissing, reserveCover } from './imfReserves';
import { cliMissing } from './oecdCli';
import { shockSummary, shockWatch } from './shockWatch';
import { TURN_WINDOW_MONTHS, UNWIND_PTS, UNWIND_WINDOW_WEEKS, recordText } from './signalRecord';
import { HOLD_AFTER_MONTHS, cliCycleText, cycleClock, nextDecisionText, policyCycleText } from './cycleClock';
import { cpiMissing, cpiSource } from './oecdInflation';
import { TAYLOR_BAND_PTS, outputGapLabel, taylorCheck, taylorMethod } from './taylorRule';
import { COFER_CCY_BY_ISO3, ccyName } from './imfCofer';
import { cftcMissing, CFTC_CURRENCY_CODES, ordinal, positioningLabel } from './cftcPositioning';
import { SCENARIOS, scenarioImpact } from './scenarioExposure';
import { HS_CHAPTERS, PARTNER_GROUP_LABEL, comtradeMissing, type PartnerGroup } from './comtradeTrade';

/**
 * Central bank inflation targets. "checked" = read on the central bank's own page on 2026-11-04.
 * Brazil and Mexico could not be re-read that day (pages blocked or script-only), so they carry
 * the long-standing published targets and say so. Egypt's page refused the request: not on file.
 */
export interface InflationTarget {
  pct: number;
  /** Tolerance either side, in points, when the bank states one. */
  bandPts?: number;
  bank: string;
  url: string;
  checked: boolean;
}

export const INFLATION_TARGETS: Record<string, InflationTarget> = {
  ZAF: { pct: 3, bandPts: 1, bank: 'SARB', url: 'https://www.resbank.co.za/en/home/what-we-do/monetary-policy', checked: true },
  TUR: { pct: 5, bandPts: 2, bank: 'CBRT (2026 year-end target)', url: 'https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Main+Menu/Core+Functions/Monetary+Policy/PRICE+STABILITY+AND+INFLATION/Inflation+Targets', checked: true },
  IDN: { pct: 2.5, bandPts: 1, bank: 'Bank Indonesia', url: 'https://www.bi.go.id/en/fungsi-utama/moneter/inflasi/default.aspx', checked: true },
  POL: { pct: 2.5, bandPts: 1, bank: 'NBP', url: 'https://nbp.pl/en/monetary-policy/', checked: true },
  CHL: { pct: 3, bank: 'Banco Central de Chile', url: 'https://www.bcentral.cl/en/web/banco-central/areas/monetary-policy', checked: true },
  GBR: { pct: 2, bandPts: 1, bank: 'Bank of England', url: 'https://www.bankofengland.co.uk/monetary-policy/inflation', checked: true },
  JPN: { pct: 2, bank: 'Bank of Japan', url: 'https://www.boj.or.jp/en/mopo/outline/qqe.htm', checked: true },
  BRA: { pct: 3, bandPts: 1.5, bank: 'BCB', url: 'https://www.bcb.gov.br/en/monetarypolicy/inflationtargeting', checked: false },
  MEX: { pct: 3, bandPts: 1, bank: 'Banxico', url: 'https://www.banxico.org.mx/monetary-policy/inflation-target.html', checked: false },
};

/**
 * Desk roles that own the MarketEdge readings. Central Bank Watcher matches the council's
 * agent of that name; Relative Value is the desk that compares a country's pricing with its peers.
 * The readings are stated rules on sourced figures (tagged "model"), not AI output.
 */
export const EDGE_AGENTS = { cb: 'Central Bank Watcher', rv: 'Relative Value', fx: 'FX Valuation', spill: 'Global Spillover' } as const;

export function targetSource(t: InflationTarget): string {
  return t.checked ? `${t.bank} stated target` : `${t.bank} published target, not re-checked`;
}

/* ------------------------------------------------------------------------------------------
 * Peer table: yields, spreads and CDS side by side. The old cheap / rich reading fitted each
 * figure on the app's composite risk score, which was never registered or tested and is retired,
 * so the table shows the figures only.
 * ------------------------------------------------------------------------------------------ */

export interface PeerScreenRow {
  iso3: string;
  countryName: string;
  /** Missing when no real source filled it; never a built-in value. */
  yield10YPct?: number;
  yieldNote: string;
  spreadBps?: number;
  cdsBps?: number;
  cdsNote: string;
  /** Real 10Y yield (10Y yield less inflation), when both figures exist. */
  realYieldPct?: number;
}

type RealYieldInput = Partial<Pick<LiveWatchlistItem, 'yield10YPct' | 'cpiInflationPct'>>;

/** 10Y yield less inflation; undefined unless both are real figures. */
export function realYield(i: RealYieldInput): number | undefined {
  return Number.isFinite(i.yield10YPct) && Number.isFinite(i.cpiInflationPct) ? (i.yield10YPct as number) - (i.cpiInflationPct as number) : undefined;
}

/** The peer table, sorted by spread over US Treasuries (widest first; rows without one last). */
export function peerScreen(peers: LiveWatchlistItem[], us10YPct?: number): { rows: PeerScreenRow[] } {
  const rows: PeerScreenRow[] = peers.map((p) => ({
    iso3: p.iso3,
    countryName: p.countryName,
    yield10YPct: p.yield10YPct,
    yieldNote: p.yield10YPct === undefined ? `Missing: ${missingReason('yield', p.iso3).short}` : yieldSourceNote(p),
    spreadBps: us10YPct !== undefined && p.yield10YPct !== undefined ? Math.round((p.yield10YPct - us10YPct) * 100) : undefined,
    cdsBps: p.cds5YBps,
    cdsNote: p.cds5YBps === undefined ? `Missing: ${missingReason('cds', p.iso3).short}` : cdsSourceNote(p),
    realYieldPct: realYield(p),
  }));
  return { rows: rows.sort((a, b) => (b.spreadBps ?? -1e9) - (a.spreadBps ?? -1e9)) };
}

/* ------------------------------------------------------------------------------------------
 * The brief for one country.
 * ------------------------------------------------------------------------------------------ */

export function policyStance(realRatePct: number, inflationGapPts: number | undefined): string {
  if (inflationGapPts === undefined) {
    return realRatePct > 3 ? 'a high real rate' : realRatePct < 0 ? 'a negative real rate' : 'a moderate real rate';
  }
  if (realRatePct > 3 && inflationGapPts <= 1) return 'tight for where inflation is, which leaves room to cut';
  if (realRatePct > 3) return 'tight, with inflation still above target';
  if (realRatePct < 0 && inflationGapPts > 0) return 'loose with inflation above target';
  if (inflationGapPts > 1) return 'not very tight with inflation above target';
  return 'close to neutral with inflation near target';
}

/** The BIS history behind the policy rate: change over 12 months and the last move. Shown only with a BIS figure. */
export function policyHistoryRows(b: OpenDataSnapshot['bisPolicyRate']): BriefRow[] {
  if (!b) return [];
  const rows: BriefRow[] = [];
  if (b.change12mPts !== undefined)
    rows.push({ label: 'Policy rate change over 12 months', value: `${b.change12mPts >= 0 ? '+' : ''}${b.change12mPts.toFixed(2)} pts`, source: 'official, BIS month-end figures', verified: true });
  if (b.lastMove)
    rows.push({ label: 'Last policy rate move', value: `${pct(b.lastMove.fromPct, 2)} to ${pct(b.lastMove.toPct, 2)} in ${formatPeriod(b.lastMove.period)}`, source: 'official, BIS', verified: true });
  return rows;
}

export function marketsMacroBrief(run: CouncilAssessmentRun, peers: LiveWatchlistItem[]): CountryBrief & { screen: ReturnType<typeof peerScreen> } {
  const open = run.openData;
  const status = getSnapshotDataStatus(open);
  const L = status.live;
  const self = peers.find((p) => p.iso3 === run.iso3);
  // The OECD's monthly figure, where it has one, is fresher than the IMF's annual one.
  const oecdCpi = self?.oecdCpi;
  const cpi = oecdCpi?.yoyPct ?? L('imf.cpiInflationPct');
  const policy = L('market.policyRatePct');
  const y10 = L('market.sovereign10YBondYieldPct');
  const cds = L('market.cds5YSpreadBps');
  const growth = L('imf.realGdpGrowthPct');
  const ca = L('wb.currentAccountPctGdp');
  const res = L('wb.fxReservesMonthsImport');
  const target = INFLATION_TARGETS[run.iso3];
  const gap = target && cpi !== undefined ? cpi - target.pct : undefined;
  const realPolicy = policy !== undefined && cpi !== undefined ? policy - cpi : undefined;
  const real10Y = y10 !== undefined && cpi !== undefined ? y10 - cpi : undefined;
  const us = open.us10YYield;
  const spreadBps = us && y10 !== undefined ? Math.round((y10 - us.valuePct) * 100) : undefined;
  const screen = peerScreen(peers, us?.valuePct);
  const cv = policy !== undefined && self?.fxVol3mPct !== undefined && self.usFedFundsPct !== undefined ? carryToVol(policy, self.usFedFundsPct, self.fxVol3mPct) : null;
  const model = (label: string, value: string, how = 'model, from figures above'): BriefRow => ({ label, value, source: how, verified: false });
  const needs = (label: string, what: string) => missingRow(label, { kind: 'setup', short: `Needs ${what}`, help: `Worked out from ${what}, which is missing.` });

  const j: string[] = [];
  if (cpi !== undefined)
    j.push(
      `Inflation is ${pct(cpi)}${oecdCpi ? ` (${cpiSource(oecdCpi)})` : ''}${target && gap !== undefined ? `, ${Math.abs(gap).toFixed(1)} pts ${gap >= 0 ? 'above' : 'below'} the ${pct(target.pct)} target` : ' (no inflation target on file)'}${
        realPolicy !== undefined && policy !== undefined ? `; with the policy rate at ${pct(policy, 2)}, the real rate is ${pct(realPolicy)}, so policy looks ${policyStance(realPolicy, gap)}` : ''
      }.`
    );
  if (y10 !== undefined)
    j.push(
      `The 10-year yields ${pct(y10, 2)}${real10Y !== undefined ? `, ${pct(real10Y)} after inflation` : ''}${
        us && spreadBps !== undefined ? `, and ${spreadBps} bps over US Treasuries (US 10Y ${pct(us.valuePct, 2)}, ${formatPeriod(us.period)})` : ''
      }.`
    );
  const macro = [growth !== undefined ? `growth is ${pct(growth)}` : '', ca !== undefined ? `the current account is ${pct(ca)} of GDP` : '', res !== undefined ? `reserves cover ${res.toFixed(1)} months of imports` : ''].filter(Boolean);
  if (macro.length) j.push(`${macro.join('; ').replace(/^./, (c) => c.toUpperCase())}.`);

  const head = [cpi !== undefined ? `inflation ${pct(cpi)}${target ? ` against a ${pct(target.pct)} target` : ''}` : '', realPolicy !== undefined ? `real policy rate ${pct(realPolicy)}` : '', y10 !== undefined ? `10Y ${pct(y10, 2)}` : ''].filter(Boolean);
  const fx = L('market.exchangeRatePerUsd');
  const groups = [
    {
      title: 'Macro now',
      rows: [
        liveRow(status, 'Real GDP growth', 'imf.realGdpGrowthPct', (v) => pct(v), open),
        liveRow(status, 'CPI inflation', 'imf.cpiInflationPct', (v) => pct(v), open),
        target
          ? { label: 'Inflation target', value: `${pct(target.pct)}${target.bandPts ? ` ± ${target.bandPts}` : ''}`, source: targetSource(target), verified: target.checked }
          : noSourceRow('Inflation target', 'No official inflation target on file for this country.'),
        liveRow(status, 'Policy rate', 'market.policyRatePct', (v) => pct(v, 2), open),
        ...policyHistoryRows(policy !== undefined ? open.bisPolicyRate : undefined),
        liveRow(status, 'Primary balance', 'imf.primaryFiscalBalancePct', (v) => `${pct(v)} of GDP`, open),
        liveRow(status, 'Debt / GDP', 'imf.debtToGdpPct', (v) => pct(v), open),
        liveRow(status, 'Current account', 'wb.currentAccountPctGdp', (v) => `${pct(v)} of GDP`, open),
        liveRow(status, 'FX reserves', 'wb.fxReservesMonthsImport', (v) => `${v.toFixed(1)} months of imports`, open),
      ],
    },
    {
      title: 'Reserves and balance of payments (IMF)',
      rows: imfRows(self),
    },
    {
      title: 'World reserve currencies (IMF COFER, quarterly)',
      rows: coferRows(self, run.iso3),
    },
    {
      title: 'Market pricing',
      rows: [
        liveRow(status, '10Y government yield', 'market.sovereign10YBondYieldPct', (v) => pct(v, 2), open),
        us
          ? { label: 'US 10Y Treasury', value: pct(us.valuePct, 2), source: `official, OECD via FRED, ${formatPeriod(us.period)} avg`, verified: true }
          : missingRow('US 10Y Treasury', { kind: 'unreachable', short: 'FRED did not answer', help: 'The free FRED feed did not answer. Press Refresh now under Research > One country, or add a free FRED key under Menu > Settings.' }),
        ...(spreadBps !== undefined ? [model('Spread over US 10Y', `${spreadBps} bps`, 'from the two yields above')] : []),
        liveRow(status, '5Y CDS', 'market.cds5YSpreadBps', (v) => `${Math.round(v)} bps`, open),
        fx !== undefined
          ? { label: `Spot FX (${open.currencyCode} per USD)`, value: fx >= 100 ? fx.toFixed(0) : fx.toFixed(fx >= 10 ? 2 : 4), source: 'live FX feed', verified: true }
          : liveRow(status, `Spot FX (${open.currencyCode} per USD)`, 'market.exchangeRatePerUsd', (v) => String(v), open),
        noSourceRow('2s10s curve slope', 'Needs official 2-year and 10-year yields, which are not connected yet.'),
        self?.reerGapPct !== undefined
          ? {
              label: 'Real exchange rate vs 10-year average',
              value: `${self.reerGapPct >= 0 ? '+' : ''}${self.reerGapPct.toFixed(1)}% (${reerLabel(self.reerGapPct)})`,
              source: `official, BIS${self.reerPeriod ? `, ${formatPeriod(self.reerPeriod)}` : ''}`,
              verified: true,
            }
          : missingRow('Real exchange rate vs 10-year average', { kind: 'unreachable', short: 'BIS did not answer', help: 'The free BIS feed did not answer, or does not cover this currency. Press Refresh now under Research > One country.' }),
        self?.fxVol3mPct !== undefined
          ? { label: 'FX volatility against USD, 3 months', value: pct(self.fxVol3mPct), source: `official, ECB reference rates${self.fxVolTo ? `, 3 months to ${formatPeriod(self.fxVolTo)}` : ''}`, verified: true }
          : missingRow('FX volatility against USD, 3 months', { kind: 'unreachable', short: 'No ECB rate', help: 'The ECB publishes no reference rate for this currency, or the feed did not answer.' }),
      ],
    },
    // The edge: readings by stated rules on the figures above, grouped by the desk role that owns them.
    {
      title: `${EDGE_AGENTS.cb} Agent`,
      rows: [
        gap !== undefined ? model('Inflation against target', pts(gap)) : needs('Inflation against target', cpi === undefined ? 'live inflation' : 'an inflation target'),
        realPolicy !== undefined ? model('Real policy rate', pct(realPolicy)) : needs('Real policy rate', policy === undefined ? 'a policy rate' : 'live inflation'),
        real10Y !== undefined ? model('Real 10Y yield', pct(real10Y)) : needs('Real 10Y yield', y10 === undefined ? 'an official 10Y yield' : 'live inflation'),
        self?.imf?.monthsOfImports !== undefined
          ? model('Reserve cover', `${reserveCover(self.imf.monthsOfImports)} (${self.imf.monthsOfImports.toFixed(1)} months of imports)`, 'model: IMF reserves over a month of IMF BOP imports; under 3 = thin, 3 to 6 = adequate, over 6 = ample')
          : needs('Reserve cover', 'IMF monthly reserves and four quarters of IMF BOP imports'),
      ],
    },
    {
      title: `${EDGE_AGENTS.rv} Agent`,
      rows: [
        cv && self?.usFedFundsPct !== undefined
          ? model('Carry over US per unit of FX volatility', `${cv.ratio.toFixed(2)} (${cv.carryPts.toFixed(1)} pts over fed funds ${pct(self.usFedFundsPct, 2)})`, 'model: policy rate minus US fed funds, over 3-month volatility')
          : needs('Carry over US per unit of FX volatility', policy === undefined ? 'a policy rate' : 'FX volatility and fed funds'),
      ],
    },
    {
      title: 'OECD inflation (monthly)',
      rows: oecdCpiRows(self),
    },
    {
      title: 'OECD leading indicator (monthly)',
      rows: cliRows(self),
    },
    {
      title: 'Cycle clock',
      rows: [...cycleClockRows(self, run.iso3), ...taylorRows(self)],
    },
    {
      title: 'Shock early warning',
      rows: shockRows(self),
    },
    {
      title: 'Signal track record',
      rows: signalRecordRows(self),
    },
    {
      title: 'Futures positioning (CFTC, weekly)',
      rows: positioningRows(self, run.iso3),
    },
    {
      title: 'US Treasury holdings (TIC, monthly)',
      rows: ticRows(self, run.iso3),
    },
    {
      title: 'Trade partners (UN Comtrade, annual)',
      rows: comtradeRows(self, run.iso3),
    },
    {
      title: `${EDGE_AGENTS.fx} Agent`,
      rows: [
        self?.cftc?.percentile !== undefined
          ? model(
              'Leveraged funds against their last 3 years',
              `${ordinal(self.cftc.percentile)} percentile (${positioningLabel(self.cftc.percentile)})`,
              `model: ${self.cftc.weeks} weekly CFTC reports; 90th or above = crowded long, 10th or below = crowded short`
            )
          : needs('Leveraged funds against their last 3 years', CFTC_CURRENCY_CODES[run.iso3] ? 'a year or more of CFTC reports' : 'a CFTC-reported currency future'),
        self?.tic?.change12mPct !== undefined
          ? model('US Treasury holdings trend', ticTrend(self.tic.change12mPct), 'model: 12-month TIC change; -10% or less = selling, +10% or more = buying')
          : needs('US Treasury holdings trend', '13 months of TIC holdings for this country'),
      ],
    },
    {
      title: `${EDGE_AGENTS.spill} Agent`,
      rows: [
        self?.oecdCli?.phase
          ? model('Growth cycle phase', self.oecdCli.phase, 'model: OECD rule on the leading indicator; above 100 and rising = expansion, above and falling = downturn, below and falling = slowdown, below and rising = recovery')
          : needs('Growth cycle phase', 'two months of the OECD leading indicator'),
        ...SCENARIOS.map((sc) => {
        const imp = self?.trade ? scenarioImpact(sc.id, self.trade) : null;
        return imp
          ? model(sc.name, `${imp.pctGdp > 0 ? '+' : ''}${imp.pctGdp.toFixed(1)}% of GDP`, `model: ${sc.shock} Basis: ${imp.basis}`)
          : missingRow(sc.name, { kind: 'unreachable', short: 'Trade figures did not answer', help: 'A needed figure did not load: World Bank or WITS trade shares, or for commodity prices the UN Comtrade export mix and the World Bank Pink Sheet. Press Refresh now under Research > One country.' });
        }),
      ],
    },
  ];
  return {
    headline: head.length ? `${run.countryName}: ${head.join(', ')}.` : `${run.countryName}: no live market or macro figures yet.`,
    judgements: j,
    sampleWarning: missingNote(groups, run.countryName),
    screen,
    groups,
  };
}

/** CFTC rows for the Country tab: official figures with the report date and the date the app pulled them. */
export function positioningRows(self: LiveWatchlistItem | undefined, iso3: string): BriefRow[] {
  const c = self?.cftc;
  const why = cftcMissing(iso3);
  const miss = (label: string) => (CFTC_CURRENCY_CODES[iso3] ? missingRow(label, { kind: 'unreachable', short: why.short, help: why.help }) : noSourceRow(label, why.help));
  if (!c) return [miss('Leveraged funds net, share of open interest'), miss('Asset managers net, share of open interest')];
  const src = `official, CFTC as of ${c.reportDate} (pulled ${c.pulledAt.slice(0, 10)})`;
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  return [
    { label: `Leveraged funds net ${c.ccy}, share of open interest`, value: sg(c.levNetPctOi), source: src, verified: true },
    { label: `Asset managers net ${c.ccy}, share of open interest`, value: sg(c.assetMgrNetPctOi), source: src, verified: true },
    ...(c.levNetWeekChange !== undefined
      ? [{ label: 'Leveraged funds, change on the week', value: `${c.levNetWeekChange >= 0 ? '+' : ''}${c.levNetWeekChange.toLocaleString('en-US')} contracts`, source: src, verified: true }]
      : []),
  ];
}

/** TIC rows for the Country tab: official figures with the month-end and the date the app pulled them. */
/** UN Comtrade: exposure to the scenario counterparties, top partners and the export mix. */
export function comtradeRows(self: LiveWatchlistItem | undefined, iso3: string): BriefRow[] {
  const c = self?.comtrade;
  if (!c) {
    const why = comtradeMissing(iso3, false);
    return [missingRow('Exports to China, Taiwan, Russia, the Gulf', { kind: 'unreachable', short: why.short, help: why.help })];
  }
  const src = `official, UN Comtrade ${c.year} (pulled ${c.pulledAt.slice(0, 10)})`;
  const groups: PartnerGroup[] = ['china', 'taiwan', 'russia', 'gulf'];
  const label = (g: PartnerGroup) => (g === 'gulf' ? 'the Gulf producers' : PARTNER_GROUP_LABEL[g]);
  const rows: BriefRow[] = [
    { label: 'Goods exports / imports', value: `$${c.exportsUsdBn.toFixed(1)}bn / $${c.importsUsdBn.toFixed(1)}bn`, source: src, verified: true },
  ];
  for (const g of groups) {
    const x = c.exportSharePct[g];
    const m = c.importSharePct[g];
    if (x === undefined && m === undefined) continue;
    rows.push({
      label: `Trade with ${label(g)}`,
      value: `${x !== undefined ? `${x.toFixed(1)}% of exports` : 'exports not listed'}, ${m !== undefined ? `${m.toFixed(1)}% of imports` : 'imports not listed'}`,
      source: src,
      verified: true,
    });
  }
  if (c.topExportPartners.length)
    rows.push({ label: 'Top export markets', value: c.topExportPartners.slice(0, 3).map((p) => `${p.name} ${p.sharePct.toFixed(0)}%`).join(', '), source: src, verified: true });
  if (c.topImportPartners.length)
    rows.push({ label: 'Top import sources', value: c.topImportPartners.slice(0, 3).map((p) => `${p.name} ${p.sharePct.toFixed(0)}%`).join(', '), source: src, verified: true });
  if (c.exportMixPct && c.productYear) {
    const top = Object.entries(c.exportMixPct)
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([ch, v]) => `${HS_CHAPTERS[ch]?.name ?? `HS ${ch}`} ${v.toFixed(0)}%`);
    if (top.length) rows.push({ label: 'Commodity share of exports', value: top.join(', '), source: `official, UN Comtrade ${c.productYear} by HS chapter (pulled ${c.pulledAt.slice(0, 10)})`, verified: true });
  }
  if (c.fuelImportSharePct !== undefined && c.productYear)
    rows.push({ label: 'Fuels share of imports', value: `${c.fuelImportSharePct.toFixed(1)}%`, source: `official, UN Comtrade ${c.productYear}, HS 27 (pulled ${c.pulledAt.slice(0, 10)})`, verified: true });
  return rows;
}

export function ticRows(self: LiveWatchlistItem | undefined, iso3: string): BriefRow[] {
  const t = self?.tic;
  if (!t) return [noSourceRow('Holdings of US Treasuries', ticMissing(iso3).help)];
  const src = `official, US Treasury TIC, ${formatMonth(t.month)} (pulled ${t.pulledAt.slice(0, 10)})`;
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  return [
    { label: 'Holdings of US Treasuries', value: `$${t.holdingsUsdBn.toFixed(1)}bn`, source: src, verified: true },
    ...(t.change1mUsdBn !== undefined ? [{ label: 'Change on the month', value: `${sg(t.change1mUsdBn)}bn`, source: src, verified: true }] : []),
    ...(t.change12mUsdBn !== undefined && t.change12mPct !== undefined
      ? [{ label: 'Change over 12 months', value: `${sg(t.change12mUsdBn)}bn (${sg(t.change12mPct)}%)`, source: src, verified: true }]
      : []),
    ...(t.shareOfForeignPct !== undefined ? [{ label: 'Share of all foreign holdings', value: `${t.shareOfForeignPct.toFixed(1)}%`, source: src, verified: true }] : []),
  ];
}

/** IMF reserves and balance-of-payments rows for the Country tab, each with its period and pull date. */
export function imfRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  const e = self?.imf;
  const pulled = e ? ` (pulled ${e.pulledAt.slice(0, 10)})` : '';
  const sg = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`;
  const miss = (label: string, m: 'reserves' | 'currentAccount' | 'imports') => {
    const r = imfMissing(e, m);
    return missingRow(label, { kind: 'unreachable', short: r.short, help: r.help });
  };
  const rows: BriefRow[] = [];
  if (e?.reserves) {
    const src = `official, IMF International Liquidity, ${formatImfPeriod(e.reserves.period)}, series ${e.reserves.key}${pulled}`;
    rows.push({ label: 'Official reserves', value: `$${e.reserves.usdBn.toFixed(1)}bn`, source: src, verified: true });
    if (e.reserves.change12mPct !== undefined) rows.push({ label: 'Reserves, change over 12 months', value: `${sg(e.reserves.change12mPct)}%`, source: src, verified: true });
  } else rows.push(miss('Official reserves', 'reserves'));
  if (e?.monthsOfImports !== undefined && e.imports4q) {
    rows.push({
      label: 'Reserves in months of imports',
      value: `${e.monthsOfImports.toFixed(1)} months`,
      source: `model: IMF reserves over imports of goods and services for the four quarters to ${formatImfPeriod(e.imports4q.through)} ($${e.imports4q.usdBn.toFixed(1)}bn, series ${e.imports4q.key}) / 12`,
      verified: false,
    });
  } else rows.push(miss('Reserves in months of imports', e?.reserves ? 'imports' : 'reserves'));
  if (e?.currentAccount) {
    rows.push({
      label: 'Current account, latest quarter',
      value: `${sg(e.currentAccount.usdBn, 1)}bn`,
      source: `official, IMF Balance of Payments, ${formatImfPeriod(e.currentAccount.period)}, series ${e.currentAccount.key}${pulled}`,
      verified: true,
    });
    const four = e.currentAccount4q;
    if (four?.pctGdp !== undefined) {
      rows.push({
        label: 'Current account, last four quarters',
        value: `${sg(four.pctGdp)}% of GDP`,
        source: `model: IMF BOP $${four.usdBn.toFixed(1)}bn to ${formatImfPeriod(four.through)} over IMF WEO GDP ${four.gdpYear} ($${four.gdpUsdBn?.toFixed(0)}bn)`,
        verified: false,
      });
    } else {
      rows.push(
        noSourceRow('Current account, last four quarters', four ? `The IMF World Economic Outlook has no GDP for ${four.through.slice(0, 4)}.` : 'The IMF series does not have four quarters in a row.')
      );
    }
  } else rows.push(miss('Current account', 'currentAccount'));
  return rows;
}

/** OECD leading indicator rows for the Country tab, with the month and the date the app pulled it. */
export function cliRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  const c = self?.oecdCli;
  const label = 'Leading indicator (100 = long-term average)';
  if (!c) {
    const why = cliMissing(!!self?.oecdCliPulledAt);
    return [self?.oecdCliPulledAt ? noSourceRow(label, why.help) : missingRow(label, { kind: 'unreachable', short: why.short, help: why.help })];
  }
  const src = `official, OECD CLI amplitude adjusted, ${formatMonth(c.month)} (pulled ${c.pulledAt.slice(0, 10)})`;
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  return [
    { label, value: c.level.toFixed(2), source: src, verified: true },
    ...(c.change1m !== undefined ? [{ label: 'Change on the month', value: sg(c.change1m), source: src, verified: true }] : []),
    ...(c.change6m !== undefined ? [{ label: 'Change over 6 months', value: sg(c.change6m), source: src, verified: true }] : []),
  ];
}

/**
 * Cycle clock rows for the Country tab: policy cycle (BIS moves), business cycle (OECD leading
 * indicator) and the next scheduled rate decision. Where things stand and for how long, not a forecast.
 */
/** Policy rule check rows (src/utils/taylorRule.ts): the rule rate, the gap to it, and how it was worked out. */
export function taylorRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  const t = taylorCheck(self);
  if (!t.ok) {
    return [missingRow('Policy rate against a Taylor rule', { kind: 'setup', short: `Needs ${t.missing.join(', ')}`, help: `The rule needs the BIS policy rate, live inflation and the central bank's own target; missing: ${t.missing.join(', ')}.` })];
  }
  const r = t.reading;
  const sg2 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  return [
    { label: 'Taylor rule rate', value: `${r.rulePct.toFixed(2)}%${r.withoutOutputGap ? ' (no output gap)' : ''}`, source: `model: ${taylorMethod(r)}`, verified: false },
    { label: 'Policy rate against the rule', value: `${sg2(r.gapToRulePts)} pts: ${r.stance}`, source: `model: BIS policy rate ${r.policyPct.toFixed(2)}% minus the rule rate; within ${TAYLOR_BAND_PTS} pt = close to the rule`, verified: false },
    ...(r.outputGapPct !== undefined
      ? [
          r.outputGapSource === 'estimate'
            ? { label: 'Output gap', value: `${sg2(r.outputGapPct)}% of potential GDP (app estimate)`, source: `model: ${outputGapLabel(r)}; middle of three filters, not an official figure`, verified: false }
            : { label: 'Output gap', value: `${sg2(r.outputGapPct)}% of potential GDP`, source: `official, IMF WEO${r.outputGapYear ? ` ${r.outputGapYear}` : ''}`, verified: true },
        ]
      : [noSourceRow('Output gap', 'No IMF output gap and too little saved IMF growth history for the app estimate, so the rule leaves that term out.')]),
  ];
}

export function cycleClockRows(self: LiveWatchlistItem | undefined, iso3: string, now = new Date()): BriefRow[] {
  const clock = cycleClock(self ?? { iso3 }, now);
  const rows: BriefRow[] = [];
  rows.push(
    clock.policy
      ? { label: 'Policy cycle', value: policyCycleText(clock.policy), source: `model, from BIS policy-rate moves to ${formatPeriod(clock.policy.asOf)}; no move for ${HOLD_AFTER_MONTHS} months = on hold`, verified: false }
      : missingRow('Policy cycle', { kind: 'setup', short: 'Needs the BIS policy-rate history', help: 'Worked out from the BIS monthly policy-rate series, which is missing for this country.' })
  );
  rows.push(
    clock.cli
      ? { label: 'Business cycle (leading indicator)', value: cliCycleText(clock.cli), source: 'model, OECD rule on the CLI level and monthly change; a turn needs two months each way', verified: false }
      : missingRow('Business cycle (leading indicator)', { kind: 'setup', short: 'Needs the OECD leading indicator', help: 'Worked out from the OECD composite leading indicator, which is missing for this country.' })
  );
  rows.push(
    clock.nextDecision
      ? { label: 'Next rate decision', value: nextDecisionText(clock.nextDecision), source: `official calendar: ${clock.nextDecision.source}${clock.nextDecision.primary ? '' : ', secondary source'}`, verified: clock.nextDecision.primary }
      : noSourceRow('Next rate decision', 'No rate decision date on file in the official calendar for this country.')
  );
  return rows;
}

/** Shock early warning rows: each warning with its rule, then what could not be checked. */
export function shockRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  if (!self) return [missingRow('Shock early warning', { kind: 'setup', short: 'Needs the live watchlist row', help: 'The checks read the live figures on this country\'s watchlist row.' })];
  const s = shockWatch(self);
  const rows: BriefRow[] = [{ label: 'Summary', value: shockSummary(s), source: 'model, stated rules on the figures below; pressure building, not a forecast', verified: false }];
  for (const w of s.warnings) rows.push({ label: `${w.level === 'alert' ? 'Alert' : 'Watch'}: ${w.label}`, value: w.detail, source: `model rule: ${w.rule}`, verified: false });
  if (s.notChecked.length) rows.push({ label: 'Not checked', value: s.notChecked.join('; '), source: 'missing inputs', verified: false });
  return rows;
}

/** How often the timing signals were followed by what they point to, in this country's own history. */
export function signalRecordRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  const r = self?.signalRecord;
  const rows: BriefRow[] = [];
  const a = r?.cliTurnToPolicy;
  rows.push(
    a
      ? {
          label: 'Leading-indicator turn, then a policy move',
          value: recordText(a, `${formatMonth(a.from)} to ${formatMonth(a.to)}`),
          source: `model: OECD CLI turns against BIS policy moves; a peak counts if a cut follows within ${TURN_WINDOW_MONTHS} months, a trough if a hike does. Cases: ${a.cases.map((c) => `${formatMonth(c.when)} ${c.followed ? 'yes' : 'no'}`).join(', ')}`,
          verified: false,
        }
      : noSourceRow('Leading-indicator turn, then a policy move', 'Needs an OECD leading-indicator turn with 6 months of BIS policy-rate history after it.')
  );
  const b = r?.crowdingUnwind;
  rows.push(
    b
      ? {
          label: 'Crowded positioning, then an unwind',
          value: recordText(b, `${b.from} to ${b.to}`),
          source: `model: CFTC leveraged funds entering the top or bottom 10% of the 3-year range (bands set with hindsight), then coming back ${UNWIND_PTS} pts of open interest within ${UNWIND_WINDOW_WEEKS} weeks`,
          verified: false,
        }
      : noSourceRow('Crowded positioning, then an unwind', 'Needs a CFTC currency future with a year or more of weekly reports and at least one crowded episode.')
  );
  return rows;
}

/** OECD monthly CPI rows for the Country tab, with the month and the date the app pulled it. */
export function oecdCpiRows(self: LiveWatchlistItem | undefined): BriefRow[] {
  const c = self?.oecdCpi;
  const label = 'CPI inflation, y/y (latest month)';
  if (!c) {
    const why = cpiMissing(!!self?.oecdCpiPulledAt);
    return [self?.oecdCpiPulledAt ? noSourceRow(label, why.help) : missingRow(label, { kind: 'unreachable', short: why.short, help: why.help })];
  }
  const src = `official, ${cpiSource(c)} (pulled ${c.pulledAt.slice(0, 10)})`;
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  return [
    { label, value: pct(c.yoyPct), source: src, verified: true },
    ...(c.change3mPts !== undefined && c.trend
      ? [
          { label: 'Change over 3 months', value: `${sg(c.change3mPts)} pts`, source: src, verified: true },
          { label: 'Inflation trend', value: c.trend, source: 'model: 3-month change; +0.5 pts or more = rising, -0.5 pts or more down = easing', verified: false },
        ]
      : []),
  ];
}

/**
 * COFER rows for the Country tab: the world's currency shares of allocated FX reserves (a world
 * reading, the same on every country), with the country's own currency first when COFER names it.
 */
export function coferRows(self: LiveWatchlistItem | undefined, iso3: string): BriefRow[] {
  const c = self?.cofer;
  if (!c) {
    return [
      missingRow('Currency shares of world FX reserves', {
        kind: 'unreachable',
        short: 'IMF COFER did not answer',
        help: 'The free IMF data API (api.imf.org) did not answer, or COFER could not be read. Run npm run check:data for the reason.',
      }),
    ];
  }
  const src = `official, IMF COFER, world (${c.area.id}), ${formatImfPeriod(c.period)}${c.method === 'claims over allocated' ? ', claims in each currency over total allocated reserves' : ''} (pulled ${c.pulledAt.slice(0, 10)})`;
  const own = COFER_CCY_BY_ISO3[iso3];
  const list = [...c.shares].sort((a, b) => (a.ccy === own ? -1 : b.ccy === own ? 1 : b.pct - a.pct)).slice(0, own && !c.shares.slice(0, 5).some((x) => x.ccy === own) ? 6 : 5);
  return list.map((x) => ({
    label: `${x.ccy === own ? 'Own currency: ' : ''}${ccyName(x.ccy)} share of world FX reserves`,
    value: `${x.pct.toFixed(1)}%${x.change4qPts !== undefined ? ` (${x.change4qPts >= 0 ? '+' : ''}${x.change4qPts.toFixed(1)} pts on the year)` : ''}`,
    source: src,
    verified: true,
  }));
}

/** True when a row holds no figure: the value reads Missing (with the reason under it). */
export function rowIsMissing(r: BriefRow): boolean {
  return Boolean(r.missing) || r.value.trim() === 'Missing';
}

/**
 * Splits panels into those with at least one figure and those with none, so a country page
 * leads with what the app actually holds and folds the all-Missing panels into one list of
 * what each still needs. Order inside each half is kept.
 */
export function splitEmptyGroups<G extends { rows: BriefRow[] }>(groups: G[]): { filled: G[]; empty: G[] } {
  const filled: G[] = [];
  const empty: G[] = [];
  for (const g of groups) (g.rows.length && g.rows.every(rowIsMissing) ? empty : filled).push(g);
  return { filled, empty };
}

/** The reasons an all-Missing panel gives, each once, for the folded list ("IMF did not answer"). */
export function emptyGroupReasons(g: { rows: BriefRow[] }): string[] {
  return [...new Set(g.rows.map((r) => r.source.trim()).filter(Boolean))];
}
