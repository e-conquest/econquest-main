/**
 * OECD data via DBnomics: composite leading indicators, CPI and national CPI. Calls are queued
 * and spaced so the service is not overloaded.
 */

import fs from 'fs';
import path from 'path';
import { BANXICO_CPI_SERIES, BANXICO_LONG, BANXICO_SHORT, banxicoHeaders, banxicoSeriesUrl, BCB_IPCA_12M, BCB_LONG, BCB_SHORT, bcbSgsUrl, EUROSTAT_GEO, EUROSTAT_LONG, EUROSTAT_SHORT, eurostatHicpUrl, EVDS_CPI_DEFAULT_SERIES, EVDS_CPI_SHORT, evdsCpiLong, evdsCpiUrl, parseEvdsCpiYoy, type NationalCpiSeries, parseBanxicoMonthly, parseBcbSgs, parseEurostatHicp } from '../../utils/nationalCpi';
import { DATA_DIR } from '../config';
import { isValidEvdsSeriesCode } from '../../utils/officialYields';
import { SOVEREIGN_CATALOG } from '../../data/presetsAndBaselines.ts';
import { describeNetworkError } from '../../utils/connectionCheck';
import { fetchWithTimeout } from '../http';
import { isBotCheck, OECD_HEADERS, OECD_PAUSE_MS } from '../../utils/oecdSdmx';
import { parseQna, type QnaSeries, qnaUrl } from '../../utils/oecdQna';
import { type ActivitySeries, BCB_IBCBR_SA, bcbSgsSinceUrl, EUROSTAT_IP_GEO, eurostatIpUrl, parseEurostatIp, parseIbcBr } from '../../utils/monthlyActivity';
import { type CliSeries, cliUrl, parseCli } from '../../utils/oecdCli';
import { type CpiSeries, cpiUrl, parseCpi } from '../../utils/oecdInflation';
import { writeFileAtomic } from '../../utils/atomicWrite';

/**
 * One way to fetch OECD data (now through DBnomics, api.db.nomics.world): named headers, one call
 * at a time at least 5 seconds apart, and nothing at all for an hour after a refusal (HTTP 429 or
 * a Cloudflare bot check).
 */
let oecdQueue: Promise<unknown> = Promise.resolve();
let oecdLastCallAt = 0;
let oecdPausedUntil = 0;
export async function oecdFetch(url: string, timeoutMs: number): Promise<{ status: number; text: string } | null> {
  const run = async () => {
    if (Date.now() < oecdPausedUntil) {
      console.warn(`[OECD] paused after a refusal; asking again in ${Math.ceil((oecdPausedUntil - Date.now()) / 60000)} min`);
      return null;
    }
    const wait = oecdLastCallAt + 5000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    oecdLastCallAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: OECD_HEADERS });
      const text = await res.text();
      if (res.status === 429 || isBotCheck(res.status, text)) {
        oecdPausedUntil = Date.now() + OECD_PAUSE_MS;
        console.warn(`[OECD via DBnomics] ${isBotCheck(res.status, text) ? 'blocked by a bot check' : 'too many requests'} (HTTP ${res.status}); pausing these calls for an hour`);
      }
      return { status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  };
  const p = oecdQueue.then(run, run);
  oecdQueue = p.catch(() => undefined);
  return p;
}

/**
 * OECD composite leading indicators (src/utils/oecdCli.ts). Monthly; one call for every area.
 * Saved to data/live/oecd-cli.json with its pull date and pulled again after a day; a failed pull
 * keeps the last good one and is retried after an hour. If the OECD refuses the narrow query
 * (a changed layout), the whole dataflow is asked for once and read the same way.
 */
type CliPull = { pulledAt: string; series: CliSeries };
let cliMemory: { pull: CliPull | null; triedAt: number } | null = null;
let cliInFlight: Promise<CliPull | null> | null = null;
function cliFile(): string {
  return path.join(DATA_DIR, 'live', 'oecd-cli.json');
}
export async function fetchCliPull(): Promise<CliPull | null> {
  if (!cliMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(cliFile(), 'utf8')) as CliPull;
      if (saved?.pulledAt && saved.series) cliMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (cliMemory?.pull && Date.now() - Date.parse(cliMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return cliMemory.pull;
  if (cliMemory && Date.now() - cliMemory.triedAt < 60 * 60 * 1000) return cliMemory.pull;
  if (cliInFlight) return cliInFlight;
  cliInFlight = (async () => {
    let series: CliSeries | null = null;
    for (const wide of [false, true]) {
      let res: { status: number; text: string } | null = null;
      try {
        res = await oecdFetch(cliUrl({ wide }), 30000);
      } catch (e) {
        console.warn(`[OECD via DBnomics] leading indicators: ${describeNetworkError(e, 30000)}`);
        break;
      }
      if (!res) break;
      if (res.status >= 200 && res.status < 300) series = parseCli(res.text);
      else console.warn(`[OECD via DBnomics] leading indicators refused (HTTP ${res.status})`);
      // Ask again without the adjustment filter only when the narrow query found nothing or was
      // refused as unknown; never after a 429 or a bot check.
      if (series || !(res.status === 400 || res.status === 404 || (res.status >= 200 && res.status < 300))) break;
    }
    const prev = cliMemory?.pull ?? null;
    if (!series) {
      cliMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: CliPull = { pulledAt: new Date().toISOString(), series };
    cliMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(cliFile()), { recursive: true });
      writeFileAtomic(cliFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    cliInFlight = null;
  });
  return cliInFlight;
}

/**
 * OECD quarterly real GDP growth (src/utils/oecdQna.ts). One call for every area, after the other
 * OECD calls (same queue). Saved to data/live/oecd-qna.json and pulled again after a day; a failed
 * pull keeps the last good one and is retried after an hour.
 */
type QnaPull = { pulledAt: string; series: QnaSeries };
let qnaMemory: { pull: QnaPull | null; triedAt: number } | null = null;
let qnaInFlight: Promise<QnaPull | null> | null = null;
function qnaFile(): string {
  return path.join(DATA_DIR, 'live', 'oecd-qna.json');
}
export async function fetchQnaPull(): Promise<QnaPull | null> {
  if (!qnaMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(qnaFile(), 'utf8')) as QnaPull;
      if (saved?.pulledAt && saved.series) qnaMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (qnaMemory?.pull && Date.now() - Date.parse(qnaMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return qnaMemory.pull;
  if (qnaMemory && Date.now() - qnaMemory.triedAt < 60 * 60 * 1000) return qnaMemory.pull;
  if (qnaInFlight) return qnaInFlight;
  qnaInFlight = (async () => {
    let series: QnaSeries | null = null;
    for (const wide of [false, true]) {
      let res: { status: number; text: string } | null = null;
      try {
        res = await oecdFetch(qnaUrl({ wide }), 30000);
      } catch (e) {
        console.warn(`[OECD via DBnomics] quarterly GDP: ${describeNetworkError(e, 30000)}`);
        break;
      }
      if (!res) break;
      if (res.status >= 200 && res.status < 300) series = parseQna(res.text);
      else console.warn(`[OECD via DBnomics] quarterly GDP refused (HTTP ${res.status})`);
      if (series || !(res.status === 400 || res.status === 404 || (res.status >= 200 && res.status < 300))) break;
    }
    const prev = qnaMemory?.pull ?? null;
    if (!series) {
      qnaMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: QnaPull = { pulledAt: new Date().toISOString(), series };
    qnaMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(qnaFile()), { recursive: true });
      writeFileAtomic(qnaFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    qnaInFlight = null;
  });
  return qnaInFlight;
}

/**
 * OECD consumer price inflation (src/utils/oecdInflation.ts). Monthly; one call for every area.
 * Saved to data/live/oecd-cpi.json with its pull date and pulled again after a day; a failed pull
 * keeps the last good one and is retried after an hour.
 */
type CpiPull = { pulledAt: string; series: CpiSeries };
let cpiMemory: { pull: CpiPull | null; triedAt: number } | null = null;
let cpiInFlight: Promise<CpiPull | null> | null = null;
function cpiFile(): string {
  return path.join(DATA_DIR, 'live', 'oecd-cpi.json');
}
export async function fetchCpiPull(): Promise<CpiPull | null> {
  if (!cpiMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(cpiFile(), 'utf8')) as CpiPull;
      if (saved?.pulledAt && saved.series) cpiMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (cpiMemory?.pull && Date.now() - Date.parse(cpiMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return cpiMemory.pull;
  if (cpiMemory && Date.now() - cpiMemory.triedAt < 60 * 60 * 1000) return cpiMemory.pull;
  if (cpiInFlight) return cpiInFlight;
  cpiInFlight = (async () => {
    let series: CpiSeries | null = null;
    for (const wide of [false, true]) {
      let res: { status: number; text: string } | null = null;
      try {
        res = await oecdFetch(cpiUrl({ wide }), 60000);
      } catch (e) {
        console.warn(`[OECD via DBnomics] consumer prices: ${describeNetworkError(e, 60000)}`);
        break;
      }
      if (!res) break;
      if (res.status >= 200 && res.status < 300) series = parseCpi(res.text);
      else console.warn(`[OECD via DBnomics] consumer prices refused (HTTP ${res.status})`);
      if (series || !(res.status === 400 || res.status === 404 || (res.status >= 200 && res.status < 300))) break;
    }
    const prev = cpiMemory?.pull ?? null;
    if (!series) {
      cpiMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: CpiPull = { pulledAt: new Date().toISOString(), series };
    cpiMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(cpiFile()), { recursive: true });
      writeFileAtomic(cpiFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    cpiInFlight = null;
  });
  return cpiInFlight;
}

/**
 * Fresher monthly inflation (src/utils/nationalCpi.ts): Brazil's central bank (BCB SGS, IPCA 12
 * months) and Eurostat HICP for EU members on the country list. Asked once a day, kept on disk
 * (data/live/national-cpi.json); a failed pull keeps the last good series per country.
 */
export type NationalCpiPull = { pulledAt: string; series: Record<string, NationalCpiSeries> };
export let nationalCpiMemory: { pull: NationalCpiPull | null; triedAt: number } | null = null;
let nationalCpiInFlight: Promise<NationalCpiPull | null> | null = null;
function nationalCpiFile(): string {
  return path.join(DATA_DIR, 'live', 'national-cpi.json');
}
/**
 * After a key change: drop the countries that key feeds, so a removed key stops showing its series
 * and a new key is asked from the next pull instead of tomorrow.
 */
export function forgetNationalCpi(iso3s: string[]): void {
  if (!nationalCpiMemory?.pull) {
    nationalCpiMemory = null;
    return;
  }
  const series = { ...nationalCpiMemory.pull.series };
  for (const iso3 of iso3s) delete series[iso3];
  const pull = { ...nationalCpiMemory.pull, series, pulledAt: new Date(0).toISOString() };
  nationalCpiMemory = { pull, triedAt: 0 };
  try {
    writeFileAtomic(nationalCpiFile(), JSON.stringify(pull));
  } catch {
    // the memory copy is enough until the next pull
  }
}
export async function fetchNationalCpi(): Promise<NationalCpiPull | null> {
  if (!nationalCpiMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(nationalCpiFile(), 'utf8')) as NationalCpiPull;
      if (saved?.pulledAt && saved.series) nationalCpiMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (nationalCpiMemory?.pull && Date.now() - Date.parse(nationalCpiMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return nationalCpiMemory.pull;
  if (nationalCpiMemory && Date.now() - nationalCpiMemory.triedAt < 60 * 60 * 1000) return nationalCpiMemory.pull;
  if (nationalCpiInFlight) return nationalCpiInFlight;
  nationalCpiInFlight = (async () => {
    const prev = nationalCpiMemory?.pull ?? null;
    const series: Record<string, NationalCpiSeries> = { ...(prev?.series || {}) };
    let answered = 0;
    const isoInCatalog = new Set(SOVEREIGN_CATALOG.map((c) => c.iso3));
    await Promise.allSettled([
      (async () => {
        if (!isoInCatalog.has('BRA')) return;
        try {
          const res = await fetchWithTimeout(bcbSgsUrl(BCB_IPCA_12M), 15000);
          if (!res.ok) return console.warn(`[BCB SGS] IPCA refused (HTTP ${res.status})`);
          const pts = parseBcbSgs(await res.json());
          if (pts.length) {
            series.BRA = { points: pts, short: BCB_SHORT, long: BCB_LONG };
            answered++;
          }
        } catch (e) {
          console.warn(`[BCB SGS] IPCA: ${describeNetworkError(e, 15000)}`);
        }
      })(),
      (async () => {
        // Mexico only with the user's own Banxico token; without it Mexico keeps the OECD series.
        const token = (process.env.BANXICO_TOKEN || '').trim();
        if (!token || !isoInCatalog.has('MEX')) {
          delete series.MEX;
          return;
        }
        try {
          const res = await fetch(banxicoSeriesUrl([BANXICO_CPI_SERIES]), { headers: banxicoHeaders(token), signal: AbortSignal.timeout(15000) });
          if (!res.ok) return console.warn(`[Banxico] INPC refused (HTTP ${res.status})`);
          const pts = parseBanxicoMonthly(await res.json(), BANXICO_CPI_SERIES);
          if (pts.length) {
            series.MEX = { points: pts, short: BANXICO_SHORT, long: BANXICO_LONG };
            answered++;
          }
        } catch (e) {
          console.warn(`[Banxico] INPC: ${describeNetworkError(e, 15000)}`);
        }
      })(),
      (async () => {
        // Turkey only with the user's own EVDS key; without it Turkey keeps the OECD series.
        const key = (process.env.EVDS_API_KEY || '').trim();
        const code = (process.env.EVDS_TR_CPI_SERIES || '').trim() || EVDS_CPI_DEFAULT_SERIES;
        if (!key || !isValidEvdsSeriesCode(code) || !isoInCatalog.has('TUR')) {
          delete series.TUR;
          return;
        }
        try {
          // The key goes only in the "key" header, never in the URL.
          const res = await fetch(evdsCpiUrl(code), { headers: { key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
          if (!res.ok) return console.warn(`[EVDS] Turkey CPI refused (HTTP ${res.status})`);
          const pts = parseEvdsCpiYoy(await res.json(), code);
          if (pts.length) {
            series.TUR = { points: pts, short: EVDS_CPI_SHORT, long: evdsCpiLong(code) };
            answered++;
          }
        } catch (e) {
          console.warn(`[EVDS] Turkey CPI: ${describeNetworkError(e, 15000)}`);
        }
      })(),
      (async () => {
        const eu = SOVEREIGN_CATALOG.filter((c) => EUROSTAT_GEO[c.iso3]);
        if (!eu.length) return;
        try {
          const res = await fetchWithTimeout(eurostatHicpUrl(eu.map((c) => EUROSTAT_GEO[c.iso3])), 20000);
          if (!res.ok) return console.warn(`[Eurostat] HICP refused (HTTP ${res.status})`);
          const byGeo = parseEurostatHicp(await res.json());
          for (const c of eu) {
            const pts = byGeo[EUROSTAT_GEO[c.iso3]];
            if (pts?.length) {
              series[c.iso3] = { points: pts, short: EUROSTAT_SHORT, long: EUROSTAT_LONG };
              answered++;
            }
          }
        } catch (e) {
          console.warn(`[Eurostat] HICP: ${describeNetworkError(e, 20000)}`);
        }
      })(),
    ]);
    if (!answered) {
      nationalCpiMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: NationalCpiPull = { pulledAt: new Date().toISOString(), series };
    nationalCpiMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(nationalCpiFile()), { recursive: true });
      writeFileAtomic(nationalCpiFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    nationalCpiInFlight = null;
  });
  return nationalCpiInFlight;
}

/**
 * Monthly activity indexes for the GDP nowcast (src/utils/monthlyActivity.ts): BCB IBC-Br for
 * Brazil, Eurostat industrial production for EU members (and Turkey where Eurostat has it). Full
 * history, asked once a day, kept on disk (data/live/monthly-activity.json); a failed pull keeps
 * the last good series per country.
 */
type ActivityPull = { pulledAt: string; series: Record<string, ActivitySeries> };
let activityMemory: { pull: ActivityPull | null; triedAt: number } | null = null;
let activityInFlight: Promise<ActivityPull | null> | null = null;
function activityFile(): string {
  return path.join(DATA_DIR, 'live', 'monthly-activity.json');
}
export async function fetchMonthlyActivity(): Promise<ActivityPull | null> {
  if (!activityMemory) {
    try {
      const saved = JSON.parse(fs.readFileSync(activityFile(), 'utf8')) as ActivityPull;
      if (saved?.pulledAt && saved.series) activityMemory = { pull: saved, triedAt: Date.parse(saved.pulledAt) };
    } catch {
      // never pulled
    }
  }
  if (activityMemory?.pull && Date.now() - Date.parse(activityMemory.pull.pulledAt) < 24 * 60 * 60 * 1000) return activityMemory.pull;
  if (activityMemory && Date.now() - activityMemory.triedAt < 60 * 60 * 1000) return activityMemory.pull;
  if (activityInFlight) return activityInFlight;
  activityInFlight = (async () => {
    const prev = activityMemory?.pull ?? null;
    const series: Record<string, ActivitySeries> = { ...(prev?.series || {}) };
    let answered = 0;
    const isoInCatalog = new Set(SOVEREIGN_CATALOG.map((c) => c.iso3));
    await Promise.allSettled([
      (async () => {
        if (!isoInCatalog.has('BRA')) return;
        try {
          const res = await fetchWithTimeout(bcbSgsSinceUrl(BCB_IBCBR_SA), 20000);
          if (!res.ok) return console.warn(`[BCB SGS] IBC-Br refused (HTTP ${res.status})`);
          const s = parseIbcBr(await res.json());
          if (s) {
            series.BRA = s;
            answered++;
          }
        } catch (e) {
          console.warn(`[BCB SGS] IBC-Br: ${describeNetworkError(e, 20000)}`);
        }
      })(),
      (async () => {
        const eu = SOVEREIGN_CATALOG.filter((c) => EUROSTAT_IP_GEO[c.iso3]).map((c) => c.iso3);
        if (!eu.length) return;
        try {
          const res = await fetchWithTimeout(eurostatIpUrl(eu.map((i) => EUROSTAT_IP_GEO[i])), 30000);
          if (!res.ok) return console.warn(`[Eurostat] industrial production refused (HTTP ${res.status})`);
          const got = parseEurostatIp(await res.json(), eu);
          for (const [iso3, s] of Object.entries(got)) {
            series[iso3] = s;
            answered++;
          }
        } catch (e) {
          console.warn(`[Eurostat] industrial production: ${describeNetworkError(e, 30000)}`);
        }
      })(),
    ]);
    if (!answered) {
      activityMemory = { pull: prev, triedAt: Date.now() };
      return prev;
    }
    const fresh: ActivityPull = { pulledAt: new Date().toISOString(), series };
    activityMemory = { pull: fresh, triedAt: Date.now() };
    try {
      fs.mkdirSync(path.dirname(activityFile()), { recursive: true });
      writeFileAtomic(activityFile(), JSON.stringify(fresh));
    } catch {
      // keep the memory copy
    }
    return fresh;
  })().finally(() => {
    activityInFlight = null;
  });
  return activityInFlight;
}
