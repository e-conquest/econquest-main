import { providerRequest } from './imfApi';

export const ACLED_CONTRACT = 'acled-global-core-30d-v1';
export interface AcledReport {
  contractVersion?: string; startDate?: string; endDate?: string; errors?: string[]; rowCount?: number; expectedRows?: number;
  transportComplete?: boolean; consistencyVerified?: boolean; limitation?: string; library?: string;
  countries?: { name: string; count: number }[]; eventTypes?: string[];
}
export interface AcledSummary {
  id: string; createdAt: string; status: 'running' | 'interrupted' | 'staged' | 'committed' | 'rolled_back';
  active: boolean; report: AcledReport; progress: Record<string, unknown>;
}
export interface AcledRun extends AcledSummary {
  sources: { ordinal: number; path: string; httpStatus: number; sha256: string; bytes: number; retrievedAt: string }[];
  chunks: { page: number; rowCount: number }[];
}
export interface AcledEvent {
  eventId: string; eventDate: string; country: string; eventType: string; subEventType: string; disorderType: string;
  timePrecision: number; geoPrecision: number; isoNumeric: number | null; fatalities: number | null;
  latitude: number | null; longitude: number | null; updatedAt: string; publishedAt: null; sourceHash: string;
  attributes: Record<string, string | number | boolean | null>;
}
export interface AcledPage {
  rows: AcledEvent[]; total: number; offset: number; limit: number; country: string; eventType: string; runId: string;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && date(v) &&
  new Date(v).toISOString().slice(0, 10) === v;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const window = (start: unknown, end: unknown): boolean => day(start) && day(end) && Date.parse(end) - Date.parse(start) === 29 * 86400000;
const bounded = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const rawInt = (v: unknown): number | null => (integer(v) || (typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) ? Number(v) : null;
const missing = (v: unknown) => v === null || v === undefined || v === '';
function report(v: unknown): v is AcledReport {
  return object(v) && (v.contractVersion === undefined || v.contractVersion === ACLED_CONTRACT) &&
    (v.startDate === undefined || day(v.startDate)) && (v.endDate === undefined || day(v.endDate)) &&
    ((v.startDate === undefined && v.endDate === undefined) || window(v.startDate, v.endDate)) &&
    ['rowCount', 'expectedRows'].every(k => v[k] === undefined || integer(v[k])) &&
    ['transportComplete', 'consistencyVerified'].every(k => v[k] === undefined || typeof v[k] === 'boolean') &&
    ['limitation', 'library'].every(k => v[k] === undefined || typeof v[k] === 'string') &&
    (v.errors === undefined || strings(v.errors)) &&
    (v.eventTypes === undefined || (strings(v.eventTypes) && v.eventTypes.every(nonempty) && new Set(v.eventTypes).size === v.eventTypes.length)) &&
    (v.countries === undefined || (Array.isArray(v.countries) && v.countries.every(c => object(c) && nonempty(c.name) && integer(c.count) && c.count > 0) &&
      new Set(v.countries.map(c => c.name)).size === v.countries.length));
}
export function validAcledSummary(v: unknown): v is AcledSummary {
  return object(v) && nonempty(v.id) && date(v.createdAt) && typeof v.active === 'boolean' &&
    ['running', 'interrupted', 'staged', 'committed', 'rolled_back'].includes(String(v.status)) && (!v.active || v.status === 'committed') &&
    object(v.progress) && report(v.report) && (!['staged', 'committed', 'rolled_back'].includes(String(v.status)) ||
      (v.report.contractVersion === ACLED_CONTRACT && window(v.report.startDate, v.report.endDate) &&
       v.report.transportComplete === true && v.report.consistencyVerified === true && integer(v.report.rowCount) &&
       v.report.rowCount > 0 && Array.isArray(v.report.errors) && v.report.errors.length === 0));
}
export function validAcledRun(v: unknown): v is AcledRun {
  if (!validAcledSummary(v) || !('sources' in v) || !Array.isArray(v.sources) || !('chunks' in v) || !Array.isArray(v.chunks) ||
    !v.sources.every((s, i) => object(s) && s.ordinal === i + 1 && typeof s.path === 'string' && integer(s.httpStatus) &&
      hash(s.sha256) && integer(s.bytes) && date(s.retrievedAt)) ||
    !v.chunks.every((c, i) => object(c) && c.page === i + 1 && integer(c.rowCount) && c.rowCount <= 5000)) return false;
  const chunks = v.chunks;
  if (v.report.transportComplete) return v.sources.length === chunks.length * 2 &&
    v.chunks.length > 0 && v.report.expectedRows === v.report.rowCount &&
    v.chunks.reduce((sum, c) => sum + c.rowCount, 0) === v.report.rowCount &&
    chunks.every((c, i) => i === chunks.length - 1 ? c.rowCount > 0 : c.rowCount === 5000) &&
    v.report.countries?.reduce((sum, c) => sum + c.count, 0) === v.report.rowCount &&
    !!v.report.eventTypes?.length && v.sources.every((s, i) => {
      let url: URL;
      try { url = new URL(s.path); } catch { return false; }
      return s.httpStatus === 200 && url.origin === 'https://acleddata.com' && url.pathname === '/api/acled/read' &&
        url.username === '' && url.password === '' && url.hash === '' && [...url.searchParams].length === 7 &&
        url.searchParams.get('event_date') === `${v.report.startDate}|${v.report.endDate}` &&
        url.searchParams.get('page') === String(i % chunks.length + 1) &&
        url.searchParams.get('event_date_where') === 'BETWEEN' && url.searchParams.get('limit') === '5000' &&
        url.searchParams.get('_format') === 'json' && url.searchParams.get('export_type') === 'dyadic' &&
        url.searchParams.get('with_total') === 'true';
    });
  return true;
}
export function validAcledEvent(v: unknown): v is AcledEvent {
  if (!object(v) || !nonempty(v.eventId) || !/^[A-Za-z0-9_-]{1,80}$/.test(v.eventId) || !day(v.eventDate) ||
    !['country', 'eventType', 'subEventType', 'disorderType'].every(k => nonempty(v[k])) ||
    ![1, 2, 3].includes(Number(v.timePrecision)) || !integer(v.timePrecision) ||
    ![1, 2, 3].includes(Number(v.geoPrecision)) || !integer(v.geoPrecision) ||
    !(v.isoNumeric === null || (integer(v.isoNumeric) && v.isoNumeric <= 999)) ||
    !(v.fatalities === null || integer(v.fatalities)) || !(v.latitude === null || bounded(v.latitude, -90, 90)) ||
    !(v.longitude === null || bounded(v.longitude, -180, 180)) || !date(v.updatedAt) || v.publishedAt !== null ||
    !hash(v.sourceHash) || !object(v.attributes) || !Object.values(v.attributes).every(a =>
      a === null || typeof a === 'string' || typeof a === 'boolean' || (typeof a === 'number' && Number.isFinite(a)))) return false;
  const raw = v.attributes;
  return raw.event_id_cnty === v.eventId && raw.event_date === v.eventDate && raw.country === v.country &&
    raw.event_type === v.eventType && raw.sub_event_type === v.subEventType && raw.disorder_type === v.disorderType &&
    rawInt(raw.year) === Number(v.eventDate.slice(0, 4)) && rawInt(raw.time_precision) === v.timePrecision &&
    rawInt(raw.geo_precision) === v.geoPrecision &&
    (missing(raw.iso) ? v.isoNumeric === null : rawInt(raw.iso) !== null && rawInt(raw.iso) === v.isoNumeric) &&
    (missing(raw.fatalities) ? v.fatalities === null : rawInt(raw.fatalities) !== null && rawInt(raw.fatalities) === v.fatalities) &&
    (missing(raw.latitude) ? v.latitude === null : typeof raw.latitude !== 'boolean' && Number(raw.latitude) === v.latitude) &&
    (missing(raw.longitude) ? v.longitude === null : typeof raw.longitude !== 'boolean' && Number(raw.longitude) === v.longitude) &&
    ['source', 'source_scale'].every(k => nonempty(raw[k])) && rawInt(raw.timestamp) !== null &&
    Date.parse(v.updatedAt) === Number(raw.timestamp) * 1000;
}
export async function checkAcledContract(): Promise<{ configured: boolean; startDate: string; endDate: string }> {
  const response = await fetch('/api/providers/acled/config', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) throw new Error('Backend restart required to enable ACLED. Existing providers remain unchanged.');
  if (!response.ok) throw new Error(`ACLED capability HTTP ${response.status}.`);
  const v: unknown = await response.json();
  if (!object(v) || v.contractVersion !== ACLED_CONTRACT || v.library !== 'acled==1.0.2' || v.auth !== 'oauth' ||
    v.scope !== 'global-account-accessible' || v.days !== 30 || typeof v.configured !== 'boolean' ||
    !day(v.startDate) || !day(v.endDate) || !window(v.startDate, v.endDate)) throw new Error('Incompatible ACLED backend contract.');
  return { configured: v.configured, startDate: v.startDate, endDate: v.endDate };
}
export async function getAcledRun(id: string): Promise<AcledRun> {
  const v = await providerRequest(`/acled/${encodeURIComponent(id)}`);
  if (!validAcledRun(v) || v.id !== id) throw new Error('Invalid ACLED snapshot contract.');
  return v;
}
export async function startAcled(): Promise<AcledRun> {
  if (!(await checkAcledContract()).configured) throw new Error('Configure myACLED credentials privately in the backend first.');
  const v = await providerRequest('/providers/acled/pull', true, { researchUse: true });
  if (!validAcledRun(v)) throw new Error('Invalid ACLED acquisition contract.');
  return v;
}
export async function mutateAcled(id: string, action: 'cancel' | 'commit' | 'rollback'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/acled/${encodeURIComponent(id)}/cancel` : `/acled/${encodeURIComponent(id)}/${action}`, true);
}
export async function getAcledPage(run: AcledRun, country: string, eventType: string, offset: number): Promise<AcledPage> {
  const params = new URLSearchParams({ country, event_type: eventType, offset: String(offset), limit: '100' });
  const v = await providerRequest(`/acled/${encodeURIComponent(run.id)}/events?${params}`);
  if (!object(v) || v.runId !== run.id || v.country !== country || v.eventType !== eventType || v.offset !== offset || v.limit !== 100 ||
    !integer(v.total) || !Array.isArray(v.rows) || v.rows.length !== Math.min(100, Math.max(0, v.total - offset)) ||
    !v.rows.every(validAcledEvent) || new Set(v.rows.map(r => r.eventId)).size !== v.rows.length ||
    v.rows.some(r => (country && r.country !== country) || (eventType && r.eventType !== eventType) ||
      !run.report.startDate || !run.report.endDate || r.eventDate < run.report.startDate || r.eventDate > run.report.endDate ||
      !run.sources.some(s => s.sha256 === r.sourceHash && s.httpStatus === 200))) {
    throw new Error('Invalid ACLED page count, native fields, original provenance or selection identity.');
  }
  return { rows: v.rows, total: v.total, offset, limit: 100, runId: run.id, country, eventType };
}
