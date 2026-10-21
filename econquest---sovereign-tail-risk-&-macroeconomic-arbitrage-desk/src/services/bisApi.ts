import { MacroRun, MacroSummary, providerRequest, validMacroSummary } from './imfApi';

export interface BisReport {
  errors?: string[]; rowCount?: number; numericCount?: number; seriesCount?: number;
  requiredPairs?: number; absentPairs?: number; availableEconomies?: number; availableIndicators?: number;
  analysisBlockedSeries?: number; firstPeriod?: string; lastPeriod?: string; retrievedAt?: string; limitation?: string;
  countries?: { code: string; name: string; iso3: string }[];
  indicators?: { code: string; name: string; flow: string; template: string; unit: string }[];
}
export interface BisSummary extends Omit<MacroSummary, 'report'> { report: BisReport }
export interface BisRun extends BisSummary { sources: MacroRun['sources'] }
export interface BisRow {
  country: string; indicator: string; period: string; value: number | null; rawValue: string | null;
  attributes: Record<string, string>; sourceHash: string; flagged: boolean;
}
export interface BisSeries {
  country: string; indicator: string; validCount: number; missingCount: number; flaggedCount: number;
  missingPeriods: string[]; firstPeriod: string | null; lastPeriod: string | null; latestValidPeriod: string | null;
  analysisBlocked: boolean; reason: string; unit: string; dimensions?: Record<string, string>;
  dimensionLabels?: Record<string, string>; attributes?: Record<string, string>; metadataSourceHash?: string;
}
export interface BisCoverage extends BisSeries { name: string; indicatorName: string; absent: boolean }
interface Page<T> { rows: T[]; total: number; offset: number; limit: number }
export interface BisObservations extends Page<BisRow> { series: BisSeries }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const period = (v: unknown): v is string => typeof v === 'string' && /^(18|19|20)\d{2}-Q[1-4]$/.test(v);
const strings = (v: unknown): v is Record<string, string> => object(v) && Object.values(v).every(s => typeof s === 'string');
const nullablePeriod = (v: unknown) => v === null || period(v);
export function validBisSummary(v: unknown): v is BisSummary {
  if (!object(v) || !validMacroSummary({ ...v, report: {} }) || !object(v.report)) return false;
  const r = v.report;
  return (r.errors === undefined || (Array.isArray(r.errors) && r.errors.every(e => typeof e === 'string'))) &&
    ['rowCount', 'numericCount', 'seriesCount', 'requiredPairs', 'absentPairs', 'availableEconomies', 'availableIndicators', 'analysisBlockedSeries'].every(k => r[k] === undefined || integer(r[k])) &&
    ['firstPeriod', 'lastPeriod'].every(k => r[k] === undefined || period(r[k])) &&
    (r.retrievedAt === undefined || (typeof r.retrievedAt === 'string' && Number.isFinite(Date.parse(r.retrievedAt)))) &&
    (r.limitation === undefined || typeof r.limitation === 'string') &&
    (r.countries === undefined || (Array.isArray(r.countries) && r.countries.every(c => object(c) &&
      typeof c.code === 'string' && /^[A-Z]{2}$/.test(c.code) && typeof c.name === 'string' && typeof c.iso3 === 'string') &&
      new Set(r.countries.map(c => c.code)).size === r.countries.length)) &&
    (r.indicators === undefined || (Array.isArray(r.indicators) && r.indicators.every(i => object(i) &&
      ['code', 'name', 'flow', 'template', 'unit'].every(k => typeof i[k] === 'string')) &&
      new Set(r.indicators.map(i => i.code)).size === r.indicators.length));
}
function validRun(v: unknown): v is BisRun {
  return validBisSummary(v) && 'sources' in v && Array.isArray(v.sources) && v.sources.every(s => object(s) &&
    integer(s.ordinal) && typeof s.path === 'string' && integer(s.httpStatus) && integer(s.bytes) && hash(s.sha256));
}
function validRow(v: unknown): v is BisRow {
  return object(v) && typeof v.country === 'string' && typeof v.indicator === 'string' && period(v.period) &&
    strings(v.attributes) && hash(v.sourceHash) && typeof v.flagged === 'boolean' && v.attributes.OBS_CONF === 'F' &&
    (v.value === null
      ? v.rawValue === null || v.rawValue === '' || v.rawValue === 'NaN'
      : typeof v.value === 'number' && Number.isFinite(v.value) && typeof v.rawValue === 'string' &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.rawValue) && Number(v.rawValue) === v.value);
}
function validSeries(v: unknown): v is BisSeries {
  return object(v) && typeof v.country === 'string' && typeof v.indicator === 'string' &&
    ['validCount', 'missingCount', 'flaggedCount'].every(k => integer(v[k])) &&
    Array.isArray(v.missingPeriods) && v.missingPeriods.every(period) && new Set(v.missingPeriods).size === v.missingPeriods.length &&
    ['firstPeriod', 'lastPeriod', 'latestValidPeriod'].every(k => nullablePeriod(v[k])) &&
    typeof v.analysisBlocked === 'boolean' && typeof v.reason === 'string' && typeof v.unit === 'string' &&
    ['dimensions', 'dimensionLabels', 'attributes'].every(k => v[k] === undefined || strings(v[k])) &&
    (v.metadataSourceHash === undefined || hash(v.metadataSourceHash));
}
function validPage(v: unknown, offset: number): v is Page<unknown> {
  return object(v) && integer(v.total) && v.offset === offset && integer(v.limit) && v.limit > 0 &&
    Array.isArray(v.rows) && v.rows.length === Math.min(v.limit, Math.max(0, v.total - offset));
}
export async function getBisRun(id: string): Promise<BisRun> {
  const v = await providerRequest(`/bis/${encodeURIComponent(id)}`);
  if (!validRun(v)) throw new Error('Invalid BIS snapshot contract; last valid review retained.');
  return v;
}
export async function startBis(): Promise<BisRun> {
  const v = await providerRequest('/providers/bis/pull', true, { researchUse: true });
  if (!validRun(v)) throw new Error('Invalid BIS acquisition contract.');
  return v;
}
export async function mutateBis(id: string, action: 'commit' | 'rollback' | 'cancel'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/bis/${encodeURIComponent(id)}/cancel` : `/bis/${encodeURIComponent(id)}/${action}`, true);
}
export async function getBisObservations(id: string, country: string, indicator: string): Promise<BisObservations> {
  const rows: BisRow[] = [];
  let total: number | undefined;
  let series: BisSeries | undefined;
  do {
    const params = new URLSearchParams({ country, indicator, offset: String(rows.length), limit: '1000' });
    const v = await providerRequest(`/bis/${encodeURIComponent(id)}/observations?${params}`);
    if (!validPage(v, rows.length) || !('series' in v) || !validSeries(v.series) || !v.rows.every(validRow) ||
      v.total > 1200 || (total !== undefined && total !== v.total) ||
      v.series.country !== country || v.series.indicator !== indicator ||
      (series && JSON.stringify(series) !== JSON.stringify(v.series)) ||
      v.rows.some(r => r.country !== country || r.indicator !== indicator)) {
      throw new Error('Invalid, mixed or truncated BIS quarterly history contract; last valid review retained.');
    }
    rows.push(...v.rows); total = v.total; series = v.series;
  } while (rows.length < total);
  if (!series || new Set(rows.map(r => r.period)).size !== rows.length ||
    rows.some((r, i) => i > 0 && r.period <= rows[i - 1].period) ||
    series.validCount !== rows.filter(r => r.value !== null).length ||
    series.missingCount !== rows.filter(r => r.value === null).length ||
    series.flaggedCount !== rows.filter(r => r.flagged).length ||
    series.firstPeriod !== (rows[0]?.period ?? null) || series.lastPeriod !== (rows.at(-1)?.period ?? null)) {
    throw new Error('Inconsistent BIS series counts or periods; last valid review retained.');
  }
  return { rows, series, total: rows.length, offset: 0, limit: 1000 };
}
export async function getBisCoverage(id: string, country: string, offset = 0): Promise<Page<BisCoverage>> {
  const params = new URLSearchParams({ country, offset: String(offset), limit: '50' });
  const v = await providerRequest(`/bis/${encodeURIComponent(id)}/coverage?${params}`);
  const valid = (r: unknown): r is BisCoverage => validSeries(r) && 'name' in r && typeof r.name === 'string' &&
    'indicatorName' in r && typeof r.indicatorName === 'string' && 'absent' in r && r.absent === (r.validCount === 0) &&
    (!country || r.country === country);
  if (!validPage(v, offset) || !v.rows.every(valid)) throw new Error('Invalid BIS coverage contract.');
  return { ...v, rows: v.rows };
}
