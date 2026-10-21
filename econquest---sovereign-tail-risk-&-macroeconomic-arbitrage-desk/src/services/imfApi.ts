export interface MacroReport {
  errors?: string[];
  contractVersion?: string;
  startPeriod?: string;
  endPeriod?: string;
  rowCount?: number;
  requiredPairs?: number;
  absentPairs?: number;
  countries?: { code: string; name: string; iso3: string | null }[];
  indicators?: { id: string; name: string; unit: string; flow: string; key: string }[];
  valueConvention?: string;
  freshness?: string;
  limitation?: string;
  excludedAreas?: { code: string; name: string; reason: string; description: string }[];
  warnings?: string[];
  warningCount?: number;
  coveragePolicy?: string;
  coverageLimitation?: string;
  numericCount?: number;
  unknownStatusRows?: number;
}
export interface MacroSummary {
  id: string;
  createdAt: string;
  status: 'running' | 'staged' | 'quarantined' | 'interrupted' | 'committed' | 'rolled_back';
  active: boolean;
  report: MacroReport;
  progress: Record<string, unknown>;
}
export interface MacroRun extends MacroSummary {
  sources: { ordinal: number; path: string; httpStatus: number; sha256: string; bytes: number }[];
}
export interface MacroRow {
  country: string;
  indicator: string;
  period: string;
  value: number | null;
  rawValue: string | null;
  scale: string;
  unit: string;
  status: string | null;
  sourceHash: string;
  attributes: Record<string, string>;
  exclusionReason?: string | null;
}
export interface MacroCoverage {
  country: string;
  name: string;
  indicator: string;
  validCount: number;
  firstPeriod: string | null;
  latestPeriod: string | null;
  missingPeriods: string[];
  missingCount: number;
  absent: boolean;
  freshness: 'unknown';
}
export interface MacroPage<T> { rows: T[]; total: number; offset: number; limit: number }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
const month = (value: unknown) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
function report(value: unknown): value is MacroReport {
  return object(value) && (value.errors === undefined || strings(value.errors)) &&
    ['contractVersion', 'valueConvention', 'freshness', 'limitation', 'coveragePolicy', 'coverageLimitation'].every(k => value[k] === undefined || typeof value[k] === 'string') &&
    ['startPeriod', 'endPeriod'].every(k => value[k] === undefined || month(value[k])) &&
    ['rowCount', 'requiredPairs', 'absentPairs', 'warningCount', 'numericCount', 'unknownStatusRows'].every(k => value[k] === undefined || integer(value[k])) &&
    (value.countries === undefined || (Array.isArray(value.countries) && value.countries.every(v => object(v) &&
      ['code', 'name'].every(k => typeof v[k] === 'string') && (v.iso3 === null || typeof v.iso3 === 'string')))) &&
    (value.indicators === undefined || (Array.isArray(value.indicators) && value.indicators.every(v => object(v) && ['id', 'name', 'unit', 'flow', 'key'].every(k => typeof v[k] === 'string')))) &&
    (value.excludedAreas === undefined || (Array.isArray(value.excludedAreas) && value.excludedAreas.every(v => object(v) && ['code', 'name', 'reason', 'description'].every(k => typeof v[k] === 'string')))) &&
    (value.warnings === undefined || strings(value.warnings));
}
export function validMacroSummary(value: unknown): value is MacroSummary {
  return object(value) && typeof value.id === 'string' && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    ['running', 'staged', 'quarantined', 'interrupted', 'committed', 'rolled_back'].includes(String(value.status)) &&
    typeof value.active === 'boolean' && (!value.active || value.status === 'committed') && report(value.report) && object(value.progress);
}
function validRun(value: unknown): value is MacroRun {
  return validMacroSummary(value) && 'sources' in value && Array.isArray(value.sources) &&
    value.sources.every(v => object(v) && integer(v.ordinal) && integer(v.httpStatus) && integer(v.bytes) &&
      typeof v.path === 'string' && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256));
}
function validRow(value: unknown): value is MacroRow {
  return object(value) && ['country', 'indicator', 'scale', 'unit', 'sourceHash'].every(k => typeof value[k] === 'string') &&
    typeof value.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(value.sourceHash) &&
    month(value.period) && (value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value))) &&
    (value.rawValue === null || typeof value.rawValue === 'string') && (value.status === null || typeof value.status === 'string') &&
    (value.exclusionReason === undefined || value.exclusionReason === null || (typeof value.exclusionReason === 'string' && value.value === null)) &&
    object(value.attributes) && Object.values(value.attributes).every(v => typeof v === 'string');
}
function validCoverage(value: unknown): value is MacroCoverage {
  return object(value) && ['country', 'name', 'indicator'].every(k => typeof value[k] === 'string') &&
    integer(value.validCount) && integer(value.missingCount) && typeof value.absent === 'boolean' &&
    value.absent === (value.validCount === 0) &&
    (value.firstPeriod === null || month(value.firstPeriod)) && (value.latestPeriod === null || month(value.latestPeriod)) &&
    Array.isArray(value.missingPeriods) && value.missingPeriods.every(month) && value.missingPeriods.length === value.missingCount &&
    new Set(value.missingPeriods).size === value.missingPeriods.length && value.freshness === 'unknown';
}
export async function providerRequest(path: string, mutate = false, body?: Record<string, unknown>): Promise<unknown> {
  const headers = new Headers();
  if (mutate) {
    const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Provider session HTTP ${response.status}`);
    const session: unknown = await response.json();
    if (!object(session) || typeof session.token !== 'string') throw new Error('Invalid research session token.');
    headers.set('X-Research-Token', session.token);
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, {
    method: mutate ? 'POST' : 'GET', headers, cache: 'no-store', signal: AbortSignal.timeout(30000),
    ...(body ? { body: JSON.stringify(body) } : ['/providers/imf/pull', '/providers/imf-weo/pull', '/providers/worldbank/pull'].includes(path) ? { body: JSON.stringify({ researchUse: true }) } : {})
  });
  if (!response.ok) throw new Error(`Provider data service HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
}
export async function getMacroRun(id: string): Promise<MacroRun> {
  const value = await providerRequest(`/macro/${encodeURIComponent(id)}`);
  if (!validRun(value)) throw new Error('Invalid IMF run contract.');
  return value;
}
export async function checkMonthlyImfContract(): Promise<void> {
  const response = await fetch('/api/providers/imf/config', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) throw new Error('Backend restart required to enable Monthly IMF v2. Existing revisions remain available for inspection.');
  if (!response.ok) throw new Error(`Monthly IMF contract check HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (!object(value) || value.contractVersion !== 'imf-monthly-native-v2' || value.coveragePolicy !== 'available-monthly-pairs') {
    throw new Error('Monthly IMF backend contract mismatch; new pulls blocked until a compatible backend is running.');
  }
}
export async function startImf(): Promise<MacroRun> {
  await checkMonthlyImfContract();
  const value = await providerRequest('/providers/imf/pull', true);
  if (!validRun(value)) throw new Error('Invalid IMF acquisition contract.');
  return value;
}
export async function mutateMacro(id: string, action: 'commit' | 'rollback' | 'cancel'): Promise<void> {
  await providerRequest(action === 'cancel' ? `/providers/imf/${encodeURIComponent(id)}/cancel` : `/macro/${encodeURIComponent(id)}/${action}`, true);
}
export function getMacroPage(id: string, type: 'coverage', country?: string, indicator?: string, offset?: number): Promise<MacroPage<MacroCoverage>>;
export function getMacroPage(id: string, type: 'observations', country: string, indicator: string, offset?: number): Promise<MacroPage<MacroRow>>;
export async function getMacroPage(
  id: string, type: 'coverage' | 'observations', country = '', indicator = '', offset = 0
): Promise<MacroPage<MacroCoverage> | MacroPage<MacroRow>> {
  const params = new URLSearchParams({ country, indicator, offset: String(offset), limit: type === 'coverage' ? '50' : '240' });
  const value = await providerRequest(`/macro/${encodeURIComponent(id)}/${type}?${params}`);
  if (!object(value) || typeof value.total !== 'number' || !integer(value.total) ||
    typeof value.offset !== 'number' || !integer(value.offset) || typeof value.limit !== 'number' || !integer(value.limit) || !Array.isArray(value.rows)) {
    throw new Error('Invalid IMF paginated data contract.');
  }
  const page = { total: value.total, offset: value.offset, limit: value.limit };
  if (value.offset !== offset || value.limit <= 0 || value.rows.length !== Math.min(value.limit, Math.max(0, value.total - offset))) throw new Error('Inconsistent IMF page boundaries.');
  if (type === 'coverage' && value.rows.every(validCoverage) &&
    value.rows.every(row => (!country || row.country === country) && (!indicator || row.indicator === indicator)) &&
    new Set(value.rows.map(row => `${row.country}/${row.indicator}`)).size === value.rows.length) return { ...page, rows: value.rows };
  if (type === 'observations' && value.rows.every(validRow) && value.rows.every(row => row.country === country && row.indicator === indicator) &&
    new Set(value.rows.map(row => row.period)).size === value.rows.length && (offset !== 0 || value.total === value.rows.length)) return { ...page, rows: value.rows };
  throw new Error('Invalid IMF paginated row contract.');
}
