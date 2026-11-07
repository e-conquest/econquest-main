/**
 * Cross-country market feeds: trade exposure for the scenario ranking, year-end FX rates and
 * the global plumbing panel (funding, liquidity, prediction markets).
 */

import { fetchWithTimeout, fetchTextWithTimeout } from '../http';
import { SOVEREIGN_CATALOG } from '../../data/presetsAndBaselines.ts';
import { parseWbLatest, parseWitsShare, type TradeExposure, WB_TRADE_INDICATORS, wbIndicatorUrl, type WbTradeKey, type WitsIndicator, witsUrl } from '../../utils/scenarioExposure';

/**
 * Last ECB reference rates of the previous year (Frankfurter answers a date with the latest
 * business day on or before it), for each currency's move since the start of the year. Only the
 * currencies the ECB publishes get a figure; for the rest the move is left out. Kept 24 hours.
 */
let fxYearEndCache: { year: number; at: number; date: string; rates: Record<string, number> } | null = null;
export async function fetchFxYearEnd(): Promise<{ date: string; rates: Record<string, number> } | null> {
  const year = new Date().getUTCFullYear();
  if (fxYearEndCache && fxYearEndCache.year === year && Date.now() - fxYearEndCache.at < 24 * 60 * 60 * 1000) return fxYearEndCache;
  try {
    const res = await fetchWithTimeout(`https://api.frankfurter.dev/v1/${year - 1}-12-31?from=USD`, 5000);
    if (!res.ok) return null;
    const body: any = await res.json();
    if (!body?.rates || typeof body.rates !== 'object') return null;
    const rates: Record<string, number> = {};
    for (const [ccy, v] of Object.entries(body.rates)) if (typeof v === 'number' && v > 0) rates[ccy.toUpperCase()] = v;
    rates.USD = 1;
    fxYearEndCache = { year, at: Date.now(), date: String(body.date || `${year - 1}-12-31`), rates };
    return fxYearEndCache;
  } catch {
    return null;
  }
}

let cachedPlumbing: {
  timestamp: number;
  usSofrRatePct?: number;
  usEffrRatePct?: number;
  fedOnRrpBalanceUsdBn?: number;
  fxRatesVsUsd: Record<string, number>;
  activeSources: string[];
} | null = null;

export async function fetchGlobalLivePlumbing() {
  if (cachedPlumbing && Date.now() - cachedPlumbing.timestamp < 3 * 60 * 1000) {
    return cachedPlumbing;
  }

  const fxRatesVsUsd: Record<string, number> = {};
  const activeSources: string[] = [];
  let usSofrRatePct: number | undefined;
  let usEffrRatePct: number | undefined;
  let fedOnRrpBalanceUsdBn: number | undefined;

  await Promise.allSettled([
    // 1. Live Spot FX Rates (Open Exchange Rates v6 -> Frankfurter fallback)
    (async () => {
      const fxRes = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 3500);
      if (fxRes.ok) {
        const data: any = await fxRes.json();
        if (data?.rates && typeof data.rates === 'object') {
          Object.entries(data.rates).forEach(([ccy, val]) => {
            if (typeof val === 'number' && val > 0) {
              fxRatesVsUsd[ccy.toUpperCase()] = val;
            }
          });
          activeSources.push('ExchangeRate-API Spot FX (Live)');
          return;
        }
      }
      const frankRes = await fetchWithTimeout('https://api.frankfurter.dev/v1/latest?from=USD', 3500);
      if (frankRes.ok) {
        const fData: any = await frankRes.json();
        if (fData?.rates && typeof fData.rates === 'object') {
          Object.entries(fData.rates).forEach(([ccy, val]) => {
            if (typeof val === 'number' && val > 0) {
              fxRatesVsUsd[ccy.toUpperCase()] = val;
            }
          });
          activeSources.push('ECB Frankfurter Spot FX (Live)');
        }
      }
    })(),

    // 2. NY Fed Markets API: Secured Overnight Financing Rate (SOFR)
    (async () => {
      const sofrRes = await fetchWithTimeout(
        'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json',
        3200
      );
      if (sofrRes.ok) {
        const data: any = await sofrRes.json();
        const rate = data?.refRates?.[0]?.percentRate;
        if (typeof rate === 'number' && rate > 0) {
          usSofrRatePct = Number(rate.toFixed(2));
          activeSources.push('NY Fed Markets SOFR/EFFR API (Live)');
        }
      }
    })(),

    // 3. NY Fed Markets API: Effective Federal Funds Rate (EFFR)
    (async () => {
      const effrRes = await fetchWithTimeout(
        'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json',
        3200
      );
      if (effrRes.ok) {
        const data: any = await effrRes.json();
        const rate = data?.refRates?.[0]?.percentRate;
        if (typeof rate === 'number' && rate > 0) {
          usEffrRatePct = Number(rate.toFixed(2));
        }
      }
    })(),

    // 4. NY Fed Markets API: Overnight Reverse Repo (ON RRP) Facility Propositions
    (async () => {
      const rrpRes = await fetchWithTimeout(
        'https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json',
        3200
      );
      if (rrpRes.ok) {
        const data: any = await rrpRes.json();
        const ops = data?.repo?.operations;
        if (Array.isArray(ops) && ops.length > 0) {
          const latestAmt = Number(ops[0]?.totalAmtAccepted);
          if (!Number.isNaN(latestAmt) && latestAmt >= 0) {
            // NY Fed returns totalAmtAccepted in USD or billions depending on endpoint version
            fedOnRrpBalanceUsdBn =
              latestAmt > 1e6 ? Number((latestAmt / 1e9).toFixed(1)) : Number(latestAmt.toFixed(1));
          }
        }
      }
    })(),
  ]);

  cachedPlumbing = {
    timestamp: Date.now(),
    usSofrRatePct,
    usEffrRatePct,
    fedOnRrpBalanceUsdBn,
    fxRatesVsUsd,
    activeSources,
  };
  return cachedPlumbing;
}

/**
 * Trade exposure for the scenario ranking (src/utils/scenarioExposure.ts): World Bank fuel and
 * trade shares, and WITS partner shares with China and Russia. Kept 24 hours (1 hour after a miss).
 */
let tradeExposureCache: { at: number; value: Map<string, TradeExposure>; pending?: Promise<Map<string, TradeExposure>> } | null = null;
async function fetchTradeExposureUncached(iso3s: string[]): Promise<Map<string, TradeExposure>> {
  const out = new Map<string, TradeExposure>(iso3s.map((i) => [i, {} as TradeExposure]));
  await Promise.all(
    (Object.entries(WB_TRADE_INDICATORS) as Array<[WbTradeKey, string]>).map(async ([key, code]) => {
      try {
        const res = await fetchWithTimeout(wbIndicatorUrl(iso3s, code), 8000);
        if (!res.ok) return;
        for (const [iso, v] of parseWbLatest(await res.json())) {
          const t = out.get(iso);
          if (!t) continue;
          t[key] = Number(v.value.toFixed(2));
          if (!t.wbYear || v.year < t.wbYear) t.wbYear = v.year; // the oldest year used, to be safe
        }
      } catch {
        // leave the figure missing
      }
    })
  );
  const thisYear = new Date().getUTCFullYear();
  const share = async (iso: string, partner: string, ind: WitsIndicator) => {
    for (const year of [thisYear - 3, thisYear - 4]) {
      const xml = await fetchTextWithTimeout(witsUrl(iso, partner, ind, year), 8000);
      const v = parseWitsShare(xml);
      if (v) return v;
    }
    return null;
  };
  await Promise.all(
    iso3s.map(async (iso) => {
      const [cn, rx, rm] = await Promise.all([share(iso, 'CHN', 'XPRT-PRTNR-SHR'), share(iso, 'RUS', 'XPRT-PRTNR-SHR'), share(iso, 'RUS', 'MPRT-PRTNR-SHR')]);
      const t = out.get(iso)!;
      if (cn) t.chinaExportSharePct = cn.pct;
      if (rx) t.russiaExportSharePct = rx.pct;
      if (rm) t.russiaImportSharePct = rm.pct;
      const years = [cn, rx, rm].filter(Boolean).map((v) => v!.year).sort();
      if (years.length) t.witsYear = years[0];
    })
  );
  return out;
}
export async function fetchTradeExposure(): Promise<Map<string, TradeExposure>> {
  const c = tradeExposureCache;
  const hasAny = c ? [...c.value.values()].some((t) => Object.keys(t).length > 0) : false;
  if (c && Date.now() - c.at < (hasAny ? 24 : 1) * 60 * 60 * 1000) return c.value;
  if (c?.pending) return c.pending;
  const pending = fetchTradeExposureUncached(SOVEREIGN_CATALOG.map((x) => x.iso3)).then((value) => {
    tradeExposureCache = { at: Date.now(), value };
    return value;
  });
  tradeExposureCache = { at: c?.at ?? 0, value: c?.value ?? new Map(), pending };
  return pending;
}
