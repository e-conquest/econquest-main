/**
 * Geopolitical Risk index (Caldara and Iacoviello, "Measuring Geopolitical Risk", American Economic
 * Review 2022): the share of articles in leading newspapers about geopolitical tensions, monthly
 * from 1985 (1900 for the historical series), with a country index (GPRC_XXX) for 44 countries.
 *
 * Read from the authors' monthly file saved in data/local/gpr/ as .xlsx or .csv (the site's .xls
 * has to be saved in one of those two forms first). Columns are found by name: a "month" column,
 * GPR (world) and GPRC_<ISO3> (country). Nothing is fetched.
 *
 * Description, not a tested signal. Browser-safe, pure.
 */

export interface GprTable {
  /** YYYY-MM, oldest first. */
  months: string[];
  /** Column name (upper case) -> values by month (null when blank). */
  series: Record<string, Array<number | null>>;
}

export interface GprReading {
  label: string;
  month: string;
  value: number;
  /** Where the latest month sits among all months of the series, % at or below it. */
  percentile: number;
  /** Mean of the 12 months to the latest. */
  mean12: number;
  /** Mean of the whole series. */
  meanAll: number;
}

export const GPR_SOURCE = 'Caldara and Iacoviello Geopolitical Risk index (matteoiacoviello.com/gpr.htm)';
export const GPR_METHOD =
  'Caldara and Iacoviello (AER 2022): share of articles in ten leading newspapers that discuss adverse geopolitical events and threats; the country index counts the articles that also name the country. Shown as published, with where the latest month sits among all months of the series.';

/** Excel serial day, "1985-01-01", "1985-01", "1/1/1985" or "1985m1" to YYYY-MM. */
export function gprMonth(cell: string): string | null {
  const t = String(cell ?? '').trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[ T].*)?$/))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{4})m(\d{1,2})$/i))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n > 300 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return d.toISOString().slice(0, 7);
    }
  }
  return null;
}

/** Rows of the monthly file (header first) to a table; a reason when the layout is not recognised. */
export function parseGprRows(rows: string[][]): GprTable | { reason: string } {
  const hi = rows.findIndex((r) => r.some((c) => /^month$/i.test(String(c).trim())) && r.some((c) => /^GPR$/i.test(String(c).trim())));
  if (hi < 0) return { reason: 'no header row with "month" and "GPR" columns (is this the monthly GPR file?)' };
  const head = rows[hi].map((c) => String(c).trim().toUpperCase());
  const mc = head.indexOf('MONTH');
  const cols = head.map((h, i) => ({ h, i })).filter(({ h, i }) => i !== mc && /^(GPR|GPRC_[A-Z]{3}|GPRHC_[A-Z]{3}|GPRH)$/.test(h));
  const months: string[] = [];
  const series: Record<string, Array<number | null>> = Object.fromEntries(cols.map(({ h }) => [h, []]));
  for (const r of rows.slice(hi + 1)) {
    const month = gprMonth(r[mc]);
    if (!month) continue;
    months.push(month);
    for (const { h, i } of cols) {
      const s = String(r[i] ?? '').trim();
      const v = s === '' ? NaN : Number(s);
      series[h].push(Number.isFinite(v) ? v : null);
    }
  }
  if (!months.length) return { reason: 'no monthly rows under the header' };
  return { months, series };
}

function reading(t: GprTable, col: string, label: string): GprReading | null {
  const vals = t.series[col];
  if (!vals) return null;
  let last = -1;
  for (let i = vals.length - 1; i >= 0; i--)
    if (vals[i] !== null) {
      last = i;
      break;
    }
  if (last < 0) return null;
  const all = vals.filter((v): v is number => v !== null);
  const v = vals[last]!;
  const recent = vals.slice(Math.max(0, last - 11), last + 1).filter((x): x is number => x !== null);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    label,
    month: t.months[last],
    value: r2(v),
    percentile: Math.round((100 * all.filter((x) => x <= v).length) / all.length),
    mean12: r2(recent.reduce((a, x) => a + x, 0) / recent.length),
    meanAll: r2(all.reduce((a, x) => a + x, 0) / all.length),
  };
}

export interface GprCountry {
  world: GprReading | null;
  country: GprReading | null;
  /** Why there is no country index. */
  countryMissing?: string;
}

export function gprForCountry(t: GprTable, iso3: string): GprCountry {
  const iso = iso3.toUpperCase();
  const world = reading(t, 'GPR', 'Geopolitical risk index, world');
  const country = reading(t, `GPRC_${iso}`, 'Geopolitical risk index, country');
  return { world, country, ...(country ? {} : { countryMissing: t.series[`GPRC_${iso}`] ? 'the country column is empty' : 'the GPR file has no country index for this country (it covers 44 countries)' }) };
}
