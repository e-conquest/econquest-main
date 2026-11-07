/**
 * Who holds a government's external debt, and on what terms (gap analysis D6), from the World Bank
 * International Debt Statistics (API source 6, free, no key; low- and middle-income countries only).
 *
 * Public and publicly guaranteed (PPG) external debt outstanding, World counterpart:
 *   DT.DOD.MLAT.CD multilateral, DT.DOD.BLAT.CD bilateral, DT.DOD.PBND.CD bonds,
 *   DT.DOD.PCBK.CD commercial banks, DT.DOD.DPPG.CD total. The four creditor groups need not sum to
 *   the total (Zambia 2024: 15.18 of 15.52 bn; IDS also counts other private creditors).
 * Debt owed to China: DT.DOD.DPPG.CD with counterpart 730 (China), as % of the PPG total.
 * Terms of new commitments: DT.INR.OFFT / DT.INR.PRVT average interest (%), DT.MAT.OFFT /
 *   DT.MAT.PRVT average maturity (years), official and private lenders.
 * Currency: DT.CUR.USDL.ZS, share of PPG debt in US dollars.
 *
 * Codes and names read from live answers on 2026-11-07 (Zambia 2024: multilateral 4.59 bn,
 * bilateral 4.83 bn, bonds 2.74 bn, banks 3.03 bn, total 15.52 bn, USD share 84.0%, official new
 * loans 3.64% for 25.0 years). The same codes on the plain indicator API (WDI) answer "not found",
 * so only the sources API is used. A year with private maturity 0 had no new private commitments
 * (IDS then reports 0 for both interest and maturity): no point is shown for that year rather than
 * a 0% loan. The World Bank host does not answer from this project's cloud session, so the parser
 * is tested on rows shaped like those answers.
 *
 * Browser-safe, pure.
 */
import { WB_API, IDS_SOURCE_ID } from './debtSchedule';
import type { Series, SeriesMissing, SeriesPoint } from './seriesHistory';

export const IDS_CHINA = '730';
export const IDS_CREDITOR_CODES = ['DT.DOD.MLAT.CD', 'DT.DOD.BLAT.CD', 'DT.DOD.PBND.CD', 'DT.DOD.PCBK.CD', 'DT.DOD.DPPG.CD', 'DT.INR.OFFT', 'DT.INR.PRVT', 'DT.MAT.OFFT', 'DT.MAT.PRVT', 'DT.CUR.USDL.ZS'] as const;
type Code = (typeof IDS_CREDITOR_CODES)[number];

export interface IdsCreditors {
  fetchedAt: string;
  /** Year -> value, World counterpart, by series code. */
  world: Partial<Record<Code, Record<string, number>>>;
  /** Year -> PPG debt owed to China, US$. */
  china?: Record<string, number>;
}

export function idsCreditorsUrl(iso3: string): string {
  return `${WB_API}/sources/${IDS_SOURCE_ID}/country/${encodeURIComponent(iso3)}/series/${IDS_CREDITOR_CODES.join(';')}/counterpart-area/WLD/time/all?format=json&per_page=2000`;
}
export function idsChinaUrl(iso3: string): string {
  return `${WB_API}/sources/${IDS_SOURCE_ID}/country/${encodeURIComponent(iso3)}/series/DT.DOD.DPPG.CD/counterpart-area/${IDS_CHINA}/time/all?format=json&per_page=200`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Sources API answer -> series code -> year -> value, for one counterpart. Null when not understood. */
export function parseIdsRows(json: unknown, counterpart: string): Record<string, Record<string, number>> | null {
  const src = (json as any)?.source;
  const data = Array.isArray(src) ? src[0]?.data : src?.data;
  if (!Array.isArray(data)) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const r of data as Array<Record<string, any>>) {
    const vars: Array<Record<string, any>> = Array.isArray(r?.variable) ? r.variable : [];
    const get = (concept: string) => vars.find((x) => String(x?.concept || '').toLowerCase() === concept)?.id;
    const series = get('series');
    const cp = get('counterpart-area');
    const y = String(get('time') ?? '').replace(/^YR/i, '');
    const v = num(r?.value);
    if (!series || v === null || !/^\d{4}$/.test(y) || (cp !== undefined && String(cp) !== counterpart)) continue;
    (out[series] ||= {})[y] = v;
  }
  return out;
}

export function parseIdsCreditors(worldJson: unknown, chinaJson: unknown, fetchedAt: string): IdsCreditors | null {
  const w = parseIdsRows(worldJson, 'WLD');
  if (!w) return null;
  const world: IdsCreditors['world'] = {};
  for (const c of IDS_CREDITOR_CODES) if (w[c] && Object.keys(w[c]).length) world[c] = w[c];
  const china = parseIdsRows(chinaJson, IDS_CHINA)?.['DT.DOD.DPPG.CD'];
  return { fetchedAt, world, ...(china && Object.keys(china).length ? { china } : {}) };
}

const ABOUT_HOLDERS = 'World Bank International Debt Statistics: public and publicly guaranteed external debt outstanding at year end.';
const SHARE = (what: string) => `${ABOUT_HOLDERS} Share owed to ${what}, % of the total (DT.DOD.DPPG.CD).`;

interface Def {
  id: string;
  label: string;
  unit: string;
  about: string;
  value: (year: string, c: IdsCreditors) => number | undefined;
}

const share = (code: Code) => (y: string, c: IdsCreditors) => {
  const part = c.world[code]?.[y];
  const total = c.world['DT.DOD.DPPG.CD']?.[y];
  return part !== undefined && total ? Number(((part / total) * 100).toFixed(1)) : undefined;
};
const raw = (code: Code, skipZero = false) => (y: string, c: IdsCreditors) => {
  const v = c.world[code]?.[y];
  if (v === undefined) return undefined;
  if (skipZero && !c.world['DT.MAT.PRVT']?.[y]) return undefined;
  return Number(v.toFixed(2));
};

export const IDS_CREDITOR_DEFS: Def[] = [
  { id: 'ppg_external_usd', label: 'Public external debt (PPG)', unit: 'USD bn', about: `${ABOUT_HOLDERS} All creditors.`, value: (y, c) => (c.world['DT.DOD.DPPG.CD']?.[y] !== undefined ? Number((c.world['DT.DOD.DPPG.CD']![y] / 1e9).toFixed(2)) : undefined) },
  { id: 'ppg_multilateral_share', label: 'Owed to multilateral lenders', unit: '% of public external debt', about: SHARE('multilateral lenders (IMF, World Bank, regional development banks and others)'), value: share('DT.DOD.MLAT.CD') },
  { id: 'ppg_bilateral_share', label: 'Owed to other governments (bilateral)', unit: '% of public external debt', about: SHARE('other governments and their agencies'), value: share('DT.DOD.BLAT.CD') },
  { id: 'ppg_bonds_share', label: 'Owed to bondholders', unit: '% of public external debt', about: SHARE('holders of bonds issued abroad'), value: share('DT.DOD.PBND.CD') },
  { id: 'ppg_banks_share', label: 'Owed to commercial banks', unit: '% of public external debt', about: SHARE('commercial banks'), value: share('DT.DOD.PCBK.CD') },
  {
    id: 'ppg_china_share',
    label: 'Owed to China',
    unit: '% of public external debt',
    about: `${ABOUT_HOLDERS} Share owed to creditors in China (government, policy banks and other Chinese lenders as the borrower reports them), % of the total. Loans the borrower does not report are not counted.`,
    value: (y, c) => {
      const part = c.china?.[y];
      const total = c.world['DT.DOD.DPPG.CD']?.[y];
      return part !== undefined && total ? Number(((part / total) * 100).toFixed(1)) : undefined;
    },
  },
  { id: 'ppg_usd_share', label: 'Public external debt in US dollars', unit: '%', about: 'World Bank International Debt Statistics: share of public and publicly guaranteed external debt denominated in US dollars.', value: raw('DT.CUR.USDL.ZS') },
  { id: 'new_loans_rate_official', label: 'Interest on new loans, official lenders', unit: '%', about: 'World Bank International Debt Statistics: average interest rate on new external loans committed that year by official lenders (multilateral and bilateral).', value: raw('DT.INR.OFFT') },
  { id: 'new_loans_rate_private', label: 'Interest on new loans, private lenders', unit: '%', about: 'World Bank International Debt Statistics: average interest rate on new external loans and bonds committed that year by private lenders. No point in a year with no new private commitments.', value: raw('DT.INR.PRVT', true) },
  { id: 'new_loans_maturity_official', label: 'Maturity of new loans, official lenders', unit: 'years', about: 'World Bank International Debt Statistics: average maturity of new external loans committed that year by official lenders.', value: raw('DT.MAT.OFFT') },
  { id: 'new_loans_maturity_private', label: 'Maturity of new loans, private lenders', unit: 'years', about: 'World Bank International Debt Statistics: average maturity of new external loans and bonds committed that year by private lenders. No point in a year with no new private commitments.', value: (y, c) => (c.world['DT.MAT.PRVT']?.[y] ? Number(c.world['DT.MAT.PRVT']![y].toFixed(2)) : undefined) },
];

/** One yearly series per definition; Missing with the reason when IDS has not answered or has none. */
export function idsCreditorSeries(c: IdsCreditors | null | undefined): Array<Series | SeriesMissing> {
  return IDS_CREDITOR_DEFS.map((d) => {
    if (!c) return { id: d.id, label: d.label, reason: 'The World Bank International Debt Statistics have not answered yet' };
    const years = new Set<string>([...Object.values(c.world).flatMap((m) => Object.keys(m || {})), ...Object.keys(c.china || {})]);
    const points: SeriesPoint[] = [...years]
      .sort()
      .map((date) => ({ date, value: d.value(date, c) }))
      .filter((p): p is SeriesPoint => p.value !== undefined);
    if (!points.length) return { id: d.id, label: d.label, reason: 'Not in the World Bank International Debt Statistics, which cover low- and middle-income countries only' };
    return { id: d.id, label: d.label, unit: d.unit, freq: 'annual' as const, source: 'World Bank International Debt Statistics', pulledAt: c.fetchedAt, points, about: d.about };
  });
}
