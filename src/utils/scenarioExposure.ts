/**
 * Scenario exposure: which countries a Hormuz, Taiwan Strait or Russia shock would hit hardest,
 * through trade. Owned by the Global Spillover Agent (the council agent of that name).
 *
 * Inputs are official trade figures (free, no key), checked 2026-11-04:
 * - World Bank WDI: fuel imports and fuel exports (% of merchandise trade), imports and exports
 *   of goods and services (% of GDP). Latest year, usually last year.
 * - World Bank WITS: partner shares of exports and imports (China, Russia). Latest year available.
 *
 * - UN Comtrade (src/utils/comtradeTrade.ts): partner shares with China, Taiwan, Russia and the
 *   Gulf producers, and the export mix by HS chapter. Used in place of WITS when it answered.
 * - World Bank Pink Sheet (src/utils/commodityPrices.ts): the latest Brent price and each
 *   commodity's actual 12-month price move.
 *
 * Each scenario is a stated shock applied to those shares, giving a first-round hit to the
 * current account in % of GDP. It is a model: no second-round effects, no price elasticities,
 * and fuel shares of merchandise trade are applied to goods-and-services totals (an approximation).
 */

export const WB_TRADE_INDICATORS = {
  fuelImportsPctMerch: 'TM.VAL.FUEL.ZS.UN',
  fuelExportsPctMerch: 'TX.VAL.FUEL.ZS.UN',
  importsPctGdp: 'NE.IMP.GNFS.ZS',
  exportsPctGdp: 'NE.EXP.GNFS.ZS',
} as const;
export type WbTradeKey = keyof typeof WB_TRADE_INDICATORS;

export function wbIndicatorUrl(iso3s: string[], indicator: string): string {
  return `https://api.worldbank.org/v2/country/${iso3s.join(';')}/indicator/${indicator}?format=json&mrnev=1&per_page=100`;
}

/** World Bank [meta, rows] reply -> ISO3 -> { value, year }. */
export function parseWbLatest(json: unknown): Map<string, { value: number; year: string }> {
  const out = new Map<string, { value: number; year: string }>();
  const rows = Array.isArray(json) ? json[1] : null;
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Array<{ countryiso3code?: string; date?: string; value?: unknown }>) {
    const v = typeof r.value === 'number' ? r.value : NaN;
    if (!r.countryiso3code || !Number.isFinite(v)) continue;
    const prev = out.get(r.countryiso3code);
    if (!prev || String(r.date) > prev.year) out.set(r.countryiso3code, { value: v, year: String(r.date) });
  }
  return out;
}

export type WitsIndicator = 'XPRT-PRTNR-SHR' | 'MPRT-PRTNR-SHR';
export function witsUrl(iso3: string, partner: string, indicator: WitsIndicator, year: number): string {
  return `https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-trade/reporter/${iso3.toLowerCase()}/year/${year}/partner/${partner.toLowerCase()}/product/all/indicator/${indicator}`;
}

/** WITS SDMX reply: <Obs TIME_PERIOD="2023" OBS_VALUE="30.7112" .../>. Share in percent. */
export function parseWitsShare(xml: unknown): { pct: number; year: string } | null {
  if (typeof xml !== 'string') return null;
  const obs = xml.match(/<Obs\b[^>]*>/);
  if (!obs) return null;
  const year = obs[0].match(/TIME_PERIOD="(\d{4})"/)?.[1];
  const val = Number(obs[0].match(/OBS_VALUE="([-\d.]+)"/)?.[1]);
  if (!year || !Number.isFinite(val) || val < 0 || val > 100) return null;
  return { pct: val, year };
}

export interface TradeExposure {
  fuelImportsPctMerch?: number;
  fuelExportsPctMerch?: number;
  importsPctGdp?: number;
  exportsPctGdp?: number;
  /** Year of the World Bank figures. */
  wbYear?: string;
  chinaExportSharePct?: number;
  russiaExportSharePct?: number;
  russiaImportSharePct?: number;
  /** Year of the WITS partner shares. */
  witsYear?: string;
  /** Where the partner shares came from, e.g. "UN Comtrade 2024" (absent = WITS). */
  partnerSource?: string;
  /** Exports to Taiwan, % of exports (UN Comtrade; WITS has no Taiwan figure). */
  taiwanExportSharePct?: number;
  /** Imports from the Gulf producers, % of imports (UN Comtrade). */
  gulfImportSharePct?: number;
  /** HS chapter -> % of goods exports (UN Comtrade). */
  exportMixPct?: Record<string, number>;
  /** Year of the export mix. */
  exportMixYear?: string;
  /** Pink Sheet code -> actual 12-month price change, %. */
  priceMoves12m?: Record<string, number>;
  /** Pink Sheet code -> actual 3-month price change, %, for the shock early warning. */
  priceMoves3m?: Record<string, number>;
  /** Month of the latest prices (YYYY-MM). */
  pricesAsOf?: string;
  /** Latest monthly Brent price, $/bbl. */
  brentUsd?: number;
}

export type ScenarioId = 'hormuz' | 'taiwan' | 'russia' | 'prices';

export interface ScenarioDef {
  id: ScenarioId;
  name: string;
  shock: string;
}

export const SCENARIOS: ScenarioDef[] = [
  { id: 'hormuz', name: 'Strait of Hormuz closed', shock: 'Oil up 50%: net fuel imports cost 50% more (exporters gain).' },
  { id: 'taiwan', name: 'Taiwan Strait crisis', shock: 'Exports to China and Taiwan fall 20%.' },
  { id: 'russia', name: 'Russia escalation', shock: 'Trade with Russia halves (exports and imports).' },
  {
    id: 'prices',
    name: 'Commodity prices, last 12 months',
    shock: 'Actual 12-month price moves (World Bank Pink Sheet) applied to the export mix (UN Comtrade) and to fuel imports.',
  },
];

/** HS chapter -> Pink Sheet codes whose price moves it. */
export const CHAPTER_PRICES: Record<string, string[]> = {
  '27': ['CRUDE_BRENT', 'NGAS_EUR', 'COAL_AUS'],
  '26': ['IRON_ORE', 'COPPER'],
  '74': ['COPPER'],
  '76': ['ALUMINUM'],
  '75': ['NICKEL'],
  '71': ['GOLD', 'PLATINUM'],
  '72': ['IRON_ORE'],
  '12': ['SOYBEANS'],
  '10': ['MAIZE', 'WHEAT_US_HRW'],
  '15': ['PALM_OIL'],
  '09': ['COFFEE_ARABIC'],
  '18': ['COCOA'],
  '17': ['SUGAR_WLD'],
};
const CHAPTER_SHORT: Record<string, string> = {
  '27': 'fuels',
  '26': 'ores',
  '74': 'copper',
  '76': 'aluminium',
  '75': 'nickel',
  '71': 'gold and platinum',
  '72': 'steel',
  '12': 'soybeans',
  '10': 'cereals',
  '15': 'palm oil',
  '09': 'coffee',
  '18': 'cocoa',
  '17': 'sugar',
};

export interface ScenarioImpact {
  /** First-round current account effect, % of GDP. Negative = hit. */
  pctGdp: number;
  /** The figures behind it, in words. */
  basis: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const partnerSrc = (t: TradeExposure) => t.partnerSource || `WITS ${t.witsYear}`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;

/** First-round current account effect of one scenario, or null when a needed figure is missing. */
export function scenarioImpact(id: ScenarioId, t: TradeExposure): ScenarioImpact | null {
  if (id === 'hormuz') {
    if ([t.fuelImportsPctMerch, t.fuelExportsPctMerch, t.importsPctGdp, t.exportsPctGdp].some((v) => v === undefined)) return null;
    const netFuel = ((t.fuelImportsPctMerch as number) / 100) * (t.importsPctGdp as number) - ((t.fuelExportsPctMerch as number) / 100) * (t.exportsPctGdp as number);
    const extras = [
      t.brentUsd !== undefined && t.pricesAsOf ? `Brent $${t.brentUsd.toFixed(0)} in ${t.pricesAsOf} would be about $${(t.brentUsd * 1.5).toFixed(0)} (Pink Sheet)` : '',
      t.gulfImportSharePct !== undefined ? `${t.gulfImportSharePct.toFixed(1)}% of imports come from the Gulf producers (${partnerSrc(t)})` : '',
    ].filter(Boolean);
    return {
      pctGdp: r2(-0.5 * netFuel),
      basis: `net fuel ${netFuel >= 0 ? 'imports' : 'exports'} about ${Math.abs(netFuel).toFixed(1)}% of GDP (World Bank, ${t.wbYear})${extras.length ? `; ${extras.join('; ')}` : ''}`,
    };
  }
  if (id === 'taiwan') {
    if (t.chinaExportSharePct === undefined || t.exportsPctGdp === undefined) return null;
    const toChina = (t.chinaExportSharePct / 100) * t.exportsPctGdp;
    const hasTw = t.taiwanExportSharePct !== undefined;
    const toTaiwan = hasTw ? ((t.taiwanExportSharePct as number) / 100) * t.exportsPctGdp : 0;
    const shares = `${t.chinaExportSharePct.toFixed(0)}% of exports to China${hasTw ? `, ${(t.taiwanExportSharePct as number).toFixed(1)}% to Taiwan` : '; Taiwan not available'}`;
    return {
      pctGdp: r2(-0.2 * (toChina + toTaiwan)),
      basis: `exports to China${hasTw ? ' and Taiwan' : ''} about ${(toChina + toTaiwan).toFixed(1)}% of GDP (${shares}, ${partnerSrc(t)})`,
    };
  }
  if (id === 'prices') return priceShock(t, t.priceMoves12m);
  if (t.russiaExportSharePct === undefined || t.russiaImportSharePct === undefined || t.exportsPctGdp === undefined || t.importsPctGdp === undefined) return null;
  const withRussia = (t.russiaExportSharePct / 100) * t.exportsPctGdp + (t.russiaImportSharePct / 100) * t.importsPctGdp;
  return { pctGdp: r2(-0.5 * withRussia), basis: `trade with Russia about ${withRussia.toFixed(1)}% of GDP (${partnerSrc(t)})` };
}

/** Countries ranked from hardest hit to most helped, for one scenario. */
/**
 * The actual price moves over a window applied to the export mix and the fuel bill, % of GDP, as if
 * prices held at today's level for a year. Used with the 12-month moves for the scenario and with the
 * 3-month moves for the shock early warning.
 */
export function priceShock(t: TradeExposure, moves: Record<string, number> | undefined): ScenarioImpact | null {
  const mix = t.exportMixPct;
  if (!moves || !mix || t.exportsPctGdp === undefined || t.importsPctGdp === undefined || t.fuelImportsPctMerch === undefined || moves.CRUDE_BRENT === undefined) return null;
  const parts: Array<{ ch: string; effect: number; move: number }> = [];
  for (const [ch, share] of Object.entries(mix)) {
    const codes = (CHAPTER_PRICES[ch] || []).filter((c) => moves[c] !== undefined);
    if (!codes.length || share <= 0) continue;
    const move = codes.reduce((a, c) => a + moves[c], 0) / codes.length;
    parts.push({ ch, move, effect: (share / 100) * t.exportsPctGdp * (move / 100) });
  }
  const exportEffect = parts.reduce((a, p) => a + p.effect, 0);
  const fuelImports = (t.fuelImportsPctMerch / 100) * t.importsPctGdp;
  const fuelBill = fuelImports * (moves.CRUDE_BRENT / 100);
  const top = [...parts].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 2);
  const words = top.map((p) => `${CHAPTER_SHORT[p.ch] || `HS ${p.ch}`} ${mix[p.ch].toFixed(0)}% of exports, price ${signedPct(p.move)}`);
  return {
    pctGdp: r2(exportEffect - fuelBill),
    basis: `${words.length ? words.join('; ') : 'no priced commodity in the export mix'}; fuel imports ${fuelImports.toFixed(1)}% of GDP with Brent ${signedPct(moves.CRUDE_BRENT)} (Pink Sheet to ${t.pricesAsOf}, UN Comtrade ${t.exportMixYear}, World Bank ${t.wbYear})`,
  };
}

export function rankScenario(
  id: ScenarioId,
  items: Array<{ iso3: string; countryName: string; trade?: TradeExposure }>
): Array<{ iso3: string; countryName: string } & ScenarioImpact> {
  return items
    .map((it) => {
      const imp = it.trade ? scenarioImpact(id, it.trade) : null;
      return imp ? { iso3: it.iso3, countryName: it.countryName, ...imp } : null;
    })
    .filter((x): x is { iso3: string; countryName: string } & ScenarioImpact => x !== null)
    .sort((a, b) => a.pctGdp - b.pctGdp);
}

type Group = 'china' | 'taiwan' | 'russia' | 'gulf';

/** Comtrade figures this file reads (matches ComtradeProfile in comtradeTrade.ts). */
export interface ComtradeLike {
  year: string;
  exportSharePct: Partial<Record<Group, number>>;
  importSharePct: Partial<Record<Group, number>>;
  exportMixPct?: Record<string, number>;
  productYear?: string;
}

/** Price moves this file reads (matches PriceMove in commodityPrices.ts). */
export interface PriceMoveLike {
  code: string;
  source: string;
  asOf: string;
  latest: number;
  change3mPct?: number;
  change12mPct?: number;
}

/**
 * Adds UN Comtrade shares (in place of WITS when Comtrade has China and Russia) and Pink Sheet
 * price moves to a country's trade figures. Nothing is filled that the sources did not give.
 */
export function enrichTrade(t: TradeExposure | undefined, comtrade?: ComtradeLike | null, moves?: PriceMoveLike[] | null): TradeExposure | undefined {
  const out: TradeExposure = { ...(t || {}) };
  if (comtrade) {
    const x = comtrade.exportSharePct;
    const m = comtrade.importSharePct;
    if (x.china !== undefined && x.russia !== undefined && m.russia !== undefined) {
      out.chinaExportSharePct = x.china;
      out.russiaExportSharePct = x.russia;
      out.russiaImportSharePct = m.russia;
      out.partnerSource = `UN Comtrade ${comtrade.year}`;
    }
    if (x.taiwan !== undefined) out.taiwanExportSharePct = x.taiwan;
    if (m.gulf !== undefined) out.gulfImportSharePct = m.gulf;
    if (comtrade.exportMixPct && comtrade.productYear) {
      out.exportMixPct = comtrade.exportMixPct;
      out.exportMixYear = comtrade.productYear;
    }
  }
  const pink = (moves || []).filter((mv) => mv.source === 'pink_sheet');
  if (pink.length) {
    const p12: Record<string, number> = {};
    for (const mv of pink) if (mv.change12mPct !== undefined) p12[mv.code] = mv.change12mPct;
    if (Object.keys(p12).length) out.priceMoves12m = p12;
    const p3: Record<string, number> = {};
    for (const mv of pink) if (mv.change3mPct !== undefined) p3[mv.code] = mv.change3mPct;
    if (Object.keys(p3).length) out.priceMoves3m = p3;
    const brent = pink.find((mv) => mv.code === 'CRUDE_BRENT');
    if (brent) {
      out.brentUsd = brent.latest;
      out.pricesAsOf = brent.asOf;
    } else out.pricesAsOf = pink.map((mv) => mv.asOf).sort().pop();
  }
  return Object.keys(out).length ? out : undefined;
}
