import { providerRequest } from './imfApi';

export const GDELT_CONTRACT = 'gdelt2-global-events-day-v1';
export const GDELT_COLUMNS = `GLOBALEVENTID SQLDATE MonthYear Year FractionDate Actor1Code Actor1Name Actor1CountryCode
Actor1KnownGroupCode Actor1EthnicCode Actor1Religion1Code Actor1Religion2Code Actor1Type1Code Actor1Type2Code Actor1Type3Code
Actor2Code Actor2Name Actor2CountryCode Actor2KnownGroupCode Actor2EthnicCode Actor2Religion1Code Actor2Religion2Code
Actor2Type1Code Actor2Type2Code Actor2Type3Code IsRootEvent EventCode EventBaseCode EventRootCode QuadClass GoldsteinScale
NumMentions NumSources NumArticles AvgTone Actor1Geo_Type Actor1Geo_FullName Actor1Geo_CountryCode Actor1Geo_ADM1Code
Actor1Geo_ADM2Code Actor1Geo_Lat Actor1Geo_Long Actor1Geo_FeatureID Actor2Geo_Type Actor2Geo_FullName Actor2Geo_CountryCode
Actor2Geo_ADM1Code Actor2Geo_ADM2Code Actor2Geo_Lat Actor2Geo_Long Actor2Geo_FeatureID ActionGeo_Type ActionGeo_FullName
ActionGeo_CountryCode ActionGeo_ADM1Code ActionGeo_ADM2Code ActionGeo_Lat ActionGeo_Long ActionGeo_FeatureID DATEADDED SOURCEURL`.split(/\s+/);
export interface GdeltReport {
  contractVersion?: string; day?: string; errors?: string[]; transportComplete?: boolean;
  rowCount?: number; completedIntervals?: number; expectedIntervals?: string[];
  limitation?: string; library?: string; libraryLicense?: string; startedAt?: string; completedAt?: string;
  countries?: { code: string | null; count: number }[];
}
export interface GdeltSummary {
  id: string; createdAt: string; status: 'running' | 'interrupted' | 'staged' | 'committed' | 'rolled_back';
  active: boolean; report: GdeltReport; progress: Record<string, unknown>;
}
export interface GdeltRun extends GdeltSummary {
  sources: { ordinal: number; path: string; httpStatus: number; sha256: string; bytes: number; retrievedAt: string }[];
  chunks: { interval: string; rowCount: number }[];
}
export interface GdeltEvent {
  eventId: string; eventDate: string; interval: string; dateAdded: string; country: string | null;
  actor1Country: string | null; actor2Country: string | null; eventCode: string; eventRootCode: string; quadClass: number;
  goldstein: number; tone: number; mentions: number; sources: number; articles: number;
  latitude: number | null; longitude: number | null;
  sourceUrl: string | null; sourceUrlSafe: boolean; publishedAt: null; sourceHash: string; attributes: Record<string, string>;
}
export interface GdeltPage {
  rows: GdeltEvent[]; total: number; offset: number; limit: number; country: string; root: string; runId: string;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  date(v) && new Date(v).toISOString().slice(0, 10) === v;
const numberIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const interval = (v: unknown): v is string => typeof v === 'string' && /^\d{8}(0\d|1\d|2[0-3])(00|15|30|45)00$/.test(v) &&
  day(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
export function safeGdeltLink(value: string | null): boolean {
  if (!value || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
function report(v: unknown): v is GdeltReport {
  return object(v) && (v.contractVersion === undefined || v.contractVersion === GDELT_CONTRACT) &&
    (v.day === undefined || day(v.day)) && (v.errors === undefined || (Array.isArray(v.errors) && v.errors.every(e => typeof e === 'string'))) &&
    ['rowCount', 'completedIntervals'].every(k => v[k] === undefined || integer(v[k])) &&
    (v.completedIntervals === undefined || (integer(v.completedIntervals) && v.completedIntervals <= 96)) &&
    (v.transportComplete === undefined || typeof v.transportComplete === 'boolean') &&
    ['limitation', 'library', 'libraryLicense'].every(k => v[k] === undefined || typeof v[k] === 'string') &&
    ['startedAt', 'completedAt'].every(k => v[k] === undefined || date(v[k])) &&
    (v.expectedIntervals === undefined || (Array.isArray(v.expectedIntervals) && v.expectedIntervals.length === 96 &&
      v.expectedIntervals.every((i, n) => interval(i) && typeof v.day === 'string' &&
        i === v.day.replaceAll('-', '') + `${Math.floor(n / 4)}`.padStart(2, '0') + `${(n % 4) * 15}`.padStart(2, '0') + '00'))) &&
    (v.countries === undefined || (Array.isArray(v.countries) && v.countries.every(c => object(c) &&
      (c.code === null || (typeof c.code === 'string' && /^[A-Z0-9]{2}$/.test(c.code))) && integer(c.count) && c.count > 0) &&
      new Set(v.countries.map(c => c.code)).size === v.countries.length));
}
export function validGdeltSummary(v: unknown): v is GdeltSummary {
  return object(v) && typeof v.id === 'string' && date(v.createdAt) &&
    ['running', 'interrupted', 'staged', 'committed', 'rolled_back'].includes(String(v.status)) &&
    typeof v.active === 'boolean' && (!v.active || v.status === 'committed') && object(v.progress) && report(v.report) &&
    (!['staged', 'committed', 'rolled_back'].includes(String(v.status)) ||
      (v.report.contractVersion === GDELT_CONTRACT && v.report.transportComplete === true && v.report.completedIntervals === 96 &&
       v.report.expectedIntervals?.length === 96 && v.report.rowCount !== undefined && v.report.rowCount > 0 &&
       Array.isArray(v.report.errors) && v.report.errors.length === 0));
}
function run(v: unknown): v is GdeltRun {
  if (!validGdeltSummary(v) || !('sources' in v) || !Array.isArray(v.sources) || !('chunks' in v) || !Array.isArray(v.chunks) ||
    !v.sources.every(s => object(s) && integer(s.ordinal) && s.ordinal > 0 && typeof s.path === 'string' &&
      integer(s.httpStatus) && hash(s.sha256) && integer(s.bytes) && date(s.retrievedAt)) ||
    !v.chunks.every(c => object(c) && interval(c.interval) && integer(c.rowCount)) ||
    new Set(v.sources.map(s => s.ordinal)).size !== v.sources.length ||
    new Set(v.chunks.map(c => c.interval)).size !== v.chunks.length) return false;
  if (v.report.transportComplete) return v.sources.length === 96 && v.chunks.length === 96 &&
    v.chunks.reduce((sum, c) => sum + c.rowCount, 0) === v.report.rowCount &&
    v.report.countries?.reduce((sum, c) => sum + c.count, 0) === v.report.rowCount &&
    v.chunks.every((c, i) => c.interval === v.report.expectedIntervals?.[i]) &&
    v.sources.every((s, i) => s.httpStatus === 200 && s.path === `https://data.gdeltproject.org/gdeltv2/${v.report.expectedIntervals?.[i]}.export.CSV.zip`);
  return true;
}
export function validGdeltEvent(v: unknown): v is GdeltEvent {
  if (!object(v) || typeof v.eventId !== 'string' || !/^[1-9]\d{0,19}$/.test(v.eventId) || !day(v.eventDate) ||
    !interval(v.interval) || !date(v.dateAdded) || v.publishedAt !== null ||
    !(v.country === null || (typeof v.country === 'string' && /^[A-Z0-9]{2}$/.test(v.country))) ||
    !['actor1Country', 'actor2Country'].every(k => v[k] === null || (typeof v[k] === 'string' && /^[A-Z]{3}$/.test(v[k]))) ||
    typeof v.eventCode !== 'string' || !/^\d{2,4}$/.test(v.eventCode) || typeof v.eventRootCode !== 'string' ||
    !/^(0[1-9]|1\d|20)$/.test(v.eventRootCode) || !v.eventCode.startsWith(v.eventRootCode) ||
    ![1, 2, 3, 4].includes(Number(v.quadClass)) || !integer(v.quadClass) ||
    !numberIn(v.goldstein, -10, 10) || !numberIn(v.tone, -100, 100) ||
    !['mentions', 'sources', 'articles'].every(k => integer(v[k])) ||
    !(v.latitude === null || numberIn(v.latitude, -90, 90)) || !(v.longitude === null || numberIn(v.longitude, -180, 180)) ||
    !(v.sourceUrl === null || typeof v.sourceUrl === 'string') || typeof v.sourceUrlSafe !== 'boolean' ||
    (v.sourceUrlSafe && !safeGdeltLink(v.sourceUrl)) || !hash(v.sourceHash) || !object(v.attributes) ||
    Object.keys(v.attributes).length !== 61 || !Object.values(v.attributes).every(c => typeof c === 'string')) return false;
  const raw = v.attributes;
  return GDELT_COLUMNS.every(c => typeof raw[c] === 'string') &&
    raw.GLOBALEVENTID === v.eventId && raw.DATEADDED === v.interval && raw.SQLDATE === v.eventDate.replaceAll('-', '') &&
    raw.EventCode === v.eventCode && raw.EventRootCode === v.eventRootCode &&
    typeof raw.EventBaseCode === 'string' && /^\d{2,3}$/.test(raw.EventBaseCode) &&
    raw.EventCode.startsWith(raw.EventBaseCode) && raw.EventBaseCode.startsWith(raw.EventRootCode) &&
    ['0', '1'].includes(String(raw.IsRootEvent)) && ['0', '1', '2', '3', '4', '5'].includes(String(raw.ActionGeo_Type)) &&
    raw.MonthYear === raw.SQLDATE.slice(0, 6) && raw.Year === raw.SQLDATE.slice(0, 4) &&
    raw.SQLDATE <= v.interval.slice(0, 8) &&
    (raw.ActionGeo_CountryCode || null) === v.country && (raw.Actor1CountryCode || null) === v.actor1Country &&
    (raw.Actor2CountryCode || null) === v.actor2Country && (raw.SOURCEURL || null) === v.sourceUrl &&
    Number(raw.GoldsteinScale) === v.goldstein && Number(raw.AvgTone) === v.tone && Number(raw.QuadClass) === v.quadClass &&
    Number(raw.NumMentions) === v.mentions && Number(raw.NumSources) === v.sources && Number(raw.NumArticles) === v.articles &&
    ['NumMentions', 'NumSources', 'NumArticles'].every(k => /^\d+$/.test(String(raw[k]))) &&
    ['GoldsteinScale', 'AvgTone'].every(k => typeof raw[k] === 'string' && raw[k].trim() !== '') &&
    (raw.ActionGeo_Lat === '' ? v.latitude === null : Number(raw.ActionGeo_Lat) === v.latitude) &&
    (raw.ActionGeo_Long === '' ? v.longitude === null : Number(raw.ActionGeo_Long) === v.longitude) &&
    Date.parse(v.dateAdded) === Date.parse(`${v.interval.slice(0, 4)}-${v.interval.slice(4, 6)}-${v.interval.slice(6, 8)}T${v.interval.slice(8, 10)}:${v.interval.slice(10, 12)}:00Z`);
}
export async function checkGdeltContract(): Promise<{ day: string }> {
  const response = await fetch('/api/providers/gdelt/config', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) throw new Error('Backend restart required to enable GDELT. Existing providers remain unchanged.');
  if (!response.ok) throw new Error(`GDELT capability HTTP ${response.status}.`);
  const v: unknown = await response.json();
  if (!object(v) || v.contractVersion !== GDELT_CONTRACT || v.library !== 'gdelt==0.1.14' || v.requiresKey !== false ||
    v.table !== 'events' || v.scope !== 'global' || v.intervalCount !== 96 || !day(v.latestCompletedDay)) {
    throw new Error('Incompatible GDELT backend contract; acquisition blocked.');
  }
  return { day: v.latestCompletedDay };
}
export async function getGdeltRun(id: string): Promise<GdeltRun> {
  const value = await providerRequest(`/gdelt/${encodeURIComponent(id)}`);
  if (!run(value) || value.id !== id) throw new Error('Invalid GDELT run contract.');
  return value;
}
export async function startGdelt(): Promise<GdeltRun> {
  await checkGdeltContract();
  const value = await providerRequest('/providers/gdelt/pull', true, { researchUse: true });
  if (!run(value)) throw new Error('Invalid GDELT acquisition contract.');
  return value;
}
export async function mutateGdelt(id: string, action: 'cancel' | 'commit' | 'rollback'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/gdelt/${encodeURIComponent(id)}/cancel` : `/gdelt/${encodeURIComponent(id)}/${action}`, true);
}
export async function getGdeltPage(id: string, country: string, root: string, offset: number): Promise<GdeltPage> {
  const params = new URLSearchParams({ country, root, offset: String(offset), limit: '100' });
  const v = await providerRequest(`/gdelt/${encodeURIComponent(id)}/events?${params}`);
  if (!object(v) || !integer(v.total) || v.runId !== id || v.country !== country || v.root !== root || v.offset !== offset || v.limit !== 100 ||
    !Array.isArray(v.rows) || v.rows.length !== Math.min(100, Math.max(0, v.total - offset)) || !v.rows.every(validGdeltEvent) ||
    new Set(v.rows.map(r => r.eventId)).size !== v.rows.length ||
    v.rows.some(r => (country && (country === 'UNKNOWN' ? r.country !== null : r.country !== country)) || (root && r.eventRootCode !== root))) {
    throw new Error('Invalid GDELT page boundaries, event provenance or selection identity.');
  }
  return { rows: v.rows, total: v.total, offset, limit: 100, runId: id, country, root };
}
