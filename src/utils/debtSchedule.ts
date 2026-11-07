/**
 * Government external debt falling due, from two free official World Bank APIs.
 *
 * 1. QEDS, Quarterly External Debt Statistics (World Bank API source 22, compiled with the IMF from
 *    countries' SDDS reports): general government external debt service, principal, by remaining
 *    maturity: up to 3 months, 3-6, 6-9 and 9-12 months, as of the latest reported quarter. External
 *    debt means debt owed to non-residents in any currency, including local-currency bonds they hold.
 * 2. IDS, International Debt Statistics (source 6, low- and middle-income countries only): projected
 *    principal and total debt service on public and publicly guaranteed external debt, by calendar
 *    year, World counterpart (all creditors).
 *
 * Series codes: IDS DT.AMT.DPPG.CD and DT.TDS.DPPG.CD with counterpart WLD match the econquest data
 * pull of 2026-10 (one row per country and year, projections for 2027-2032). The QEDS codes were read
 * from the source 22 indicator list on 2026-11-04. Neither host answers from this project's cloud
 * session, so the response parsers follow the World Bank API's documented JSON and are tested on
 * fixtures; when a series is missing or a response is not understood, the feed returns nothing and
 * the brief keeps its sample figures, labelled sample.
 */

export const WB_API = 'https://api.worldbank.org/v2';
export const QEDS_SOURCE_ID = 22;
export const IDS_SOURCE_ID = 6;

/** QEDS general government external debt service (principal) by remaining maturity, US$. */
export const QEDS_GG_BUCKETS: Array<{ code: string; label: string; months: [number, number] }> = [
  { code: 'DT.AMT.DECT.CD.GG.03', label: 'Next 3 months', months: [0, 3] },
  { code: 'DT.AMT.DECT.CD.GG.36', label: '3 to 6 months', months: [3, 6] },
  { code: 'DT.AMT.DECT.CD.GG.69', label: '6 to 9 months', months: [6, 9] },
  { code: 'DT.AMT.DECT.CD.GG.0912', label: '9 to 12 months', months: [9, 12] },
];

export const IDS_PRINCIPAL = 'DT.AMT.DPPG.CD';
export const IDS_DEBT_SERVICE = 'DT.TDS.DPPG.CD';
export const IDS_WORLD = 'WLD';

export const QEDS_LABEL = 'QEDS quarterly external debt statistics';
export const IDS_LABEL = 'IDS international debt statistics, projections';

export interface DebtSchedule {
  /** Next 12 months of general government external principal, from the latest QEDS quarter. */
  qeds?: {
    /** Reporting quarter the schedule is measured from, e.g. "2026Q2". */
    asOf: string;
    buckets: Array<{ label: string; usdBn: number }>;
    next12mUsdBn: number;
  };
  /** Projected public external debt service by calendar year (IDS). */
  ids?: {
    years: Array<{ year: number; principalUsdBn?: number; debtServiceUsdBn?: number }>;
  };
  /** Government debt securities outstanding (BIS): international markets and all markets. */
  bis?: import('./bisDebtSecurities').BisDebtSecurities;
  fetchedAt: string;
}

export function qedsUrl(iso3: string): string {
  const codes = QEDS_GG_BUCKETS.map((b) => b.code).join(';');
  return `${WB_API}/country/${encodeURIComponent(iso3)}/indicator/${codes}?source=${QEDS_SOURCE_ID}&format=json&mrv=4&per_page=200`;
}

export function idsUrl(iso3: string): string {
  return `${WB_API}/sources/${IDS_SOURCE_ID}/country/${encodeURIComponent(iso3)}/series/${IDS_PRINCIPAL};${IDS_DEBT_SERVICE}/counterpart-area/${IDS_WORLD}/time/all?format=json&per_page=1000`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Quarter keys as served: "2026Q2", "2026-Q2" or "YR2026Q2". Returns a sortable key or null. */
export function quarterKey(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(?:YR)?(\d{4})[-\s]?Q([1-4])$/i);
  return m ? `${m[1]}Q${m[2]}` : null;
}

/**
 * QEDS answer (the v2 indicator API: [meta, rows], each row with indicator.id, date and value) ->
 * the four buckets for the latest quarter that has all four. Anything else -> null.
 */
export function parseQeds(json: unknown): DebtSchedule['qeds'] | null {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return null;
  const byQuarter = new Map<string, Map<string, number>>();
  for (const r of json[1] as Array<Record<string, any>>) {
    const code = r?.indicator?.id;
    const q = quarterKey(r?.date);
    const v = num(r?.value);
    if (!code || !q || v === null) continue;
    if (!byQuarter.has(q)) byQuarter.set(q, new Map());
    byQuarter.get(q)!.set(String(code), v);
  }
  const full = [...byQuarter.entries()]
    .filter(([, m]) => QEDS_GG_BUCKETS.every((b) => m.has(b.code)))
    .sort((a, b) => b[0].localeCompare(a[0]));
  if (!full.length) return null;
  const [asOf, m] = full[0];
  const buckets = QEDS_GG_BUCKETS.map((b) => ({ label: b.label, usdBn: m.get(b.code)! / 1e9 }));
  if (buckets.some((b) => b.usdBn < 0)) return null;
  return { asOf, buckets, next12mUsdBn: buckets.reduce((a, b) => a + b.usdBn, 0) };
}

/**
 * IDS answer (the v2 sources API: source.data[], each with variable[] of {concept, id} and value)
 * -> years at or after `fromYear`, World counterpart only. Two values for one series and year are
 * refused (per-creditor rows mixed in), as in the econquest pull.
 */
export function parseIds(json: unknown, fromYear: number): DebtSchedule['ids'] | null {
  const src = (json as any)?.source;
  const data = Array.isArray(src) ? src[0]?.data : src?.data;
  if (!Array.isArray(data)) return null;
  const years = new Map<number, { year: number; principalUsdBn?: number; debtServiceUsdBn?: number }>();
  for (const r of data as Array<Record<string, any>>) {
    const vars: Array<Record<string, any>> = Array.isArray(r?.variable) ? r.variable : [];
    const get = (concept: string) => vars.find((x) => String(x?.concept || '').toLowerCase() === concept)?.id;
    const series = get('series');
    const cp = get('counterpart-area');
    const y = Number(String(get('time') ?? '').replace(/^YR/i, ''));
    const v = num(r?.value);
    if (v === null || !Number.isInteger(y) || y < fromYear) continue;
    if (cp !== undefined && cp !== IDS_WORLD) continue;
    const row = years.get(y) || { year: y };
    const key = series === IDS_PRINCIPAL ? 'principalUsdBn' : series === IDS_DEBT_SERVICE ? 'debtServiceUsdBn' : null;
    if (!key) continue;
    if (row[key] !== undefined) return null;
    row[key] = v / 1e9;
    years.set(y, row);
  }
  const out = [...years.values()].sort((a, b) => a.year - b.year);
  return out.length ? { years: out } : null;
}

/** "Q2 2026" from "2026Q2". */
export function quarterLabel(q: string): string {
  const m = q.match(/^(\d{4})Q([1-4])$/);
  return m ? `Q${m[2]} ${m[1]}` : q;
}
