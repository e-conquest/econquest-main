/**
 * UN Comtrade trade partners and export mix (Sam, 2026-11-05: "UN Comtrade trade partners, which
 * would sharpen the Hormuz/Taiwan/Russia exposure beyond WITS").
 *
 * Source: UN Comtrade, annual goods trade reported by each country (HS classification, US dollars).
 * Two ways in ("support both"):
 * - Public preview, no key: comtradeapi.un.org/public/v1/preview/..., up to 500 rows a request
 *   and a low request rate. The app asks once per country per month and spaces requests out.
 * - Free subscription key in COMTRADE_API_KEY (comtradeplus.un.org > My API portal): the
 *   data/v1/get route, larger limits. Used when set.
 *
 * Two requests per country, each for the latest year the country has reported:
 * 1. Exports and imports with every partner (cmdCode TOTAL): shares with the scenario
 *    counterparties (China, Taiwan, Russia, the Gulf producers) and the top partners.
 * 2. Exports and imports by HS chapter with the world: the export mix (fuels, ores, metals,
 *    farm goods) that the commodity price moves apply to, and the fuel share of imports.
 *
 * Annual figures come one to two years late; every figure carries its year.
 */

export const COMTRADE_LABEL = 'UN Comtrade (annual goods trade, HS)';
export const COMTRADE_HOST = 'comtradeapi.un.org';

/** UN M49 numeric codes for the countries the app covers (Comtrade's reporter codes). */
export const COMTRADE_REPORTERS: Record<string, number> = {
  BRA: 76,
  TUR: 792,
  EGY: 818,
  ZAF: 710,
  MEX: 484,
  IDN: 360,
  JPN: 392,
  IND: 699,
  CHL: 152,
  POL: 616,
  GBR: 826,
  USA: 842,
  CHN: 156,
};

/** Partners the scenarios ask about. Comtrade files Taiwan as "Other Asia, nes" (490). */
export const SCENARIO_PARTNERS = {
  china: [156],
  taiwan: [490],
  russia: [643],
  /** Gulf producers whose oil and gas leave through the Strait of Hormuz. */
  gulf: [364, 368, 414, 634, 682, 784, 48, 512],
} as const;
export type PartnerGroup = keyof typeof SCENARIO_PARTNERS;

export const PARTNER_GROUP_LABEL: Record<PartnerGroup, string> = {
  china: 'China',
  taiwan: 'Taiwan',
  russia: 'Russia',
  gulf: 'Gulf producers (Iran, Iraq, Kuwait, Qatar, Saudi Arabia, UAE, Bahrain, Oman)',
};

/** Names for partner codes that may come without a description. */
const PARTNER_NAMES: Record<number, string> = {
  0: 'World',
  156: 'China',
  490: 'Taiwan',
  643: 'Russia',
  842: 'United States',
  392: 'Japan',
  410: 'Korea',
  276: 'Germany',
  528: 'Netherlands',
  699: 'India',
  76: 'Brazil',
  484: 'Mexico',
  124: 'Canada',
  682: 'Saudi Arabia',
  784: 'UAE',
  364: 'Iran',
  368: 'Iraq',
  634: 'Qatar',
  414: 'Kuwait',
  512: 'Oman',
  48: 'Bahrain',
  826: 'United Kingdom',
  251: 'France',
  381: 'Italy',
  724: 'Spain',
  792: 'Turkey',
  704: 'Viet Nam',
  458: 'Malaysia',
  702: 'Singapore',
  764: 'Thailand',
  344: 'Hong Kong',
  36: 'Australia',
  710: 'South Africa',
  818: 'Egypt',
  360: 'Indonesia',
  32: 'Argentina',
  152: 'Chile',
  616: 'Poland',
  757: 'Switzerland',
  56: 'Belgium',
};

/** HS chapters read for the export mix, grouped by the commodity whose price moves them. */
export const HS_CHAPTERS: Record<string, { name: string; priceCodes: string[] }> = {
  '27': { name: 'Mineral fuels (oil, gas, coal)', priceCodes: ['CRUDE_BRENT', 'NGAS_EUR', 'COAL_AUS'] },
  '26': { name: 'Ores (iron ore, copper ore)', priceCodes: ['IRON_ORE', 'COPPER'] },
  '74': { name: 'Copper', priceCodes: ['COPPER'] },
  '76': { name: 'Aluminium', priceCodes: ['ALUMINUM'] },
  '75': { name: 'Nickel', priceCodes: ['NICKEL'] },
  '71': { name: 'Gold, platinum and precious stones', priceCodes: ['GOLD', 'PLATINUM'] },
  '72': { name: 'Iron and steel', priceCodes: ['IRON_ORE'] },
  '12': { name: 'Oil seeds (soybeans)', priceCodes: ['SOYBEANS'] },
  '10': { name: 'Cereals (maize, wheat)', priceCodes: ['MAIZE', 'WHEAT_US_HRW'] },
  '15': { name: 'Animal and vegetable oils (palm oil)', priceCodes: ['PALM_OIL'] },
  '09': { name: 'Coffee and tea', priceCodes: ['COFFEE_ARABIC'] },
  '18': { name: 'Cocoa', priceCodes: ['COCOA'] },
  '17': { name: 'Sugar', priceCodes: ['SUGAR_WLD'] },
};

export interface ComtradeRow {
  period: string;
  flowCode: 'X' | 'M';
  partnerCode: number;
  partnerName?: string;
  cmdCode: string;
  value: number;
}

/** The years to try, newest first: two and three years back (annual data lags). */
export function comtradeYears(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  return [y - 2, y - 3];
}

/**
 * One request URL. Without a key: the public preview. With one: the data route (the key goes in
 * a header, never in the address). Breakdown codes are pinned to the totals so each partner or
 * chapter comes back once.
 */
export function comtradeUrl(reporter: number, year: number, kind: 'partners' | 'products', keyed: boolean): string {
  const base = keyed ? `https://${COMTRADE_HOST}/data/v1/get/C/A/HS` : `https://${COMTRADE_HOST}/public/v1/preview/C/A/HS`;
  const params = [
    `reporterCode=${reporter}`,
    `period=${year}`,
    'flowCode=X,M',
    ...(kind === 'partners' ? ['cmdCode=TOTAL'] : [`cmdCode=TOTAL,${Object.keys(HS_CHAPTERS).join(',')}`, 'partnerCode=0']),
    'partner2Code=0',
    'customsCode=C00',
    'motCode=0',
    'includeDesc=true',
  ];
  return `${base}?${params.join('&')}`;
}

/** Comtrade {data: [...]} -> rows. Rows that are not totals for the breakdowns, or have no value, are dropped. */
export function parseComtrade(json: unknown): ComtradeRow[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: ComtradeRow[] = [];
  const seen = new Set<string>();
  for (const r of data as Array<Record<string, unknown>>) {
    const flow = String(r?.flowCode ?? '');
    if (flow !== 'X' && flow !== 'M') continue;
    if (r.partner2Code !== undefined && r.partner2Code !== null && Number(r.partner2Code) !== 0) continue;
    if (r.customsCode !== undefined && r.customsCode !== null && String(r.customsCode) !== 'C00') continue;
    if (r.motCode !== undefined && r.motCode !== null && Number(r.motCode) !== 0) continue;
    const partnerCode = Number(r.partnerCode);
    const value = Number(r.primaryValue ?? (flow === 'X' ? r.fobvalue : r.cifvalue));
    const period = String(r.period ?? r.refYear ?? '').slice(0, 4);
    const cmdCode = String(r.cmdCode ?? '');
    if (!Number.isFinite(partnerCode) || !Number.isFinite(value) || value < 0 || !/^\d{4}$/.test(period) || !cmdCode) continue;
    const key = `${period}|${flow}|${partnerCode}|${cmdCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = typeof r.partnerDesc === 'string' && r.partnerDesc.trim() ? r.partnerDesc.trim() : undefined;
    out.push({ period, flowCode: flow, partnerCode, ...(desc ? { partnerName: desc } : {}), cmdCode, value });
  }
  return out;
}

export interface PartnerShare {
  code: number;
  name: string;
  sharePct: number;
  usdBn: number;
}

export interface ComtradeProfile {
  iso3: string;
  /** Year of the partner figures. */
  year: string;
  exportsUsdBn: number;
  importsUsdBn: number;
  /** Share of exports and imports with each scenario counterparty, percent (0 when listed with nothing, absent when not listed). */
  exportSharePct: Partial<Record<PartnerGroup, number>>;
  importSharePct: Partial<Record<PartnerGroup, number>>;
  topExportPartners: PartnerShare[];
  topImportPartners: PartnerShare[];
  /** Year of the export mix, when read. */
  productYear?: string;
  /** HS chapter -> share of exports, percent. */
  exportMixPct?: Record<string, number>;
  /** Mineral fuels (HS 27) as a share of imports, percent. */
  fuelImportSharePct?: number;
}

const r1 = (v: number) => Number(v.toFixed(1));
const bn = (v: number) => Number((v / 1e9).toFixed(2));

/** Partner name from Comtrade's description, else the app's own list. */
const nameOf = (r: ComtradeRow) => (r.partnerCode === 490 ? 'Taiwan' : r.partnerName && !/^other asia/i.test(r.partnerName) ? r.partnerName : PARTNER_NAMES[r.partnerCode] || `Partner ${r.partnerCode}`);

/** A country's profile from its partner rows and (optionally) product rows. Null when there is no World total. */
export function buildProfile(iso3: string, partnerRows: ComtradeRow[], productRows: ComtradeRow[] = []): ComtradeProfile | null {
  const totals = partnerRows.filter((r) => r.cmdCode === 'TOTAL');
  const year = totals.map((r) => r.period).sort().pop();
  if (!year) return null;
  const rows = totals.filter((r) => r.period === year);
  const world = (flow: 'X' | 'M') => rows.find((r) => r.flowCode === flow && r.partnerCode === 0)?.value;
  const wx = world('X');
  const wm = world('M');
  if (!wx || !wm) return null;
  const listed = (flow: 'X' | 'M') => rows.filter((r) => r.flowCode === flow && r.partnerCode !== 0);
  const share = (flow: 'X' | 'M', codes: readonly number[]) => {
    const l = listed(flow);
    if (!l.length) return undefined;
    const sum = l.filter((r) => codes.includes(r.partnerCode)).reduce((s, r) => s + r.value, 0);
    return r1((sum / (flow === 'X' ? wx : wm)) * 100);
  };
  const groupShares = (flow: 'X' | 'M') => {
    const o: Partial<Record<PartnerGroup, number>> = {};
    for (const g of Object.keys(SCENARIO_PARTNERS) as PartnerGroup[]) {
      const v = share(flow, SCENARIO_PARTNERS[g]);
      if (v !== undefined) o[g] = v;
    }
    return o;
  };
  // Codes above 896 and a few others are regional or "not specified" aggregates, not countries.
  const isCountry = (c: number) => c > 0 && c < 897 && ![97, 290, 471, 472, 473, 492, 527, 568, 577, 636, 637, 838, 839, 849, 879, 899].includes(c);
  const top = (flow: 'X' | 'M') =>
    listed(flow)
      .filter((r) => isCountry(r.partnerCode))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((r) => ({ code: r.partnerCode, name: nameOf(r), sharePct: r1((r.value / (flow === 'X' ? wx : wm)) * 100), usdBn: bn(r.value) }));

  const prod = productRows.filter((r) => r.partnerCode === 0);
  const pYear = prod.map((r) => r.period).sort().pop();
  let mix: Record<string, number> | undefined;
  let fuelImports: number | undefined;
  if (pYear) {
    const p = prod.filter((r) => r.period === pYear);
    const px = p.find((r) => r.flowCode === 'X' && r.cmdCode === 'TOTAL')?.value;
    const pm = p.find((r) => r.flowCode === 'M' && r.cmdCode === 'TOTAL')?.value;
    if (px) {
      mix = {};
      for (const ch of Object.keys(HS_CHAPTERS)) {
        const v = p.find((r) => r.flowCode === 'X' && r.cmdCode === ch)?.value;
        if (v !== undefined) mix[ch] = r1((v / px) * 100);
      }
    }
    const f = p.find((r) => r.flowCode === 'M' && r.cmdCode === '27')?.value;
    if (pm && f !== undefined) fuelImports = r1((f / pm) * 100);
  }
  return {
    iso3,
    year,
    exportsUsdBn: bn(wx),
    importsUsdBn: bn(wm),
    exportSharePct: groupShares('X'),
    importSharePct: groupShares('M'),
    topExportPartners: top('X'),
    topImportPartners: top('M'),
    ...(pYear && mix ? { productYear: pYear, exportMixPct: mix } : {}),
    ...(fuelImports !== undefined ? { fuelImportSharePct: fuelImports } : {}),
  };
}

/** Why a country has no Comtrade figure. */
export function comtradeMissing(iso3: string, keyed: boolean): { short: string; help: string } {
  if (!COMTRADE_REPORTERS[iso3]) return { short: 'Not in the app’s Comtrade list', help: 'This country has no Comtrade reporter code in the app yet.' };
  return keyed
    ? { short: 'Comtrade did not answer', help: 'UN Comtrade did not answer with your key, or this country has not reported the last two years.' }
    : {
        short: 'Comtrade did not answer',
        help: 'The free Comtrade preview did not answer (it allows few requests), or this country has not reported the last two years. A free key (Menu > Settings, or COMTRADE_API_KEY) gives higher limits.',
      };
}

/** "China 30.7% of exports, Taiwan 0.6%, Russia 0.4% (UN Comtrade 2024)." */
export function partnerSentence(p: ComtradeProfile): string {
  const parts = (['china', 'taiwan', 'russia', 'gulf'] as PartnerGroup[])
    .filter((g) => p.exportSharePct[g] !== undefined)
    .map((g) => `${g === 'gulf' ? 'Gulf' : PARTNER_GROUP_LABEL[g]} ${p.exportSharePct[g]!.toFixed(1)}%`);
  return `Exports $${p.exportsUsdBn.toFixed(1)}bn${parts.length ? `: ${parts.join(', ')} of the total` : ''} (UN Comtrade ${p.year}).`;
}
