/**
 * The credit cycle from the BIS (Bank for International Settlements) SDMX API, free and with no key
 * (gap analysis D3, 2026-11-07). Three dataflows, each read as CSV with its full quarterly history:
 *
 * 1. WS_CREDIT_GAP: credit to the private non-financial sector from all lenders (TC_BORROWERS P,
 *    TC_LENDERS A) as % of GDP. CG_DTYPE A is the ratio, B its long-run trend, C the gap (A minus
 *    B). The codes were read from a live answer on 2026-11-07: Brazil 2025-Q4 A 93.03, B 91.25,
 *    C 1.78, so C = A - B.
 * 2. WS_DSR: debt service ratio of the private non-financial sector (DSR_BORROWERS P), % of income.
 * 3. WS_SPP: selected residential property prices; VALUE R real / N nominal, UNIT_MEASURE 628 index
 *    (2010 = 100) / 771 year-on-year change in per cent. Real y/y change is used.
 *
 * Header names and codes were checked against live answers on 2026-11-07. The BIS host does not
 * answer from this project's cloud session, so the parsers are tested on rows copied from those
 * answers. A country the BIS does not cover, or a quarter it did not publish, has no point.
 *
 * Browser-safe, pure.
 */
import { BIS_API, parseBisCsv } from './bisDebtSecurities';
import { quarterKey } from './debtSchedule';
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export interface BisCreditCycle {
  fetchedAt: string;
  /** Quarter (YYYYQn) -> value, for each series the BIS answered. */
  creditGap?: Record<string, number>;
  creditToGdp?: Record<string, number>;
  dsr?: Record<string, number>;
  realHousePricesYoy?: Record<string, number>;
}

export function bisCreditGapUrl(iso2: string): string {
  return `${BIS_API}/WS_CREDIT_GAP/Q.${iso2}.P.A./all?format=csv`;
}
export function bisDsrUrl(iso2: string): string {
  return `${BIS_API}/WS_DSR/Q.${iso2}../all?format=csv`;
}
export function bisPropertyUrl(iso2: string): string {
  return `${BIS_API}/WS_SPP/Q.${iso2}../all?format=csv`;
}

/** Quarter -> value for the rows `pick` keeps; unreadable rows are skipped. */
function quarters(rows: Array<Record<string, string>>, pick: (r: Record<string, string>) => boolean): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!pick(r) || r.OBS_VALUE === '' || r.OBS_VALUE === 'NaN') continue;
    const q = quarterKey(r.TIME_PERIOD);
    const v = Number(r.OBS_VALUE);
    if (q && Number.isFinite(v)) out[q] = Number(v.toFixed(4));
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseBisCreditGap(text: unknown): Pick<BisCreditCycle, 'creditGap' | 'creditToGdp'> {
  const rows = parseBisCsv(text).filter((r) => r.TC_BORROWERS === 'P' && r.TC_LENDERS === 'A');
  const creditGap = quarters(rows, (r) => r.CG_DTYPE === 'C');
  const creditToGdp = quarters(rows, (r) => r.CG_DTYPE === 'A');
  return { ...(creditGap ? { creditGap } : {}), ...(creditToGdp ? { creditToGdp } : {}) };
}

export function parseBisDsr(text: unknown): Pick<BisCreditCycle, 'dsr'> {
  const dsr = quarters(parseBisCsv(text), (r) => r.DSR_BORROWERS === 'P');
  return dsr ? { dsr } : {};
}

export function parseBisProperty(text: unknown): Pick<BisCreditCycle, 'realHousePricesYoy'> {
  const realHousePricesYoy = quarters(parseBisCsv(text), (r) => r.VALUE === 'R' && r.UNIT_MEASURE === '771');
  return realHousePricesYoy ? { realHousePricesYoy } : {};
}

export const BIS_CREDIT_DEFS = [
  {
    id: 'credit_gap',
    key: 'creditGap',
    label: 'Credit-to-GDP gap',
    unit: 'pp of GDP',
    source: 'BIS credit-to-GDP gaps',
    about:
      'Credit to the private non-financial sector from all lenders, as % of GDP, minus its long-run trend, as the BIS computes it. Basel III guidance starts a countercyclical capital buffer when the gap is above 2 points and sets the maximum at 10 points.',
  },
  {
    id: 'credit_gdp',
    key: 'creditToGdp',
    label: 'Private credit',
    unit: '% of GDP',
    source: 'BIS credit-to-GDP gaps',
    about: 'Credit to the private non-financial sector (households and firms) from all lenders, as % of GDP.',
  },
  {
    id: 'debt_service_ratio',
    key: 'dsr',
    label: 'Debt service ratio, private sector',
    unit: '% of income',
    source: 'BIS debt service ratios',
    about: 'Interest and principal paid by households and non-financial firms, as % of their income.',
  },
  {
    id: 'house_prices_real_yoy',
    key: 'realHousePricesYoy',
    label: 'Real house prices (y/y)',
    unit: '%',
    source: 'BIS selected residential property prices',
    about: 'Residential property prices after inflation, change on the same quarter a year earlier.',
  },
] as const;

/** One series per definition; Missing with the reason when the BIS has not answered or has none. */
export function bisCreditSeries(cycle: BisCreditCycle | null | undefined, covered: boolean): Array<Series | SeriesMissing> {
  return BIS_CREDIT_DEFS.map((d) => {
    if (!covered) return { id: d.id, label: d.label, reason: 'Not a BIS reporting country in the catalogue' };
    if (!cycle) return { id: d.id, label: d.label, reason: 'The BIS has not answered yet' };
    const rates = cycle[d.key];
    const points: SeriesPoint[] = Object.entries(rates || {})
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!points.length) return { id: d.id, label: d.label, reason: `The BIS publishes no ${d.label.toLowerCase()} series for this country` };
    return { id: d.id, label: d.label, unit: d.unit, freq: 'quarterly' as const, source: d.source, pulledAt: cycle.fetchedAt, points, about: d.about };
  });
}
