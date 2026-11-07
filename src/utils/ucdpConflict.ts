/**
 * UCDP conflict data (Uppsala Conflict Data Program), from the CSV files downloaded from
 * https://ucdp.uu.se/downloads/ (Sam, 2026-11-06: "use downloaded csvs", no live API pulls).
 *
 * The 26.1 release is shipped in datasets/ucdp/; newer downloads (the .zip as downloaded, or the .csv
 * inside) go in data/local/ucdp/. Each file is recognised by its columns, not its name, so a new yearly release (26.1, 27.1, ...) reads the same:
 *
 * - UCDP/PRIO Armed Conflict Dataset (UcdpPrioConflict_v26_1.csv): every state-based armed
 *   conflict per year since 1946, with its intensity (1 = 25 to 999 battle deaths, 2 = 1,000+) and
 *   type (extrasystemic, interstate, intrastate, internationalised intrastate).
 * - UCDP Battle-Related Deaths, conflict level (BattleDeaths_v26_1_conf.csv): battle deaths per
 *   state-based conflict per year since 1989 (best, low, high), with where the battles were.
 * - UCDP Non-State Conflict (NonState_v26_1.csv): deaths in fighting between armed groups, neither
 *   of them a government, per year since 1989.
 * - UCDP One-Sided Violence (OneSided_v26_1.csv): deaths of civilians killed deliberately by a
 *   government or an armed group, per year since 1989.
 * - UCDP Dyadic Dataset (Dyadic_v26_1.csv): each pair of warring sides per year since 1946.
 *
 * Only per-country, per-year totals are kept. Nothing is estimated: a country UCDP codes with no
 * rows in a year had no conflict UCDP recorded that year (a real zero, since UCDP codes the whole
 * world); a dataset not on disk makes its figures Missing with the reason.
 *
 * UCDP counts organised violence only, where a conflict or actor reached 25 deaths in a calendar
 * year. Protests, riots below that bar and crime are not in it.
 */

export const UCDP_SHORT = 'UCDP';
export const UCDP_DOWNLOADS_PAGE = 'https://ucdp.uu.se/downloads/';
export const UCDP_FOLDER = 'data/local/ucdp/';
export const UCDP_SCOPE = 'organised violence only, in conflicts or by actors that reached 25 deaths in a calendar year';
export const UCDP_CITATION =
  'UCDP, Uppsala University (ucdp.uu.se), CC BY 4.0. Davies, Pettersson & Öberg (2026), "Organized violence 1989-2025", Journal of Peace Research; Gleditsch et al. (2002), "Armed Conflict 1946-2001: A New Dataset", Journal of Peace Research 39(5).';
export const UCDP_MULTI_NOTE = 'a conflict fought in more than one country counts in each of them';

export type UcdpDatasetId = 'acd' | 'brd' | 'nonstate' | 'onesided' | 'dyadic';

export const UCDP_DATASETS: Record<UcdpDatasetId, { name: string; file: string; from: number }> = {
  acd: { name: 'UCDP/PRIO Armed Conflict Dataset', file: 'UcdpPrioConflict_v<version>.csv', from: 1946 },
  brd: { name: 'UCDP Battle-Related Deaths (conflict level)', file: 'BattleDeaths_v<version>_conf.csv', from: 1989 },
  nonstate: { name: 'UCDP Non-State Conflict', file: 'NonState_v<version>.csv', from: 1989 },
  onesided: { name: 'UCDP One-Sided Violence', file: 'OneSided_v<version>.csv', from: 1989 },
  dyadic: { name: 'UCDP Dyadic Dataset', file: 'Dyadic_v<version>.csv', from: 1946 },
};
export const UCDP_DATASET_IDS = Object.keys(UCDP_DATASETS) as UcdpDatasetId[];

/* ------------------------------------------------------------------------------------------
 * Country codes. UCDP writes countries as Gleditsch-Ward numbers, several in one cell when a
 * conflict spans countries ("750, 770").
 * ------------------------------------------------------------------------------------------ */

export const GW_TO_ISO3: Record<number, string> = {
  2: 'USA', 20: 'CAN', 40: 'CUB', 41: 'HTI', 42: 'DOM', 51: 'JAM', 52: 'TTO', 70: 'MEX', 90: 'GTM', 91: 'HND',
  92: 'SLV', 93: 'NIC', 94: 'CRI', 95: 'PAN', 100: 'COL', 101: 'VEN', 110: 'GUY', 115: 'SUR', 130: 'ECU', 135: 'PER',
  140: 'BRA', 145: 'BOL', 150: 'PRY', 155: 'CHL', 160: 'ARG', 165: 'URY',
  200: 'GBR', 205: 'IRL', 210: 'NLD', 211: 'BEL', 220: 'FRA', 225: 'CHE', 230: 'ESP', 235: 'PRT', 255: 'DEU', 260: 'DEU',
  290: 'POL', 305: 'AUT', 310: 'HUN', 316: 'CZE', 317: 'SVK', 325: 'ITA', 339: 'ALB', 340: 'SRB', 341: 'MNE', 343: 'MKD',
  344: 'HRV', 345: 'SRB', 346: 'BIH', 347: 'XKX', 349: 'SVN', 350: 'GRC', 352: 'CYP', 355: 'BGR', 359: 'MDA', 360: 'ROU',
  365: 'RUS', 366: 'EST', 367: 'LVA', 368: 'LTU', 369: 'UKR', 370: 'BLR', 371: 'ARM', 372: 'GEO', 373: 'AZE', 375: 'FIN',
  380: 'SWE', 385: 'NOR', 390: 'DNK',
  404: 'GNB', 420: 'GMB', 432: 'MLI', 433: 'SEN', 434: 'BEN', 435: 'MRT', 436: 'NER', 437: 'CIV', 438: 'GIN', 439: 'BFA',
  450: 'LBR', 451: 'SLE', 452: 'GHA', 461: 'TGO', 471: 'CMR', 475: 'NGA', 481: 'GAB', 482: 'CAF', 483: 'TCD', 484: 'COG',
  490: 'COD', 500: 'UGA', 501: 'KEN', 510: 'TZA', 516: 'BDI', 517: 'RWA', 520: 'SOM', 522: 'DJI', 530: 'ETH', 531: 'ERI',
  540: 'AGO', 541: 'MOZ', 551: 'ZMB', 552: 'ZWE', 553: 'MWI', 560: 'ZAF', 565: 'NAM', 570: 'LSO', 571: 'BWA', 572: 'SWZ',
  580: 'MDG',
  600: 'MAR', 615: 'DZA', 616: 'TUN', 620: 'LBY', 625: 'SDN', 626: 'SSD', 630: 'IRN', 640: 'TUR', 645: 'IRQ', 651: 'EGY',
  652: 'SYR', 660: 'LBN', 663: 'JOR', 666: 'ISR', 670: 'SAU', 678: 'YEM', 690: 'KWT', 692: 'BHR', 694: 'QAT', 696: 'ARE',
  698: 'OMN',
  700: 'AFG', 701: 'TKM', 702: 'TJK', 703: 'KGZ', 704: 'UZB', 705: 'KAZ', 710: 'CHN', 712: 'MNG', 713: 'TWN', 731: 'PRK',
  732: 'KOR', 740: 'JPN', 750: 'IND', 770: 'PAK', 771: 'BGD', 775: 'MMR', 780: 'LKA', 790: 'NPL', 800: 'THA', 811: 'KHM',
  812: 'LAO', 816: 'VNM', 820: 'MYS', 830: 'SGP', 840: 'PHL', 850: 'IDN', 860: 'TLS',
  900: 'AUS', 910: 'PNG', 920: 'NZL', 940: 'SLB', 950: 'FJI',
  // Small states that appear in UCDP rows.
  55: 'GRD', 338: 'MLT', 581: 'COM', 760: 'BTN', 835: 'BRN',
  // States that no longer exist, counted under the country that holds the territory now (as 260
  // West Germany and 345 Yugoslavia above): 680 South Yemen (1967-1990), 751 Hyderabad (1948),
  // 817 South Vietnam (1954-1975).
  680: 'YEM', 751: 'IND', 817: 'VNM',
};

/** Countries the app shows that UCDP folds into another country. */
export const UCDP_NOT_SEPARATE: Record<string, string> = {
  HKG: 'UCDP has no separate code for Hong Kong; conflict there counts under China.',
  PSE: 'UCDP codes the Palestinian territories under Israel (Gleditsch-Ward 666).',
};

export const ISO3_IN_UCDP = new Set(Object.values(GW_TO_ISO3));

/** ISO3 codes in a Gleditsch-Ward cell such as "750, 770"; unknown codes are returned apart. */
export function gwCell(cell: string | undefined): { iso3: string[]; unknown: number[] } {
  const iso3: string[] = [];
  const unknown: number[] = [];
  for (const part of String(cell || '').split(',')) {
    const t = part.trim();
    if (!/^\d+$/.test(t)) continue;
    const iso = GW_TO_ISO3[Number(t)];
    if (iso) {
      if (!iso3.includes(iso)) iso3.push(iso);
    } else unknown.push(Number(t));
  }
  return { iso3, unknown };
}

/* ------------------------------------------------------------------------------------------
 * CSV. UCDP cells carry quoted names with commas.
 * ------------------------------------------------------------------------------------------ */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

type Row = Record<string, string>;

/** A UCDP event file (Candidate monthly, or the yearly GED in the same format): read as candidate events. */
export function isCandidateHeader(header: string[]): boolean {
  const h = new Set(header.map((x) => x.trim().toLowerCase()));
  return ['id', 'type_of_violence', 'country_id', 'date_start', 'best'].every((k) => h.has(k));
}

/** Which UCDP dataset a header belongs to, from its columns. */
export function detectDataset(header: string[]): UcdpDatasetId | null {
  const h = new Set(header.map((x) => x.trim().toLowerCase()));
  if (h.has('bd_best')) return 'brd';
  if (h.has('cumulative_intensity') && h.has('intensity_level')) return 'acd';
  if (h.has('best_fatality_estimate') && h.has('actor_id')) return 'onesided';
  if (h.has('best_fatality_estimate') && h.has('org')) return 'nonstate';
  if (h.has('dyad_id') && h.has('intensity_level') && h.has('gwno_loc')) return 'dyadic';
  return null;
}

/* ------------------------------------------------------------------------------------------
 * Per-country, per-year totals.
 * ------------------------------------------------------------------------------------------ */

export interface Deaths {
  best: number;
  low: number;
  high: number;
  /** Conflicts (or actors, for one-sided violence) behind the figure. */
  n: number;
}
const emptyDeaths = (): Deaths => ({ best: 0, low: 0, high: 0, n: 0 });

export const CONFLICT_TYPES: Record<string, string> = { '1': 'extrasystemic', '2': 'interstate', '3': 'intrastate', '4': 'internationalised intrastate' };

export interface CountryYear {
  /** Armed conflicts located in the country (UCDP/PRIO ACD). */
  conflicts?: { n: number; wars: number; types: Record<string, number>; opponents: string[] };
  /** Armed conflicts elsewhere in which the country's government is a side, primary or supporting. */
  abroad?: { n: number; places: string[] };
  stateBased?: Deaths;
  nonState?: Deaths;
  oneSided?: Deaths;
  /** Pairs of warring sides in conflicts located in the country (Dyadic). */
  dyads?: number;
}

export interface UcdpFileInfo {
  dataset: UcdpDatasetId;
  file: string;
  version: string;
  rows: number;
  minYear: number;
  maxYear: number;
}

export interface UcdpData {
  files: Partial<Record<UcdpDatasetId, UcdpFileInfo>>;
  /** ISO3 -> year -> totals. */
  countries: Record<string, Record<string, CountryYear>>;
  /** Codes the app has no country for, with the rows that named them. */
  unknownCodes: Record<string, number>;
  /** Files in the folder that were not read, with why. */
  skipped: Array<{ file: string; reason: string }>;
  /** UCDP Candidate Events (monthly, preliminary), kept apart from the yearly totals. */
  candidate?: CandidateStore;
}

export const emptyUcdpData = (): UcdpData => ({ files: {}, countries: {}, unknownCodes: {}, skipped: [] });

/* ------------------------------------------------------------------------------------------
 * UCDP Candidate Events (gap analysis D8): the monthly, preliminary event files UCDP publishes
 * between yearly releases (GEDEvent_v26_0_9.csv for September 2026, or the cumulative
 * GEDEvent_v26_01_26_09.csv), same columns as the yearly GED. Columns read: id, type_of_violence
 * (1 state-based, 2 non-state, 3 one-sided), country_id (Gleditsch-Ward), date_start, best, low,
 * high, code_status ("Clear", or a "Check ..." flag for events kept with higher uncertainty). An
 * event can sit in two monthly files and in the cumulative one: it is counted once, by id, the
 * later file name winning. Each event counts in the month of date_start. Only months after the
 * latest year of the yearly files are shown, labelled preliminary; they never enter the yearly
 * totals, the tests or the scorecard. Codebook: ucdp.uu.se/downloads/candidateged/ (v1.5).
 * ------------------------------------------------------------------------------------------ */

export const UCDP_CANDIDATE_NAME = 'UCDP Candidate Events (monthly, preliminary)';
export const UCDP_CANDIDATE_FILE = 'GEDEvent_v<yy>_0_<m>.csv';

interface CandidateEvent {
  iso3: string;
  month: string;
  type: 1 | 2 | 3;
  best: number;
  low: number;
  high: number;
  check: boolean;
}

export interface CandidateStore {
  files: string[];
  /** Release labels from the file names, e.g. "26.0.9". */
  versions: string[];
  events: Map<string, CandidateEvent>;
}

/** "GEDEvent_v26_0_9.csv" -> "26.0.9"; "GEDEvent_v26_01_26_09.csv" -> "26.01.26.09". */
export function candidateVersion(file: string): string {
  const m = file.match(/v(\d+(?:_\d+)+)/i);
  return m ? m[1].replace(/_/g, '.') : '';
}

function addCandidate(data: UcdpData, file: string, header: string[], rows: string[][]): boolean {
  const at = (k: string) => header.indexOf(k);
  const [iId, iType, iCountry, iStart, iBest, iLow, iHigh, iStatus] = ['id', 'type_of_violence', 'country_id', 'date_start', 'best', 'low', 'high', 'code_status'].map(at);
  const store: CandidateStore = (data.candidate ||= { files: [], versions: [], events: new Map() });
  let read = 0;
  for (const r of rows) {
    const id = (r[iId] || '').trim();
    const month = (r[iStart] || '').trim().slice(0, 7);
    const type = Number((r[iType] || '').trim());
    if (!id || !/^\d{4}-\d{2}$/.test(month) || ![1, 2, 3].includes(type)) continue;
    const loc = gwCell(r[iCountry]);
    for (const c of loc.unknown) data.unknownCodes[String(c)] = (data.unknownCodes[String(c)] || 0) + 1;
    const iso3 = loc.iso3[0];
    if (!iso3) continue;
    read++;
    store.events.set(id, {
      iso3,
      month,
      type: type as 1 | 2 | 3,
      best: num(r[iBest]),
      low: num(r[iLow]),
      high: num(r[iHigh]),
      check: iStatus >= 0 && !/^clear$/i.test((r[iStatus] || '').trim()),
    });
  }
  if (!read) {
    data.skipped.push({ file, reason: 'no candidate events with a date and a known country' });
    return false;
  }
  store.files.push(file);
  const v = candidateVersion(file);
  if (v && !store.versions.includes(v)) store.versions.push(v);
  return true;
}

export interface CandidateMonth {
  month: string;
  stateBased: number;
  nonState: number;
  oneSided: number;
  total: number;
  low: number;
  high: number;
  events: number;
  /** Events UCDP flags "Check ..." (kept with higher uncertainty). */
  flagged: number;
}

export interface CandidateReading {
  versions: string[];
  /** Months after the yearly release, oldest first. Months with no event in the country are zeros up to the last month in the files. */
  months: CandidateMonth[];
  from: string;
  to: string;
}

/** Candidate months for one country after `afterYear` (the yearly release's last year). */
export function candidateReading(data: UcdpData | null | undefined, iso3: string, afterYear: number | null): CandidateReading | null {
  const store = data?.candidate;
  if (!store || !store.events.size) return null;
  const iso = String(iso3 || '').toUpperCase();
  const firstMonth = afterYear === null ? '' : `${afterYear + 1}-01`;
  let last = '';
  for (const e of store.events.values()) if (e.month >= firstMonth && e.month > last) last = e.month;
  if (!last) return null;
  let first = last;
  for (const e of store.events.values()) if (e.month >= firstMonth && e.month < first) first = e.month;
  const byMonth = new Map<string, CandidateMonth>();
  const blank = (month: string): CandidateMonth => ({ month, stateBased: 0, nonState: 0, oneSided: 0, total: 0, low: 0, high: 0, events: 0, flagged: 0 });
  for (let [y, m] = first.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    byMonth.set(k, blank(k));
  }
  for (const e of store.events.values()) {
    if (e.iso3 !== iso || !byMonth.has(e.month)) continue;
    const b = byMonth.get(e.month)!;
    if (e.type === 1) b.stateBased += e.best;
    else if (e.type === 2) b.nonState += e.best;
    else b.oneSided += e.best;
    b.total += e.best;
    b.low += e.low;
    b.high += e.high;
    b.events++;
    if (e.check) b.flagged++;
  }
  return { versions: [...store.versions], months: [...byMonth.values()], from: first, to: last };
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Adds one CSV file to the totals. Returns the dataset it was, or null (with the reason in
 * data.skipped) when it is not a UCDP file the app reads.
 */
export function addUcdpCsv(data: UcdpData, file: string, text: string): UcdpDatasetId | 'candidate' | null {
  const rows = parseCsv(text);
  if (!rows.length) {
    data.skipped.push({ file, reason: 'empty file' });
    return null;
  }
  const header = rows[0].map((x) => x.trim().toLowerCase());
  if (isCandidateHeader(header)) return addCandidate(data, file, header, rows.slice(1)) ? 'candidate' : null;
  const dataset = detectDataset(header);
  if (!dataset) {
    data.skipped.push({ file, reason: 'not one of the UCDP files the app reads (armed conflict, battle deaths, non-state, one-sided, dyadic, candidate events)' });
    return null;
  }
  const prior = data.files[dataset];
  const recs: Row[] = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  const version = recs.find((r) => r.version)?.version.trim() || '';
  if (prior && compareVersions(prior.version, version) >= 0) {
    data.skipped.push({ file, reason: `an equal or newer ${UCDP_DATASETS[dataset].name} (${prior.version}, ${prior.file}) is already read` });
    return null;
  }
  if (prior) {
    // A newer release replaces the older one: drop what the older one added.
    for (const years of Object.values(data.countries)) for (const cy of Object.values(years)) clearDataset(cy, dataset);
    data.skipped.push({ file: prior.file, reason: `replaced by the newer ${version} release (${file})` });
  }
  let minYear = Infinity;
  let maxYear = -Infinity;
  let read = 0;
  const cy = (iso: string, year: string): CountryYear => ((data.countries[iso] ||= {})[year] ||= {});
  const unknown = (codes: number[]) => {
    for (const c of codes) data.unknownCodes[String(c)] = (data.unknownCodes[String(c)] || 0) + 1;
  };
  for (const r of recs) {
    const year = r.year?.trim();
    if (!/^\d{4}$/.test(year || '')) continue;
    read++;
    minYear = Math.min(minYear, Number(year));
    maxYear = Math.max(maxYear, Number(year));
    if (dataset === 'acd') {
      const loc = gwCell(r.gwno_loc);
      unknown(loc.unknown);
      for (const iso of loc.iso3) {
        const c = (cy(iso, year!).conflicts ||= { n: 0, wars: 0, types: {}, opponents: [] });
        c.n++;
        if (r.intensity_level?.trim() === '2') c.wars++;
        const type = CONFLICT_TYPES[r.type_of_conflict?.trim()] || 'other';
        c.types[type] = (c.types[type] || 0) + 1;
        const opp = (r.side_b || '').trim();
        if (opp && !c.opponents.includes(opp)) c.opponents.push(opp);
      }
      // Sides: the governments on side A and B, and their supporters.
      const sides = new Set([...gwCell(r.gwno_a).iso3, ...gwCell(r.gwno_b).iso3, ...gwCell(r.gwno_a_2nd).iso3, ...gwCell(r.gwno_b_2nd).iso3]);
      for (const iso of sides) {
        if (loc.iso3.includes(iso)) continue;
        const a = (cy(iso, year!).abroad ||= { n: 0, places: [] });
        a.n++;
        const place = (r.location || '').trim();
        if (place && !a.places.includes(place)) a.places.push(place);
      }
    } else if (dataset === 'dyadic') {
      const loc = gwCell(r.gwno_loc);
      unknown(loc.unknown);
      for (const iso of loc.iso3) {
        const c = cy(iso, year!);
        c.dyads = (c.dyads || 0) + 1;
      }
    } else {
      const isBrd = dataset === 'brd';
      // Battle deaths: where the battles were; otherwise where the violence took place.
      const where = gwCell(isBrd ? r.gwno_battle || r.gwno_loc : r.gwno_location);
      unknown(where.unknown);
      const best = num(isBrd ? r.bd_best : r.best_fatality_estimate);
      const low = num(isBrd ? r.bd_low : r.low_fatality_estimate);
      const high = num(isBrd ? r.bd_high : r.high_fatality_estimate);
      const key = isBrd ? 'stateBased' : dataset === 'nonstate' ? 'nonState' : 'oneSided';
      for (const iso of where.iso3) {
        const d = ((cy(iso, year!) as Record<string, Deaths>)[key] ||= emptyDeaths());
        d.best += best;
        d.low += low;
        d.high += high;
        d.n++;
      }
    }
  }
  if (!read) {
    data.skipped.push({ file, reason: 'no rows with a year' });
    return null;
  }
  data.files[dataset] = { dataset, file, version, rows: read, minYear, maxYear };
  return dataset;
}

function clearDataset(c: CountryYear, d: UcdpDatasetId): void {
  if (d === 'acd') {
    delete c.conflicts;
    delete c.abroad;
  } else if (d === 'brd') delete c.stateBased;
  else if (d === 'nonstate') delete c.nonState;
  else if (d === 'onesided') delete c.oneSided;
  else delete c.dyads;
}

/** "26.1" vs "25.1": positive when a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------
 * The reading for one country.
 * ------------------------------------------------------------------------------------------ */

export interface UcdpYearFigures {
  year: number;
  conflicts?: CountryYear['conflicts'];
  abroad?: CountryYear['abroad'];
  stateBased?: Deaths;
  nonState?: Deaths;
  oneSided?: Deaths;
  dyads?: number;
  /** State-based + non-state + one-sided best estimates; only when all three files are read. */
  totalBest?: number;
}

export interface UcdpReading {
  iso3: string;
  /** Releases read, e.g. { acd: '26.1', brd: '26.1' }. */
  versions: Partial<Record<UcdpDatasetId, string>>;
  latest: UcdpYearFigures;
  /** The three years before the latest, newest first. */
  prior: UcdpYearFigures[];
  /** Datasets not on disk, so their figures are missing. */
  missingDatasets: UcdpDatasetId[];
  /** Preliminary months after the yearly release, when Candidate event files are added. */
  candidate?: CandidateReading;
}

function yearFigures(data: UcdpData, iso: string, year: number): UcdpYearFigures {
  const c = data.countries[iso]?.[String(year)] || {};
  const has = (d: UcdpDatasetId) => {
    const f = data.files[d];
    return !!f && year >= f.minYear && year <= f.maxYear;
  };
  const out: UcdpYearFigures = { year };
  if (has('acd')) {
    out.conflicts = c.conflicts || { n: 0, wars: 0, types: {}, opponents: [] };
    out.abroad = c.abroad || { n: 0, places: [] };
  }
  if (has('brd')) out.stateBased = c.stateBased || emptyDeaths();
  if (has('nonstate')) out.nonState = c.nonState || emptyDeaths();
  if (has('onesided')) out.oneSided = c.oneSided || emptyDeaths();
  if (has('dyadic')) out.dyads = c.dyads || 0;
  if (out.stateBased && out.nonState && out.oneSided) out.totalBest = out.stateBased.best + out.nonState.best + out.oneSided.best;
  return out;
}

/** Latest year any file read covers. */
export function latestUcdpYear(data: UcdpData): number | null {
  const ys = Object.values(data.files).map((f) => f!.maxYear);
  return ys.length ? Math.max(...ys) : null;
}

/** The reading for one country, or null when no file is read or UCDP has no code for it. */
export function ucdpReading(data: UcdpData | null | undefined, iso3: string): UcdpReading | null {
  if (!data) return null;
  const iso = String(iso3 || '').toUpperCase();
  const latest = latestUcdpYear(data);
  if (latest === null || !ISO3_IN_UCDP.has(iso)) return null;
  return {
    iso3: iso,
    versions: Object.fromEntries(Object.entries(data.files).map(([k, f]) => [k, f!.version])),
    latest: yearFigures(data, iso, latest),
    prior: [1, 2, 3].map((k) => yearFigures(data, iso, latest - k)),
    missingDatasets: UCDP_DATASET_IDS.filter((d) => !data.files[d]),
    ...(() => {
      const c = candidateReading(data, iso, latest);
      return c ? { candidate: c } : {};
    })(),
  };
}

/** Why a country has no UCDP reading, as a short phrase and a line of help. */
export function ucdpMissing(data: UcdpData | null | undefined, iso3: string): { short: string; help: string } {
  const iso = String(iso3 || '').toUpperCase();
  if (UCDP_NOT_SEPARATE[iso]) return { short: 'not a separate country in UCDP', help: UCDP_NOT_SEPARATE[iso] };
  if (!ISO3_IN_UCDP.has(iso)) return { short: 'no UCDP country code for this country in the app', help: 'The app maps UCDP Gleditsch-Ward codes to countries; this one is not in its table.' };
  if (!data || latestUcdpYear(data) === null)
    return {
      short: 'UCDP files not added',
      help: `The UCDP files shipped in datasets/ucdp/ were not found. Download the UCDP CSV files from ${UCDP_DOWNLOADS_PAGE} and put them (zipped or not) in ${UCDP_FOLDER}.`,
    };
  return { short: 'UCDP figures not read', help: 'The UCDP files were read but did not fill this country.' };
}

/** One line on what a missing dataset leaves out. */
export function missingDatasetNote(d: UcdpDatasetId): string {
  return `${UCDP_DATASETS[d].name} not added (${UCDP_DATASETS[d].file} in ${UCDP_FOLDER})`;
}

/* ------------------------------------------------------------------------------------------
 * Words.
 * ------------------------------------------------------------------------------------------ */

/** UCDP's own thresholds, as UCDP codes them in the armed conflict dataset. */
export const UCDP_INTENSITY_RULE =
  "UCDP's intensity coding: war = 1,000 or more battle deaths in the year, minor armed conflict = 25 to 999";
export type Intensity = 'war' | 'minor armed conflict' | 'no armed conflict';
export function intensityOf(c: { n: number; wars: number }): Intensity {
  return c.wars > 0 ? 'war' : c.n > 0 ? 'minor armed conflict' : 'no armed conflict';
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const deathsText = (d: Deaths) => `${n0(d.best)}${d.low !== d.best || d.high !== d.best ? ` (range ${n0(d.low)} to ${n0(d.high)})` : ''}`;
const versionText = (r: UcdpReading, d: UcdpDatasetId) => `${UCDP_DATASETS[d].name}${r.versions[d] ? ` ${r.versions[d]}` : ''}`;

export interface UcdpFigure {
  label: string;
  value: string;
  source: string;
  tag: 'official' | 'model';
}

/** Figures and plain sentences for the Politics & Events Agent and the Sources tab. */
export function ucdpFigures(r: UcdpReading): { figures: UcdpFigure[]; sentences: string[]; weight: number; missing: string[] } {
  const figures: UcdpFigure[] = [];
  const sentences: string[] = [];
  const missing = r.missingDatasets.map(missingDatasetNote);
  let weight = 0;
  const L = r.latest;
  const y = L.year;
  if (L.conflicts) {
    const c = L.conflicts;
    const level = intensityOf(c);
    const types = Object.entries(c.types).map(([t, k]) => `${k} ${t}`).join(', ');
    figures.push({
      label: `Armed conflicts in the country, ${y}`,
      value: c.n ? `${c.n} (${types}); ${c.wars} at war intensity; against ${c.opponents.slice(0, 4).join(', ')}${c.opponents.length > 4 ? ` and ${c.opponents.length - 4} more` : ''}` : 'none recorded',
      source: `${versionText(r, 'acd')}; state-based conflicts with at least 25 battle deaths in the year; ${UCDP_MULTI_NOTE}`,
      tag: 'official',
    });
    figures.push({ label: `Conflict intensity, ${y}`, value: level, source: `Rule: ${UCDP_INTENSITY_RULE}`, tag: 'model' });
    if (level === 'war') weight = 0.8;
    else if (level === 'minor armed conflict') weight = 0.5;
    sentences.push(c.n ? `UCDP records ${c.n} armed conflict${c.n === 1 ? '' : 's'} in the country in ${y} (${level}).` : `UCDP records no armed conflict in the country in ${y}.`);
    const before = r.prior.filter((p) => p.conflicts).map((p) => `${p.year}: ${p.conflicts!.n}`);
    if (before.length) figures.push({ label: 'Armed conflicts, years before', value: before.join(', '), source: versionText(r, 'acd'), tag: 'official' });
  }
  if (L.abroad && L.abroad.n) {
    figures.push({
      label: `Side in armed conflicts elsewhere, ${y}`,
      value: `${L.abroad.n} (${L.abroad.places.slice(0, 5).join('; ')})`,
      source: `${versionText(r, 'acd')}; the government as a primary or supporting side in a conflict located in another country`,
      tag: 'official',
    });
    sentences.push(`The government is a side in ${L.abroad.n} armed conflict${L.abroad.n === 1 ? '' : 's'} located elsewhere.`);
  }
  const deathRows: Array<[string, Deaths | undefined, UcdpDatasetId, string]> = [
    ['Battle deaths, state-based conflict', L.stateBased, 'brd', `where the battles took place; ${UCDP_MULTI_NOTE}`],
    ['Deaths in non-state conflict', L.nonState, 'nonstate', 'fighting between armed groups, neither of them a government'],
    ['Deaths in one-sided violence against civilians', L.oneSided, 'onesided', 'civilians killed deliberately by a government or an armed group'],
  ];
  for (const [label, d, ds, note] of deathRows) {
    if (!d) continue;
    figures.push({ label: `${label}, ${y}`, value: deathsText(d), source: `${versionText(r, ds)}; ${note}`, tag: 'official' });
  }
  if (L.totalBest !== undefined) {
    const prior = r.prior.filter((p) => p.totalBest !== undefined);
    figures.push({
      label: `Deaths from organised violence, ${y}`,
      value: `${n0(L.totalBest)}${prior.length ? ` (${prior.map((p) => `${p.year}: ${n0(p.totalBest!)}`).join(', ')})` : ''}`,
      source: `UCDP best estimates, state-based + non-state + one-sided; ${UCDP_SCOPE}`,
      tag: 'official',
    });
    const avg = prior.length ? prior.reduce((a, p) => a + p.totalBest!, 0) / prior.length : undefined;
    if (L.totalBest > 0) {
      let trend = '';
      if (avg !== undefined && (L.totalBest >= 25 || avg >= 25)) {
        if (L.totalBest >= 2 * Math.max(avg, 1)) trend = `, more than twice the ${prior.length}-year average before it (${n0(avg)})`;
        else if (L.totalBest <= 0.5 * avg) trend = `, under half the ${prior.length}-year average before it (${n0(avg)})`;
        else trend = `, against a ${prior.length}-year average of ${n0(avg)} before it`;
      }
      sentences.push(`UCDP counts ${n0(L.totalBest)} deaths from organised violence in ${y}${trend}.`);
      if (weight < 0.3 && L.totalBest >= 25) weight = 0.3;
      if (avg !== undefined && L.totalBest >= 100 && L.totalBest >= 2 * Math.max(avg, 1)) weight = Math.max(weight, 0.6);
    } else sentences.push(`UCDP counts no deaths from organised violence in ${y}.`);
  }
  if (r.candidate) {
    const c = r.candidate;
    const sum = (k: keyof CandidateMonth) => c.months.reduce((a, m) => a + (m[k] as number), 0);
    const total = sum('total');
    const flagged = sum('flagged');
    const last3 = c.months.slice(-3).map((m) => `${m.month}: ${n0(m.total)}`).join(', ');
    figures.push({
      label: `Deaths from organised violence since the yearly release, ${c.from} to ${c.to} (preliminary)`,
      value: `${n0(total)} (range ${n0(sum('low'))} to ${n0(sum('high'))}; state-based ${n0(sum('stateBased'))}, non-state ${n0(sum('nonState'))}, one-sided ${n0(sum('oneSided'))}); last months ${last3}${flagged ? `; ${flagged} events flagged for checking` : ''}`,
      source: `${UCDP_CANDIDATE_NAME} ${c.versions.join(', ')}; events not yet checked against the 25-death threshold for the year; revised in the next yearly release`,
      tag: 'official',
    });
    sentences.push(`Preliminary UCDP Candidate events count ${n0(total)} deaths from organised violence from ${c.from} to ${c.to}.`);
  }
  if (L.dyads) figures.push({ label: `Warring pairs of sides, ${y}`, value: String(L.dyads), source: `${versionText(r, 'dyadic')}; pairs in conflicts located in the country`, tag: 'official' });
  return { figures, sentences, weight, missing };
}

/** One line for the council's figure list. */
export function ucdpInputLine(r: UcdpReading | null, missing: { short: string }): string {
  if (!r) return `- UCDP armed conflict and conflict deaths: MISSING (${missing.short})`;
  const L = r.latest;
  const parts: string[] = [];
  if (L.conflicts) parts.push(`${L.conflicts.n} armed conflicts in the country (${L.conflicts.wars} at war intensity)`);
  if (L.abroad?.n) parts.push(`side in ${L.abroad.n} conflicts elsewhere`);
  if (L.stateBased) parts.push(`battle deaths ${deathsText(L.stateBased)}`);
  if (L.nonState) parts.push(`non-state conflict deaths ${deathsText(L.nonState)}`);
  if (L.oneSided) parts.push(`one-sided violence deaths ${deathsText(L.oneSided)}`);
  const prior = r.prior.filter((p) => p.totalBest !== undefined).map((p) => `${p.year}: ${n0(p.totalBest!)}`);
  if (L.totalBest !== undefined) parts.push(`total ${n0(L.totalBest)}${prior.length ? ` (${prior.join(', ')})` : ''}`);
  if (r.candidate) parts.push(`preliminary ${r.candidate.from} to ${r.candidate.to}: ${n0(r.candidate.months.reduce((a, m) => a + m.total, 0))} deaths (UCDP Candidate ${r.candidate.versions.join(', ')})`);
  const missingNote = r.missingDatasets.length ? `; not added: ${r.missingDatasets.map((d) => UCDP_DATASETS[d].name).join(', ')}` : '';
  return `- UCDP conflict, ${L.year}: ${parts.join('; ') || 'no figures'} (UCDP ${[...new Set(Object.values(r.versions))].join('/')} downloaded files${missingNote})`;
}
