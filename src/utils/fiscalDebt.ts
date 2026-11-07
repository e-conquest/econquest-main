/**
 * Public debt and fiscal figures for the Fiscal & Debt Agent (Sam, 2026-11-05).
 *
 * Every figure here comes from a live feed the app already pulls, and only when that feed answered:
 * - IMF World Economic Outlook (DataMapper): general government gross debt, % of GDP
 *   (GGXWDG_NGDP), the IMF's own projection a year or two out, primary balance (GGXONLB_G01_GDP_PT) and
 *   real GDP growth (NGDP_RPCH), each with the WEO year it is for.
 * - World Bank QEDS: general government external principal falling due in the next 12 months.
 * - World Bank IDS: projected public external debt service by calendar year.
 * - BIS: government bonds in international markets (and the part due within a year), and
 *   government debt securities in all markets.
 *
 * The rules on top (debt path, debt-stabilising primary balance, reserve cover) are stated here and
 * shown with their inputs; they are the agent's readings, not forecasts.
 */
import type { OpenDataSnapshot } from '../types/council';

export interface YearValue {
  value: number;
  /** WEO year, e.g. "2025". */
  year: string;
}

export interface FiscalFigures {
  debtPctGdp?: YearValue;
  /** The IMF's own WEO projection, a later year than debtPctGdp. */
  debtProjectionPctGdp?: YearValue;
  primaryBalancePctGdp?: YearValue;
  realGrowthPct?: YearValue;
  /** QEDS: general government external principal due in the next 12 months, from the quarter shown. */
  extDue12m?: { usdBn: number; asOf: string };
  /** IDS: projected public external debt service in the first projection year after this one. */
  idsNext?: { year: number; debtServiceUsdBn?: number; principalUsdBn?: number };
  /** BIS: government bonds in international markets. */
  intlBonds?: { usdBn: number; due1yUsdBn?: number; asOf: string };
  /** BIS: government debt securities in all markets. */
  allSecurities?: { usdBn: number; asOf: string; valuation: 'nominal' | 'market' };
}

export const WEO_LABEL = 'IMF World Economic Outlook';
export const QEDS_SHORT = 'World Bank QEDS';
export const IDS_SHORT = 'World Bank IDS projections';
export const BIS_SECURITIES_SHORT = 'BIS debt securities';

/** Change in debt/GDP (points) from now to the IMF projection that counts as rising or falling. */
export const DEBT_PATH_PTS = 2;

/** Only figures a live feed marked; nothing built in. Returns undefined when no figure is live. */
export function fiscalFromSnapshot(snap: OpenDataSnapshot, now: Date = new Date()): FiscalFigures | undefined {
  const lf = snap.liveFields || {};
  const years = snap.imfIndicators?.years || {};
  const yv = (key: string, value: number | undefined): YearValue | undefined =>
    lf[key] && years[key] && typeof value === 'number' && Number.isFinite(value) ? { value, year: years[key] } : undefined;
  const out: FiscalFigures = {};
  const debt = yv('imf.debtToGdpPct', snap.imfIndicators?.debtToGdpPct);
  if (debt) out.debtPctGdp = debt;
  const proj = yv('imf.debtToGdpForecast2027Pct', snap.imfIndicators?.debtToGdpForecast2027Pct);
  if (proj && (!debt || Number(proj.year) > Number(debt.year))) out.debtProjectionPctGdp = proj;
  const pb = yv('imf.primaryFiscalBalancePct', snap.imfIndicators?.primaryFiscalBalancePct);
  if (pb) out.primaryBalancePctGdp = pb;
  const g = yv('imf.realGdpGrowthPct', snap.imfIndicators?.realGdpGrowthPct);
  if (g) out.realGrowthPct = g;
  const ds = snap.debtSchedule;
  if (ds?.qeds) out.extDue12m = { usdBn: ds.qeds.next12mUsdBn, asOf: ds.qeds.asOf };
  const nextYear = ds?.ids?.years.filter((y) => y.year > now.getUTCFullYear()).sort((a, b) => a.year - b.year)[0];
  if (nextYear && (nextYear.debtServiceUsdBn !== undefined || nextYear.principalUsdBn !== undefined)) {
    out.idsNext = { year: nextYear.year, ...(nextYear.debtServiceUsdBn !== undefined ? { debtServiceUsdBn: nextYear.debtServiceUsdBn } : {}), ...(nextYear.principalUsdBn !== undefined ? { principalUsdBn: nextYear.principalUsdBn } : {}) };
  }
  if (ds?.bis?.intl) out.intlBonds = { usdBn: ds.bis.intl.outstandingUsdBn, ...(ds.bis.intl.dueWithin1yUsdBn !== undefined ? { due1yUsdBn: ds.bis.intl.dueWithin1yUsdBn } : {}), asOf: ds.bis.intl.asOf };
  if (ds?.bis?.all) out.allSecurities = { usdBn: ds.bis.all.outstandingUsdBn, asOf: ds.bis.all.asOf, valuation: ds.bis.all.valuation };
  return Object.keys(out).length ? out : undefined;
}

export type DebtPath = 'rising' | 'stable' | 'falling';

/** Debt path from the IMF's own projection: 2 points or more up = rising, 2 or more down = falling. */
export function debtPath(f: FiscalFigures): { path: DebtPath; changePts: number } | undefined {
  if (!f.debtPctGdp || !f.debtProjectionPctGdp) return undefined;
  const changePts = f.debtProjectionPctGdp.value - f.debtPctGdp.value;
  return { path: changePts >= DEBT_PATH_PTS ? 'rising' : changePts <= -DEBT_PATH_PTS ? 'falling' : 'stable', changePts };
}

/**
 * Primary balance that holds debt/GDP steady: pb* = d × (r − g) / (1 + g), with r the real
 * borrowing cost and g real growth, both as fractions. The app uses the 10Y yield less inflation as
 * r, which is the cost of new borrowing and usually above the average cost of the debt already
 * outstanding, so pb* leans high for countries whose rates have risen.
 */
export function stabilisingPrimaryBalance(debtPct: number, realRatePct: number, realGrowthPct: number): number {
  const r = realRatePct / 100;
  const g = realGrowthPct / 100;
  return debtPct * ((r - g) / (1 + g));
}

/** Reserve cover of the government's external principal due in a year: under 1 = thin, 1 to 3 = adequate, over 3 = ample. */
export function coverLabel(times: number): 'thin' | 'adequate' | 'ample' {
  return times < 1 ? 'thin' : times <= 3 ? 'adequate' : 'ample';
}

/** "2026Q2" -> "Q2 2026"; anything else as given. */
export function formatQuarter(q: string): string {
  const m = q.match(/^(\d{4})-?Q([1-4])$/i);
  return m ? `Q${m[2]} ${m[1]}` : q;
}
