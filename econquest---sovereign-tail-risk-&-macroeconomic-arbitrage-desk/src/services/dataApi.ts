export interface Observation {
  country?: string;
  year?: number;
  inDefault?: boolean;
  values?: (number | null)[];
  symbol?: string;
  observedAt?: string;
  value?: number;
  publishedAt: string | null;
}

export interface Dataset {
  id: string;
  version: string;
  kind: 'annual' | 'market';
  source: string;
  unit: string;
  createdAt: string;
  freshnessDays: number | null;
  observations: Observation[];
  active: boolean;
  sessionPolicy?: { expectedCloseAt: string; nextCheckAt: string; checkedAt: string } | null;
  providerReport?: YahooReport | null;
}

export interface IngestionRun {
  id: string;
  status: 'staged' | 'quarantined' | 'committed' | 'rolled_back' | 'interrupted';
  createdAt: string;
  source: string;
  kind: 'annual' | 'market';
  errors: string[];
  datasetId: string | null;
  rowCount: number;
}

export interface ResearchState {
  schemaVersion: 1;
  datasets: Dataset[];
  runs: IngestionRun[];
  providers: ProviderStatus[];
  macro?: MacroSummary[];
  weo?: WeoSummary[];
  worldbank?: WorldBankSummary[];
  fred?: FredSummary[];
  bis?: BisSummary[];
  ids?: WorldBankSummary[];
  comtrade?: ComtradeSummary[];
  gdelt?: GdeltSummary[];
  acled?: AcledSummary[];
}

export interface ProviderStatus {
  id: 'yfinance' | 'imf' | 'imf-weo' | 'worldbank' | 'fred' | 'bis' | 'ids' | 'comtrade' | 'gdelt' | 'acled';
  name: string;
  mode: 'manual';
  status: 'available' | 'running' | 'staged' | 'quarantined' | 'interrupted';
  lastAttemptAt: string | null;
  lastValidatedAt: string | null;
  errors: string[];
}

export interface YahooReport {
  adapterVersion: string;
  library?: string;
  retrievedAt?: string;
  startedAt?: string;
  semantics?: string;
  timestampConvention?: string;
  calendar?: string;
  settings?: Record<string, unknown>;
  summaries?: {
    symbol: string; name: string; currency: string; exchange: string; timezone: string;
    rows: number; firstSession: string; lastSession: string; lastClose: number; lastCloseAt: string;
    missingSessions: number; actions: Record<string, unknown>[]; warnings: string[];
  }[];
  errors: string[];
  pullId: string;
  originalSha256?: string;
}

export interface ImportPreview {
  run: IngestionRun;
  preview: Observation[];
  sheets: string[];
  providerReport?: YahooReport | null;
}

export interface ResearchEvent {
  sequence: number;
  event: string;
  createdAt: string;
  runId: string | null;
  datasetId: string | null;
  details: Record<string, unknown>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const kind = (value: unknown) => value === 'annual' || value === 'market';

function validYahooReport(value: unknown): value is YahooReport {
  return object(value) && typeof value.adapterVersion === 'string' && typeof value.pullId === 'string' &&
    (value.originalSha256 === undefined || (typeof value.originalSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.originalSha256))) &&
    ['library', 'semantics', 'timestampConvention', 'calendar'].every(key => value[key] === undefined || typeof value[key] === 'string') &&
    ['startedAt', 'retrievedAt'].every(key => value[key] === undefined || date(value[key])) &&
    (value.settings === undefined || object(value.settings)) &&
    Array.isArray(value.errors) && value.errors.every(e => typeof e === 'string') &&
    (value.summaries === undefined || (Array.isArray(value.summaries) && value.summaries.every(s => object(s) &&
      typeof s.symbol === 'string' && typeof s.name === 'string' && s.currency === 'USD' &&
      typeof s.exchange === 'string' && typeof s.timezone === 'string' && Number.isInteger(s.rows) &&
      typeof s.firstSession === 'string' && typeof s.lastSession === 'string' && finite(s.lastClose) &&
      date(s.lastCloseAt) && Number.isInteger(s.missingSessions) && Array.isArray(s.actions) && s.actions.every(object) &&
      Array.isArray(s.warnings) && s.warnings.every(w => typeof w === 'string'))));
}

function validProvider(value: unknown): value is ProviderStatus {
  return object(value) && ['yfinance', 'imf', 'imf-weo', 'worldbank', 'fred', 'bis', 'ids', 'comtrade', 'gdelt', 'acled'].includes(String(value.id)) && typeof value.name === 'string' && value.mode === 'manual' &&
    ['available', 'running', 'staged', 'quarantined', 'interrupted'].includes(String(value.status)) &&
    (value.lastAttemptAt === null || date(value.lastAttemptAt)) &&
    (value.lastValidatedAt === null || date(value.lastValidatedAt)) &&
    Array.isArray(value.errors) && value.errors.every(e => typeof e === 'string');
}

function validSessionPolicy(value: unknown): boolean {
  return value === undefined || value === null || (object(value) && date(value.expectedCloseAt) && date(value.nextCheckAt) && date(value.checkedAt));
}

function validObservation(value: unknown): value is Observation {
  if (!object(value) || !(value.publishedAt === null || date(value.publishedAt))) return false;
  const annual = typeof value.country === 'string' && /^[A-Z]{3}$/.test(value.country) &&
    Number.isInteger(value.year) && typeof value.inDefault === 'boolean' &&
    Array.isArray(value.values) && value.values.length === 6 && value.values.every(v => v === null || finite(v));
  const market = typeof value.symbol === 'string' && value.symbol.trim().length > 0 &&
    date(value.observedAt) && finite(value.value);
  return annual || market;
}

function validRun(value: unknown): value is IngestionRun {
  return object(value) && typeof value.id === 'string' &&
    ['staged', 'quarantined', 'committed', 'rolled_back', 'interrupted'].includes(String(value.status)) &&
    date(value.createdAt) && typeof value.source === 'string' && kind(value.kind) &&
    Array.isArray(value.errors) && value.errors.every(e => typeof e === 'string') &&
    (value.datasetId === null || typeof value.datasetId === 'string') &&
    Number.isInteger(value.rowCount) && Number(value.rowCount) >= 0;
}

export function validateResearchState(value: unknown): asserts value is ResearchState {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.providers) || !value.providers.every(validProvider) ||
    (value.macro !== undefined && (!Array.isArray(value.macro) || !value.macro.every(validMacroSummary))) ||
    (value.weo !== undefined && (!Array.isArray(value.weo) || !value.weo.every(validWeoSummary))) ||
    (value.worldbank !== undefined && (!Array.isArray(value.worldbank) || !value.worldbank.every(validWorldBankSummary))) ||
    (value.fred !== undefined && (!Array.isArray(value.fred) || !value.fred.every(validFredSummary))) ||
    (value.bis !== undefined && (!Array.isArray(value.bis) || !value.bis.every(validBisSummary))) ||
    (value.ids !== undefined && (!Array.isArray(value.ids) || !value.ids.every(validIdsSummary))) ||
    (value.comtrade !== undefined && (!Array.isArray(value.comtrade) || !value.comtrade.every(validComtradeSummary))) ||
    (value.gdelt !== undefined && (!Array.isArray(value.gdelt) || !value.gdelt.every(validGdeltSummary))) ||
    (value.acled !== undefined && (!Array.isArray(value.acled) || !value.acled.every(validAcledSummary))) ||
    !Array.isArray(value.runs) || !value.runs.every(validRun) || !Array.isArray(value.datasets) ||
    !value.datasets.every(d => object(d) && typeof d.id === 'string' && typeof d.version === 'string' &&
      kind(d.kind) && typeof d.source === 'string' && typeof d.unit === 'string' && date(d.createdAt) &&
      (d.freshnessDays === null || (Number.isInteger(d.freshnessDays) && Number(d.freshnessDays) >= 0 && Number(d.freshnessDays) <= 36500)) &&
      typeof d.active === 'boolean' && Array.isArray(d.observations) && d.observations.length > 0 &&
      validSessionPolicy(d.sessionPolicy) &&
      (d.providerReport == null || validYahooReport(d.providerReport)) &&
      d.observations.every(row => validObservation(row) &&
        (d.kind === 'annual' ? row.values !== undefined : row.value !== undefined)))) {
    throw new Error('Backend returned an invalid research-data contract. Last valid data retained.');
  }
  for (const type of ['annual', 'market']) {
    if (value.datasets.filter(d => d.kind === type && d.active).length > 1) {
      throw new Error(`Backend returned competing active ${type} datasets.`);
    }
  }
}

export function validatePreview(value: unknown): asserts value is ImportPreview {
  if (!object(value) || !validRun(value.run) || !Array.isArray(value.preview) ||
    !value.preview.every(validObservation) || !Array.isArray(value.sheets) ||
    !value.sheets.every(sheet => typeof sheet === 'string') ||
    (value.providerReport != null && !validYahooReport(value.providerReport))) {
    throw new Error('Backend returned an invalid import preview.');
  }
}

async function request(path: string, init?: RequestInit, timeout = 30000): Promise<unknown> {
  const response = await fetch(`/api${path}`, { ...init, signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Data service ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

async function mutationHeaders(): Promise<HeadersInit> {
  const session = await request('/session');
  if (!object(session) || typeof session.token !== 'string') throw new Error('Invalid backend session token.');
  return { 'X-Research-Token': session.token };
}

export async function loadResearchState(): Promise<ResearchState> {
  const state = await request('/state');
  validateResearchState(state);
  return state;
}

export async function loadResearchEvents(): Promise<ResearchEvent[]> {
  const health = await request('/health');
  if (!object(health) || health.status !== 'ok' || health.connectorsActive !== false ||
    !Array.isArray(health.observations) || !health.observations.every(row => object(row) &&
      typeof row.id === 'string' && ['ok', 'error', 'unknown', 'fresh', 'stale'].includes(String(row.status)) &&
      date(row.checkedAt) && object(row.details))) {
    throw new Error('Backend returned invalid data-health status.');
  }
  const response = await request('/events');
  if (!object(response) || !Array.isArray(response.events) ||
    !response.events.every((event): event is ResearchEvent => object(event) &&
      Number.isInteger(event.sequence) && Number(event.sequence) > 0 &&
      typeof event.event === 'string' && date(event.createdAt) && object(event.details) &&
      (event.runId === null || typeof event.runId === 'string') &&
      (event.datasetId === null || typeof event.datasetId === 'string'))) {
    throw new Error('Backend returned invalid audit events.');
  }
  return response.events;
}

export async function stageImport(form: FormData): Promise<ImportPreview> {
  const preview = await request('/imports', { method: 'POST', body: form, headers: await mutationHeaders() });
  validatePreview(preview);
  return preview;
}

export async function pullYahoo(): Promise<ImportPreview> {
  const headers = new Headers(await mutationHeaders());
  headers.set('Content-Type', 'application/json');
  const preview = await request('/providers/yfinance/pull', {
    method: 'POST', headers, body: JSON.stringify({ personalUse: true })
  }, 120000);
  validatePreview(preview);
  if (!preview.providerReport) throw new Error('Yahoo pull returned no validation report.');
  return preview;
}

export async function loadImportPreview(runId: string): Promise<ImportPreview> {
  const result = await request(`/imports/${encodeURIComponent(runId)}/preview`);
  validatePreview(result);
  return result;
}

export async function commitImport(id: string): Promise<ResearchState> {
  const state = await request(`/imports/${encodeURIComponent(id)}/commit`, { method: 'POST', headers: await mutationHeaders() });
  validateResearchState(state);
  return state;
}

export async function activateDataset(id: string): Promise<ResearchState> {
  const state = await request(`/datasets/${encodeURIComponent(id)}/activate`, { method: 'POST', headers: await mutationHeaders() });
  validateResearchState(state);
  return state;
}

export async function downloadDatabaseBackup(): Promise<void> {
  const response = await fetch('/api/backup', { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Database backup failed: HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\0') {
    throw new Error('Data service did not return a valid SQLite backup.');
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.sqlite3' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `econquest-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`;
  anchor.click();
  URL.revokeObjectURL(url);
}
import { MacroSummary, validMacroSummary } from './imfApi';
import { WeoSummary, validWeoSummary } from './weoApi';
import { WorldBankSummary, validWorldBankSummary, validIdsSummary } from './worldbankApi';
import { ComtradeSummary, validComtradeSummary } from './comtradeApi';
import { GdeltSummary, validGdeltSummary } from './gdeltApi';
import { AcledSummary, validAcledSummary } from './acledApi';
import { FredSummary, validFredSummary } from './fredApi';
import { BisSummary, validBisSummary } from './bisApi';
