/**
 * OECD consumer price inflation, monthly (Sam, 2026-11-05: "OECD composite leading indicators and
 * inflation, monthly, no key").
 *
 * Source: the OECD's dataflow DSD_PRICES@DF_PRICES_ALL, headline CPI (all items), monthly, read
 * through DBnomics (api.db.nomics.world, free, no key) because the OECD's own API refused the app
 * with a bot check. The OECD's own annual growth rate (y/y %) is used where it
 * is in the reply; otherwise the y/y change is worked out from the CPI index 12 months apart, and
 * the source says so. The newest month is usually one to two months old.
 *
 * The app asks once a day for every area at once and keeps it on disk (data/live/oecd-cpi.json).
 * Where it has a figure it is the app's inflation figure (fresher than the IMF's annual one);
 * elsewhere the IMF figure stays. Countries the OECD does not cover (Egypt, for one) read
 * "OECD publishes no CPI" on the OECD rows.
 *
 * Readings: the latest y/y rate and month, the change over three months, and a stated rule on
 * that change: up 0.5 pts or more = rising, down 0.5 pts or more = easing, otherwise steady.
 */
import { OECD_AREA_FOR, areaSeries, dbnomicsUrl, formatMonth, parseOecdReply, seriesByArea } from './oecdSdmx';

export const CPI_LABEL = 'OECD consumer prices via DBnomics, all items, y/y';
export const CPI_DATASET = 'DSD_PRICES@DF_PRICES_ALL';

/**
 * DBnomics query for headline CPI. With no area, every area (one call for the whole app).
 * Filtered to monthly, CPI, all items, annual growth rate; `wide` drops the growth-rate filter
 * (used if the narrow query finds nothing), and the reader then works y/y out from the index.
 */
export function cpiUrl(opts: { areas?: string[]; wide?: boolean } = {}): string {
  const areas = (opts.areas || []).flatMap((a) => OECD_AREA_FOR[a] || [a]);
  return dbnomicsUrl(CPI_DATASET, {
    ...(areas.length ? { REF_AREA: areas } : {}),
    FREQ: ['M'],
    MEASURE: ['CPI'],
    EXPENDITURE: ['_T'],
    ...(opts.wide ? {} : { TRANSFORMATION: ['GY'] }),
  });
}

/** 'national': a central bank or Eurostat series that is newer than the OECD's (utils/nationalCpi.ts). */
export type CpiBasis = 'oecd_yoy' | 'from_index' | 'national';
export type CpiSeries = Record<string, { basis: CpiBasis; points: { period: string; value: number }[]; short?: string; long?: string }>;

/** Reads the OECD reply into one y/y series per area. Null when nothing usable. */
export function parseCpi(text: unknown, keepMonths?: number): CpiSeries | null {
  const obs = parseOecdReply(text, keepMonths);
  if (!obs?.length) return null;
  const base = { MEASURE: ['CPI'], FREQ: ['M'], EXPENDITURE: ['_T'] };
  const prefer = { METHODOLOGY: ['N', 'HICP'], ADJUSTMENT: ['N'] };
  const yoy = seriesByArea(obs, { ...base, TRANSFORMATION: ['GY'] }, { ...prefer, UNIT_MEASURE: ['PA', 'PC'] });
  const index = seriesByArea(obs, { ...base, TRANSFORMATION: ['_Z'] }, { ...prefer, UNIT_MEASURE: ['IX'] });
  const out: CpiSeries = {};
  for (const [area, pts] of Object.entries(yoy)) if (pts.length) out[area] = { basis: 'oecd_yoy', points: pts };
  for (const [area, pts] of Object.entries(index)) {
    if (out[area]) continue;
    const by = new Map(pts.map((p) => [p.period, p.value]));
    const derived = pts
      .map((p) => {
        const [y, m] = p.period.split('-').map(Number);
        const prev = by.get(`${y - 1}-${String(m).padStart(2, '0')}`);
        return prev ? { period: p.period, value: Number(((p.value / prev - 1) * 100).toFixed(2)) } : null;
      })
      .filter((p): p is { period: string; value: number } => p !== null);
    if (derived.length) out[area] = { basis: 'from_index', points: derived };
  }
  return Object.keys(out).length ? out : null;
}

export type CpiTrend = 'rising' | 'easing' | 'steady';

/** Stated rule on the change in the y/y rate over three months. */
export function cpiTrend(change3mPts: number): CpiTrend {
  return change3mPts >= 0.5 ? 'rising' : change3mPts <= -0.5 ? 'easing' : 'steady';
}

export interface CpiReading {
  iso3: string;
  /** YYYY-MM of the latest figure. */
  month: string;
  yoyPct: number;
  basis: CpiBasis;
  /** For a national series: short and long source labels. */
  short?: string;
  long?: string;
  /** y/y rate now minus three months earlier, in points. */
  change3mPts?: number;
  trend?: CpiTrend;
}

export function cpiFor(iso3: string, series: CpiSeries | null | undefined): CpiReading | null {
  const s = areaSeries(iso3, series);
  const pts = s?.points;
  if (!s || !pts?.length) return null;
  const last = pts[pts.length - 1];
  const [y, m] = last.period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 7);
  const before = pts.find((p) => p.period === d);
  const change3mPts = before ? Number((last.value - before.value).toFixed(2)) : undefined;
  return {
    iso3,
    month: last.period,
    yoyPct: Number(last.value.toFixed(2)),
    basis: s.basis,
    ...(s.short ? { short: s.short } : {}),
    ...(s.long ? { long: s.long } : {}),
    ...(change3mPts !== undefined ? { change3mPts, trend: cpiTrend(change3mPts) } : {}),
  };
}

/** Source line for a figure. */
export function cpiSource(c: { month: string; basis: CpiBasis; long?: string }): string {
  if (c.basis === 'national' && c.long) return `${c.long}, ${formatMonth(c.month)}`;
  return `OECD via DBnomics, ${formatMonth(c.month)}${c.basis === 'from_index' ? ' (y/y worked out from the OECD CPI index)' : ''}`;
}

/** Why a country has no OECD CPI figure: the OECD answered without it, or did not answer. */
export function cpiMissing(pulled: boolean): { short: string; help: string } {
  return pulled
    ? { short: 'OECD publishes no CPI', help: 'The OECD answered, but publishes no monthly consumer price index for this country.' }
    : { short: 'DBnomics did not answer', help: 'DBnomics (the free mirror the app reads OECD data from) did not answer yet; the app asks again within the hour.' };
}

const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/** "OECD inflation 3.4% y/y (Sep 2026), +0.6 pts over 3 months: rising." */
export function cpiSentence(c: CpiReading): string {
  const base = `Inflation ${c.yoyPct.toFixed(1)}% y/y (${cpiSource(c)})`;
  if (c.change3mPts === undefined || !c.trend) return `${base}.`;
  return `${base}, ${sg(c.change3mPts)} pts over 3 months: ${c.trend}.`;
}
