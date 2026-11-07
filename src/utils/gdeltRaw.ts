/**
 * GDELT 2.0 raw files (Sam, 2026-11-05): the 15-minute files GDELT publishes at
 * data.gdeltproject.org/gdeltv2/ (listed in masterfilelist.txt, newest in lastupdate.txt), read
 * instead of the DOC API, which refuses with HTTP 429 when asked too often.
 *
 * Two tables are read:
 * - Events (YYYYMMDDHHMMSS.export.CSV.zip): who did what to whom, coded by CAMEO event type, with a
 *   Goldstein intensity score, tone and place. Counted per country per day: every event whose
 *   place (ActionGeo) is in the country, or whose first or second actor is the country.
 * - Global Knowledge Graph 2.1 (YYYYMMDDHHMMSS.gkg.csv.zip): one row per article, with its themes,
 *   the places, people and organisations it names, and its tone. Counted per country per day: every
 *   article that names a place in the country, split by economic theme group.
 *
 * This file is the parsing and adding up (browser-safe, no fs). utils/gdeltRawStore.ts downloads,
 * keeps one small file per day on disk and throws the raw files away.
 *
 * Nothing here is estimated: counts are what the files hold. Where only some GKG files are read
 * (one every few hours, to keep the download small), the figures shown are shares of the articles
 * read, and the share of files read is shown with them.
 */

/** GDELT writes a file set every 15 minutes, stamped YYYYMMDDHHMMSS (UTC) at :00, :15, :30, :45. */
export const SLOT_MS = 15 * 60 * 1000;
export const GDELT_RAW_BASE = 'https://data.gdeltproject.org/gdeltv2/';
export const GDELT_LAST_UPDATE_URL = `${GDELT_RAW_BASE}lastupdate.txt`;
export const GDELT_MASTER_LIST_URL = `${GDELT_RAW_BASE}masterfilelist.txt`;

export type GdeltRawTable = 'events' | 'gkg';

export function slotUrl(slot: string, table: GdeltRawTable): string {
  return `${GDELT_RAW_BASE}${slot}${table === 'events' ? '.export.CSV.zip' : '.gkg.csv.zip'}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function slotOf(ms: number): string {
  const d = new Date(Math.floor(ms / SLOT_MS) * SLOT_MS);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}
export function slotMs(slot: string): number {
  const m = slot.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
/** "20261105181500" -> "2026-11-05". */
export function slotDay(slot: string): string {
  return `${slot.slice(0, 4)}-${slot.slice(4, 6)}-${slot.slice(6, 8)}`;
}

/** Every slot from fromMs up to and including toSlot, oldest first. everyMinutes thins it (GKG). */
export function slotsBetween(fromMs: number, toSlot: string, everyMinutes = 15): string[] {
  const end = slotMs(toSlot);
  if (!Number.isFinite(end)) return [];
  const step = Math.max(15, Math.round(everyMinutes / 15) * 15) * 60 * 1000;
  const out: string[] = [];
  // Line the thinned slots up on whole steps from midnight UTC, so every run picks the same files.
  let t = Math.ceil(Math.max(fromMs, 0) / step) * step;
  for (; t <= end; t += step) out.push(slotOf(t));
  return out;
}

export interface GdeltFileEntry {
  size: number;
  md5: string;
  url: string;
  slot: string;
  table: GdeltRawTable | 'mentions' | 'other';
}

/** Lines of lastupdate.txt or masterfilelist.txt: "<bytes> <md5> <url>". Bad lines are skipped. */
export function parseFileList(text: string): GdeltFileEntry[] {
  const out: GdeltFileEntry[] = [];
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const size = Number(parts[0]);
    const url = parts[2];
    const m = url.match(/\/(\d{14})\.([a-z.]+)\.zip$/i);
    if (!Number.isFinite(size) || !m) continue;
    const kind = m[2].toLowerCase();
    const table = kind === 'export.csv' ? 'events' : kind === 'gkg.csv' ? 'gkg' : kind === 'mentions.csv' ? 'mentions' : 'other';
    out.push({ size, md5: parts[1], url, slot: m[1], table });
  }
  return out;
}

/**
 * Country codes. GDELT writes places (ActionGeo, GKG locations) in FIPS 10-4 codes, which differ
 * from ISO codes for many countries (Chile is CI, South Africa SF, Japan JA, the UK UK). Actors
 * carry CAMEO country codes, which are ISO3 for these countries.
 */
export const ISO3_TO_FIPS: Record<string, string> = {
  USA: 'US', CAN: 'CA', MEX: 'MX', BRA: 'BR', ARG: 'AR', CHL: 'CI', COL: 'CO', PER: 'PE', VEN: 'VE', ECU: 'EC',
  URY: 'UY', PRY: 'PA', BOL: 'BL', CRI: 'CS', PAN: 'PM', DOM: 'DR', GTM: 'GT', HND: 'HO', SLV: 'ES', NIC: 'NU',
  JAM: 'JM', CUB: 'CU', GBR: 'UK', IRL: 'EI', FRA: 'FR', DEU: 'GM', ITA: 'IT', ESP: 'SP', PRT: 'PO', NLD: 'NL',
  BEL: 'BE', CHE: 'SZ', AUT: 'AU', SWE: 'SW', NOR: 'NO', DNK: 'DA', FIN: 'FI', POL: 'PL', CZE: 'EZ', HUN: 'HU',
  ROU: 'RO', BGR: 'BU', GRC: 'GR', SRB: 'RI', HRV: 'HR', UKR: 'UP', RUS: 'RS', BLR: 'BO', TUR: 'TU', KAZ: 'KZ',
  UZB: 'UZ', AZE: 'AJ', GEO: 'GG', ARM: 'AM', ISR: 'IS', LBN: 'LE', SYR: 'SY', JOR: 'JO', IRQ: 'IZ', IRN: 'IR',
  SAU: 'SA', ARE: 'AE', QAT: 'QA', KWT: 'KU', OMN: 'MU', BHR: 'BA', YEM: 'YM', EGY: 'EG', LBY: 'LY', TUN: 'TS',
  DZA: 'AG', MAR: 'MO', NGA: 'NI', GHA: 'GH', CIV: 'IV', SEN: 'SG', KEN: 'KE', ETH: 'ET', TZA: 'TZ', UGA: 'UG',
  RWA: 'RW', AGO: 'AO', ZMB: 'ZA', ZWE: 'ZI', MOZ: 'MZ', ZAF: 'SF', NAM: 'WA', BWA: 'BC', SDN: 'SU', COD: 'CG',
  CMR: 'CM', CHN: 'CH', JPN: 'JA', KOR: 'KS', PRK: 'KN', TWN: 'TW', HKG: 'HK', IND: 'IN', PAK: 'PK', BGD: 'BG',
  LKA: 'CE', NPL: 'NP', IDN: 'ID', MYS: 'MY', THA: 'TH', VNM: 'VM', PHL: 'RP', SGP: 'SN', MMR: 'BM', KHM: 'CB',
  AUS: 'AS', NZL: 'NZ', MNG: 'MG', AFG: 'AF',
};
export const FIPS_TO_ISO3: Record<string, string> = Object.fromEntries(Object.entries(ISO3_TO_FIPS).map(([i, f]) => [f, i]));

export const CAMEO_ROOTS: Record<string, string> = {
  '01': 'Public statements', '02': 'Appeals', '03': 'Intent to cooperate', '04': 'Consultations',
  '05': 'Diplomatic cooperation', '06': 'Material cooperation', '07': 'Aid', '08': 'Concessions',
  '09': 'Investigations', '10': 'Demands', '11': 'Disapproval', '12': 'Rejections', '13': 'Threats',
  '14': 'Protests', '15': 'Shows of force', '16': 'Reduced relations', '17': 'Coercion',
  '18': 'Assaults', '19': 'Fighting', '20': 'Mass violence',
};
export const QUAD_CLASSES = ['Verbal cooperation', 'Material cooperation', 'Verbal conflict', 'Material conflict'] as const;

/** One country, one day (or one week once added up), from the events table. */
export interface EventAgg {
  /** Events counted. */
  n: number;
  /** Counts by quad class 1-4. */
  quad: [number, number, number, number];
  /** Counts by CAMEO root code "01".."20". */
  root: Record<string, number>;
  /** Root 14. */
  protests: number;
  /** Event code 163: impose embargo, boycott or sanctions. */
  sanctions: number;
  /** Roots 18-20: assault, fight, mass violence. */
  violence: number;
  /** Sums, for means. */
  goldsteinSum: number;
  toneSum: number;
  /** Articles that reported the events (GDELT's NumArticles). */
  articles: number;
}
export const emptyEventAgg = (): EventAgg => ({ n: 0, quad: [0, 0, 0, 0], root: {}, protests: 0, sanctions: 0, violence: 0, goldsteinSum: 0, toneSum: 0, articles: 0 });

export function addEventAgg(into: EventAgg, from: EventAgg): EventAgg {
  into.n += from.n;
  for (let i = 0; i < 4; i++) into.quad[i] += from.quad[i] || 0;
  for (const [k, v] of Object.entries(from.root)) into.root[k] = (into.root[k] || 0) + v;
  into.protests += from.protests;
  into.sanctions += from.sanctions;
  into.violence += from.violence;
  into.goldsteinSum += from.goldsteinSum;
  into.toneSum += from.toneSum;
  into.articles += from.articles;
  return into;
}

/** Calls fn for each line without splitting the whole file into an array first. */
function eachLine(text: string, fn: (line: string) => void): void {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.charCodeAt(end - 1) === 13 ? text.slice(start, end - 1) : text.slice(start, end);
    if (line) fn(line);
    start = end + 1;
  }
}

/** Events table (GDELT 2.0, 61 tab-separated columns, no header). Rows with fewer columns are skipped. */
export function aggregateEvents(text: string): { byCountry: Record<string, EventAgg>; rows: number; skipped: number } {
  const byCountry: Record<string, EventAgg> = {};
  let rows = 0;
  let skipped = 0;
  eachLine(text, (line) => {
    const c = line.split('\t');
    if (c.length < 58) {
      skipped++;
      return;
    }
    rows++;
    const who = new Set<string>();
    const place = FIPS_TO_ISO3[c[53]];
    if (place) who.add(place);
    for (const a of [c[7], c[17]]) if (a && ISO3_TO_FIPS[a]) who.add(a);
    if (!who.size) return;
    const root = (c[28] || '').padStart(2, '0').slice(0, 2);
    const quad = Number(c[29]);
    const gold = Number(c[30]);
    const tone = Number(c[34]);
    const arts = Number(c[33]);
    const code = c[26] || '';
    for (const iso of who) {
      const a = (byCountry[iso] ||= emptyEventAgg());
      a.n++;
      if (quad >= 1 && quad <= 4) a.quad[quad - 1]++;
      if (CAMEO_ROOTS[root]) a.root[root] = (a.root[root] || 0) + 1;
      if (root === '14') a.protests++;
      if (code.startsWith('163')) a.sanctions++;
      if (root === '18' || root === '19' || root === '20') a.violence++;
      if (Number.isFinite(gold)) a.goldsteinSum += gold;
      if (Number.isFinite(tone)) a.toneSum += tone;
      if (Number.isFinite(arts)) a.articles += arts;
    }
  });
  return { byCountry, rows, skipped };
}

/**
 * Economic theme groups read from the GKG. Each group is a list of GDELT theme names; a name ending
 * in "*" matches every theme that starts with it (ECON_CURRENCY* takes the exchange-rate and
 * reserve themes).
 */
export const GKG_THEME_GROUPS: Record<string, { label: string; themes: string[] }> = {
  inflation: { label: 'Inflation and prices', themes: ['ECON_INFLATION', 'ECON_COST_OF_LIVING', 'ECON_PRICECONTROL', 'ECON_PRICEGOUGE'] },
  centralBank: { label: 'Central bank and interest rates', themes: ['ECON_CENTRALBANK', 'ECON_INTEREST_RATE*', 'ECON_MONETARY*'] },
  debt: { label: 'Debt, default and bankruptcy', themes: ['ECON_DEBT', 'ECON_BANKRUPTCY', 'ECON_DEFAULT*'] },
  currency: { label: 'Currency and reserves', themes: ['ECON_CURRENCY*', 'ECON_DEVALUATION'] },
  fiscal: { label: 'Taxes, spending and subsidies', themes: ['ECON_TAXATION', 'ECON_SUBSIDIES', 'ECON_AUSTERITY', 'ECON_BUDGET*', 'TAX_ECON_PRICE'] },
  lenders: { label: 'IMF, World Bank and other lenders', themes: ['ECON_DEVELOPMENTORGS', 'ECON_IMF*'] },
  markets: { label: 'Stock and bond markets', themes: ['ECON_STOCKMARKET', 'ECON_BOND*'] },
  jobs: { label: 'Jobs and unemployment', themes: ['ECON_UNEMPLOYMENT', 'UNEMPLOYMENT', 'ECON_LAYOFFS'] },
  trade: { label: 'Trade and tariffs', themes: ['ECON_FREETRADE', 'ECON_TRADE*', 'ECON_TARIFF*', 'TRADE_DISPUTE'] },
  sanctions: { label: 'Sanctions', themes: ['SANCTIONS'] },
  protest: { label: 'Protests and unrest', themes: ['PROTEST', 'UNREST*', 'STRIKE', 'GENERAL_STRIKE'] },
};
export const GKG_GROUP_IDS = Object.keys(GKG_THEME_GROUPS);
/** Groups that make an article "economic" for the names list. */
const ECONOMIC_GROUPS = new Set(['inflation', 'centralBank', 'debt', 'currency', 'fiscal', 'lenders', 'markets', 'jobs', 'trade']);

const exactTheme = new Map<string, string>();
const prefixTheme: Array<[string, string]> = [];
for (const [id, g] of Object.entries(GKG_THEME_GROUPS)) {
  for (const t of g.themes) {
    if (t.endsWith('*')) prefixTheme.push([t.slice(0, -1), id]);
    else exactTheme.set(t, id);
  }
}
/** The group a GDELT theme name falls in, or undefined. */
export function themeGroup(theme: string): string | undefined {
  const exact = exactTheme.get(theme);
  if (exact) return exact;
  for (const [p, id] of prefixTheme) if (theme.startsWith(p)) return id;
  return undefined;
}

/** One country, one day (or more once added up), from the GKG. */
export interface GkgAgg {
  /** Articles that name a place in the country. */
  docs: number;
  toneSum: number;
  /** Per theme group: articles and their tone sum. */
  themes: Record<string, { n: number; toneSum: number }>;
  /** Articles that touch at least one economic group. */
  econDocs: number;
  /** People and organisations named in the economic articles, with counts (trimmed to the top few). */
  persons: Record<string, number>;
  orgs: Record<string, number>;
}
export const emptyGkgAgg = (): GkgAgg => ({ docs: 0, toneSum: 0, themes: {}, econDocs: 0, persons: {}, orgs: {} });

export const TOP_NAMES_KEPT = 15;
export function trimTop(m: Record<string, number>, k = TOP_NAMES_KEPT): Record<string, number> {
  const entries = Object.entries(m);
  if (entries.length <= k) return m;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k));
}

export function addGkgAgg(into: GkgAgg, from: GkgAgg, keepNames = TOP_NAMES_KEPT): GkgAgg {
  into.docs += from.docs;
  into.toneSum += from.toneSum;
  into.econDocs += from.econDocs;
  for (const [k, v] of Object.entries(from.themes)) {
    const t = (into.themes[k] ||= { n: 0, toneSum: 0 });
    t.n += v.n;
    t.toneSum += v.toneSum;
  }
  for (const [k, v] of Object.entries(from.persons)) into.persons[k] = (into.persons[k] || 0) + v;
  for (const [k, v] of Object.entries(from.orgs)) into.orgs[k] = (into.orgs[k] || 0) + v;
  into.persons = trimTop(into.persons, keepNames);
  into.orgs = trimTop(into.orgs, keepNames);
  return into;
}

/**
 * GKG 2.1 (27 tab-separated columns, no header). Read: V1THEMES (7), V1LOCATIONS (9, entries
 * "type#name#FIPS#adm1#lat#long#feature" split by ";"), V1PERSONS (11), V1ORGANIZATIONS (13),
 * V1.5TONE (15, tone first).
 */
export function aggregateGkg(text: string): { byCountry: Record<string, GkgAgg>; rows: number; skipped: number } {
  const byCountry: Record<string, GkgAgg> = {};
  let rows = 0;
  let skipped = 0;
  eachLine(text, (line) => {
    const c = line.split('\t');
    if (c.length < 16) {
      skipped++;
      return;
    }
    rows++;
    const where = new Set<string>();
    if (c[9]) {
      for (const loc of c[9].split(';')) {
        const iso = FIPS_TO_ISO3[loc.split('#')[2] || ''];
        if (iso) where.add(iso);
      }
    }
    if (!where.size) return;
    const groups = new Set<string>();
    if (c[7]) for (const t of c[7].split(';')) {
      const g = t && themeGroup(t);
      if (g) groups.add(g);
    }
    const tone = Number((c[15] || '').split(',')[0]);
    const toneOk = Number.isFinite(tone) && c[15] !== '';
    const econ = [...groups].some((g) => ECONOMIC_GROUPS.has(g));
    const persons = econ && c[11] ? [...new Set(c[11].split(';').filter(Boolean))] : [];
    const orgs = econ && c[13] ? [...new Set(c[13].split(';').filter(Boolean))] : [];
    for (const iso of where) {
      const a = (byCountry[iso] ||= emptyGkgAgg());
      a.docs++;
      if (toneOk) a.toneSum += tone;
      for (const g of groups) {
        const t = (a.themes[g] ||= { n: 0, toneSum: 0 });
        t.n++;
        if (toneOk) t.toneSum += tone;
      }
      if (econ) {
        a.econDocs++;
        for (const p of persons) a.persons[p] = (a.persons[p] || 0) + 1;
        for (const o of orgs) a.orgs[o] = (a.orgs[o] || 0) + 1;
      }
    }
  });
  // Names are trimmed per file so a busy file cannot blow up the day file.
  for (const a of Object.values(byCountry)) {
    a.persons = trimTop(a.persons, TOP_NAMES_KEPT * 4);
    a.orgs = trimTop(a.orgs, TOP_NAMES_KEPT * 4);
  }
  return { byCountry, rows, skipped };
}

/** What one day file on disk holds. Slots are "HHMM" within the day. */
export interface GdeltRawDay {
  day: string;
  events: { done: string[]; missing: string[] };
  gkg: { done: string[]; missing: string[] };
  countries: Record<string, { ev?: EventAgg; gkg?: GkgAgg }>;
}
export const emptyDay = (day: string): GdeltRawDay => ({ day, events: { done: [], missing: [] }, gkg: { done: [], missing: [] }, countries: {} });

/** Monday (UTC) of the week a YYYY-MM-DD day falls in. */
export function weekStart(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}

export interface GdeltRawWeek {
  weekStart: string;
  /** Files read and files GDELT does not have (gaps on its side), and how many there should be. */
  coverage: { eventsFiles: number; eventsMissing: number; gkgFiles: number; gkgMissing: number; expectedFiles: number };
  events?: {
    count: number;
    byQuad: Record<string, number>;
    topRoots: Array<{ code: string; label: string; count: number }>;
    protests: number;
    sanctions: number;
    violence: number;
    goldsteinMean: number;
    toneMean: number;
    articles: number;
  };
  gkg?: {
    /** Articles read that name the country. */
    articles: number;
    toneMean: number;
    /** Per theme group: articles, share of the country's articles (percent), mean tone. */
    themes: Record<string, { label: string; articles: number; sharePct: number; toneMean: number | null }>;
  };
}

export interface GdeltRawSeries {
  iso3: string;
  /** Newest 15-minute file read, ISO. */
  latestFileAt?: string;
  /** When the files were last pulled, ISO. */
  pulledAt?: string;
  weeks: GdeltRawWeek[];
  /** Over the latest four weeks, from the economic articles. */
  topPersons: Array<{ name: string; articles: number }>;
  topOrgs: Array<{ name: string; articles: number }>;
  /** GKG files read as a share of all GKG files in the period (1 = every file). */
  gkgSampleShare: number | null;
}

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Weekly figures for one country from day files (any order). Weeks with no file read are left out. */
export function buildSeries(iso3: string, days: GdeltRawDay[], opts: { pulledAt?: string; nowMs?: number } = {}): GdeltRawSeries {
  const byWeek = new Map<string, { ev: EventAgg; gkg: GkgAgg; cov: GdeltRawWeek['coverage']; hasEv: boolean; hasGkg: boolean }>();
  let latest = '';
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const wk = weekStart(d.day);
    const w = byWeek.get(wk) || { ev: emptyEventAgg(), gkg: emptyGkgAgg(), cov: { eventsFiles: 0, eventsMissing: 0, gkgFiles: 0, gkgMissing: 0, expectedFiles: 7 * 96 }, hasEv: false, hasGkg: false };
    byWeek.set(wk, w);
    w.cov.eventsFiles += d.events.done.length;
    w.cov.eventsMissing += d.events.missing.length;
    w.cov.gkgFiles += d.gkg.done.length;
    w.cov.gkgMissing += d.gkg.missing.length;
    if (d.events.done.length) w.hasEv = true;
    if (d.gkg.done.length) w.hasGkg = true;
    const c = d.countries[iso3];
    if (c?.ev) addEventAgg(w.ev, c.ev);
    if (c?.gkg) addGkgAgg(w.gkg, c.gkg, TOP_NAMES_KEPT * 4);
    const lastDone = [...d.events.done, ...d.gkg.done].sort().pop();
    if (lastDone) {
      const s = `${d.day.replace(/-/g, '')}${lastDone}00`;
      if (s > latest) latest = s;
    }
  }
  const weeks: GdeltRawWeek[] = [];
  let gkgRead = 0;
  let gkgAll = 0;
  for (const [wk, w] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!w.hasEv && !w.hasGkg) continue;
    const out: GdeltRawWeek = { weekStart: wk, coverage: w.cov };
    if (w.hasEv) {
      const e = w.ev;
      out.events = {
        count: e.n,
        byQuad: Object.fromEntries(QUAD_CLASSES.map((q, i) => [q, e.quad[i]])),
        topRoots: Object.entries(e.root)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([code, count]) => ({ code, label: CAMEO_ROOTS[code] || code, count })),
        protests: e.protests,
        sanctions: e.sanctions,
        violence: e.violence,
        goldsteinMean: e.n ? round(e.goldsteinSum / e.n) : 0,
        toneMean: e.n ? round(e.toneSum / e.n) : 0,
        articles: e.articles,
      };
    }
    if (w.hasGkg) {
      const g = w.gkg;
      gkgRead += w.cov.gkgFiles;
      out.gkg = {
        articles: g.docs,
        toneMean: g.docs ? round(g.toneSum / g.docs) : 0,
        themes: Object.fromEntries(
          GKG_GROUP_IDS.map((id) => {
            const t = g.themes[id] || { n: 0, toneSum: 0 };
            return [id, { label: GKG_THEME_GROUPS[id].label, articles: t.n, sharePct: g.docs ? round((100 * t.n) / g.docs, 1) : 0, toneMean: t.n ? round(t.toneSum / t.n) : null }];
          }),
        ),
      };
    }
    weeks.push(out);
  }
  // Sample share over the days that had any GKG file read: files read / every 15-minute file in them.
  let gkgDays = 0;
  for (const d of days) if (d.gkg.done.length || d.gkg.missing.length) gkgDays++;
  gkgAll = gkgDays * 96;
  // Names over the latest four weeks.
  const recent = days.filter((d) => weeks.length && d.day >= (weeks.slice(-4)[0]?.weekStart || ''));
  const names = emptyGkgAgg();
  for (const d of recent) if (d.countries[iso3]?.gkg) addGkgAgg(names, d.countries[iso3].gkg!, 200);
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, articles]) => ({ name, articles }));
  return {
    iso3,
    ...(latest ? { latestFileAt: new Date(slotMs(latest)).toISOString() } : {}),
    ...(opts.pulledAt ? { pulledAt: opts.pulledAt } : {}),
    weeks,
    topPersons: top(names.persons),
    topOrgs: top(names.orgs),
    gkgSampleShare: gkgAll ? round(gkgRead / gkgAll, 3) : null,
  };
}

/** Rough size of a pull: files left to fetch times the size of the newest file of each table. */
export function estimatePullBytes(left: { events: number; gkg: number }, newest: { events?: number; gkg?: number }): number | null {
  if (!newest.events && !newest.gkg) return null;
  return left.events * (newest.events || 0) + left.gkg * (newest.gkg || 0);
}

/** A week counts as complete once the newest file read is past its end. */
const WEEK_MS = 7 * 86400000;

/**
 * The short reading the council and the country page use: the latest complete week against the
 * average of up to seven weeks before it. Every figure is a count or a mean from the files read.
 */
export interface GdeltRawReading {
  weekStart: string;
  /** False when no complete week is on disk yet and the reading is the week in progress. */
  complete: boolean;
  pulledAt?: string;
  latestFileAt?: string;
  /** Events files read in the week, and how many GDELT should have (672). */
  eventsFilesRead: number;
  eventsFilesExpected: number;
  /** Weeks in the baseline (0 = no comparison). */
  baselineWeeks: number;
  events?: {
    count: number;
    protests: number;
    sanctions: number;
    violence: number;
    goldsteinMean: number;
    toneMean: number;
    baseline?: { count: number; protests: number; sanctions: number; violence: number; goldsteinMean: number };
    /** Latest count over the baseline average, minus 1, as a percent. */
    changePct?: number;
  };
  gkg?: {
    articles: number;
    toneMean: number;
    /** Share of GKG files read (1 = every file). */
    sampleShare: number | null;
    /** Theme groups with articles this week, largest share first. */
    themes: Array<{ id: string; label: string; sharePct: number; baselineSharePct?: number; toneMean: number | null }>;
  };
  topPersons: Array<{ name: string; articles: number }>;
  topOrgs: Array<{ name: string; articles: number }>;
}

/** Latest week at least this many times the baseline average reads as a surge. */
export const EVENT_SURGE_RATIO = 1.5;
export const EVENT_SURGE_RULE = `a week with at least ${EVENT_SURGE_RATIO}x the average events of the weeks before it reads as a surge`;
export const GOLDSTEIN_RULE = 'Goldstein scale: -10 = most conflictual, +10 = most cooperative, averaged over the events';

export function gdeltRawReading(s: GdeltRawSeries | null | undefined): GdeltRawReading | null {
  if (!s || !s.weeks.length) return null;
  const latestMs = s.latestFileAt ? Date.parse(s.latestFileAt) : 0;
  const isComplete = (w: GdeltRawWeek) => Date.parse(`${w.weekStart}T00:00:00Z`) + WEEK_MS <= latestMs + SLOT_MS;
  const completeWeeks = s.weeks.filter(isComplete);
  const latest = completeWeeks.at(-1) || s.weeks.at(-1)!;
  const complete = isComplete(latest);
  const before = complete ? completeWeeks.slice(0, -1).slice(-7) : [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const out: GdeltRawReading = {
    weekStart: latest.weekStart,
    complete,
    ...(s.pulledAt ? { pulledAt: s.pulledAt } : {}),
    ...(s.latestFileAt ? { latestFileAt: s.latestFileAt } : {}),
    eventsFilesRead: latest.coverage.eventsFiles,
    eventsFilesExpected: latest.coverage.expectedFiles,
    baselineWeeks: 0,
    topPersons: s.topPersons.slice(0, 5),
    topOrgs: s.topOrgs.slice(0, 5),
  };
  if (latest.events) {
    const e = latest.events;
    const base = before.filter((w) => w.events).map((w) => w.events!);
    out.events = { count: e.count, protests: e.protests, sanctions: e.sanctions, violence: e.violence, goldsteinMean: e.goldsteinMean, toneMean: e.toneMean };
    if (base.length) {
      out.baselineWeeks = base.length;
      const b = {
        count: round(avg(base.map((x) => x.count)), 1),
        protests: round(avg(base.map((x) => x.protests)), 1),
        sanctions: round(avg(base.map((x) => x.sanctions)), 1),
        violence: round(avg(base.map((x) => x.violence)), 1),
        goldsteinMean: round(avg(base.map((x) => x.goldsteinMean))),
      };
      out.events.baseline = b;
      if (b.count > 0) out.events.changePct = round((100 * e.count) / b.count - 100, 0);
    }
  }
  if (latest.gkg) {
    const g = latest.gkg;
    const base = before.filter((w) => w.gkg).map((w) => w.gkg!);
    out.baselineWeeks = Math.max(out.baselineWeeks, base.length);
    out.gkg = {
      articles: g.articles,
      toneMean: g.toneMean,
      sampleShare: s.gkgSampleShare,
      themes: Object.entries(g.themes)
        .filter(([, t]) => t.articles > 0)
        .sort((a, b) => b[1].sharePct - a[1].sharePct)
        .map(([id, t]) => ({
          id,
          label: t.label,
          sharePct: t.sharePct,
          ...(base.length ? { baselineSharePct: round(avg(base.map((w) => w.themes[id]?.sharePct || 0)), 1) } : {}),
          toneMean: t.toneMean,
        })),
    };
  }
  return out;
}

/** True when the latest week is a surge against its baseline (needs at least 3 baseline weeks). */
export function isEventSurge(r: GdeltRawReading | null | undefined): boolean {
  const e = r?.events;
  return !!e?.baseline && (r!.baselineWeeks >= 3) && e.baseline.count > 0 && e.count >= EVENT_SURGE_RATIO * e.baseline.count;
}
