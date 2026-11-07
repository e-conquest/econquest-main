/**
 * Data connection check (Sam, 2026-11-05: "clean up the data sources and make sure they connect
 * properly").
 *
 * One list of every outside source the app reads, and a check that asks each one for a single
 * small, real answer through the same URL and parser the app uses. Each source comes back as one
 * row: connected (with the figure it returned), needs setup (which key or file), off (your own
 * paid account, not switched on), or failed (no answer, refused, or an answer the app could not
 * read), with the reason in plain words.
 *
 * Used by GET /api/data/connections (the Tools page) and by `npm run check:data` in a terminal.
 * Keys and passwords are never put in a row: only whether they are set.
 */
import { ECB_SPF_SERIES, ecbSpfUrl, FOCUS_URL, parseEcbCsv, parseFocus12m } from './inflationSurveys';
import { gscpiFromBytes, GSCPI_URLS } from './stressIndices';
import { bcrpEmbigUrl, describeBcrpReply, parseBcrpEmbig } from './hardCurrencySpread';
import { geminiModel } from './geminiModel';
import { DEFAULT_REFEREE_MODEL, refereeModelOrDefault } from './refereeModel';
import { TIC_URL, formatMonth, parseTicTable, ticHoldingFor } from './ticHoldings';
import { IMF_MEASURES, IMF_SDMX_HOST, formatImfPeriod, pullImfExternal } from './imfReserves';
import { cliFor, cliUrl, parseCli } from './oecdCli';
import { formatQuarter, parseQna, qnaReading, qnaUrl } from './oecdQna';
import { BCB_IBCBR_SA, bcbSgsSinceUrl, eurostatIpUrl, parseEurostatIp, parseIbcBr } from './monthlyActivity';
import { OECD_HEADERS, isBotCheck } from './oecdSdmx';
import { cpiFor, cpiUrl, parseCpi } from './oecdInflation';
import { ACLED_TOKEN_URL, acledReadUrl, acledTokenBody, parseAcledPage } from './acled';
import { BANXICO_CPI_SERIES, banxicoHeaders, banxicoSeriesUrl, BCB_IPCA_12M, bcbSgsUrl, eurostatHicpUrl, EVDS_CPI_DEFAULT_SERIES, evdsCpiUrl, parseBanxicoMonthly, parseEvdsCpiYoy, parseBcbSgs, parseEurostatHicp } from './nationalCpi';
import { coferLine, pullCofer } from './imfCofer';
import { CFTC_CURRENCY_CODES, cftcUrl, parseCftcRows, positioningFor } from './cftcPositioning';
import { BIS_ISO2, bisIntlUrl, parseBisIntl } from './bisDebtSecurities';
import { CBPOL_AREA, cbpolDailyUrl, parseCbpolCsv, policyRateFor } from './bisPolicyRates';
import { idsUrl, parseIds } from './debtSchedule';
import { frankfurterSeriesUrl, parseEffr, parseFxVol, parseReer, reerUrl } from './fxValuation';
import {
  US_10Y_SERIES,
  TESOURO_DIRETO_CSV_URL,
  evdsSeriesUrl,
  fredApiUrl,
  fredCsvUrl,
  isValidEvdsSeriesCode,
  parseEvdsLatest,
  parseFredApiLatest,
  parseFredCsvLatest,
  parseTesouroDiretoLatest,
} from './officialYields';
import { lsegSnapshotUrl, lsegTokenRequest, ownCdsSettings, parseLsegSnapshot, parseOwnCdsCsv } from './ownCds';
import { parseWitsShare, witsUrl } from './scenarioExposure';
import { PINK_SHEET_PAGE, PINK_SHEET_SHEET, eiaSpotUrl, findPinkSheetUrl, moveSentence, parseEiaSpot, parsePinkSheet, priceMove } from './commodityPrices';
import { readXlsxSheet } from './xlsxRead';
import { GDELT_V1_SIZES_URL, parseFileSizes } from './gdeltDaily';
import { ACLED_AGGREGATED_PAGE, ACLED_FOLDER, acledFileReading, type AcledFileData } from './acledFiles';
import { UCDP_DATASETS, UCDP_DATASET_IDS, UCDP_DOWNLOADS_PAGE, UCDP_FOLDER, ucdpReading, type UcdpData } from './ucdpConflict';
import { COMTRADE_REPORTERS, buildProfile, comtradeUrl, comtradeYears, parseComtrade, partnerSentence } from './comtradeTrade';

export type ConnectionState =
  /** Answered, and the answer was read. */
  | 'connected'
  /** A key, file or setting the source needs is missing or invalid. */
  | 'needs_setup'
  /** An optional key that is not set; the app uses a free route instead. */
  | 'optional'
  /** Your own paid account, not switched on. */
  | 'off'
  /** No answer: timeout, address not found, connection refused, or blocked on the way. */
  | 'no_answer'
  /** Answered with an HTTP error (refused, not found, rate limited). */
  | 'refused'
  /** Answered, but not in the shape the app reads. */
  | 'bad_reply';

export type ConnectionGroup = 'free' | 'free_key' | 'own_account' | 'ai';

export interface ConnectionResult {
  id: string;
  name: string;
  group: ConnectionGroup;
  /** What the app fills from it. */
  feeds: string;
  state: ConnectionState;
  /** The reason, or what came back, in a sentence. */
  detail: string;
  /** A figure from the answer, to show it is real: "Brazil reserves 5.9 months of imports (2024)". */
  sample?: string;
  /** How to set it up (the .env lines), when it needs setup or is optional. */
  setup?: string;
  /** Something to fix even though it connected (a model not installed, a stale file). */
  warning?: string;
  host: string;
  httpStatus?: number;
  latencyMs?: number;
}

export interface ConnectionReport {
  checkedAt: string;
  results: ConnectionResult[];
  counts: Record<ConnectionState, number>;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface CheckOptions {
  env: Record<string, string | undefined>;
  fetchFn?: FetchFn;
  now?: Date;
  /** Per request, ms. The Brazil Treasury file gets at least 90 s because it is about 15 MB from a slow server. */
  timeoutMs?: number;
  /** AI settings as the app uses them (the in-app settings win over .env). */
  ai?: { provider?: string; ollamaBaseUrl?: string; ollamaQuickModel?: string; ollamaDeepModel?: string; openAiBaseUrl?: string; geminiModel?: string };
  /** File reader for the own CDS file (injected in tests). */
  readFile?: (path: string) => { text: string; modified: Date } | null;
  /** The UCDP files read from data/local/ucdp/ (utils/ucdpStore.ts); absent = not checked. */
  ucdp?: () => UcdpData | null;
  /** The ACLED aggregated files in data/local/acled/ (server: acledFileData). */
  acledFiles?: () => AcledFileData | null;
  /** Only these source ids. */
  only?: string[];
  /** Where each key in `env` came from: 'app' = saved in Menu > Settings > API keys, 'env' = .env. */
  keySources?: Record<string, 'app' | 'env' | 'none'>;
  /** Pause between the two OECD checks, ms (default 3000; tests set 0). */
  oecdGapMs?: number;
}

export const STATE_LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  needs_setup: 'Needs setup',
  optional: 'Not set (optional)',
  off: 'Off (your own account)',
  no_answer: 'No answer',
  refused: 'Refused',
  bad_reply: 'Unreadable answer',
};

export const isFailure = (s: ConnectionState) => s === 'no_answer' || s === 'refused' || s === 'bad_reply';

const SAMPLE_ISO3 = 'BRA';
const SAMPLE_NAME = 'Brazil';

interface ProbeReply {
  ok: boolean;
  status?: number;
  latencyMs: number;
  text?: string;
  /** The address that finally answered, when redirects were followed. */
  finalUrl?: string;
  /** Set when there was no HTTP answer at all. */
  networkError?: string;
}

/** Turns a fetch failure into words: timeout, DNS, refused, TLS, proxy. */
export function describeNetworkError(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return `No answer within ${Math.round(timeoutMs / 1000)} s.`;
  const code = e?.cause?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Address not found. Check the internet connection (or a VPN or firewall blocking DNS).';
  if (code === 'ECONNREFUSED') return 'Connection refused: nothing is listening at that address.';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'The connection was cut. A firewall or proxy may be blocking it.';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'The connection timed out.';
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(e?.cause?.message || '')) return 'Secure connection failed (certificate). A proxy may be intercepting it.';
  const msg = String(e?.cause?.message || e?.message || 'failed').replace(/\.+$/, '');
  if (/cancel|abort/i.test(msg)) return 'The request was stopped on the way, often by a proxy or firewall that does not allow this site.';
  return `Request failed: ${msg}.`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function probe(fetchFn: FetchFn, url: string, timeoutMs: number, init: RequestInit = {}): Promise<ProbeReply> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0, text, ...(res.url && res.url !== url ? { finalUrl: res.url } : {}) };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, networkError: describeNetworkError(err, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }
}

function httpRefusal(status: number | undefined, text: string | undefined): string {
  if (isBotCheck(status, text))
    return `Blocked by the site's bot check (a Cloudflare "Just a moment" page, HTTP ${status}), not a data error. It usually clears after an hour without calls; the app pauses its own calls for an hour after this.`;
  const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const why =
    status === 401 || status === 403
      ? 'Refused: the key or login was not accepted, or the site blocks this network.'
      : status === 404
        ? 'Not found: the address or series code may have changed.'
        : status === 429
          ? 'Rate limited: too many requests. Wait a minute and check again.'
          : status && status >= 500
            ? 'The source had a server error. Usually temporary.'
            : 'The source refused the request.';
  return `${why} (HTTP ${status}${snippet ? `: "${snippet}"` : ''})`;
}

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text || '');
  } catch {
    return undefined;
  }
}

/**
 * True when a request was redirected to the site's own error page (for example the New York Fed
 * sends a 302 to www.newyorkfed.org/errors/500 during an outage). That is a fault on the source's
 * side, not a format change.
 */
export function isErrorPageRedirect(finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try {
    return /\/(errors?|error-pages?)(\/\d{3}|\.html?|\/?$)/i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

type Def = Omit<ConnectionResult, 'state' | 'detail' | 'host'> & { url?: string };

/** One HTTP check: probe, then read with the app's own parser. `read` returns a sample, or null if unreadable. */
async function httpCheck(
  def: Def,
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
  read: (r: ProbeReply) => string | null,
  init?: RequestInit,
  unreadable = 'It answered, but not in the format the app reads. The source may have changed its format.'
): Promise<ConnectionResult> {
  const { url: _u, ...rest } = def;
  const r = await probe(fetchFn, url, timeoutMs, init);
  const base = { ...rest, host: hostOf(url), latencyMs: r.latencyMs, ...(r.status ? { httpStatus: r.status } : {}) };
  if (r.networkError) return { ...base, state: 'no_answer', detail: r.networkError };
  if (isErrorPageRedirect(r.finalUrl))
    return { ...base, state: 'refused', detail: `Site error: the source sent its own error page (redirected to ${r.finalUrl}). A problem on its side, usually temporary; not a format change.` };
  if (!r.ok) return { ...base, state: 'refused', detail: httpRefusal(r.status, r.text) };
  let sample: string | null = null;
  try {
    sample = read(r);
  } catch {
    sample = null;
  }
  if (!sample) return { ...base, state: 'bad_reply', detail: unreadable };
  return { ...base, state: 'connected', detail: `Answered in ${r.latencyMs} ms.`, sample };
}

const fmt = (n: number, dp = 1) => n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp });

function setRow(def: Def, state: ConnectionState, detail: string, host: string): ConnectionResult {
  const { url: _u, ...rest } = def;
  return { ...rest, state, detail, host };
}

export const SOURCE_IDS = [
  'worldbank',
  'worldbank_debt',
  'imf',
  'imf_reserves',
  'imf_cofer',
  'gdelt',
  'gdelt_v1',
  'polymarket',
  'kalshi',
  'nyfed',
  'fx_spot',
  'frankfurter',
  'bis_reer',
  'bis_debt',
  'bis_cbpol',
  'wits',
  'cftc',
  'tic',
  'pink_sheet',
  'oecd_cli',
  'oecd_cpi',
  'oecd_qna',
  'bcb_ipca',
  'bcrp_embig',
  'eurostat_hicp',
  'bcb_ibcbr',
  'eurostat_ip',
  'comtrade',
  'fred_csv',
  'fred_api',
  'tesouro',
  'ecb_spf',
  'bcb_focus',
  'nyfed_gscpi',
  'evds',
  'banxico',
  'ucdp',
  'acled',
  'acled_files',
  'eia',
  'own_cds',
  'gemini',
  'ollama',
  'openai_compatible',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export async function checkConnections(opts: CheckOptions): Promise<ConnectionReport> {
  const env = opts.env;
  const fetchFn: FetchFn = opts.fetchFn || ((u, i) => fetch(u, i));
  const now = opts.now || new Date();
  const T = opts.timeoutMs ?? 10000;
  const year = now.getUTCFullYear();
  const want = (id: SourceId) => !opts.only || opts.only.includes(id);
  // How to name a key in a sentence: saved in Settings, or the .env name.
  const keyPhrase = (envName: string) => (opts.keySources?.[envName] === 'app' ? 'the key saved in Settings' : `the key in ${envName}`);
  const savedNote = (envName: string, r: ConnectionResult) =>
    r.state === 'connected' && opts.keySources?.[envName] === 'app' ? { ...r, detail: `${r.detail} (key saved in Settings)` } : r;
  const provider = (opts.ai?.provider || env.DEFAULT_AI_PROVIDER || 'gemini').toLowerCase();
  const usesOllama = provider === 'ollama' || provider.startsWith('hybrid');
  const usesGemini = provider === 'gemini' || provider.startsWith('hybrid');
  const usesOpenAi = provider === 'openai_compatible';

  const jobs: Array<Promise<ConnectionResult>> = [];
  const add = (id: SourceId, job: () => Promise<ConnectionResult>) => {
    if (want(id)) jobs.push(job());
  };

  // ---- Free, no key -------------------------------------------------------------------------
  add('worldbank', () =>
    httpCheck(
      { id: 'worldbank', name: 'World Bank indicators', group: 'free', feeds: 'Reserves, current account, external debt, political stability, trade shares' },
      fetchFn,
      `https://api.worldbank.org/v2/country/${SAMPLE_ISO3}/indicator/FI.RES.TOTL.MO?format=json&per_page=6`,
      T,
      (r) => {
        const rows = (parseJson(r.text) as unknown[])?.[1];
        const row = Array.isArray(rows) ? (rows as Array<{ value?: unknown; date?: string }>).find((x) => typeof x?.value === 'number') : undefined;
        return row ? `${SAMPLE_NAME} reserves ${fmt(Number(row.value))} months of imports (${row.date})` : null;
      }
    )
  );

  add('worldbank_debt', () =>
    httpCheck(
      { id: 'worldbank_debt', name: 'World Bank debt statistics (IDS, QEDS)', group: 'free', feeds: 'External debt falling due, by year and by quarter (banker brief)' },
      fetchFn,
      idsUrl(SAMPLE_ISO3),
      T,
      (r) => {
        const json = parseJson(r.text);
        const ids = parseIds(json, year);
        const y = ids?.years?.find((x) => x.principalUsdBn !== undefined);
        if (y) return `${SAMPLE_NAME} public external principal due ${y.year}: $${fmt(y.principalUsdBn!)}bn`;
        // An empty but well-formed reply still proves the connection.
        return Array.isArray(json) || (json && typeof json === 'object') ? `Answered (no projection rows for ${SAMPLE_NAME} this year)` : null;
      }
    )
  );

  add('imf', () =>
    httpCheck(
      { id: 'imf', name: 'IMF World Economic Outlook (DataMapper)', group: 'free', feeds: 'Debt/GDP, inflation, GDP growth, primary balance' },
      fetchFn,
      `https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP/${SAMPLE_ISO3}`,
      T,
      (r) => {
        const series = (parseJson(r.text) as { values?: Record<string, Record<string, Record<string, number>>> })?.values?.GGXWDG_NGDP?.[SAMPLE_ISO3];
        if (!series) return null;
        for (const y of [String(year - 1), String(year), String(year - 2)]) {
          if (typeof series[y] === 'number') return `${SAMPLE_NAME} government debt ${fmt(series[y])}% of GDP (${y})`;
        }
        return null;
      }
    )
  );

  add('imf_reserves', async () => {
    const def: Def = {
      id: 'imf_reserves',
      name: 'IMF reserves and balance of payments (api.imf.org)',
      group: 'free',
      feeds: 'Monthly official reserves (IL), quarterly current account and imports (BOP), months of import cover',
    };
    const t0 = Date.now();
    let pulled: Awaited<ReturnType<typeof pullImfExternal>>;
    try {
      pulled = await pullImfExternal({ fetchFn, env, timeoutMs: Math.max(T, 30000) }, SAMPLE_ISO3);
    } catch (err) {
      return { ...setRow(def, 'no_answer', describeNetworkError(err, Math.max(T, 30000)), IMF_SDMX_HOST), latencyMs: Date.now() - t0 };
    }
    const e = pulled.external;
    const latencyMs = Date.now() - t0;
    const failed = pulled.steps.filter((s) => !s.ok);
    const steps = pulled.steps.map((s) => `${IMF_MEASURES[s.measure].label}: ${s.ok ? 'read' : 'not read'} (${s.note})`).join(' ');
    if (e.reserves || e.currentAccount) {
      const bits = [
        e.reserves ? `reserves $${fmt(e.reserves.usdBn)}bn (${formatImfPeriod(e.reserves.period)})` : '',
        e.monthsOfImports !== undefined ? `${fmt(e.monthsOfImports)} months of imports` : '',
        e.currentAccount4q?.pctGdp !== undefined
          ? `current account ${fmt(e.currentAccount4q.pctGdp)}% of GDP (4 quarters to ${formatImfPeriod(e.currentAccount4q.through)})`
          : e.currentAccount
            ? `current account $${fmt(e.currentAccount.usdBn)}bn (${formatImfPeriod(e.currentAccount.period)})`
            : '',
      ].filter(Boolean);
      return {
        ...setRow(def, 'connected', `Answered in ${latencyMs} ms. ${steps}`, IMF_SDMX_HOST),
        latencyMs,
        sample: `${SAMPLE_NAME} ${bits.join(', ')}`,
        ...(failed.length ? { warning: failed.map((s) => `${IMF_MEASURES[s.measure].label}: ${s.note}`).join(' ') } : {}),
        setup: 'If an IMF indicator is not matched by name, set its series key in .env: IMF_RESERVES_KEY, IMF_CA_KEY, IMF_IMPORTS_KEY ({ISO3} for the country).',
      };
    }
    const status = failed.map((s) => s.httpStatus ?? Number(/HTTP (\d{3})/.exec(s.note)?.[1] ?? 0)).find((n) => n >= 400);
    const noAnswer = failed.length > 0 && failed.every((s) => !s.httpStatus && /no answer within|fetch failed|request failed/i.test(s.note));
    return {
      ...setRow(def, status ? 'refused' : noAnswer ? 'no_answer' : 'bad_reply', steps || 'The IMF answered nothing the app could read.', IMF_SDMX_HOST),
      latencyMs,
      ...(status ? { httpStatus: status } : {}),
      setup: 'If an IMF indicator is not matched by name, set its series key in .env: IMF_RESERVES_KEY, IMF_CA_KEY, IMF_IMPORTS_KEY ({ISO3} for the country).',
    };
  });

  add('imf_cofer', async () => {
    const def: Def = { id: 'imf_cofer', name: 'IMF COFER (reserve currency shares)', group: 'free', feeds: 'World shares of official FX reserves by currency, quarterly' };
    const t0 = Date.now();
    let r: Awaited<ReturnType<typeof pullCofer>>;
    try {
      r = await pullCofer({ fetchFn, env, timeoutMs: Math.max(T, 30000) });
    } catch (err) {
      return { ...setRow(def, 'no_answer', describeNetworkError(err, Math.max(T, 30000)), IMF_SDMX_HOST), latencyMs: Date.now() - t0 };
    }
    const latencyMs = Date.now() - t0;
    const setup = 'If the world code or a currency is not found by name, set IMF_COFER_KEY in .env to the series key.';
    if (r.cofer) {
      return {
        ...setRow(def, 'connected', `Answered in ${latencyMs} ms. ${r.note}.`, IMF_SDMX_HOST),
        latencyMs,
        sample: `World FX reserves ${formatImfPeriod(r.cofer.period)}: ${coferLine(r.cofer, 3)}`,
        setup,
      };
    }
    const status = r.httpStatus && r.httpStatus >= 400 ? r.httpStatus : Number(/HTTP (\d{3})/.exec(r.note)?.[1] ?? 0) || undefined;
    const state: ConnectionState = status ? 'refused' : /no answer within|fetch failed|request failed/i.test(r.note) ? 'no_answer' : 'bad_reply';
    return { ...setRow(def, state, r.note, IMF_SDMX_HOST), latencyMs, ...(status ? { httpStatus: status } : {}), setup };
  });

  add('gdelt', () =>
    httpCheck(
      { id: 'gdelt', name: 'GDELT news', group: 'free', feeds: 'Headlines and news tone (risk score input)' },
      fetchFn,
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${SAMPLE_NAME}" economy`)}&mode=artlist&format=json&maxrecords=1`,
      // A refusal arrives after about 11 s (Sam's Mac, 2026-11-05).
      Math.max(T, 25000),
      (r) => {
        const arts = (parseJson(r.text) as { articles?: Array<{ title?: string }> })?.articles;
        if (Array.isArray(arts)) return arts[0]?.title ? `Latest headline: "${String(arts[0].title).slice(0, 80)}"` : 'Answered (no articles in the window)';
        return null;
      },
      undefined,
      'It answered with text instead of data. GDELT does this when asked too often (one request every 5 seconds); check again in a minute.'
    ).then((r) =>
      r.state === 'refused' && r.httpStatus === 429
        ? { ...r, detail: 'GDELT refused: too many requests from this connection (HTTP 429). It allows one request every 5 seconds and keeps refusing for a while after it is exceeded. The app pauses GDELT for 15 minutes after a refusal; check again after that.' }
        : r.state === 'no_answer'
          ? { ...r, detail: `${r.detail} GDELT's news search (api.gdeltproject.org) is a separate server from its event files (data.gdeltproject.org) and is sometimes slow or down for hours. The app keeps the last saved headlines and tone, each with its own date, and tries again within the hour; nothing for you to change.` }
          : r
    )
  );

  add('gdelt_v1', () =>
    httpCheck(
      { id: 'gdelt_v1', name: 'GDELT 1.0 event files', group: 'free', feeds: 'Monthly event history per country back to 1979 (npm run gdelt:daily)' },
      fetchFn,
      GDELT_V1_SIZES_URL,
      Math.max(T, 20000),
      (r) => {
        const files = parseFileSizes(r.text || '');
        const days = files.filter((f) => f.kind === 'day');
        return files.length ? `${files.length} files listed, newest ${days.at(-1)?.period || files.at(-1)!.period}` : null;
      }
    )
  );

  add('polymarket', () =>
    httpCheck(
      { id: 'polymarket', name: 'Polymarket', group: 'free', feeds: 'Prediction-market odds' },
      fetchFn,
      'https://gamma-api.polymarket.com/events?limit=1&active=true&closed=false',
      T,
      (r) => {
        const ev = parseJson(r.text);
        return Array.isArray(ev) && ev.length ? `Open market: "${String((ev[0] as { title?: string }).title || '').slice(0, 80)}"` : null;
      }
    )
  );

  add('kalshi', () =>
    httpCheck(
      { id: 'kalshi', name: 'Kalshi', group: 'free', feeds: 'Prediction-market odds (second venue)' },
      fetchFn,
      'https://api.elections.kalshi.com/trade-api/v2/markets?limit=1&status=open',
      T,
      (r) => {
        const m = (parseJson(r.text) as { markets?: Array<{ title?: string }> })?.markets;
        return Array.isArray(m) ? (m[0]?.title ? `Open market: "${String(m[0].title).slice(0, 80)}"` : 'Answered (no open markets)') : null;
      }
    )
  );

  add('nyfed', () =>
    httpCheck(
      { id: 'nyfed', name: 'New York Fed rates', group: 'free', feeds: 'Fed funds, SOFR, reverse repo (dollar leg of carry). When it is down the app reads the same rate from FRED (DFF)' },
      fetchFn,
      'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json',
      T,
      (r) => {
        const e = parseEffr(parseJson(r.text));
        return e ? `Effective fed funds ${fmt(e.pct, 2)}% (${e.date})` : null;
      }
    )
  );

  add('fx_spot', () =>
    httpCheck(
      { id: 'fx_spot', name: 'Spot FX (open.er-api.com)', group: 'free', feeds: 'Exchange rates against the dollar' },
      fetchFn,
      'https://open.er-api.com/v6/latest/USD',
      T,
      (r) => {
        const brl = (parseJson(r.text) as { rates?: Record<string, number> })?.rates?.BRL;
        return typeof brl === 'number' && brl > 0 ? `USD/BRL ${fmt(brl, 3)}` : null;
      }
    )
  );

  add('frankfurter', () =>
    httpCheck(
      { id: 'frankfurter', name: 'ECB reference rates (Frankfurter)', group: 'free', feeds: 'FX volatility; spot FX backup' },
      fetchFn,
      frankfurterSeriesUrl('BRL', now),
      T,
      (r) => {
        const v = parseFxVol(parseJson(r.text), 'BRL');
        return v ? `BRL 3-month volatility ${fmt(v.volPct)}% (to ${v.to})` : null;
      }
    )
  );

  add('bis_reer', () =>
    httpCheck(
      { id: 'bis_reer', name: 'BIS real exchange rates', group: 'free', feeds: 'Currency valuation against its own history' },
      fetchFn,
      reerUrl(BIS_ISO2[SAMPLE_ISO3], now),
      T,
      (r) => {
        const g = parseReer(r.text);
        return g ? `${SAMPLE_NAME} real exchange rate ${g.gapPct > 0 ? '+' : ''}${fmt(g.gapPct)}% vs its 10-year average (${g.period})` : null;
      }
    )
  );

  add('bis_debt', () =>
    httpCheck(
      { id: 'bis_debt', name: 'BIS debt securities', group: 'free', feeds: 'Government bonds outstanding (international and all markets)' },
      fetchFn,
      bisIntlUrl(BIS_ISO2[SAMPLE_ISO3]),
      T,
      (r) => {
        const d = parseBisIntl(r.text);
        return d ? `${SAMPLE_NAME} international government bonds $${fmt(d.outstandingUsdBn)}bn (${d.asOf})` : null;
      }
    )
  );

  add('bis_cbpol', () =>
    httpCheck(
      { id: 'bis_cbpol', name: 'BIS central bank policy rates', group: 'free', feeds: 'Policy rate per country, daily, with the central bank and the date' },
      fetchFn,
      cbpolDailyUrl([CBPOL_AREA[SAMPLE_ISO3]]),
      Math.max(T, 15000),
      (r) => {
        const p = policyRateFor(SAMPLE_ISO3, { pulledAt: now.toISOString(), daily: parseCbpolCsv(r.text, 'D'), monthly: {} }, now);
        return p ? `${SAMPLE_NAME} policy rate ${fmt(p.ratePct, 2)}% (${p.bank ? `${p.bank}, ` : ''}${p.date})` : null;
      },
      undefined,
      'The BIS answered, but with no Brazil policy-rate rows the app could read. The dataset format may have changed.'
    )
  );

  add('wits', () =>
    httpCheck(
      { id: 'wits', name: 'WITS trade partners', group: 'free', feeds: 'Export and import shares with China and Russia (scenario exposure)' },
      fetchFn,
      witsUrl(SAMPLE_ISO3, 'CHN', 'XPRT-PRTNR-SHR', year - 3),
      Math.max(T, 12000),
      (r) => {
        const s = parseWitsShare(r.text);
        return s ? `${SAMPLE_NAME} exports to China ${fmt(s.pct)}% of total (${s.year})` : null;
      }
    )
  );

  add('cftc', () =>
    httpCheck(
      { id: 'cftc', name: 'CFTC Commitments of Traders', group: 'free', feeds: 'Weekly currency futures positioning: MXN, BRL, ZAR, JPY, GBP, EUR' },
      fetchFn,
      cftcUrl(now, [CFTC_CURRENCY_CODES.MEX.code]),
      Math.max(T, 20000),
      (r) => {
        const p = positioningFor('MEX', parseCftcRows(parseJson(r.text)));
        return p ? `Leveraged funds net MXN ${p.levNetPctOi > 0 ? '+' : ''}${fmt(p.levNetPctOi)}% of open interest (as of ${p.reportDate}, ${p.weeks} weeks)` : null;
      },
      undefined,
      'The CFTC answered, but with no Mexican peso rows the app could read. The report format may have changed.'
    )
  );

  add('tic', () =>
    httpCheck(
      { id: 'tic', name: 'US Treasury TIC (foreign holders)', group: 'free', feeds: 'Monthly holdings of US Treasuries by country (about 20 named holders)' },
      fetchFn,
      TIC_URL,
      Math.max(T, 15000),
      (r) => {
        const t = parseTicTable(r.text);
        const h = ticHoldingFor(SAMPLE_ISO3, t) || ticHoldingFor('JPN', t);
        return h ? `${h.iso3 === SAMPLE_ISO3 ? SAMPLE_NAME : 'Japan'} holds $${fmt(h.holdingsUsdBn)}bn of US Treasuries (${formatMonth(h.month)})` : null;
      },
      undefined,
      'Treasury answered, but the table was not in the layout the app reads (a Country row with YYYY-MM months). The file may have changed.'
    )
  );

  add('pink_sheet', async () => {
    const def: Def = {
      id: 'pink_sheet',
      name: 'World Bank Pink Sheet (commodity prices)',
      group: 'free',
      feeds: 'Monthly prices of oil, gas, coal, metals and farm goods (spillover scenarios)',
      setup: 'Nothing needed. If the World Bank page changes, set PINK_SHEET_URL to the "Monthly prices" .xlsx link from worldbank.org/en/research/commodity-markets.',
    };
    const override = (env.PINK_SHEET_URL || '').trim();
    let url = override;
    if (!url) {
      const page = await probe(fetchFn, PINK_SHEET_PAGE, Math.max(T, 15000));
      const base = { host: hostOf(PINK_SHEET_PAGE), latencyMs: page.latencyMs, ...(page.status ? { httpStatus: page.status } : {}) };
      if (page.networkError) return { ...setRow(def, 'no_answer', page.networkError, base.host), ...base };
      if (!page.ok) return { ...setRow(def, 'refused', httpRefusal(page.status, page.text), base.host), ...base };
      url = findPinkSheetUrl(page.text) || '';
      if (!url) return { ...setRow(def, 'bad_reply', 'The World Bank commodity markets page answered, but had no "Monthly prices" workbook link. Set PINK_SHEET_URL to the .xlsx link.', base.host), ...base };
    }
    const t0 = Date.now();
    const controller = new AbortController();
    const wait = Math.max(T, 45000);
    const timer = setTimeout(() => controller.abort(), wait);
    try {
      const res = await fetchFn(url, { signal: controller.signal });
      const host = hostOf(url);
      if (!res.ok) return { ...setRow(def, 'refused', httpRefusal(res.status, ''), host), httpStatus: res.status, latencyMs: Date.now() - t0 };
      const buf = await res.arrayBuffer();
      const latencyMs = Date.now() - t0;
      let rows: string[][] | null = null;
      try {
        rows = await readXlsxSheet(buf, PINK_SHEET_SHEET);
      } catch {
        rows = null;
      }
      const series = rows ? parsePinkSheet(rows) : new Map();
      const brent = series.get('CRUDE_BRENT') || [...series.values()][0];
      const mv = brent ? priceMove(brent) : null;
      if (!mv) return { ...setRow(def, 'bad_reply', `The workbook downloaded, but the "${PINK_SHEET_SHEET}" sheet was not in the layout the app reads (months like 2025M09 down the first column, commodity codes across the top).`, host), httpStatus: res.status, latencyMs };
      return {
        ...setRow(def, 'connected', `Answered in ${latencyMs} ms; ${series.size} commodities read${override ? ' (from PINK_SHEET_URL)' : ''}.`, host),
        httpStatus: res.status,
        latencyMs,
        sample: moveSentence(mv).replace(/\.$/, ''),
      };
    } catch (err) {
      return { ...setRow(def, 'no_answer', describeNetworkError(err, wait), hostOf(url)), latencyMs: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  });
  // Shows how current DBnomics' copy is overall, so an old month for one country can be told
  // apart from the whole mirror running behind.
  const usMonthNote = (c: { iso3: string; month: string }, us: { month: string } | null) =>
    us && c.iso3 !== 'USA' ? `; newest for the United States: ${formatMonth(us.month)}` : '';
  // OECD data via DBnomics: one call at a time, the CPI check after the CLI one.
  let oecdGate: Promise<unknown> = Promise.resolve();
  add('oecd_cli', () => {
    const job = httpCheck(
      { id: 'oecd_cli', name: 'OECD leading indicators (via DBnomics)', group: 'free', feeds: 'Monthly OECD composite leading indicator (amplitude adjusted, 100 = long-term average) for the countries the OECD covers' },
      fetchFn,
      cliUrl({ areas: ['USA', SAMPLE_ISO3] }),
      Math.max(T, 20000),
      (r) => {
        const s = parseCli(r.text);
        const c = cliFor(SAMPLE_ISO3, s) || cliFor('USA', s);
        const us = cliFor('USA', s);
        return c ? `${c.iso3 === SAMPLE_ISO3 ? SAMPLE_NAME : 'United States'} leading indicator ${fmt(c.level, 2)} (${formatMonth(c.month)}${c.phase ? `, ${c.phase}` : ''})${usMonthNote(c, us)}` : null;
      },
      { headers: OECD_HEADERS },
      'DBnomics answered, but with no amplitude-adjusted OECD leading indicator series the app reads (dataset DSD_STES@DF_CLI). The dataset code or dimension names may differ.'
    );
    oecdGate = job;
    return job;
  });

  add('oecd_cpi', () => {
    const job = (async () => {
      await oecdGate.catch(() => undefined);
      await new Promise((r) => setTimeout(r, opts.oecdGapMs ?? 3000));
      return httpCheck(
        { id: 'oecd_cpi', name: 'OECD consumer prices (via DBnomics)', group: 'free', feeds: 'Monthly OECD headline CPI inflation, y/y, for the countries the OECD covers' },
        fetchFn,
        cpiUrl({ areas: ['USA', SAMPLE_ISO3] }),
        Math.max(T, 20000),
        (r) => {
          const s = parseCpi(r.text);
          const c = cpiFor(SAMPLE_ISO3, s) || cpiFor('USA', s);
          const us = cpiFor('USA', s);
          return c ? `${c.iso3 === SAMPLE_ISO3 ? SAMPLE_NAME : 'United States'} inflation ${fmt(c.yoyPct, 1)}% y/y (${formatMonth(c.month)})${usMonthNote(c, us)}` : null;
        },
        { headers: OECD_HEADERS },
        'DBnomics answered, but with no monthly OECD headline CPI growth series the app reads (dataset DSD_PRICES@DF_PRICES_ALL). The dataset code or dimension names may differ.'
      );
    })();
    oecdGate = job;
    return job;
  });

  add('oecd_qna', async () => {
    // Same DBnomics queue as the leading indicator and CPI checks: one call at a time.
    await oecdGate.catch(() => undefined);
    await new Promise((r) => setTimeout(r, opts.oecdGapMs ?? 3000));
    return httpCheck(
      { id: 'oecd_qna', name: 'OECD quarterly GDP (via DBnomics)', group: 'free', feeds: 'Quarterly real GDP growth (q/q and y/y, seasonally adjusted) for the OECD and partner countries, used by the nowcast and forecasts' },
      fetchFn,
      qnaUrl({ areas: ['USA', SAMPLE_ISO3] }),
      Math.max(T, 20000),
      (r) => {
        const s = parseQna(r.text);
        const c = qnaReading(SAMPLE_ISO3, s) || qnaReading('USA', s);
        const us = qnaReading('USA', s);
        if (!c) return null;
        const g = c.qoqPct ?? c.yoyPct!;
        return `${c.iso3 === SAMPLE_ISO3 ? SAMPLE_NAME : 'United States'} real GDP ${fmt(g, 1)}% ${c.qoqPct !== undefined ? 'q/q' : 'y/y'} (${formatQuarter(c.quarter)})${us && c.iso3 !== 'USA' ? `; newest for the United States: ${formatQuarter(us.quarter)}` : ''}`;
      },
      { headers: OECD_HEADERS },
      'DBnomics answered, but with no quarterly real GDP growth series the app reads (dataset DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD). The dataset code or dimension names may differ.'
    );
  });

  add('bcb_ipca', () =>
    httpCheck(
      { id: 'bcb_ipca', name: 'Banco Central do Brasil (SGS)', group: 'free', feeds: "Brazil's monthly IPCA inflation over 12 months, fresher than the OECD mirror" },
      fetchFn,
      bcbSgsUrl(BCB_IPCA_12M, 3),
      T,
      (r) => {
        const pts = parseBcbSgs(parseJson(r.text));
        const last = pts[pts.length - 1];
        return last ? `Brazil IPCA ${fmt(last.value, 2)}% over 12 months (${formatMonth(last.period)})` : null;
      },
      {},
      'The BCB answered, but not with the SGS series 13522 rows the app reads.'
    )
  );

  add('bcrp_embig', async () => {
    // Read once, so a reply the app cannot read is described (empty, a web page, other series).
    let lastText: string | undefined;
    const res = await httpCheck(
      { id: 'bcrp_embig', name: 'Central bank of Peru (BCRPData, EMBIG)', group: 'free', feeds: 'USD bond spread over Treasuries (J.P. Morgan EMBI Global, monthly) for Argentina, Brazil, Chile, Colombia, Ecuador, Mexico, Peru, Venezuela; the free stand-in for CDS, labelled a bond spread' },
      fetchFn,
      bcrpEmbigUrl(now, 6),
      Math.max(T, 20000),
      (r) => {
        lastText = r.text;
        const p = parseBcrpEmbig(r.text, '');
        const c = p?.countries.BRA || (p ? Object.values(p.countries)[0] : undefined);
        return c ? `${c.iso3} USD bond spread ${fmt(c.bps)} bp (${formatMonth(c.period)}), ${Object.keys(p!.countries).length} countries` : null;
      },
      {},
      'BCRP answered, but not with the monthly EMBIG series the app reads (PN43672XM to PN43681XM).'
    );
    return res.state === 'bad_reply' ? { ...res, detail: describeBcrpReply(lastText) } : res;
  });

  add('bcb_ibcbr', () =>
    httpCheck(
      { id: 'bcb_ibcbr', name: 'Banco Central do Brasil IBC-Br (SGS)', group: 'free', feeds: "Brazil's monthly economic activity index, seasonally adjusted, for the GDP nowcast" },
      fetchFn,
      bcbSgsSinceUrl(BCB_IBCBR_SA, `01/01/${year - 1}`),
      T,
      (r) => {
        const s = parseIbcBr(parseJson(r.text));
        const last = s?.points[s.points.length - 1];
        return last ? `Brazil IBC-Br ${fmt(last.value, 1)} (${formatMonth(last.period)}, seasonally adjusted)` : null;
      },
      {},
      'The BCB answered, but not with the SGS series 24364 rows the app reads.'
    )
  );

  add('eurostat_ip', () =>
    httpCheck(
      { id: 'eurostat_ip', name: 'Eurostat industrial production', group: 'free', feeds: 'Monthly industrial production index for EU members (and Turkey where Eurostat has it), for the GDP nowcast' },
      fetchFn,
      eurostatIpUrl(['PL'], `${year - 1}-01`),
      T,
      (r) => {
        const s = parseEurostatIp(parseJson(r.text), ['POL']).POL;
        const last = s?.points[s.points.length - 1];
        return last ? `Poland industrial production ${fmt(last.value, 1)} (${formatMonth(last.period)}, 2021 = 100)` : null;
      },
      {},
      'Eurostat answered, but not with the sts_inpr_m index the app reads (B-D, PRD, SCA, I21).'
    )
  );

  add('eurostat_hicp', () =>
    httpCheck(
      { id: 'eurostat_hicp', name: 'Eurostat HICP', group: 'free', feeds: 'Monthly inflation for EU members (Poland on the default lists), fresher than the OECD mirror' },
      fetchFn,
      eurostatHicpUrl(['PL'], 3),
      T,
      (r) => {
        const pts = parseEurostatHicp(parseJson(r.text)).PL;
        const last = pts?.[pts.length - 1];
        return last ? `Poland HICP ${fmt(last.value, 1)}% y/y (${formatMonth(last.period)})` : null;
      },
      {},
      'Eurostat answered, but not with the prc_hicp_minr annual-rate figures the app reads (all items, coicop18 TOTAL).'
    )
  );

  add('comtrade', async () => {
    const key = (env.COMTRADE_API_KEY || '').trim();
    const def: Def = {
      id: 'comtrade',
      name: key ? 'UN Comtrade (your free key)' : 'UN Comtrade (public preview)',
      group: 'free',
      feeds: 'Trade partners (China, Taiwan, Russia, Gulf) and export mix by HS chapter (spillover scenarios)',
      setup: 'Nothing needed: the public preview answers without a key but allows few requests. For higher limits, add a key in Menu > Settings, or COMTRADE_API_KEY="..." (free: comtradeplus.un.org > My Comtrade > My API portal).',
    };
    const reporter = COMTRADE_REPORTERS[SAMPLE_ISO3];
    // The year two back is usually reported; if not, the year before.
    let last: ConnectionResult | null = null;
    for (const yr of comtradeYears(now)) {
      const res = await httpCheck(
        def,
        fetchFn,
        comtradeUrl(reporter, yr, 'partners', !!key),
        Math.max(T, 20000),
        (r) => {
          const p = buildProfile(SAMPLE_ISO3, parseComtrade(parseJson(r.text)));
          return p ? `${SAMPLE_NAME}: ${partnerSentence(p).replace(/\.$/, '')}` : null;
        },
        key ? { headers: { 'Ocp-Apim-Subscription-Key': key } } : undefined,
        `Comtrade answered, but with no ${SAMPLE_NAME} trade totals for ${yr} the app could read.`
      );
      last = res;
      if (res.state !== 'bad_reply') break;
    }
    const res = last!;
    if (key && res.state === 'refused' && (res.httpStatus === 401 || res.httpStatus === 403)) {
      return { ...res, state: 'needs_setup', detail: `Comtrade did not accept ${keyPhrase('COMTRADE_API_KEY')} (HTTP ${res.httpStatus}). Remove it to use the public preview.` };
    }
    if (!key && res.state === 'refused' && res.httpStatus === 429) {
      return { ...res, detail: `${res.detail} The public preview allows few requests; a free key (Menu > Settings or COMTRADE_API_KEY) gives more.` };
    }
    return savedNote('COMTRADE_API_KEY', { ...res, detail: key ? res.detail.split(key).join('***') : res.detail });
  });

  add('fred_csv', () =>
    httpCheck(
      { id: 'fred_csv', name: 'FRED download (no key)', group: 'free', feeds: '10Y yields: US, Mexico, South Africa, Japan, UK, Poland, Chile' },
      fetchFn,
      fredCsvUrl(US_10Y_SERIES, now),
      T,
      (r) => {
        const o = parseFredCsvLatest(r.text || '', US_10Y_SERIES);
        return o ? `US 10Y ${fmt(o.valuePct, 2)}% (${o.period})` : null;
      }
    )
  );

  add('tesouro', () =>
    httpCheck(
      { id: 'tesouro', name: 'Brazil Treasury (Tesouro Direto)', group: 'free', feeds: 'Brazil 10Y yield (NTN-F)' },
      fetchFn,
      TESOURO_DIRETO_CSV_URL,
      // The whole history, about 15 MB from a slow server: 60 s on Sam's Mac (2026-11-05).
      Math.max(T, 90000),
      (r) => {
        const o = parseTesouroDiretoLatest(r.text || '');
        return o ? `Brazil NTN-F ${fmt(o.valuePct, 2)}% (${o.period})` : null;
      }
    )
  );

  // Layout probes (not verified from the cloud session): on a bad reply the start of the reply is
  // shown, so the format can be confirmed from one run of npm run check:data.
  const replyStart = (t: string | undefined) => (t ? ` Start of the reply: ${t.replace(/\s+/g, ' ').slice(0, 300)}` : '');
  add('ecb_spf', async () => {
    let lastText: string | undefined;
    const key = ECB_SPF_SERIES[2].key;
    const res = await httpCheck(
      { id: 'ecb_spf', name: 'ECB Survey of Professional Forecasters', group: 'free', feeds: 'Euro-area HICP inflation expected one year, two years and longer term ahead (quarterly)' },
      fetchFn,
      ecbSpfUrl(key),
      Math.max(T, 15000),
      (r) => {
        lastText = r.text;
        const obs = parseEcbCsv(r.text || '');
        const last = obs[obs.length - 1];
        return last ? `SPF longer-term HICP ${fmt(last.value, 2)}% (${last.date}), ${obs.length} quarters` : null;
      },
      {},
      `The ECB answered, but not with TIME_PERIOD and OBS_VALUE columns for SPF.${key}.`
    );
    return res.state === 'bad_reply' || res.state === 'refused' ? { ...res, detail: `${res.detail}${replyStart(lastText)}` } : res;
  });

  add('bcb_focus', async () => {
    let lastText: string | undefined;
    const res = await httpCheck(
      { id: 'bcb_focus', name: 'Banco Central do Brasil Focus survey (Olinda)', group: 'free', feeds: "Brazil's market median for IPCA inflation over the next 12 months" },
      fetchFn,
      FOCUS_URL,
      Math.max(T, 30000),
      (r) => {
        lastText = r.text;
        const obs = parseFocus12m(parseJson(r.text));
        const last = obs[obs.length - 1];
        return last ? `Focus IPCA 12 months ahead ${fmt(last.value, 2)}% (${last.date}), ${obs.length} survey dates` : null;
      },
      {},
      'The BCB answered, but without the IPCA medians (Indicador, Data, Mediana) the app reads.'
    );
    return res.state === 'bad_reply' || res.state === 'refused' ? { ...res, detail: `${res.detail}${replyStart(lastText)}` } : res;
  });

  add('nyfed_gscpi', async () => {
    const def: Def = { id: 'nyfed_gscpi', name: 'NY Fed Global Supply Chain Pressure Index', group: 'free', feeds: 'Monthly supply chain pressure index (scenario factor and world series), an Excel 97 file' };
    const started = Date.now();
    try {
      const res = await fetchFn(GSCPI_URLS.csv, { signal: AbortSignal.timeout(Math.max(T, 20000)) });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ...setRow(def, 'refused', `HTTP ${res.status}`, 'www.newyorkfed.org'), httpStatus: res.status, latencyMs };
      const got = await gscpiFromBytes(new Uint8Array(await res.arrayBuffer()), now);
      if ('reason' in got) return { ...setRow(def, 'bad_reply', `${got.reason}.`, 'www.newyorkfed.org'), latencyMs };
      const last = got.obs[got.obs.length - 1];
      return { ...setRow(def, 'connected', `Answered in ${latencyMs} ms.`, 'www.newyorkfed.org'), latencyMs, sample: `GSCPI ${fmt(last.value, 2)} (${last.date.slice(0, 7)}), ${got.obs.length} months` };
    } catch (e) {
      return setRow(def, 'no_answer', (e as Error).message || 'No answer', 'www.newyorkfed.org');
    }
  });

  // ---- Free with your own key -----------------------------------------------------------------
  add('fred_api', async () => {
    const def: Def = {
      id: 'fred_api',
      name: 'FRED API (free key)',
      group: 'free_key',
      feeds: 'Same yields as the FRED download, through the official API',
      setup: 'Menu > Settings > API keys, or FRED_API_KEY="..." in .env (free: fred.stlouisfed.org > My Account > API Keys). Without it the app uses the FRED download.',
    };
    const key = (env.FRED_API_KEY || '').trim();
    if (!key) return setRow(def, 'optional', 'No key set. The app uses the FRED download instead, which needs no key.', 'api.stlouisfed.org');
    const res = await httpCheck(def, fetchFn, fredApiUrl(US_10Y_SERIES, key), T, (r) => {
      const o = parseFredApiLatest(parseJson(r.text), US_10Y_SERIES);
      return o ? `US 10Y ${fmt(o.valuePct, 2)}% (${o.period})` : null;
    });
    if (res.state === 'refused' && (res.httpStatus === 400 || res.httpStatus === 403)) {
      return { ...res, state: 'needs_setup', detail: `FRED did not accept ${keyPhrase('FRED_API_KEY')} (HTTP ${res.httpStatus}). Check it was copied in full. The app falls back to the FRED download meanwhile.` };
    }
    return savedNote('FRED_API_KEY', res);
  });

  add('evds', async () => {
    const def: Def = {
      id: 'evds',
      name: 'Turkey central bank (EVDS)',
      group: 'free_key',
      feeds: 'Turkey monthly CPI inflation; Turkey 10Y yield once its series code is set',
      setup: 'Menu > Settings > Data API keys, or in .env: EVDS_API_KEY="..." (free: evds3.tcmb.gov.tr > profile > API key). For the 10Y yield also EVDS_TR10Y_SERIES="TP...." (the 10Y bond series code in EVDS).',
    };
    const key = (env.EVDS_API_KEY || '').trim();
    const series = (env.EVDS_TR10Y_SERIES || '').trim();
    const cpiSeries = (env.EVDS_TR_CPI_SERIES || '').trim() || EVDS_CPI_DEFAULT_SERIES;
    if (!key && !series) return setRow(def, 'needs_setup', "Not set up. Turkey's 10Y yield reads Missing and Turkey's inflation stays on the OECD series until it is.", 'evds3.tcmb.gov.tr');
    if (!key) return setRow(def, 'needs_setup', 'The 10Y series code is set but the EVDS key is empty (Menu > Settings or EVDS_API_KEY).', 'evds3.tcmb.gov.tr');
    if (series && !isValidEvdsSeriesCode(series)) return setRow(def, 'needs_setup', `EVDS_TR10Y_SERIES "${series}" is not a series code (it starts with "TP.").`, 'evds3.tcmb.gov.tr');
    if (!isValidEvdsSeriesCode(cpiSeries)) return setRow(def, 'needs_setup', `EVDS_TR_CPI_SERIES "${cpiSeries}" is not a series code (it starts with "TP."). Leave it empty to use ${EVDS_CPI_DEFAULT_SERIES}.`, 'evds3.tcmb.gov.tr');
    const headers = { key, Accept: 'application/json' };
    let cpiNote = '';
    const res = await httpCheck(def, fetchFn, evdsCpiUrl(cpiSeries, now), T, (r) => {
      const pts = parseEvdsCpiYoy(parseJson(r.text), cpiSeries);
      const last = pts[pts.length - 1];
      if (!last) return null;
      cpiNote = `Turkey CPI ${fmt(last.value, 2)}% over 12 months (${formatMonth(last.period)})`;
      return cpiNote;
    }, { headers }, `EVDS answered, but CPI series ${cpiSeries} had no 12 months of values. Set the CPI index series code in Menu > Settings.`);
    if (res.state === 'refused' && (res.httpStatus === 401 || res.httpStatus === 403)) {
      return { ...res, state: 'needs_setup', detail: `EVDS did not accept ${keyPhrase('EVDS_API_KEY')} (HTTP ${res.httpStatus}).` };
    }
    if (res.state !== 'connected' && res.state !== 'bad_reply') return savedNote('EVDS_API_KEY', res);
    if (!series) {
      return savedNote('EVDS_API_KEY', { ...res, detail: `${res.detail} The 10Y series code is empty, so Turkey's 10Y yield reads Missing (Menu > Settings or EVDS_TR10Y_SERIES).` });
    }
    const y = await httpCheck(def, fetchFn, evdsSeriesUrl(series, now), T, (r) => {
      const o = parseEvdsLatest(parseJson(r.text), series);
      return o ? `Turkey 10Y ${fmt(o.valuePct, 2)}% (${o.period})` : null;
    }, { headers }, `EVDS answered, but series ${series} had no recent values. Check the series code.`);
    if (y.state !== 'connected') return savedNote('EVDS_API_KEY', { ...y, detail: res.state === 'connected' ? `${y.detail} (${cpiNote} read fine.)` : y.detail });
    const sample = [cpiNote, y.sample].filter(Boolean).join('; ');
    return savedNote('EVDS_API_KEY', { ...y, ...(sample ? { sample } : {}), detail: res.state === 'connected' ? y.detail : `${y.detail} ${res.detail}` });
  });

  add('banxico', async () => {
    const def: Def = {
      id: 'banxico',
      name: 'Banco de México (SIE)',
      group: 'free_key',
      feeds: "Mexico's monthly INPC inflation over 12 months, fresher than the OECD mirror",
      setup: 'Menu > Settings > Data API keys, or BANXICO_TOKEN="..." in .env (free: banxico.org.mx/SieAPIRest/service/v1/token). Without it Mexico keeps the OECD inflation series.',
    };
    const token = (env.BANXICO_TOKEN || '').trim();
    if (!token) return setRow(def, 'optional', 'No token set. Mexico keeps the OECD inflation series, which lags five to six months.', 'www.banxico.org.mx');
    const res = await httpCheck(def, fetchFn, banxicoSeriesUrl([BANXICO_CPI_SERIES], now, 3), T, (r) => {
      const pts = parseBanxicoMonthly(parseJson(r.text), BANXICO_CPI_SERIES);
      const last = pts[pts.length - 1];
      return last ? `Mexico INPC ${fmt(last.value, 2)}% over 12 months (${formatMonth(last.period)})` : null;
    }, { headers: banxicoHeaders(token) }, `Banxico answered, but not with the SIE series ${BANXICO_CPI_SERIES} rows the app reads.`);
    if (res.state === 'refused' && (res.httpStatus === 401 || res.httpStatus === 403)) {
      return { ...res, state: 'needs_setup', detail: `Banxico did not accept ${keyPhrase('BANXICO_TOKEN')} (HTTP ${res.httpStatus}). Check it was copied in full.` };
    }
    return savedNote('BANXICO_TOKEN', res);
  });

  add('acled', async () => {
    const def: Def = {
      id: 'acled',
      name: 'ACLED (conflict events)',
      group: 'free_key',
      feeds: 'Conflict events per country over twelve months, for the Politics & Events Agent',
      setup: 'Menu > Settings > Data API keys, or in .env: ACLED_EMAIL="..." and ACLED_PASSWORD="..." (free for non-commercial use; the API needs a myACLED Research-level account).',
    };
    const email = (env.ACLED_EMAIL || '').trim();
    const password = env.ACLED_PASSWORD || '';
    if (!email && !password) return setRow(def, 'needs_setup', 'Not set up. The conflict figures read Missing until it is.', 'acleddata.com');
    if (!email || !password) return setRow(def, 'needs_setup', `The ACLED ${email ? 'password' : 'email'} is empty (Menu > Settings or ${email ? 'ACLED_PASSWORD' : 'ACLED_EMAIL'}).`, 'acleddata.com');
    let bearer = '';
    const tok = await httpCheck(def, fetchFn, ACLED_TOKEN_URL, T, (r) => {
      const t = (parseJson(r.text) as { access_token?: unknown } | null)?.access_token;
      bearer = typeof t === 'string' ? t : '';
      return bearer ? 'signed in' : null;
    }, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: acledTokenBody(email, password).toString() }, 'ACLED answered the sign-in, but without an access token.');
    if (tok.state === 'refused' && [400, 401, 403].includes(tok.httpStatus || 0)) {
      return { ...tok, state: 'needs_setup', detail: `ACLED did not accept the email and password${opts.keySources?.ACLED_PASSWORD === 'app' ? ' saved in Settings' : ' in ACLED_EMAIL / ACLED_PASSWORD'} (HTTP ${tok.httpStatus}).` };
    }
    if (tok.state !== 'connected') return tok;
    // A token alone does not prove API access: Open accounts sign in but cannot read events.
    const read = await httpCheck(def, fetchFn, acledReadUrl('Mexico', now).replace(/limit=\d+/, 'limit=5'), T, (r) => {
      const rows = parseAcledPage(parseJson(r.text));
      if (!rows) return null;
      const last = rows.reduce((m, x) => (x.event_date > m ? x.event_date : m), '');
      return rows.length ? `Mexico events read, newest ${last}` : 'API answered (no Mexico events in the window)';
    }, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } }, 'ACLED answered, but not with the event rows the app reads.');
    if (read.state === 'refused' && (read.httpStatus === 401 || read.httpStatus === 403)) {
      return { ...read, state: 'needs_setup', detail: 'Signed in, but ACLED did not allow API access for this account. Open accounts (public email such as gmail.com) get aggregated downloads only; the API needs the Research level.' };
    }
    return read.state === 'connected' && opts.keySources?.ACLED_PASSWORD === 'app' ? { ...read, detail: `${read.detail} (account saved in Settings)` } : read;
  });

  add('acled_files', async () => {
    const def: Def = {
      id: 'acled_files',
      name: 'ACLED aggregated files (downloaded)',
      group: 'free',
      feeds: 'Conflict events per country over twelve months, for the Politics & Events Agent, when no ACLED API reading is on hand',
      setup: `Log in at ${ACLED_AGGREGATED_PAGE} (a free registered myACLED account is enough), download your region's aggregated file and put it, as downloaded (.xlsx or .csv, zipped or not), in ${ACLED_FOLDER}. Nothing is fetched. The API reading, when your account has one, wins.`,
    };
    const host = 'your files';
    if (!opts.acledFiles) return setRow(def, 'optional', `The folder ${ACLED_FOLDER} was not checked from here.`, host);
    let data: AcledFileData | null;
    try {
      data = opts.acledFiles();
    } catch (err: any) {
      return setRow(def, 'bad_reply', `The ACLED folder could not be read (${err?.message || err}).`, host);
    }
    const skipped = data?.skipped.length ? `Not read: ${data.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}.` : '';
    if (!data || !data.files.length) return setRow(def, 'optional', `No ACLED aggregated file in ${ACLED_FOLDER}.${skipped ? ` ${skipped}` : ''}`, host);
    const read = data.files.map((f) => `${f.file} (${f.countries} countries, weeks ${f.firstWeek} to ${f.lastWeek}, ${f.rows} rows)`);
    const first = [...data.countries.values()][0];
    const r = first ? acledFileReading(data, first.name, now) : null;
    const sample = r ? `${r.country}: ${r.total.events} events, ${r.total.fatalities} fatalities, ${r.total.from} to ${r.total.to}` : undefined;
    return { ...setRow(def, 'connected', `Read ${read.join('; ')}.`, host), ...(sample ? { sample } : {}), ...(skipped ? { warning: skipped } : {}) };
  });

  add('eia', async () => {
    const def: Def = {
      id: 'eia',
      name: 'US EIA oil prices (free key)',
      group: 'free_key',
      feeds: 'Daily Brent and WTI spot prices (spillover scenarios)',
      setup: 'Menu > Settings > Data API keys, or EIA_API_KEY="..." in .env (free: eia.gov/opendata > Register). Without it oil comes monthly from the World Bank Pink Sheet.',
    };
    const key = (env.EIA_API_KEY || '').trim();
    if (!key) return setRow(def, 'optional', 'No key set. Oil comes monthly from the World Bank Pink Sheet instead.', 'api.eia.gov');
    const res = await httpCheck(def, fetchFn, eiaSpotUrl(key, now), Math.max(T, 20000), (r) => {
      const s = parseEiaSpot(parseJson(r.text)).get('RBRTE');
      const mv = s ? priceMove(s) : null;
      return mv ? moveSentence(mv).replace(/\.$/, '') : null;
    }, undefined, 'EIA answered, but with no Brent rows the app could read. The route or series code may have changed.');
    if (res.state === 'refused' && (res.httpStatus === 401 || res.httpStatus === 403)) {
      return { ...res, state: 'needs_setup', detail: `EIA did not accept ${keyPhrase('EIA_API_KEY')} (HTTP ${res.httpStatus}). Oil comes monthly from the Pink Sheet meanwhile.` };
    }
    // Never echo the key: EIA puts it in the URL, so make sure no reply text carries it.
    return savedNote('EIA_API_KEY', { ...res, detail: res.detail.split(key).join('***') });
  });

  // UCDP: downloaded CSV files in data/local/ucdp/, read from disk (Sam, 2026-11-06: no live pulls).
  add('ucdp', async () => {
    const def: Def = {
      id: 'ucdp',
      name: 'UCDP conflict data (downloaded files)',
      group: 'free',
      feeds: 'Armed conflicts, battle deaths, non-state and one-sided violence per country and year (Politics & Events Agent)',
      setup: `Download the CSV files from ${UCDP_DOWNLOADS_PAGE} (UCDP/PRIO Armed Conflict, Battle-Related Deaths conflict level, Non-State, One-Sided, Dyadic) and put them, zipped or not, in ${UCDP_FOLDER}. Nothing is fetched.`,
    };
    const host = 'your files';
    if (!opts.ucdp) return setRow(def, 'needs_setup', `The folder ${UCDP_FOLDER} was not checked from here.`, host);
    let data: UcdpData | null;
    try {
      data = opts.ucdp();
    } catch (err: any) {
      return setRow(def, 'bad_reply', `The UCDP folder could not be read (${err?.message || err}).`, host);
    }
    const files = data ? UCDP_DATASET_IDS.filter((d) => data!.files[d]) : [];
    if (!data || !files.length) {
      const skipped = data?.skipped.length ? ` Not read: ${data.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}.` : '';
      return setRow(def, 'needs_setup', `No UCDP files in ${UCDP_FOLDER}.${skipped}`, host);
    }
    const missing = UCDP_DATASET_IDS.filter((d) => !data!.files[d]);
    const read = files.map((d) => { const f = data!.files[d]!; return `${UCDP_DATASETS[d].name} ${f.version} (${f.minYear}-${f.maxYear}, ${f.rows} rows)`; });
    if (data.candidate) read.push(`UCDP Candidate Events ${data.candidate.versions.join(', ')} (${data.candidate.events.size} events, preliminary)`);
    const r = ucdpReading(data, SAMPLE_ISO3);
    const latest = r?.latest;
    const sample = latest
      ? `${SAMPLE_NAME} ${latest.year}: ${latest.conflicts ? `${latest.conflicts.n} armed conflicts` : ''}${latest.totalBest !== undefined ? `${latest.conflicts ? ', ' : ''}${latest.totalBest} deaths from organised violence` : ''}`.replace(/: $/, ': read')
      : undefined;
    const warnings = [
      missing.length ? `Not added: ${missing.map((d) => UCDP_DATASETS[d].name).join(', ')}.` : '',
      data.skipped.length ? `Not read: ${data.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}.` : '',
      Object.keys(data.unknownCodes).length ? `Country codes the app has no country for: ${Object.keys(data.unknownCodes).slice(0, 8).join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    return { ...setRow(def, 'connected', `Read ${read.join('; ')}.`, host), ...(sample ? { sample } : {}), ...(warnings ? { warning: warnings } : {}) };
  });

  // ---- Your own paid account (off unless switched on) -------------------------------------------
  add('own_cds', async () => {
    const def: Def = {
      id: 'own_cds',
      name: 'Your CDS data (file or LSEG)',
      group: 'own_account',
      feeds: '5Y sovereign CDS (no free source exists)',
      setup:
        'Menu > Settings > Your own paid data, or in .env. File: CDS_FEED="csv" and CDS_CSV_PATH="/full/path/cds.csv" with columns iso3,date,cds5y_bps,source. ' +
        'LSEG: CDS_FEED="lseg" with LSEG_APP_KEY, LSEG_USERNAME, LSEG_PASSWORD and LSEG_CDS_RICS="BRA=<ric>,TUR=<ric>".',
    };
    const feed = (env.CDS_FEED || '').trim().toLowerCase();
    if (!feed || feed === 'off') return setRow(def, 'off', 'Off. CDS reads Missing until you connect your own licensed data.', 'your file or LSEG');
    if (feed !== 'csv' && feed !== 'lseg') return setRow(def, 'needs_setup', `CDS_FEED is "${feed}"; it must be "csv" or "lseg".`, 'your file or LSEG');
    const cfg = ownCdsSettings(env);
    if (feed === 'csv') {
      const p = (env.CDS_CSV_PATH || '').trim();
      if (!cfg?.csvPath) return setRow(def, 'needs_setup', 'CDS_FEED is "csv" but CDS_CSV_PATH is empty.', 'your file');
      const file = opts.readFile ? opts.readFile(cfg.csvPath) : null;
      if (!file) return setRow(def, 'needs_setup', `No file at CDS_CSV_PATH (${p}). Use the full path, starting with /.`, 'your file');
      const quotes = parseOwnCdsCsv(file.text);
      if (quotes.size === 0) return setRow(def, 'bad_reply', 'The file was read but no rows were usable. The header must be iso3,date,cds5y_bps,source.', 'your file');
      const latest = [...quotes.values()].map((q) => q.date).sort().pop()!;
      const ageDays = Math.floor((now.getTime() - Date.parse(latest)) / 86400000);
      const first = [...quotes.values()][0];
      return {
        ...setRow(def, 'connected', `Read ${quotes.size} ${quotes.size === 1 ? 'country' : 'countries'} from your file; latest quote ${latest}.`, 'your file'),
        sample: `${first.iso3} 5Y CDS ${fmt(first.bps)} bp (${first.date}, ${first.source})`,
        ...(ageDays > 7 ? { warning: `The latest quote is ${ageDays} days old. Export a fresh file to keep CDS current.` } : {}),
      };
    }
    // LSEG
    if (!cfg?.lseg) {
      const missing = ['LSEG_APP_KEY', 'LSEG_USERNAME', 'LSEG_PASSWORD', 'LSEG_CDS_RICS'].filter((k) => !(env[k] || '').trim());
      return setRow(def, 'needs_setup', `CDS_FEED is "lseg" but ${missing.length ? missing.join(', ') : 'LSEG_CDS_RICS (as ISO3=RIC pairs)'} ${missing.length > 1 ? 'are' : 'is'} not set.`, 'api.refinitiv.com');
    }
    const tokReq = lsegTokenRequest(cfg.lseg);
    const tok = await probe(fetchFn, tokReq.url, T, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokReq.body });
    const host = hostOf(tokReq.url);
    if (tok.networkError) return { ...setRow(def, 'no_answer', `LSEG sign-in: ${tok.networkError}`, host), latencyMs: tok.latencyMs };
    if (!tok.ok) return { ...setRow(def, tok.status === 400 || tok.status === 401 ? 'needs_setup' : 'refused', `LSEG sign-in refused (HTTP ${tok.status}). Check LSEG_APP_KEY, LSEG_USERNAME and LSEG_PASSWORD.`, host), httpStatus: tok.status };
    const token = (parseJson(tok.text) as { access_token?: string })?.access_token;
    if (!token) return setRow(def, 'bad_reply', 'LSEG sign-in answered without a token.', host);
    return httpCheck(def, fetchFn, lsegSnapshotUrl(cfg.lseg), T, (r) => {
      const q = parseLsegSnapshot(parseJson(r.text), cfg.lseg!.rics, now.toISOString().slice(0, 10));
      if (!q.size) return null;
      const first = [...q.values()][0];
      return `${q.size} of ${Object.keys(cfg.lseg!.rics).length} RICs priced; ${first.iso3} ${fmt(first.bps)} bp`;
    }, { headers: { Authorization: `Bearer ${token}` } }, 'LSEG answered but none of the RICs in LSEG_CDS_RICS had a price. Check the RICs against your entitlement.');
  });

  // ---- AI models ---------------------------------------------------------------------------------
  add('gemini', async () => {
    const model = opts.env.GEMINI_MODEL?.trim() || opts.ai?.geminiModel || geminiModel(undefined, opts.env);
    const def: Def = {
      id: 'gemini',
      name: `Gemini (${model})`,
      group: 'ai',
      feeds: 'Council summary, debate replies, agent choice',
      setup: 'Menu > Settings > AI model key, or GEMINI_API_KEY="..." in .env (https://ai.google.dev/gemini-api/docs/api-key).',
    };
    const key = (env.GEMINI_API_KEY || '').trim();
    if (!key || key === 'MY_GEMINI_API_KEY') {
      return setRow(def, usesGemini ? 'needs_setup' : 'optional', usesGemini ? 'The AI model is set to Gemini but no Gemini key is set (Menu > Settings, or GEMINI_API_KEY).' : `Not set. The AI model is set to ${provider}, so Gemini is not needed.`, 'generativelanguage.googleapis.com');
    }
    // Reads the model's description: proves the key and the model name without spending tokens.
    const res = await httpCheck(def, fetchFn, `https://generativelanguage.googleapis.com/v1beta/models/${model}`, T, (r) => {
      const name = (parseJson(r.text) as { name?: string; displayName?: string })?.displayName;
      return name ? `Key accepted; model "${name}" available` : null;
    }, { headers: { 'x-goog-api-key': key } });
    if (res.state === 'refused' && (res.httpStatus === 400 || res.httpStatus === 401 || res.httpStatus === 403)) return { ...res, state: 'needs_setup', detail: `Google did not accept ${keyPhrase('GEMINI_API_KEY')} (HTTP ${res.httpStatus}).` };
    if (res.state === 'refused' && res.httpStatus === 404) return { ...res, detail: `The key works but model ${model} was not found. The model name in the app may need updating.` };
    return savedNote('GEMINI_API_KEY', res);
  });

  add('ollama', async () => {
    const base = (opts.ai?.ollamaBaseUrl || env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const quick = opts.ai?.ollamaQuickModel || env.OLLAMA_QUICK_MODEL || 'qwen2.5:7b';
    const deep = refereeModelOrDefault(opts.ai?.ollamaDeepModel) || refereeModelOrDefault(env.OLLAMA_DEEP_MODEL) || DEFAULT_REFEREE_MODEL;
    const def: Def = {
      id: 'ollama',
      name: 'Ollama (on this computer)',
      group: 'ai',
      feeds: 'Council summary, debate replies, agent choice (local)',
      setup: `OLLAMA_BASE_URL="${base}", OLLAMA_QUICK_MODEL="${quick}", OLLAMA_DEEP_MODEL="${deep}". Install from ollama.com, then run: ollama pull ${quick}`,
    };
    const r = await probe(fetchFn, `${base}/api/tags`, Math.min(T, 4000));
    const host = hostOf(base);
    if (r.networkError) {
      return { ...setRow(def, usesOllama ? 'no_answer' : 'optional', usesOllama ? `Ollama is not running at ${base}. Open the Ollama app, or run: ollama serve. ${r.networkError}` : `Not running at ${base}. The AI model is set to ${provider}, so Ollama is not needed.`, host), latencyMs: r.latencyMs };
    }
    if (!r.ok) return { ...setRow(def, 'refused', httpRefusal(r.status, r.text), host), httpStatus: r.status };
    const models = ((parseJson(r.text) as { models?: Array<{ name?: string }> })?.models || []).map((m) => String(m.name || ''));
    const has = (m: string) => models.some((x) => x === m || x === `${m}:latest` || (m.endsWith(':latest') && x === m.slice(0, -7)));
    const missing = [...new Set([quick, deep])].filter((m) => !has(m));
    return {
      ...setRow(def, 'connected', `Running at ${base} with ${models.length} model${models.length === 1 ? '' : 's'} installed.`, host),
      latencyMs: r.latencyMs,
      httpStatus: r.status,
      sample: models.length ? `Installed: ${models.slice(0, 5).join(', ')}${models.length > 5 ? ' …' : ''}` : 'No models installed',
      ...(missing.length ? { warning: `Not installed: ${missing.join(', ')}. Run: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}` } : {}),
    };
  });

  add('openai_compatible', async () => {
    const base = (opts.ai?.openAiBaseUrl || env.OPENAI_COMPATIBLE_BASE_URL || '').replace(/\/+$/, '');
    const def: Def = {
      id: 'openai_compatible',
      name: 'Local OpenAI-style server (LM Studio, vLLM)',
      group: 'ai',
      feeds: 'Alternative local AI model',
      setup: 'OPENAI_COMPATIBLE_BASE_URL="http://localhost:1234/v1" and OPENAI_COMPATIBLE_MODEL="...". Only needed if the AI model is set to it.',
    };
    if (!usesOpenAi) return setRow(def, 'optional', `Not in use. The AI model is set to ${provider}.`, base ? hostOf(base) : 'not set');
    if (!base) return setRow(def, 'needs_setup', 'The AI model is set to this server but OPENAI_COMPATIBLE_BASE_URL is empty.', 'not set');
    return httpCheck(def, fetchFn, `${base}/models`, Math.min(T, 4000), (r) => {
      const ids = ((parseJson(r.text) as { data?: Array<{ id?: string }> })?.data || []).map((m) => m.id).filter(Boolean);
      return ids.length ? `Models: ${ids.slice(0, 4).join(', ')}` : 'Answered (no models listed)';
    });
  });

  const results = await Promise.all(jobs);
  const order = new Map<string, number>(SOURCE_IDS.map((id, i) => [id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const counts = { connected: 0, needs_setup: 0, optional: 0, off: 0, no_answer: 0, refused: 0, bad_reply: 0 } as Record<ConnectionState, number>;
  for (const r of results) counts[r.state]++;
  return { checkedAt: now.toISOString(), results, counts };
}

/** Plain-text table for the terminal (`npm run check:data`). */
export function formatReport(rep: ConnectionReport): string {
  const mark: Record<ConnectionState, string> = {
    connected: 'OK  ',
    needs_setup: 'SET ',
    optional: '--  ',
    off: 'OFF ',
    no_answer: 'FAIL',
    refused: 'FAIL',
    bad_reply: 'FAIL',
  };
  const groupName: Record<ConnectionGroup, string> = {
    free: 'Free sources (no key)',
    free_key: 'Free sources that need your own key',
    own_account: 'Your own paid data (off unless you switch it on)',
    ai: 'AI model',
  };
  const lines: string[] = [`EconQuest data connection check, ${rep.checkedAt}`, ''];
  for (const g of ['free', 'free_key', 'own_account', 'ai'] as ConnectionGroup[]) {
    const rows = rep.results.filter((r) => r.group === g);
    if (!rows.length) continue;
    lines.push(groupName[g]);
    for (const r of rows) {
      lines.push(`  ${mark[r.state]} ${r.name}  [${STATE_LABEL[r.state]}${r.latencyMs !== undefined && r.state === 'connected' ? `, ${r.latencyMs} ms` : ''}]`);
      lines.push(`       ${r.sample || r.detail}`);
      if (r.sample && r.state !== 'connected') lines.push(`       ${r.detail}`);
      if (r.state !== 'connected' && !r.sample && r.host) lines.push(`       host: ${r.host}`);
      if (r.warning) lines.push(`       ! ${r.warning}`);
      if (r.setup && (r.state === 'needs_setup' || r.state === 'off')) lines.push(`       setup: ${r.setup}`);
    }
    lines.push('');
  }
  const c = rep.counts;
  const failed = c.no_answer + c.refused + c.bad_reply;
  lines.push(`${c.connected} connected, ${failed} failed, ${c.needs_setup} need setup, ${c.off} off, ${c.optional} optional not set.`);
  return lines.join('\n');
}
