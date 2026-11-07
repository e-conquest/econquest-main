/**
 * IMF reserves and balance of payments (Sam, 2026-11-05: "IMF COFER and IFS for reserve
 * composition and monthly reserves, balance of payments").
 *
 * Source: the IMF data portal's free SDMX 3.0 API (api.imf.org, no key). IFS was retired in 2025
 * and split into topic datasets; the two the app reads are:
 *   - IL  (International Liquidity, the IFS successor): monthly official reserves, in US dollars.
 *   - BOP (Balance of Payments, BPM6): quarterly current account and imports of goods and
 *         services, in US dollars.
 *
 * The IMF changed its dataset layouts and codes when it moved portals, and codes cannot be checked
 * from the cloud, so the app does not hard-code them. It reads each dataset's own structure (its
 * dimensions and the names of its indicator codes), picks the indicator whose IMF name matches
 * (for example "Current account"), then asks for that series for one country and checks the
 * series names say US dollars. Every figure carries the IMF series key it came from. If the IMF
 * names differ from what the app looks for, Sam can set the series key in .env (IMF_RESERVES_KEY,
 * IMF_CA_KEY, IMF_IMPORTS_KEY, with {ISO3} for the country).
 *
 * Readings, per country: reserves at the latest month-end and their change over 12 months;
 * current account in the latest quarter and over the last four, as % of GDP (GDP from the IMF
 * World Economic Outlook for that year, stated); months of imports (reserves over the last four
 * quarters of imports of goods and services, divided by 12). A stated rule calls reserve cover:
 * under 3 months = thin, 3 to 6 = adequate, over 6 = ample.
 */

export const IMF_SDMX_HOST = 'api.imf.org';
export const IMF_SDMX_BASE = `https://${IMF_SDMX_HOST}/external/sdmx/3.0`;
export const IMF_AGENCY = 'IMF.STA';
export const IMF_RESERVES_LABEL = 'IMF International Liquidity (IL)';
export const IMF_BOP_LABEL = 'IMF Balance of Payments (BOP)';

export type ImfFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const JSON_ACCEPT = { Accept: 'application/json' };

export function imfStructureUrl(flow: string): string {
  return `${IMF_SDMX_BASE}/structure/dataflow/${IMF_AGENCY}/${flow}/+?references=descendants&detail=full`;
}

export function imfDataUrl(flow: string, key: string): string {
  return `${IMF_SDMX_BASE}/data/dataflow/${IMF_AGENCY}/${flow}/+/${key}?attributes=dsd&measures=all`;
}

export function datamapperGdpUrl(iso3: string): string {
  return `https://www.imf.org/external/datamapper/api/v1/NGDPD/${iso3}`;
}

// ---- Structure ------------------------------------------------------------------------------

export interface ImfCode {
  id: string;
  name: string;
}

export interface ImfStructure {
  flow: string;
  /** Dimension ids in key order (TIME_PERIOD left out). */
  dims: string[];
  /** Codes with their IMF names, for the indicator dimension only. */
  indicators: ImfCode[];
  indicatorDim: string;
  countryDim?: string;
  /** Codes with names for the country dimension, when the structure carries its codelist (COFER: world and groups). */
  countryCodes?: ImfCode[];
  freqDim?: string;
}

/** An SDMX name: a string, or { en: "..." } under name or names. */
function nameOf(o: unknown): string {
  const x = o as { name?: unknown; names?: Record<string, string> };
  if (typeof x?.name === 'string') return x.name;
  if (x?.name && typeof x.name === 'object') return String((x.name as Record<string, string>).en ?? Object.values(x.name)[0] ?? '');
  if (x?.names && typeof x.names === 'object') return String(x.names.en ?? Object.values(x.names)[0] ?? '');
  return '';
}

const COUNTRY_DIMS = ['COUNTRY', 'REF_AREA', 'JURISDICTION', 'ECONOMY'];
const FREQ_DIMS = ['FREQUENCY', 'FREQ'];

/**
 * Reads an SDMX-JSON structure message (dataflow with its data structure and codelists). Null when
 * no data structure with an indicator dimension and a codelist for it is found.
 */
export function parseImfStructure(flow: string, json: unknown): ImfStructure | null {
  const root = json as { data?: Record<string, unknown> } & Record<string, unknown>;
  const data = (root?.data ?? root) as Record<string, unknown>;
  const dsds = (data?.dataStructures ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(dsds) || !dsds.length) return null;
  const comps = dsds[0].dataStructureComponents as { dimensionList?: { dimensions?: Array<Record<string, unknown>> } } | undefined;
  const dimDefs = [...(comps?.dimensionList?.dimensions ?? [])].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const dims = dimDefs.map((d) => String(d.id)).filter((id) => id && id !== 'TIME_PERIOD');
  if (!dims.length) return null;
  const indicatorDim = dims.find((d) => d === 'INDICATOR') ?? dims.find((d) => /INDICATOR/.test(d));
  if (!indicatorDim) return null;
  const def = dimDefs.find((d) => d.id === indicatorDim) as { localRepresentation?: { enumeration?: string } } | undefined;
  const urn = def?.localRepresentation?.enumeration ?? '';
  // urn:...Codelist=IMF.STA:CL_BOP_INDICATOR(1.0.0)
  const clId = /Codelist=[^:]+:([^(]+)\(/.exec(urn)?.[1];
  const lists = (data?.codelists ?? []) as Array<{ id?: string; codes?: unknown[] }>;
  const list = (clId && lists.find((l) => l.id === clId)) || lists.find((l) => /INDICATOR/i.test(String(l.id)));
  if (!list?.codes?.length) return null;
  const indicators = list.codes.map((c) => ({ id: String((c as { id?: unknown }).id ?? ''), name: nameOf(c) })).filter((c) => c.id && c.name);
  if (!indicators.length) return null;
  const countryDim = dims.find((d) => COUNTRY_DIMS.includes(d));
  const cDef = dimDefs.find((d) => d.id === countryDim) as { localRepresentation?: { enumeration?: string } } | undefined;
  const cClId = /Codelist=[^:]+:([^(]+)\(/.exec(cDef?.localRepresentation?.enumeration ?? '')?.[1];
  const cList = cClId ? lists.find((l) => l.id === cClId) : undefined;
  const countryCodes = (cList?.codes ?? []).map((c) => ({ id: String((c as { id?: unknown }).id ?? ''), name: nameOf(c) })).filter((c) => c.id && c.name);
  return {
    flow,
    dims,
    indicators,
    indicatorDim,
    ...(countryCodes.length ? { countryCodes } : {}),
    ...(countryDim ? { countryDim } : {}),
    ...(dims.find((d) => FREQ_DIMS.includes(d)) ? { freqDim: dims.find((d) => FREQ_DIMS.includes(d)) } : {}),
  };
}

// ---- What the app looks for ------------------------------------------------------------------

export type ImfMeasureId = 'reserves' | 'currentAccount' | 'imports';

export interface ImfMeasure {
  id: ImfMeasureId;
  flow: string;
  freq: 'M' | 'Q';
  label: string;
  /** .env setting that overrides the match with a full series key ({ISO3} = country). */
  envKey: string;
  /** IMF indicator names that fit, and names to leave out. */
  want: RegExp;
  avoid: RegExp;
  /** Words the chosen series' names should carry (scored), and words that rule a series out. */
  prefer: RegExp[];
  reject: RegExp;
}

export const IMF_MEASURES: Record<ImfMeasureId, ImfMeasure> = {
  reserves: {
    id: 'reserves',
    flow: 'IL',
    freq: 'M',
    label: 'Official reserve assets',
    envKey: 'IMF_RESERVES_KEY',
    // Live IL names (Nov 2026): "Total reserves (gold at market value)" TRGMV_REVS, also at national
    // valuation and at 35 SDRs per ounce; components ("Reserves excluding gold", SDRs, gold) are avoided.
    want: /^total reserves|reserve assets|official reserves|international reserves/i,
    avoid: /national valuation|\bsdrs?\b|per ounce|volume|excluding|weeks|imports|reserve position|special drawing|^gold|^reserves,|other reserve|securities|deposits|derivatives|loans|liabilit|drain|memo|forward|predetermined|contingent/i,
    prefer: [/total/i, /market value/i],
    reject: /domestic currency|national currency|percent|% of|index|ounce|troy/i,
  },
  currentAccount: {
    id: 'currentAccount',
    flow: 'BOP',
    freq: 'Q',
    label: 'Current account balance',
    envKey: 'IMF_CA_KEY',
    // Live BOP name (Nov 2026): "Current account balance (credit less debit)" CAB. The words credit and
    // debit sit inside that name, so they are not avoided here; the series pick drops the credit and
    // debit entries by their accounting-entry code instead.
    want: /current account/i,
    avoid: /^total current account|credit\/revenue|debit\/expenditure|goods|services|income|transfer|exceptional|supplement|excluding|of which/i,
    prefer: [/net/i, /total/i],
    reject: /domestic currency|national currency|percent|% of|\bcredit\b|\bdebit\b|euro\b/i,
  },
  imports: {
    id: 'imports',
    flow: 'BOP',
    freq: 'Q',
    label: 'Imports of goods and services',
    envKey: 'IMF_IMPORTS_KEY',
    want: /^goods and services\b|goods and services$|imports of goods and services/i,
    avoid: /net\b|balance|credit|exports|of which|supplement|excluding/i,
    prefer: [/debit/i],
    reject: /domestic currency|national currency|percent|% of|\bcredit\b|net\b|euro\b/i,
  },
};

/** Indicator codes whose IMF names fit, best first (shortest name, then "total"). At most 4. */
export function matchIndicators(s: ImfStructure, m: ImfMeasure): ImfCode[] {
  return s.indicators
    .filter((c) => m.want.test(c.name) && !m.avoid.test(c.name))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, 4);
}

/** The series key for one country: indicator codes joined with +, other dimensions open (*). */
export function seriesKey(s: ImfStructure, iso3: string, freq: string, codes: string[]): string {
  return s.dims
    .map((d) => (d === s.indicatorDim ? codes.join('+') : d === s.countryDim ? iso3 : d === s.freqDim ? freq : '*'))
    .join('.');
}

// ---- Data -----------------------------------------------------------------------------------

export interface ImfObs {
  /** YYYY-MM for months, YYYY-Qn for quarters, YYYY for years. */
  period: string;
  value: number;
}

export interface ImfSeries {
  /** Dimension codes joined with dots, in key order. */
  key: string;
  /** Dimension id -> { code, IMF name }. */
  dims: Record<string, ImfCode>;
  /** Power of ten the values are in (6 = millions), when the IMF states it. */
  scale?: number;
  obs: ImfObs[];
}

/** "2025-M09" / "2025-09" / "2025M09" -> "2025-09"; "2025-Q2" / "2025Q2" -> "2025-Q2". */
export function normalizePeriod(p: string): string {
  const s = String(p).trim();
  let m = /^(\d{4})-?M(\d{1,2})$/i.exec(s) || /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{4})-?Q([1-4])$/i.exec(s);
  if (m) return `${m[1]}-Q${m[2]}`;
  return s;
}

function scaleFrom(v: ImfCode | undefined): number | undefined {
  if (!v) return undefined;
  if (/^-?\d+$/.test(v.id)) return Number(v.id);
  const t = `${v.id} ${v.name}`.toLowerCase();
  if (/billion/.test(t)) return 9;
  if (/million/.test(t)) return 6;
  if (/thousand/.test(t)) return 3;
  if (/\bunits?\b|\bone\b/.test(t)) return 0;
  return undefined;
}

/**
 * Reads an SDMX-JSON data message (1.0 or 2.0 layout). Each series comes back with its dimension
 * codes and names, the scale when stated (series, observation or dataset attribute SCALE or
 * UNIT_MULT, or "Millions" in a name), and its observations oldest first.
 */
export function parseImfData(json: unknown): ImfSeries[] {
  const root = json as Record<string, unknown>;
  const data = ((root?.data as Record<string, unknown>) ?? root) as Record<string, unknown>;
  const st = ((data.structures as unknown[])?.[0] ?? data.structure ?? root.structure) as
    | {
        dimensions?: { series?: Array<{ id: string; values: unknown[] }>; observation?: Array<{ id: string; values: unknown[] }> };
        attributes?: { series?: Array<{ id: string; values: unknown[] }>; observation?: Array<{ id: string; values: unknown[] }>; dataSet?: Array<{ id: string; values: unknown[] }> };
      }
    | undefined;
  const ds = ((data.dataSets ?? root.dataSets) as Array<{ series?: Record<string, { attributes?: Array<number | null>; observations?: Record<string, unknown[]> }>; attributes?: Array<number | null> }>)?.[0];
  if (!st?.dimensions?.series || !ds?.series) return [];
  const sDims = st.dimensions.series;
  const time = st.dimensions.observation?.find((d) => d.id === 'TIME_PERIOD') ?? st.dimensions.observation?.[0];
  const code = (v: unknown): ImfCode => ({ id: String((v as { id?: unknown; value?: unknown })?.id ?? (v as { value?: unknown })?.value ?? ''), name: nameOf(v) });
  const isScale = (id: string) => /^(SCALE|UNIT_MULT|UNIT_MULTIPLIER)$/i.test(id);
  const attrAt = (defs: Array<{ id: string; values: unknown[] }> | undefined, idx: Array<number | null> | undefined): number | undefined => {
    if (!defs || !idx) return undefined;
    for (let i = 0; i < defs.length; i++) {
      if (!isScale(defs[i].id) || idx[i] === null || idx[i] === undefined) continue;
      const s = scaleFrom(code(defs[i].values[idx[i] as number]));
      if (s !== undefined) return s;
    }
    return undefined;
  };
  const dsScale = attrAt(st.attributes?.dataSet, ds.attributes);
  const out: ImfSeries[] = [];
  for (const [k, s] of Object.entries(ds.series)) {
    const idx = k.split(':').map(Number);
    const dims: Record<string, ImfCode> = {};
    sDims.forEach((d, i) => {
      dims[d.id] = code(d.values[idx[i]]);
    });
    let scale = attrAt(st.attributes?.series, s.attributes) ?? dsScale;
    const obs: ImfObs[] = [];
    for (const [oi, arr] of Object.entries(s.observations ?? {})) {
      const raw = arr?.[0];
      const value = typeof raw === 'number' ? raw : raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      const per = time?.values[Number(oi)];
      if (!Number.isFinite(value) || !per) continue;
      if (scale === undefined) scale = attrAt(st.attributes?.observation, arr.slice(1) as Array<number | null>);
      obs.push({ period: normalizePeriod(code(per).id || code(per).name), value });
    }
    if (scale === undefined) {
      const named = Object.values(dims).map(scaleFrom).find((v) => v !== undefined && v !== 0);
      if (named !== undefined) scale = named;
    }
    obs.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    out.push({ key: sDims.map((d) => dims[d.id].id).join('.'), dims, ...(scale !== undefined ? { scale } : {}), obs });
  }
  return out;
}

/**
 * Words a series' codes stand for, for when the IMF data answer carries codes without names
 * (seen on Sam's Mac 2026-11-05: BOP entry CD_T came back with no name). CD = credit, DB = debit,
 * N/NET = net, by the IMF's BPM6 accounting-entry codes.
 */
function codeWords(dim: string, id: string): string {
  if (/ACCOUNTING_ENTRY/.test(dim)) return /^CD/i.test(id) ? 'credit' : /^DB/i.test(id) ? 'debit' : /^N/i.test(id) ? 'net' : '';
  if (/UNIT/.test(dim) && id === 'USD') return 'US dollar';
  if (/UNIT/.test(dim) && /^XDC/.test(id)) return 'domestic currency';
  return '';
}
export const labelOf = (s: ImfSeries) =>
  Object.entries(s.dims)
    .map(([dim, d]) => [d.name, d.id, codeWords(dim, d.id)].filter(Boolean).join(' '))
    .join(' | ');

/** The one series that fits the measure: right frequency, in US dollars, not ruled out; best score wins. */
export function pickSeries(series: ImfSeries[], m: ImfMeasure): ImfSeries | null {
  const scored = series
    .filter((s) => s.obs.length)
    .map((s) => {
      const l = labelOf(s);
      // The indicator was already chosen by name, so its own name (e.g. "credit less debit") is not
      // held against the series here: only the other dimensions (entry, unit, frequency) can rule it out.
      const rest = labelOf({ ...s, dims: Object.fromEntries(Object.entries(s.dims).filter(([dim]) => !/INDICATOR/.test(dim))) });
      const usd = /us dollars?|\bUSD\b/i.test(l) || Object.values(s.dims).some((d) => d.id === 'USD');
      if (!usd || m.reject.test(rest)) return null;
      const f = Object.entries(s.dims).find(([id]) => FREQ_DIMS.includes(id))?.[1]?.id;
      if (f && f !== m.freq) return null;
      return { s, score: m.prefer.reduce((n, re) => n + (re.test(l) ? 1 : 0), 0) - l.length / 1000 };
    })
    .filter((x): x is { s: ImfSeries; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.s ?? null;
}

/** Values in US dollar billions; null when the IMF did not state the scale. */
export function toUsdBn(value: number, scale: number | undefined): number | null {
  if (scale === undefined) return null;
  return value * Math.pow(10, scale - 9);
}

/** Above this many US dollars a single reading cannot be real (world reserves are about $13 trillion). */
const IMPLAUSIBLE_USD = 1e14;

/**
 * The scale to use for a series. The live IMF API (Nov 2026) states SCALE 6 (millions) on series whose
 * values are already in whole dollars (Brazil goods and services debit 113520669001.43 for one quarter).
 * When the stated scale would put the largest value above $100 trillion, the values are read as whole
 * dollars (scale 0). Otherwise the stated scale stands; undefined when the IMF stated none.
 */
export function seriesScale(s: Pick<ImfSeries, 'scale' | 'obs'>): number | undefined {
  if (s.scale === undefined) return undefined;
  const max = s.obs.reduce((m, o) => Math.max(m, Math.abs(o.value)), 0);
  return max * Math.pow(10, s.scale) > IMPLAUSIBLE_USD ? 0 : s.scale;
}

// ---- Readings -------------------------------------------------------------------------------

export interface ImfReading {
  /** The IMF series key the figure came from. */
  key: string;
  period: string;
  usdBn: number;
}

export interface ImfExternal {
  iso3: string;
  reserves?: ImfReading & { change12mPct?: number };
  /** Latest quarter. */
  currentAccount?: ImfReading;
  /** Sum of the last four quarters, and as % of GDP when the WEO has GDP for that year. */
  currentAccount4q?: { usdBn: number; through: string; pctGdp?: number; gdpYear?: string; gdpUsdBn?: number };
  imports4q?: { usdBn: number; through: string; key: string };
  /** Reserves over a month of imports (last four quarters / 12). */
  monthsOfImports?: number;
  /** What could not be read, per measure, in words. */
  missing?: Partial<Record<ImfMeasureId, string>>;
}

export type ReserveCover = 'thin' | 'adequate' | 'ample';

/** Stated rule: under 3 months of imports = thin, 3 to 6 = adequate, over 6 = ample. */
export function reserveCover(months: number): ReserveCover {
  return months < 3 ? 'thin' : months <= 6 ? 'adequate' : 'ample';
}

/** Previous quarter: "2025-Q1" -> "2024-Q4". */
function prevQuarter(q: string): string {
  const [y, n] = q.split('-Q').map(Number);
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
}

/** Sum of the last four consecutive quarters, or null when one is missing. */
export function lastFourQuarters(obs: ImfObs[]): { sum: number; through: string } | null {
  const q = obs.filter((o) => /^\d{4}-Q[1-4]$/.test(o.period));
  if (q.length < 4) return null;
  const by = new Map(q.map((o) => [o.period, o.value]));
  const through = q[q.length - 1].period;
  let p = through;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const v = by.get(p);
    if (v === undefined) return null;
    sum += v;
    p = prevQuarter(p);
  }
  return { sum, through };
}

/** Builds the readings from the three picked series and the WEO GDP (USD bn by year). */
export function buildExternal(
  iso3: string,
  picked: Partial<Record<ImfMeasureId, ImfSeries | null>>,
  gdpByYear: Record<string, number> | null,
  missing: Partial<Record<ImfMeasureId, string>> = {}
): ImfExternal {
  const out: ImfExternal = { iso3 };
  const miss = { ...missing };
  const res = picked.reserves;
  if (res?.obs.length) {
    const last = res.obs[res.obs.length - 1];
    const bn = toUsdBn(last.value, seriesScale(res));
    if (bn === null) miss.reserves = 'The IMF did not state the unit (millions or billions) for this series.';
    else {
      const [y, mo] = last.period.split('-');
      const yearAgo = res.obs.find((o) => o.period === `${Number(y) - 1}-${mo}`);
      out.reserves = {
        key: res.key,
        period: last.period,
        usdBn: round(bn, 1),
        ...(yearAgo && yearAgo.value > 0 ? { change12mPct: round((last.value / yearAgo.value - 1) * 100, 1) } : {}),
      };
    }
  }
  const ca = picked.currentAccount;
  if (ca?.obs.length) {
    const last = ca.obs[ca.obs.length - 1];
    const bn = toUsdBn(last.value, seriesScale(ca));
    if (bn === null) miss.currentAccount = 'The IMF did not state the unit (millions or billions) for this series.';
    else {
      out.currentAccount = { key: ca.key, period: last.period, usdBn: round(bn, 2) };
      const four = lastFourQuarters(ca.obs);
      if (four) {
        const sumBn = toUsdBn(four.sum, seriesScale(ca))!;
        const yr = four.through.slice(0, 4);
        const gdp = gdpByYear?.[yr];
        out.currentAccount4q = {
          usdBn: round(sumBn, 1),
          through: four.through,
          ...(gdp && gdp > 0 ? { pctGdp: round((sumBn / gdp) * 100, 1), gdpYear: yr, gdpUsdBn: round(gdp, 1) } : {}),
        };
      }
    }
  }
  const im = picked.imports;
  if (im?.obs.length) {
    const four = lastFourQuarters(im.obs);
    const bn = four ? toUsdBn(four.sum, seriesScale(im)) : null;
    if (four && bn !== null && bn > 0) {
      out.imports4q = { usdBn: round(bn, 1), through: four.through, key: im.key };
      if (out.reserves) out.monthsOfImports = round(out.reserves.usdBn / (bn / 12), 1);
    } else if (!four) miss.imports = 'The IMF series has no four consecutive recent quarters.';
    else miss.imports = 'The IMF did not state the unit (millions or billions) for this series.';
  }
  if (Object.keys(miss).length) out.missing = miss;
  return out;
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));

/** WEO DataMapper NGDPD (USD bn) for one country: year -> value. */
export function parseDatamapperGdp(json: unknown, iso3: string): Record<string, number> | null {
  const v = (json as { values?: { NGDPD?: Record<string, Record<string, unknown>> } })?.values?.NGDPD?.[iso3];
  if (!v) return null;
  const out: Record<string, number> = {};
  for (const [y, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[y] = n;
  return Object.keys(out).length ? out : null;
}

// ---- The pull -------------------------------------------------------------------------------

export interface ImfPullOptions {
  fetchFn: ImfFetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Structures already read (kept a week on disk by the server). */
  structures?: Record<string, ImfStructure>;
}

export interface ImfStep {
  measure: ImfMeasureId;
  ok: boolean;
  /** What happened, in words: which IMF indicator was matched, or why not. */
  note: string;
  url?: string;
  httpStatus?: number;
}

export async function getJson(fetchFn: ImfFetch, url: string, timeoutMs: number): Promise<{ json?: unknown; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers: JSON_ACCEPT, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, error: 'answered, but not with JSON' };
    }
  } catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    const code = err?.cause?.code || '';
    if (err?.name === 'AbortError') return { error: `no answer within ${Math.round(timeoutMs / 1000)} s` };
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { error: 'fetch failed: address not found (internet, VPN or firewall)' };
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED') return { error: 'fetch failed: connection cut or refused (a firewall or proxy may block api.imf.org)' };
    return { error: String(err?.message || 'request failed') };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads (or reuses) the structure of each dataset the measures need. */
export async function loadStructures(opts: ImfPullOptions, flows: string[]): Promise<{ structures: Record<string, ImfStructure>; errors: Record<string, string> }> {
  const structures: Record<string, ImfStructure> = { ...(opts.structures || {}) };
  const errors: Record<string, string> = {};
  for (const flow of flows) {
    if (structures[flow]) continue;
    const r = await getJson(opts.fetchFn, imfStructureUrl(flow), opts.timeoutMs ?? 30000);
    const s = r.json ? parseImfStructure(flow, r.json) : null;
    if (s) structures[flow] = s;
    else errors[flow] = r.error ? `IMF ${flow} structure: ${r.error}` : `IMF ${flow} structure answered, but without an indicator list the app could read.`;
  }
  return { structures, errors };
}

/** Pulls one measure for one country: the .env key when set, else the matched indicator. */
export async function pullMeasure(
  opts: ImfPullOptions,
  m: ImfMeasure,
  iso3: string,
  structure: ImfStructure | undefined
): Promise<{ series: ImfSeries | null; step: ImfStep }> {
  const override = opts.env?.[m.envKey]?.trim();
  let key: string;
  let how: string;
  if (override) {
    key = override.replace(/\{ISO3\}/g, iso3);
    how = `series key from ${m.envKey}`;
  } else {
    if (!structure) return { series: null, step: { measure: m.id, ok: false, note: `IMF ${m.flow} structure not read.` } };
    const codes = matchIndicators(structure, m);
    if (!codes.length) {
      return { series: null, step: { measure: m.id, ok: false, note: `No IMF ${m.flow} indicator name matched "${m.label}". Set ${m.envKey} in .env to the series key (dimension order: ${structure.dims.join('.')}).` } };
    }
    key = seriesKey(structure, iso3, m.freq, codes.map((c) => c.id));
    how = `IMF ${m.flow} indicator ${codes.map((c) => `${c.id} ("${c.name}")`).join(' or ')}`;
  }
  const url = imfDataUrl(m.flow, key);
  const r = await getJson(opts.fetchFn, url, opts.timeoutMs ?? 30000);
  if (!r.json) return { series: null, step: { measure: m.id, ok: false, note: `${how}: ${r.error}`, url, ...(r.status ? { httpStatus: r.status } : {}) } };
  const all = parseImfData(r.json);
  const s = pickSeries(all, m);
  if (!s) {
    return {
      series: null,
      step: { measure: m.id, ok: false, note: `${how}: ${all.length ? `${all.length} series came back, none in US dollars at ${m.freq === 'M' ? 'monthly' : 'quarterly'} frequency` : 'no series for this country'}.`, url, httpStatus: r.status },
    };
  }
  return { series: s, step: { measure: m.id, ok: true, note: `${how}; series ${s.key}`, url, httpStatus: r.status } };
}

/** All three measures plus WEO GDP for one country. */
export async function pullImfExternal(opts: ImfPullOptions, iso3: string): Promise<{ external: ImfExternal; steps: ImfStep[]; structures: Record<string, ImfStructure> }> {
  const ms = Object.values(IMF_MEASURES);
  const needStructure = [...new Set(ms.filter((m) => !opts.env?.[m.envKey]?.trim()).map((m) => m.flow))];
  const { structures, errors } = await loadStructures(opts, needStructure);
  const picked: Partial<Record<ImfMeasureId, ImfSeries | null>> = {};
  const steps: ImfStep[] = [];
  const missing: Partial<Record<ImfMeasureId, string>> = {};
  for (const m of ms) {
    const { series, step } = await pullMeasure(opts, m, iso3, structures[m.flow]);
    if (!structures[m.flow] && errors[m.flow] && !opts.env?.[m.envKey]?.trim()) step.note = errors[m.flow];
    picked[m.id] = series;
    steps.push(step);
    if (!series) missing[m.id] = step.note;
  }
  let gdp: Record<string, number> | null = null;
  if (picked.currentAccount) {
    const g = await getJson(opts.fetchFn, datamapperGdpUrl(iso3), Math.min(opts.timeoutMs ?? 15000, 15000));
    gdp = g.json ? parseDatamapperGdp(g.json, iso3) : null;
  }
  return { external: buildExternal(iso3, picked, gdp, missing), steps, structures };
}

// ---- Words ----------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-09" -> "Sep 2025"; "2025-Q2" -> "Q2 2025". */
export function formatImfPeriod(p: string): string {
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m && MONTHS[Number(m[2]) - 1]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (m) return `Q${m[2]} ${m[1]}`;
  return p;
}

/** Why a country has no IMF reserves or balance-of-payments figure. */
export function imfMissing(e: ImfExternal | undefined, measure: ImfMeasureId): { short: string; help: string } {
  const why = e?.missing?.[measure];
  if (why) return { short: 'IMF series not read', help: why };
  return { short: 'IMF did not answer', help: 'The free IMF data API (api.imf.org) did not answer, or the pull has not run yet. Press Refresh now under Research > One country, or run npm run check:data.' };
}

const sg = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`;

/** One or two sentences for the council. */
export function imfSentence(e: ImfExternal): string {
  const parts: string[] = [];
  if (e.reserves) {
    parts.push(
      `Official reserves $${e.reserves.usdBn.toFixed(1)}bn (IMF, ${formatImfPeriod(e.reserves.period)})${e.reserves.change12mPct !== undefined ? `, ${sg(e.reserves.change12mPct)}% on the year` : ''}${
        e.monthsOfImports !== undefined ? `, ${e.monthsOfImports.toFixed(1)} months of imports: ${reserveCover(e.monthsOfImports)}` : ''
      }.`
    );
  }
  if (e.currentAccount4q?.pctGdp !== undefined) {
    parts.push(`Current account ${sg(e.currentAccount4q.pctGdp)}% of GDP over the four quarters to ${formatImfPeriod(e.currentAccount4q.through)} (IMF BOP).`);
  } else if (e.currentAccount) {
    parts.push(`Current account ${sg(e.currentAccount.usdBn, 1)}bn in ${formatImfPeriod(e.currentAccount.period)} (IMF BOP).`);
  }
  return parts.join(' ');
}
