/**
 * US Treasury International Capital (TIC): foreign holdings of US Treasury securities by country
 * (Sam, 2026-11-05: "CFTC and TIC positioning").
 *
 * Source: Treasury's "Major Foreign Holders of Treasury Securities" table (slt_table5.txt on
 * ticdata.treasury.gov, free, no key). It is monthly, published around the 18th for the month
 * two months earlier, and holds the last 13 month-ends in billions of dollars. It names about 20
 * holders; the rest are in "All Other", so most smaller countries have no figure of their own.
 *
 * The old table (mfh.txt) stopped at January 2023 and is not used.
 *
 * What the app reads, per country it lists: holdings at the latest month-end, the change over a
 * month and over 12 months, and the share of all foreign holdings. A stated rule calls the
 * 12-month change: down 10% or more = selling, up 10% or more = buying, otherwise steady.
 */

export const TIC_LABEL = 'US Treasury TIC, Major Foreign Holders of Treasury Securities';
export const TIC_HOST = 'ticdata.treasury.gov';
export const TIC_URL = `https://${TIC_HOST}/resource-center/data-chart-center/tic/Documents/slt_table5.txt`;

/** Treasury's row names for the countries the app files. */
export const TIC_NAMES: Record<string, string> = {
  'japan': 'JPN',
  'united kingdom': 'GBR',
  'china, mainland': 'CHN',
  'brazil': 'BRA',
  'india': 'IND',
  'mexico': 'MEX',
  'turkey': 'TUR',
  'turkiye': 'TUR',
  'poland': 'POL',
  'chile': 'CHL',
  'south africa': 'ZAF',
  'indonesia': 'IDN',
  'egypt': 'EGY',
  'russia': 'RUS',
  'korea, south': 'KOR',
  'taiwan': 'TWN',
  'saudi arabia': 'SAU',
  'switzerland': 'CHE',
  'canada': 'CAN',
};

export interface TicTable {
  /** Month-ends, newest first, YYYY-MM. */
  months: string[];
  /** ISO3 -> holdings by month (same order as months), USD bn. */
  rows: Record<string, number[]>;
  /** All foreign holders, by month. */
  total?: number[];
  /** Of which foreign official holders, by month. */
  official?: number[];
}

/** Splits on tabs, or on runs of two or more spaces when the file comes without tabs. */
const cells = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map((c) => c.trim());

/** Reads slt_table5.txt. Null when no header row with YYYY-MM months is found. */
export function parseTicTable(text: unknown): TicTable | null {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^country\b/i.test(l.trim()) && /\d{4}-\d{2}/.test(l));
  if (hi < 0) return null;
  const months = cells(lines[hi]).slice(1).filter((c) => /^\d{4}-\d{2}$/.test(c));
  if (months.length < 2) return null;
  const out: TicTable = { months, rows: {} };
  for (const line of lines.slice(hi + 1)) {
    const c = cells(line);
    if (c.length < months.length + 1) continue;
    const name = c[0].toLowerCase().replace(/\s+/g, ' ');
    const vals = c.slice(1, months.length + 1).map(Number);
    if (!vals.every((v) => Number.isFinite(v) && v >= 0)) continue;
    if (name === 'grand total') out.total = vals;
    else if (name === 'of which: foreign official') out.official = vals;
    else if (TIC_NAMES[name]) out.rows[TIC_NAMES[name]] = vals;
  }
  return Object.keys(out.rows).length ? out : null;
}

export interface TicHolding {
  iso3: string;
  /** YYYY-MM month-end of the latest figure. */
  month: string;
  holdingsUsdBn: number;
  change1mUsdBn?: number;
  /** Change over 12 months (needs 13 month-ends). */
  change12mUsdBn?: number;
  change12mPct?: number;
  /** Share of all foreign holdings, percent. */
  shareOfForeignPct?: number;
}

export function ticHoldingFor(iso3: string, table: TicTable | null | undefined): TicHolding | null {
  const v = table?.rows[iso3];
  if (!table || !v?.length) return null;
  const now = v[0];
  const yearAgo = v.length >= 13 ? v[12] : undefined;
  return {
    iso3,
    month: table.months[0],
    holdingsUsdBn: now,
    ...(v.length > 1 ? { change1mUsdBn: Number((now - v[1]).toFixed(1)) } : {}),
    ...(yearAgo !== undefined ? { change12mUsdBn: Number((now - yearAgo).toFixed(1)) } : {}),
    ...(yearAgo ? { change12mPct: Number(((now / yearAgo - 1) * 100).toFixed(1)) } : {}),
    ...(table.total?.[0] ? { shareOfForeignPct: Number(((now / table.total[0]) * 100).toFixed(1)) } : {}),
  };
}

export type TicTrend = 'selling' | 'buying' | 'steady';

/** Stated rule on the 12-month change: -10% or less = selling, +10% or more = buying. */
export function ticTrend(change12mPct: number): TicTrend {
  return change12mPct <= -10 ? 'selling' : change12mPct >= 10 ? 'buying' : 'steady';
}

/** Why a country has no TIC figure. */
export function ticMissing(iso3: string): { short: string; help: string } {
  return Object.values(TIC_NAMES).includes(iso3)
    ? {
        short: 'Not listed by Treasury',
        help: 'Treasury names only its largest foreign holders (about 20); this country is in "All Other", or the TIC file did not answer.',
      }
    : { short: 'Not listed by Treasury', help: 'Treasury names only its largest foreign holders (about 20); this country is in "All Other".' };
}

export function formatMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[mo - 1] ? `${names[mo - 1]} ${y}` : m;
}

const sg = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`;

/** "Holds $168.4bn of US Treasuries (Aug 2026), down 8.8% on the year: steady." */
export function ticSentence(t: TicHolding): string {
  const base = `Holds $${t.holdingsUsdBn.toFixed(1)}bn of US Treasuries (TIC, ${formatMonth(t.month)})`;
  if (t.change12mPct === undefined) return `${base}.`;
  const trend = ticTrend(t.change12mPct);
  return `${base}, ${sg(t.change12mPct)}% on the year: ${trend === 'steady' ? 'steady' : `${trend} Treasuries`}.`;
}
