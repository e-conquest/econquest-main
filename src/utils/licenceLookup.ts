/**
 * Licence class for a figure, read from its source text.
 *
 * Every figure in the app carries a free-text source ("IMF WEO, 2025", "official, OECD via FRED,
 * Sep 2026", "model: IMF reserves over IMF BOP imports ..."). This maps that text to the rows of the
 * licence register (src/data/dataLicences.ts) it names. A figure worked out from several sources
 * (a model reading) takes the strictest class of its inputs, because the terms of every input
 * still apply to it. A source the register does not name is reported as not mapped, never guessed.
 *
 * Browser-safe.
 */
import { DATA_LICENCES, LICENCE_STATUS_LABEL, type LicenceRow, type LicenceShare, type LicenceStatus } from '../data/dataLicences';

/** Register id and the words in a source text that name it. */
const SOURCE_PATTERNS: Array<[string, RegExp]> = [
  ['imf', /\bIMF\b|World Economic Outlook|Fiscal Monitor|\bCOFER\b|DataMapper/i],
  ['comtrade', /Comtrade/i],
  ['wits', /\bWITS\b/],
  ['bis', /\bBIS\b/],
  ['ecb', /\bECB\b|Frankfurter/i],
  ['erapi', /ExchangeRate-API|er-api\.com/i],
  ['nyfed', /\bNY Fed\b|New York Fed|\bEFFR\b|\bSOFR\b/i],
  ['fred', /\bFRED\b/],
  ['oecd', /\bOECD\b(?! via FRED)|DBnomics/i],
  ['eurostat', /Eurostat|\bHICP\b/i],
  ['cftc', /\bCFTC\b/i],
  ['tic', /\bTIC\b|Treasury International Capital/],
  ['eia', /\bEIA\b/],
  ['gdelt', /GDELT/i],
  ['ucdp', /\bUCDP\b|Uppsala Conflict/i],
  ['ofac', /\bOFAC\b/],
  ['gpr', /Caldara|Iacoviello|Geopolitical Risk index/i],
  ['unsc', /UN Security Council|\bUNSC\b/],
  ['polymarket', /Polymarket/i],
  ['kalshi', /Kalshi/i],
  ['bcrp', /\bBCRP\b|\bEMBI|Banco Central de Reserva del Per/i],
  ['trm_colombia', /\bTRM\b|Superintendencia Financiera|datos\.gov\.co/i],
  ['boc_boe', /BoC-BoE|Sovereign Default Database/i],
  ['bcra', /\bBCRA\b|Banco Central de la Rep[uú]blica Argentina/i],
  ['bcb', /Banco Central do Brasil|\bBCB\b|\bSGS\b|\bIPCA\b/],
  ['tesouro', /Tesouro/i],
  ['banxico', /Banxico|Banco de México|\bSIE\b/],
  ['acled', /\bACLED\b/],
  ['evds', /\bEVDS\b|\bTCMB\b/],
  ['own', /\byour (own|holdings|connector)\b|\bLSEG\b|\byour \S+ data\b/i],
  ['pinksheet', /Pink Sheet|pink_sheet/i],
  ['worldbank', /World Bank|\bWGI\b|\bWDI\b|\bIDS\b|\bQEDS\b/],
];

/** Strictest first: a figure takes the first of these that any of its sources has. */
const STRICTNESS: LicenceStatus[] = ['permission', 'not_verified', 'conditions', 'open'];

const BY_ID = new Map(DATA_LICENCES.map((r) => [r.id, r]));

export interface FigureLicence {
  /** The strictest class among the register rows the source names. */
  status: LicenceStatus;
  label: string;
  /** Every register row the source names, in register order. */
  rows: LicenceRow[];
}

/** Register rows named in a source text, in register order. Empty when none is named. */
export function licenceRowsForSource(source: string | undefined): LicenceRow[] {
  const s = (source || '').trim();
  if (!s) return [];
  const ids = new Set(SOURCE_PATTERNS.filter(([, re]) => re.test(s)).map(([id]) => id));
  return DATA_LICENCES.filter((r) => ids.has(r.id));
}

/** The licence class of a figure from its source text, or null when the register names none of its sources. */
export function licenceForSource(source: string | undefined): FigureLicence | null {
  const rows = licenceRowsForSource(source);
  if (!rows.length) return null;
  const status = STRICTNESS.find((st) => rows.some((r) => r.status === st)) as LicenceStatus;
  return { status, label: LICENCE_STATUS_LABEL[status], rows };
}

const SHARE_STRICTNESS: LicenceShare[] = ['restricted', 'unclear', 'allowed'];

/**
 * Whether the figure may be passed on for free (the register's `share` field), strictest of the
 * sources it names; null when it names none (the app's own calculation).
 */
export function shareForSource(source: string | undefined): { share: LicenceShare; rows: LicenceRow[] } | null {
  const rows = licenceRowsForSource(source);
  if (!rows.length) return null;
  const share = SHARE_STRICTNESS.find((sh) => rows.some((r) => r.share === sh)) as LicenceShare;
  return { share, rows };
}

/** Short text for a table cell or a references line. */
export function licenceLabelForSource(source: string | undefined): string {
  const lic = licenceForSource(source);
  return lic ? lic.label : 'Not in the licence register';
}

/** True when the source's terms let the figure be shown to clients (open, or allowed with conditions). */
export function clientSafeStatus(status: LicenceStatus): boolean {
  return status === 'open' || status === 'conditions';
}

/** A register row by id (for tests and the About dialog). */
export function licenceRow(id: string): LicenceRow | undefined {
  return BY_ID.get(id);
}
