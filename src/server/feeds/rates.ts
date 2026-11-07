/**
 * Yields, rates and market extras: official 10Y yields (FRED, Tesouro Direto, EVDS), debt falling
 * due, your own CDS file, hard-currency bond spread, FX valuation and the effective fed funds rate.
 */

import fs from 'fs';
import path from 'path';
import { BIS_API, BIS_ISO2, bisAllMarketsUrl, bisIntlUrl, parseBisAllMarkets, parseBisIntl } from '../../utils/bisDebtSecurities';
import { CDS_HIDDEN } from '../../utils/cdsHidden.ts';
import { DATA_DIR } from '../config';
import { EMPTY_FX_HISTORY, type FxHistoryFile, fxQuarterUrl, parseFxQuarter, quartersToPull, readFxHistoryFile } from '../../utils/fxHistory';
import { EXTRA_FX, type ExtraFxCode, extraFxNeedsPull, extraFxUrl, extraFxWindows, type FxExtraFile, parseExtraFx, readFxExtraFile } from '../../utils/fxExtra';
import { bcrpEmbigUrl, describeBcrpReply, type HcSpreadPull, parseBcrpEmbig } from '../../utils/hardCurrencySpread.ts';
import { describeNetworkError } from '../../utils/connectionCheck';
import { evdsSeriesUrl, FRED_10Y_SERIES, fredApiUrl, fredCsvUrl, isValidEvdsSeriesCode, type OfficialYieldObservation, parseEvdsLatest, parseFredApiLatest, parseFredCsvLatest, parseTesouroDiretoLatest, TESOURO_DIRETO_CSV_URL, US_10Y_SERIES } from '../../utils/officialYields.ts';
import { fetchJsonWithTimeout, fetchTextWithTimeout, fetchWithTimeout } from '../http';
import { type Effr, frankfurterSeriesUrl, type FxVol, parseEffr, parseFredDff, parseFxVol, parseReer, parseReerMonthly, type ReerGap, reerLongUrl, reerUrl } from '../../utils/fxValuation';
import { lsegSnapshotUrl, lsegTokenRequest, type OwnCdsQuote, ownCdsSettings, parseLsegSnapshot, parseOwnCdsCsv } from '../../utils/ownCds';
import { type DebtSchedule, idsUrl, parseIds, parseQeds, qedsUrl } from '../../utils/debtSchedule';
import { writeFileAtomic } from '../../utils/atomicWrite';
import { CBPOL_DATASET, parseCbpolCsv } from '../../utils/bisPolicyRates';
import { type BisCreditCycle, bisCreditGapUrl, bisDsrUrl, bisPropertyUrl, parseBisCreditGap, parseBisDsr, parseBisProperty } from '../../utils/bisCreditCycle';
import { bocBoeEditions, bocBoeUrl, parseBocBoeCsv, type SovereignDefaults } from '../../utils/sovereignDefaults';
import { idsChinaUrl, idsCreditorsUrl, type IdsCreditors, parseIdsCreditors } from '../../utils/idsCreditors';
import { type AlfredSeries, alfredUrl, parseAlfred } from '../../utils/alfredVintages';
import { ECB_SPF_SERIES, ecbSpfUrl, FOCUS_URL, type InflationSurveys, parseEcbCsv, parseFocus12m } from '../../utils/inflationSurveys';
import { gscpiFromBytes, GSCPI_URLS, STRESS_INDICES, type StressPulls } from '../../utils/stressIndices';
import { type InflationExpectations, parseFredApiObservations, US_INFLATION_EXPECTATION_IDS } from '../../utils/inflationExpectations';
import { buildFedBalanceSheet, FED_SERIES, type FedBalanceSheet, type Obs, parseFredCsvSeries } from '../../utils/fedBalanceSheet';

/**
 * Latest official 10Y yield (OECD via FRED, monthly average), or null if not covered or unreachable.
 * Uses the official FRED API when FRED_API_KEY is set, and falls back to the no-key CSV download.
 */
/**
 * Brazil: the Treasury's Tesouro Direto CSV holds the whole price history. On Sam's Mac
 * (2026-11-05) it was 14.6 MB and took 60 seconds, so it gets 90 seconds, one download at a time,
 * and the parsed answer is kept 6 hours in memory and on disk (data/live/tesouro.json) so a restart
 * does not download it again. A failed download is retried after 30 minutes.
 */
const TESOURO_TIMEOUT_MS = 90000;
let tesouroCache: { at: number; obs: OfficialYieldObservation | null } | null = null;
let tesouroPending: Promise<OfficialYieldObservation | null> | null = null;
function tesouroFile(): string {
  return path.join(DATA_DIR, 'live', 'tesouro.json');
}
async function fetchTesouroDiretoYield(): Promise<OfficialYieldObservation | null> {
  if (!tesouroCache) {
    try {
      const saved = JSON.parse(fs.readFileSync(tesouroFile(), 'utf8'));
      if (saved?.obs && typeof saved.at === 'number') tesouroCache = saved;
    } catch {
      // nothing saved yet
    }
  }
  if (tesouroCache && Date.now() - tesouroCache.at < (tesouroCache.obs ? 6 * 60 : 30) * 60 * 1000) return tesouroCache.obs;
  if (tesouroPending) return tesouroPending;
  tesouroPending = (async () => {
    let obs: OfficialYieldObservation | null = null;
    try {
      const res = await fetchWithTimeout(TESOURO_DIRETO_CSV_URL, TESOURO_TIMEOUT_MS);
      if (res.ok) obs = parseTesouroDiretoLatest(await res.text());
      else console.warn(`[Tesouro] Brazil yield file refused (HTTP ${res.status})`);
    } catch (e) {
      console.warn(`[Tesouro] Brazil yield file: ${describeNetworkError(e, TESOURO_TIMEOUT_MS)}`);
    }
    if (obs) {
      tesouroCache = { at: Date.now(), obs };
      try {
        fs.mkdirSync(path.dirname(tesouroFile()), { recursive: true });
        writeFileAtomic(tesouroFile(), JSON.stringify(tesouroCache));
      } catch {
        // keep the memory copy
      }
    } else {
      // Keep serving the last good figure (it carries its own date); retry in 30 minutes.
      tesouroCache = { at: Date.now() - (tesouroCache?.obs ? 6 * 60 - 30 : 0) * 60 * 1000, obs: tesouroCache?.obs ?? null };
    }
    return tesouroCache.obs;
  })().finally(() => {
    tesouroPending = null;
  });
  return tesouroPending;
}

/**
 * Official yields change at most daily (Brazil) or monthly (FRED/OECD), so results are kept for
 * 6 hours. A miss (feed down, or no series) is kept for 30 minutes so the watchlist does not
 * retry every country on each refresh.
 */
export const officialYieldCache = new Map<string, { at: number; obs: OfficialYieldObservation | null }>();
export async function fetchOfficial10YYield(iso3: string): Promise<OfficialYieldObservation | null> {
  const hit = officialYieldCache.get(iso3);
  if (hit && Date.now() - hit.at < (hit.obs ? 6 * 60 * 60 * 1000 : 30 * 60 * 1000)) return hit.obs;
  const obs = await fetchOfficial10YYieldUncached(iso3);
  officialYieldCache.set(iso3, { at: Date.now(), obs });
  return obs;
}

/**
 * Government external debt falling due (QEDS quarterly schedule, IDS yearly projections) from the
 * World Bank API, and government debt securities outstanding from the BIS API, all with no key. These change quarterly at most, so answers are kept for 12 hours
 * and misses for an hour. Each source is tried on its own; either can be missing.
 */
const debtScheduleCache = new Map<string, { at: number; value: DebtSchedule | null }>();
export async function fetchDebtSchedule(iso3: string): Promise<DebtSchedule | null> {
  const hit = debtScheduleCache.get(iso3);
  if (hit && Date.now() - hit.at < (hit.value ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  const iso2 = BIS_ISO2[iso3];
  const [qedsJson, idsJson, bisIntlCsv, bisAllCsv] = await Promise.all([
    fetchJsonWithTimeout(qedsUrl(iso3)),
    fetchJsonWithTimeout(idsUrl(iso3)),
    iso2 ? fetchTextWithTimeout(bisIntlUrl(iso2)) : Promise.resolve(null),
    iso2 ? fetchTextWithTimeout(bisAllMarketsUrl(iso2)) : Promise.resolve(null),
  ]);
  const qeds = qedsJson ? parseQeds(qedsJson) : null;
  const ids = idsJson ? parseIds(idsJson, new Date().getUTCFullYear()) : null;
  const intl = bisIntlCsv ? parseBisIntl(bisIntlCsv) : null;
  const all = bisAllCsv ? parseBisAllMarkets(bisAllCsv) : null;
  const bis = intl || all ? { ...(intl ? { intl } : {}), ...(all ? { all } : {}) } : null;
  const value: DebtSchedule | null =
    qeds || ids || bis
      ? { ...(qeds ? { qeds } : {}), ...(ids ? { ids } : {}), ...(bis ? { bis } : {}), fetchedAt: new Date().toISOString() }
      : null;
  debtScheduleCache.set(iso3, { at: Date.now(), value });
  return value;
}

/**
 * The credit cycle (src/utils/bisCreditCycle.ts): credit-to-GDP gap, debt service ratio and real
 * house prices from the BIS, full quarterly history, no key. Kept 12 hours, misses an hour.
 */
const bisCreditCache = new Map<string, { at: number; value: BisCreditCycle | null }>();
export async function fetchBisCreditCycle(iso3: string): Promise<BisCreditCycle | null> {
  const iso2 = BIS_ISO2[iso3];
  if (!iso2) return null;
  const hit = bisCreditCache.get(iso3);
  if (hit && Date.now() - hit.at < (hit.value ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  const [gapCsv, dsrCsv, sppCsv] = await Promise.all([
    fetchTextWithTimeout(bisCreditGapUrl(iso2)),
    fetchTextWithTimeout(bisDsrUrl(iso2)),
    fetchTextWithTimeout(bisPropertyUrl(iso2)),
  ]);
  const value: BisCreditCycle | null =
    gapCsv || dsrCsv || sppCsv
      ? { fetchedAt: new Date().toISOString(), ...parseBisCreditGap(gapCsv), ...parseBisDsr(dsrCsv), ...parseBisProperty(sppCsv) }
      : null;
  bisCreditCache.set(iso3, { at: Date.now(), value });
  return value;
}

/**
 * Who holds public external debt and on what terms (src/utils/idsCreditors.ts), World Bank IDS,
 * yearly, no key. Kept 12 hours, misses an hour.
 */
const idsCreditorsCache = new Map<string, { at: number; value: IdsCreditors | null }>();
export async function fetchIdsCreditors(iso3: string): Promise<IdsCreditors | null> {
  const hit = idsCreditorsCache.get(iso3);
  if (hit && Date.now() - hit.at < (hit.value ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  const [world, china] = await Promise.all([fetchJsonWithTimeout(idsCreditorsUrl(iso3), 15000), fetchJsonWithTimeout(idsChinaUrl(iso3), 15000)]);
  const value = world ? parseIdsCreditors(world, china, new Date().toISOString()) : null;
  idsCreditorsCache.set(iso3, { at: Date.now(), value });
  return value;
}

/**
 * Sovereign default history (src/utils/sovereignDefaults.ts): the BoC-BoE database for every
 * country in one CSV from the Bank of Canada Valet API, newest edition that answers. One request a
 * day at most (the Valet terms bar going round its request limits); misses retried after an hour.
 */
let sovereignDefaultsCache: { at: number; value: SovereignDefaults | null } | null = null;
let sovereignDefaultsInFlight: Promise<SovereignDefaults | null> | null = null;
export async function fetchSovereignDefaults(): Promise<SovereignDefaults | null> {
  const hit = sovereignDefaultsCache;
  if (hit && Date.now() - hit.at < (hit.value ? 24 : 1) * 60 * 60 * 1000) return hit.value;
  if (sovereignDefaultsInFlight) return sovereignDefaultsInFlight;
  sovereignDefaultsInFlight = (async () => {
    let value: SovereignDefaults | null = null;
    for (const edition of bocBoeEditions()) {
      const csv = await fetchTextWithTimeout(bocBoeUrl(edition), 20000);
      value = csv ? parseBocBoeCsv(csv, edition, new Date().toISOString()) : null;
      if (value) break;
    }
    sovereignDefaultsCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    sovereignDefaultsInFlight = null;
  });
  return sovereignDefaultsInFlight;
}

/**
 * A FRED series' full history (the official API with the user's key, else the no-key CSV), for the
 * scenario engine's financial stress factor and the US inflation expectations.
 * Kept 12 hours in memory (an hour after a miss); when FRED does not answer the factor is left out and named.
 */
const fredHistoryCache = new Map<string, { at: number; value: Obs[] | null }>();
export async function fetchFredHistory(seriesId: string, from = '1993-12-01'): Promise<Obs[] | null> {
  const hit = fredHistoryCache.get(seriesId);
  if (hit && Date.now() - hit.at < (hit.value ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  let obs: Obs[] = [];
  // The user's own FRED key (Menu > Settings > API keys) when set: the official API; else the CSV download.
  const apiKey = (process.env.FRED_API_KEY || '').trim();
  if (apiKey) {
    try {
      const q = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: 'json', observation_start: from });
      const res = await fetchWithTimeout(`https://api.stlouisfed.org/fred/series/observations?${q.toString()}`, 15000);
      if (res.ok) obs = parseFredApiObservations(await res.json());
    } catch {
      // fall through to the CSV download
    }
  }
  if (!obs.length) {
    const csv = await fetchTextWithTimeout(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${from}`, 15000);
    obs = csv ? parseFredCsvSeries(csv) : [];
  }
  const value = obs.length ? obs : null;
  fredHistoryCache.set(seriesId, { at: Date.now(), value });
  return value;
}

/**
 * NY Fed Global Supply Chain Pressure Index (src/utils/stressIndices.ts): the CSV file first, then
 * the Excel file (every sheet tried). Kept 12 hours (an hour after a miss); a miss carries its reason.
 */
let gscpiCache: { at: number; value: NonNullable<StressPulls['gscpi']> } | null = null;
export async function fetchGscpi(): Promise<NonNullable<StressPulls['gscpi']>> {
  if (gscpiCache && Date.now() - gscpiCache.at < ('obs' in gscpiCache.value ? 12 : 1) * 60 * 60 * 1000) return gscpiCache.value;
  let value: NonNullable<StressPulls['gscpi']> = { reason: 'The New York Fed GSCPI file did not answer' };
  for (const url of [GSCPI_URLS.csv, GSCPI_URLS.xlsx]) {
    try {
      const res = await fetchWithTimeout(url, 20000);
      if (!res.ok) continue;
      const got = await gscpiFromBytes(new Uint8Array(await res.arrayBuffer()));
      if ('obs' in got) {
        value = got;
        break;
      }
      value = got;
    } catch {
      // try the next address
    }
  }
  gscpiCache = { at: Date.now(), value };
  return value;
}

/** The stress indices (FRED weekly) and the GSCPI, for the scenarios and the world series. */
export async function fetchStressPulls(): Promise<StressPulls> {
  const [fred, gscpi] = await Promise.all([
    Promise.all(STRESS_INDICES.map(async (s) => [s.fred, await fetchFredHistory(s.fred)] as const)),
    fetchGscpi(),
  ]);
  const out: StressPulls['fred'] = {};
  for (const [id, obs] of fred) if (obs?.length) out[id] = obs;
  return { fred: out, gscpi, fetchedAt: new Date().toISOString() };
}

/**
 * Survey inflation expectations (src/utils/inflationSurveys.ts): ECB SPF (three quarterly series)
 * and the BCB Focus 12-month IPCA median. Kept 12 hours (an hour when either missed).
 */
let surveysCache: { at: number; value: InflationSurveys } | null = null;
export async function fetchInflationSurveys(): Promise<InflationSurveys> {
  if (surveysCache && Date.now() - surveysCache.at < (surveysCache.value.focus.length && Object.keys(surveysCache.value.spf).length ? 12 : 1) * 60 * 60 * 1000) return surveysCache.value;
  const spf: InflationSurveys['spf'] = {};
  await Promise.all(
    ECB_SPF_SERIES.map(async (d) => {
      const csv = await fetchTextWithTimeout(ecbSpfUrl(d.key), 15000);
      const obs = csv ? parseEcbCsv(csv) : [];
      if (obs.length) spf[d.key] = obs;
    }),
  );
  let focus: InflationSurveys['focus'] = [];
  let focusReason: string | undefined;
  try {
    const res = await fetchWithTimeout(FOCUS_URL, 30000);
    if (!res.ok) focusReason = `The BCB Focus service answered HTTP ${res.status}`;
    else {
      focus = parseFocus12m(await res.json());
      if (!focus.length) focusReason = 'The BCB Focus reply had no IPCA medians in the fields the app reads (layout not verified yet; see npm run check:data)';
    }
  } catch {
    focusReason = 'The BCB Focus service did not answer';
  }
  const value: InflationSurveys = {
    fetchedAt: new Date().toISOString(),
    spf,
    ...(Object.keys(spf).length ? {} : { spfReason: 'The ECB Data Portal gave no SPF observations the app could read (series keys not verified yet; see npm run check:data)' }),
    focus,
    ...(focusReason ? { focusReason } : {}),
  };
  surveysCache = { at: Date.now(), value };
  return value;
}

/**
 * ALFRED real-time vintages (src/utils/alfredVintages.ts) for one US series, with the user's FRED
 * key. Kept 12 hours (an hour after a miss); no key gives a reason, never a number.
 */
const alfredCache = new Map<string, { at: number; value: AlfredSeries | { reason: string } }>();
export async function fetchAlfred(seriesId: string): Promise<AlfredSeries | { reason: string }> {
  const apiKey = (process.env.FRED_API_KEY || '').trim();
  if (!apiKey) return { reason: 'US data as first published needs your free FRED API key (Menu > Settings > API keys)' };
  const hit = alfredCache.get(seriesId);
  if (hit && Date.now() - hit.at < ('rows' in hit.value ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  let value: AlfredSeries | { reason: string } = { reason: 'ALFRED (FRED API) did not answer' };
  try {
    const res = await fetchWithTimeout(alfredUrl(seriesId, apiKey, '1999-01-01'), 30000);
    if (res.status === 400 || res.status === 403) value = { reason: `FRED did not accept the API key (HTTP ${res.status})` };
    else if (res.ok) {
      const rows = parseAlfred(await res.json());
      value = rows.length ? { id: seriesId, rows } : { reason: `ALFRED gave no vintages for ${seriesId}` };
    } else value = { reason: `ALFRED answered HTTP ${res.status}` };
  } catch {
    // keep the reason above
  }
  alfredCache.set(seriesId, { at: Date.now(), value });
  return value;
}

/** US inflation expectations (src/utils/inflationExpectations.ts): five FRED series from 2003, or null when none answered. */
export async function fetchInflationExpectations(): Promise<InflationExpectations | null> {
  const got = await Promise.all(US_INFLATION_EXPECTATION_IDS.map(async (id) => [id, await fetchFredHistory(id, '2003-01-01')] as const));
  const series: InflationExpectations['series'] = {};
  for (const [id, obs] of got) if (obs?.length) series[id] = obs;
  return Object.keys(series).length ? { fetchedAt: new Date().toISOString(), series } : null;
}

/**
 * Own-account 5Y CDS (off unless CDS_FEED is set in .env; see src/utils/ownCds.ts). The CSV is
 * re-read when the file changes; LSEG answers are kept for 15 minutes and its token until expiry.
 * The credentials never leave the server and are never logged.
 */
export let ownCdsCache: { key: string; at: number; quotes: Map<string, OwnCdsQuote> } | null = null;
let lsegToken: { token: string; until: number } | null = null;
export async function loadOwnCds(): Promise<Map<string, OwnCdsQuote>> {
  // CDS is hidden for now (src/utils/cdsHidden.ts): the USD bond spread stands in for it.
  if (CDS_HIDDEN) return new Map();
  const cfg = ownCdsSettings(process.env);
  if (!cfg) return new Map();
  try {
    if (cfg.provider === 'csv' && cfg.csvPath) {
      const stat = fs.statSync(cfg.csvPath);
      const key = `csv:${cfg.csvPath}:${stat.mtimeMs}`;
      if (ownCdsCache?.key === key) return ownCdsCache.quotes;
      const quotes = parseOwnCdsCsv(fs.readFileSync(cfg.csvPath, 'utf8'));
      ownCdsCache = { key, at: Date.now(), quotes };
      return quotes;
    }
    if (cfg.provider === 'lseg' && cfg.lseg) {
      const key = `lseg:${Object.entries(cfg.lseg.rics).join(',')}`;
      if (ownCdsCache?.key === key && Date.now() - ownCdsCache.at < 15 * 60 * 1000) return ownCdsCache.quotes;
      if (!lsegToken || Date.now() > lsegToken.until) {
        const req = lsegTokenRequest(cfg.lseg);
        const res = await fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: req.body,
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`LSEG sign-in refused (${res.status})`);
        const tok = (await res.json()) as { access_token?: string; expires_in?: string | number };
        if (!tok.access_token) throw new Error('LSEG sign-in gave no token');
        lsegToken = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in) || 300) * 1000 - 30000 };
      }
      const res = await fetch(lsegSnapshotUrl(cfg.lseg), {
        headers: { Authorization: `Bearer ${lsegToken.token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401) lsegToken = null;
      if (!res.ok) throw new Error(`LSEG pricing snapshot refused (${res.status})`);
      const quotes = parseLsegSnapshot(await res.json(), cfg.lseg.rics, new Date().toISOString().slice(0, 10));
      ownCdsCache = { key, at: Date.now(), quotes };
      return quotes;
    }
  } catch (e) {
    console.warn(`[own CDS] ${cfg.provider}: ${e instanceof Error ? e.message : 'failed'}`);
  }
  return new Map();
}

/** Turkey's EVDS feed is on only when the user has set both a key and a series code. */
function evdsSettings(): { key: string; series: string } | null {
  const key = (process.env.EVDS_API_KEY || '').trim();
  const series = (process.env.EVDS_TR10Y_SERIES || '').trim();
  return key && isValidEvdsSeriesCode(series) ? { key, series } : null;
}

async function fetchEvdsTurkeyYield(): Promise<OfficialYieldObservation | null> {
  const cfg = evdsSettings();
  if (!cfg) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // The key goes only in the "key" header, never in the URL (EVDS returns 403 otherwise).
    const res = await fetch(evdsSeriesUrl(cfg.series), {
      signal: controller.signal,
      headers: { key: cfg.key, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[EVDS] Turkey 10Y request failed with HTTP ${res.status}`);
      return null;
    }
    return parseEvdsLatest(await res.json(), cfg.series);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Countries with an official 10Y source wired in (Turkey only once EVDS is set up). */
export function hasOfficial10YSource(iso3: string): boolean {
  return iso3 === 'BRA' || Boolean(FRED_10Y_SERIES[iso3]) || (iso3 === 'TUR' && evdsSettings() !== null);
}

async function fetchOfficial10YYieldUncached(iso3: string): Promise<OfficialYieldObservation | null> {
  if (iso3 === 'BRA') return fetchTesouroDiretoYield();
  if (iso3 === 'TUR') return fetchEvdsTurkeyYield();
  const seriesId = FRED_10Y_SERIES[iso3];
  if (!seriesId) return null;
  return fetchFredLatest(seriesId);
}

/** Latest observation of a FRED yield series: the API when FRED_API_KEY is set, else the CSV. */
export async function fetchFredLatest(seriesId: string): Promise<OfficialYieldObservation | null> {
  const apiKey = (process.env.FRED_API_KEY || '').trim();
  if (apiKey) {
    try {
      const res = await fetchWithTimeout(fredApiUrl(seriesId, apiKey), 6000);
      if (res.ok) {
        const obs = parseFredApiLatest(await res.json(), seriesId);
        if (obs) return obs;
      }
    } catch {
      // fall through to the CSV download
    }
  }
  try {
    const res = await fetchWithTimeout(fredCsvUrl(seriesId), 6000);
    if (!res.ok) return null;
    return parseFredCsvLatest(await res.text(), seriesId);
  } catch {
    return null;
  }
}

/**
 * Market extras saved to disk (data/live/market-extras.json): the US 10Y and other FRED
 * benchmarks, the BIS real exchange rate gap and three-month FX volatility per country, and the
 * NY Fed fed funds rate. Each keeps its own source date. A good answer is saved; when a feed does
 * not answer (offline, or down) the last saved figure is used, so the screens built on them (carry,
 * spread over Treasuries, real exchange rate) keep their saved figures with their dates instead of
 * reading Missing.
 */
type MarketExtrasFile = {
  fred: Record<string, { at: string; value: OfficialYieldObservation }>;
  fx: Record<string, { at: string; reer?: ReerGap; vol?: FxVol }>;
  effr?: { at: string; value: { pct: number; date: string } };
  /** Hard-currency bond spreads (BCRP EMBIG), the whole last good pull. */
  hcSpread?: HcSpreadPull;
};
let marketExtras: MarketExtrasFile | null = null;
function marketExtrasFile(): string {
  return path.join(DATA_DIR, 'live', 'market-extras.json');
}
export function loadMarketExtras(): MarketExtrasFile {
  if (marketExtras) return marketExtras;
  let f: MarketExtrasFile = { fred: {}, fx: {} };
  try {
    const saved = JSON.parse(fs.readFileSync(marketExtrasFile(), 'utf8')) as Partial<MarketExtrasFile>;
    f = { fred: saved.fred && typeof saved.fred === 'object' ? saved.fred : {}, fx: saved.fx && typeof saved.fx === 'object' ? saved.fx : {}, ...(saved.effr ? { effr: saved.effr } : {}), ...(saved.hcSpread ? { hcSpread: saved.hcSpread } : {}) };
  } catch {
    // never saved
  }
  marketExtras = f;
  return f;
}
export function saveMarketExtras(change: (f: MarketExtrasFile) => void) {
  const f = loadMarketExtras();
  change(f);
  try {
    fs.mkdirSync(path.dirname(marketExtrasFile()), { recursive: true });
    writeFileAtomic(marketExtrasFile(), JSON.stringify(f));
  } catch (err: any) {
    console.warn(`[market extras] could not save: ${err?.message || err}`);
  }
}

/** A FRED yield series kept for 12 hours (1 hour after a miss). Used for MarketEdge benchmarks. */
export const fredSeriesCache = new Map<string, { at: number; value: OfficialYieldObservation | null; fallback?: boolean }>();
export async function fetchFredCached(seriesId: string): Promise<OfficialYieldObservation | null> {
  const hit = fredSeriesCache.get(seriesId);
  if (hit && Date.now() - hit.at < (hit.value && !hit.fallback ? 12 : 1) * 60 * 60 * 1000) return hit.value;
  const got = await fetchFredLatest(seriesId);
  if (got) saveMarketExtras((f) => (f.fred[seriesId] = { at: new Date().toISOString(), value: got }));
  const value = got ?? loadMarketExtras().fred[seriesId]?.value ?? null;
  // A saved figure stands in, but the feed is asked again within the hour.
  fredSeriesCache.set(seriesId, { at: Date.now(), value, ...(got ? {} : { fallback: true }) });
  return value;
}

/**
 * Hard-currency bond spreads for the eight countries BCRP publishes (src/utils/hardCurrencySpread.ts):
 * one request for all of them, kept 12 hours (1 hour after a miss). A good answer is saved in
 * market-extras.json; when BCRP does not answer the saved pull stands in, with its own months.
 */
export let hcSpreadCache: { at: number; value: HcSpreadPull | null; fallback?: boolean } | null = null;
export async function fetchHcSpreadUncached(): Promise<HcSpreadPull | null> {
  const url = bcrpEmbigUrl();
  try {
    const res = await fetchWithTimeout(url, 20000);
    if (!res.ok) {
      console.warn(`[BCRP EMBIG] HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    const got = parseBcrpEmbig(text, url);
    if (!got) console.warn(`[BCRP EMBIG] ${describeBcrpReply(text)}`);
    return got;
  } catch (e) {
    console.warn(`[BCRP EMBIG] ${describeNetworkError(e, 20000)}`);
    return null;
  }
}
export async function fetchHcSpread(opts: { force?: boolean } = {}): Promise<HcSpreadPull | null> {
  if (!opts.force && hcSpreadCache && Date.now() - hcSpreadCache.at < (hcSpreadCache.value && !hcSpreadCache.fallback ? 12 : 1) * 60 * 60 * 1000) return hcSpreadCache.value;
  const got = await fetchHcSpreadUncached();
  if (got) saveMarketExtras((f) => (f.hcSpread = got));
  const value = got ?? loadMarketExtras().hcSpread ?? null;
  hcSpreadCache = { at: Date.now(), value, ...(got ? {} : { fallback: true }) };
  return value;
}

/**
 * Daily exchange rate history (src/utils/fxHistory.ts): ECB reference rates per US dollar since
 * 1999, pulled one calendar quarter per request, newest first, four at a time. Saved to
 * data/live/fx-history.json after each batch so a stopped pull keeps what it read. Finished
 * quarters are never pulled again; the current one is pulled again after 12 hours. One pull runs
 * at a time; callers that cannot wait race it against a timeout and read the saved file.
 */
let fxHistoryMemory: FxHistoryFile | null = null;
let fxHistoryPending: Promise<{ file: FxHistoryFile; read: number; failed: number }> | null = null;
function fxHistoryPath(): string {
  return path.join(DATA_DIR, 'live', 'fx-history.json');
}
export function loadFxHistory(): FxHistoryFile {
  if (fxHistoryMemory) return fxHistoryMemory;
  try {
    fxHistoryMemory = readFxHistoryFile(JSON.parse(fs.readFileSync(fxHistoryPath(), 'utf8')));
  } catch {
    fxHistoryMemory = { ...EMPTY_FX_HISTORY, chunks: {} };
  }
  return fxHistoryMemory;
}
function saveFxHistory(file: FxHistoryFile) {
  try {
    fs.mkdirSync(path.dirname(fxHistoryPath()), { recursive: true });
    writeFileAtomic(fxHistoryPath(), JSON.stringify(file));
  } catch (err: any) {
    console.warn(`[FX history] could not save: ${err?.message || err}`);
  }
}
export async function pullFxHistory(): Promise<{ file: FxHistoryFile; read: number; failed: number }> {
  if (fxHistoryPending) return fxHistoryPending;
  fxHistoryPending = (async () => {
    const file = loadFxHistory();
    const todo = quartersToPull(file);
    let read = 0;
    let failed = 0;
    for (let i = 0; i < todo.length; i += 4) {
      const batch = todo.slice(i, i + 4);
      const got = await Promise.all(batch.map(async (key) => {
        const url = fxQuarterUrl(key);
        if (!url) return null;
        try {
          const res = await fetchWithTimeout(url, 10000);
          if (!res.ok) return null;
          const rates = parseFxQuarter(await res.json());
          return rates ? { key, rates } : null;
        } catch {
          return null;
        }
      }));
      const at = new Date().toISOString();
      for (const g of got) if (g) file.chunks[g.key] = { pulledAt: at, rates: g.rates };
      const n = got.filter(Boolean).length;
      read += n;
      failed += batch.length - n;
      if (n) saveFxHistory(file);
      // The newest batch failing entirely means Frankfurter is not answering: stop and keep what is saved.
      if (!n) {
        failed += todo.length - i - batch.length;
        break;
      }
    }
    if (failed) console.warn(`[FX history] ${read} quarters read, ${failed} not read (Frankfurter did not answer)`);
    return { file, read, failed };
  })().finally(() => {
    fxHistoryPending = null;
  });
  return fxHistoryPending;
}
export async function fetchFxHistory(): Promise<FxHistoryFile> {
  return quartersToPull(loadFxHistory()).length ? (await pullFxHistory()).file : loadFxHistory();
}

/**
 * Daily central-bank rates for currencies the ECB does not publish (src/utils/fxExtra.ts): PEN
 * from the BCRP, COP (TRM) from datos.gov.co, ARS from the BCRA. The full history once, then the
 * last 45 days again every 12 hours. Saved to data/live/fx-extra.json; one pull at a time.
 */
let fxExtraMemory: FxExtraFile | null = null;
let fxExtraPending: Promise<FxExtraFile> | null = null;
function fxExtraPath(): string {
  return path.join(DATA_DIR, 'live', 'fx-extra.json');
}
export function loadFxExtra(): FxExtraFile {
  if (fxExtraMemory) return fxExtraMemory;
  try {
    fxExtraMemory = readFxExtraFile(JSON.parse(fs.readFileSync(fxExtraPath(), 'utf8')));
  } catch {
    fxExtraMemory = { version: 1, currencies: {} };
  }
  return fxExtraMemory;
}
export async function fetchFxExtra(): Promise<FxExtraFile> {
  const file = loadFxExtra();
  const due = (Object.keys(EXTRA_FX) as ExtraFxCode[]).filter((c) => extraFxNeedsPull(file.currencies[c]));
  if (!due.length) return file;
  if (fxExtraPending) return fxExtraPending;
  fxExtraPending = (async () => {
    await Promise.all(
      due.map(async (code) => {
        const saved = file.currencies[code];
        const rates: Record<string, number> = { ...(saved?.rates || {}) };
        let through = saved?.through;
        let read = 0;
        for (const [from, to] of extraFxWindows(code, saved)) {
          try {
            const res = await fetchWithTimeout(extraFxUrl(code, from, to), 15000);
            if (!res.ok) break;
            const got = parseExtraFx(code, await res.json().catch(() => null));
            if (got) Object.assign(rates, got);
            through = to;
            read++;
          } catch {
            break;
          }
        }
        if (!read) {
          console.warn(`[FX extra] ${code}: ${EXTRA_FX[code].source.split(',')[0]} did not answer`);
          return;
        }
        file.currencies[code] = { pulledAt: new Date().toISOString(), through: through || new Date().toISOString().slice(0, 10), rates };
      })
    );
    try {
      fs.mkdirSync(path.dirname(fxExtraPath()), { recursive: true });
      writeFileAtomic(fxExtraPath(), JSON.stringify(file));
    } catch (err: any) {
      console.warn(`[FX extra] could not save: ${err?.message || err}`);
    }
    return file;
  })().finally(() => {
    fxExtraPending = null;
  });
  return fxExtraPending;
}

/** US 10Y (OECD monthly, via FRED): the benchmark for spreads over Treasuries in MarketEdge. */
export function fetchUs10YYield(): Promise<OfficialYieldObservation | null> {
  return fetchFredCached(US_10Y_SERIES);
}

/**
 * FX valuation per currency (see src/utils/fxValuation.ts): BIS real exchange rate gap and
 * three-month realised volatility against the dollar. Kept 12 hours (1 hour after a miss).
 */
export type FxValuation = { reer: ReerGap | null; vol: FxVol | null; fromSaved?: boolean; answered?: boolean };
export const fxValuationCache = new Map<string, { at: number; value: FxValuation; pending?: Promise<FxValuation> }>();
export async function fetchFxValuationUncached(iso3: string, ccy: string): Promise<FxValuation> {
  const iso2 = BIS_ISO2[iso3];
  const [reerText, volRes] = await Promise.all([
    iso2 ? fetchTextWithTimeout(reerUrl(iso2), 8000) : Promise.resolve(null),
    fetchWithTimeout(frankfurterSeriesUrl(ccy), 6000).catch(() => null),
  ]);
  let vol: FxVol | null = null;
  try {
    if (volRes?.ok) vol = parseFxVol(await volRes.json(), ccy);
  } catch {
    vol = null;
  }
  const reer = parseReer(reerText);
  if (reer || vol) saveMarketExtras((f) => (f.fx[iso3] = { at: new Date().toISOString(), ...(reer ? { reer } : f.fx[iso3]?.reer ? { reer: f.fx[iso3].reer } : {}), ...(vol ? { vol } : f.fx[iso3]?.vol ? { vol: f.fx[iso3].vol } : {}) }));
  const saved = loadMarketExtras().fx[iso3];
  return { reer: reer ?? saved?.reer ?? null, vol: vol ?? saved?.vol ?? null, ...((!reer && saved?.reer) || (!vol && saved?.vol) ? { fromSaved: true } : {}), answered: !!(reer || vol) };
}
export async function fetchFxValuation(iso3: string, ccy: string): Promise<FxValuation> {
  const hit = fxValuationCache.get(iso3);
  const fresh = hit && Date.now() - hit.at < ((hit.value.reer || hit.value.vol) && !hit.value.fromSaved ? 12 : 1) * 60 * 60 * 1000;
  if (fresh) return hit!.value;
  if (hit?.pending) return hit.pending;
  const pending = fetchFxValuationUncached(iso3, ccy).then((value) => {
    fxValuationCache.set(iso3, { at: Date.now(), value });
    return value;
  });
  fxValuationCache.set(iso3, { at: hit?.at ?? 0, value: hit?.value ?? { reer: null, vol: null }, pending });
  return pending;
}

/**
 * US effective federal funds rate, the dollar leg of carry. 6h cache. From the NY Fed; when the NY
 * Fed does not answer (its API sometimes redirects every call to an error page), the same rate as
 * FRED republishes it (series DFF, no key), labelled as such. Only when both fail is the saved
 * figure used.
 */
export let effrCache: { at: number; value: Effr | null; fallback?: boolean } | null = null;
export async function fetchEffr(): Promise<Effr | null> {
  if (effrCache && Date.now() - effrCache.at < (effrCache.value && !effrCache.fallback ? 6 : 1) * 60 * 60 * 1000) return effrCache.value;
  let value: Effr | null = null;
  try {
    const res = await fetchWithTimeout('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json', 4000);
    if (res.ok) value = parseEffr(await res.json().catch(() => null));
  } catch {
    value = null;
  }
  if (!value) {
    try {
      const res = await fetchWithTimeout(fredCsvUrl('DFF'), 6000);
      if (res.ok) value = parseFredDff(await res.text());
    } catch {
      value = null;
    }
  }
  const fallback = !value;
  if (value) {
    const got = value;
    saveMarketExtras((f) => (f.effr = { at: new Date().toISOString(), value: got }));
  } else value = loadMarketExtras().effr?.value ?? null;
  effrCache = { at: Date.now(), value, ...(fallback ? { fallback: true } : {}) };
  return value;
}

/** Forget the hard-currency bond spread held in memory, so the next read uses the saved file. */
export function forgetHcSpread(): void {
  hcSpreadCache = null;
}
/** Forget the effective fed funds rate held in memory. */
export function forgetEffr(): void {
  effrCache = null;
}
/** Forget your own CDS file held in memory (after its key or file changes). */
export function forgetOwnCds(): void {
  ownCdsCache = null;
}

/**
 * Fed balance sheet (H.4.1) series from FRED, two years each, kept 12 hours (1 hour after a miss).
 * A series that answers is saved to data/live/fed-balance-sheet.json; one that does not uses its
 * saved values, with their own dates (src/utils/fedBalanceSheet.ts).
 */
let fedCache: { at: number; value: FedBalanceSheet; fallback: boolean } | null = null;
function fedFile(): string {
  return path.join(DATA_DIR, 'live', 'fed-balance-sheet.json');
}
export async function fetchFedBalanceSheet(): Promise<FedBalanceSheet> {
  if (fedCache && Date.now() - fedCache.at < (fedCache.fallback ? 1 : 12) * 60 * 60 * 1000) return fedCache.value;
  let saved: Record<string, Obs[]> = {};
  try {
    saved = JSON.parse(fs.readFileSync(fedFile(), 'utf8'))?.series || {};
  } catch {
    // never saved
  }
  const raw: Record<string, Obs[] | null> = {};
  let fallback = false;
  let got = false;
  await Promise.all(
    FED_SERIES.map(async (def) => {
      const csv = await fetchTextWithTimeout(fredCsvUrl(def.id), 8000);
      const obs = csv ? parseFredCsvSeries(csv) : [];
      if (obs.length) {
        raw[def.id] = obs;
        saved[def.id] = obs;
        got = true;
      } else {
        fallback = true;
        raw[def.id] = saved[def.id]?.length ? saved[def.id] : null;
      }
    })
  );
  if (got) {
    try {
      fs.mkdirSync(path.dirname(fedFile()), { recursive: true });
      writeFileAtomic(fedFile(), JSON.stringify({ savedAt: new Date().toISOString(), series: saved }));
    } catch (err: any) {
      console.warn(`[fed balance sheet] could not save: ${err?.message || err}`);
    }
  }
  const value = buildFedBalanceSheet(raw);
  fedCache = { at: Date.now(), value, fallback };
  return value;
}

/**
 * BIS daily policy rate history for one area from 1999 (event study, src/utils/eventStudy.ts).
 * Kept 24 hours in memory (1 hour after a miss).
 */
const policyDailyCache = new Map<string, { at: number; value: Array<{ period: string; pct: number }> | null }>();
export async function fetchPolicyDaily(area: string): Promise<Array<{ period: string; pct: number }> | null> {
  const hit = policyDailyCache.get(area);
  if (hit && Date.now() - hit.at < (hit.value ? 24 : 1) * 60 * 60 * 1000) return hit.value;
  const csv = await fetchTextWithTimeout(`${BIS_API}/${CBPOL_DATASET}/D.${area}/all?startPeriod=1999-01-01&format=csv`, 20000).catch(() => null);
  const value = csv ? parseCbpolCsv(csv, 'D')[area]?.points ?? null : null;
  policyDailyCache.set(area, { at: Date.now(), value });
  return value;
}

/** BIS real broad effective exchange rate from 1994 for one country (BEER). Kept 24 hours (1 hour after a miss). */
const reerLongCache = new Map<string, { at: number; value: Array<{ period: string; value: number }> | null }>();
export async function fetchReerLong(iso3: string): Promise<Array<{ period: string; value: number }> | null> {
  const iso2 = BIS_ISO2[iso3];
  if (!iso2) return null;
  const hit = reerLongCache.get(iso2);
  if (hit && Date.now() - hit.at < (hit.value ? 24 : 1) * 60 * 60 * 1000) return hit.value;
  const csv = await fetchTextWithTimeout(reerLongUrl(iso2), 15000).catch(() => null);
  const pts = csv ? parseReerMonthly(csv) : [];
  const value = pts.length ? pts : null;
  reerLongCache.set(iso2, { at: Date.now(), value });
  return value;
}
