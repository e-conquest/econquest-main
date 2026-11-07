/**
 * Sanctions lists (seven-groups plan, Phase 4): the official lists of sanctioned people, firms,
 * vessels and aircraft, read from files you download, counted by country and programme.
 *
 *   OFAC (US Treasury)  SDN.CSV + ADD.CSV (and the non-SDN CONS_PRIM.CSV + CONS_ADD.CSV), the
 *                       legacy CSV layout: no header row, "-0-" for an empty field.
 *   UN Security Council consolidated.xml (the consolidated list, XML).
 *
 * An entry counts for a country when one of its addresses is in the country, or (UN) one of its
 * nationalities is. An entry can count for several countries. Country names the app cannot match
 * are reported, never guessed.
 *
 * Description, not a tested signal, and not a compliance screen: name matching here is plain text,
 * with none of the fuzzy matching, aliases or ownership rules a compliance check needs.
 *
 * Browser-safe, pure.
 */
import { ISO_NUMERIC_TO_ISO3 } from '../data/worldCountries';

export type SanctionsListId = 'ofac_sdn' | 'ofac_cons' | 'un';
export type EntryType = 'individual' | 'entity' | 'vessel' | 'aircraft';

export const SANCTIONS_LISTS: Record<SanctionsListId, { name: string; short: string; files: string; url: string }> = {
  ofac_sdn: { name: 'OFAC Specially Designated Nationals and Blocked Persons List', short: 'OFAC SDN', files: 'SDN.CSV and ADD.CSV', url: 'https://ofac.treasury.gov/sanctions-list-service' },
  ofac_cons: { name: 'OFAC Consolidated (non-SDN) Sanctions List', short: 'OFAC non-SDN', files: 'CONS_PRIM.CSV and CONS_ADD.CSV', url: 'https://ofac.treasury.gov/sanctions-list-service' },
  un: { name: 'UN Security Council Consolidated List', short: 'UN', files: 'consolidated.xml', url: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list' },
};

export interface SanctionsEntry {
  list: SanctionsListId;
  id: string;
  name: string;
  type: EntryType;
  programs: string[];
  /** ISO3 codes from addresses and (UN) nationalities. */
  countries: string[];
  /** UN: date first listed (YYYY-MM-DD). */
  listedOn?: string;
}

export interface SanctionsData {
  entries: SanctionsEntry[];
  files: Array<{ list: SanctionsListId; file: string; entries: number; modified?: string }>;
  /** Country names no ISO3 code was found for, with how often they appeared. */
  unknownCountries: Record<string, number>;
  skipped: Array<{ file: string; reason: string }>;
}

export const emptySanctionsData = (): SanctionsData => ({ entries: [], files: [], unknownCountries: {}, skipped: [] });

/* ------------------------------------------------------------------------------------------
 * Country names as the lists spell them.
 * ---------------------------------------------------------------------------------------- */

const ALIASES: Record<string, string> = {
  'korea north': 'PRK', 'democratic peoples republic of korea': 'PRK', 'north korea': 'PRK', 'dprk': 'PRK',
  'korea south': 'KOR', 'republic of korea': 'KOR', 'korea': 'KOR',
  'iran islamic republic of': 'IRN', 'russian federation': 'RUS', 'syrian arab republic': 'SYR',
  'venezuela bolivarian republic of': 'VEN', 'bolivia plurinational state of': 'BOL', 'burma': 'MMR',
  'congo democratic republic of the': 'COD', 'democratic republic of the congo': 'COD', 'dr congo': 'COD', 'congo kinshasa': 'COD',
  'congo republic of the': 'COG', 'congo': 'COG', 'republic of the congo': 'COG', 'congo brazzaville': 'COG',
  'cote divoire': 'CIV', 'ivory coast': 'CIV', 'laos': 'LAO', 'lao peoples democratic republic': 'LAO',
  'viet nam': 'VNM', 'vietnam': 'VNM', 'turkey': 'TUR', 'turkiye': 'TUR', 'united kingdom of great britain and northern ireland': 'GBR', 'uk': 'GBR',
  'united states of america': 'USA', 'usa': 'USA', 'united republic of tanzania': 'TZA', 'republic of moldova': 'MDA', 'moldova': 'MDA',
  'czech republic': 'CZE', 'north macedonia': 'MKD', 'macedonia': 'MKD', 'the former yugoslav republic of macedonia': 'MKD',
  'west bank': 'PSE', 'gaza': 'PSE', 'palestinian': 'PSE', 'state of palestine': 'PSE', 'palestine': 'PSE',
  'kosovo': 'XKX', 'eswatini': 'SWZ', 'swaziland': 'SWZ', 'cabo verde': 'CPV', 'cape verde': 'CPV',
  'bosnia and herzegovina': 'BIH', 'hong kong': 'HKG', 'china hong kong': 'HKG', 'hong kong sar': 'HKG', 'macau': 'MAC', 'macao': 'MAC',
  'taiwan province of china': 'TWN', 'gambia the': 'GMB', 'the gambia': 'GMB', 'gambia': 'GMB', 'bahamas the': 'BHS', 'bahamas': 'BHS',
  'british virgin islands': 'VGB', 'virgin islands british': 'VGB', 'cayman islands': 'CYM', 'marshall islands': 'MHL', 'seychelles': 'SYC',
  'malta': 'MLT', 'liberia': 'LBR', 'belize': 'BLZ', 'bahrain': 'BHR', 'armenia': 'ARM', 'kyrgyzstan': 'KGZ', 'tajikistan': 'TJK',
  'singapore': 'SGP', 'luxembourg': 'LUX', 'liechtenstein': 'LIE', 'monaco': 'MCO', 'eritrea': 'ERI', 'burundi': 'BDI', 'rwanda': 'RWA',
  'central african republic': 'CAF', 'chad': 'TCD', 'burkina faso': 'BFA', 'mauritania': 'MRT', 'djibouti': 'DJI', 'haiti': 'HTI',
  'jamaica': 'JAM', 'trinidad and tobago': 'TTO', 'guyana': 'GUY', 'suriname': 'SUR', 'albania': 'ALB', 'montenegro': 'MNE',
  'north cyprus': 'CYP', 'region crimea': 'UKR', 'crimea': 'UKR', 'antigua and barbuda': 'ATG', 'saint kitts and nevis': 'KNA',
  'st kitts and nevis': 'KNA', 'saint vincent and the grenadines': 'VCT', 'comoros': 'COM', 'maldives': 'MDV', 'brunei': 'BRN', 'bhutan': 'BTN',
  'timor leste': 'TLS', 'fiji': 'FJI', 'samoa': 'WSM', 'vanuatu': 'VUT', 'panama': 'PAN', 'sierra leone': 'SLE', 'guinea bissau': 'GNB',
  'equatorial guinea': 'GNQ', 'togo': 'TGO', 'benin': 'BEN', 'malawi': 'MWI', 'lesotho': 'LSO', 'mauritius': 'MUS', 'gibraltar': 'GIB',
  'isle of man': 'IMN', 'jersey': 'JEY', 'guernsey': 'GGY', 'curacao': 'CUW', 'aruba': 'ABW', 'andorra': 'AND', 'san marino': 'SMR',
  // Spellings seen in the 6 Nov 2026 OFAC and UN files.
  'barbados': 'BRB', 'dominica': 'DMA', 'palau': 'PLW', 'bermuda': 'BMU', 'cote d ivoire': 'CIV',
  'china hong kong special administrative region': 'HKG', 'hong kong special administrative region': 'HKG',
  'northern gaza': 'PSE', 'north gaza': 'PSE', 'northern mali': 'MLI',
  // Left unmatched on purpose: disputed areas (Kashmir, Jammu and Kashmir, Kafia Kingi) and groupings
  // that are not one country (Commonwealth of Independent States, former Soviet Union).
};

export function normCountry(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_TO_ISO3: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const { iso3, name } of Object.values(ISO_NUMERIC_TO_ISO3)) m.set(normCountry(name), iso3);
  for (const [k, v] of Object.entries(ALIASES)) m.set(normCountry(k), v);
  return m;
})();

/** ISO3 for a country name as a list spells it; null when the app has no match. */
export function iso3ForName(name: string): string | null {
  // OFAC writes regions as "Region: Gaza"; inverted names as "Man, Isle of" or "North Macedonia, The Republic of".
  const raw = String(name ?? '').replace(/^\s*region\s*:\s*/i, '');
  const n = normCountry(raw);
  if (!n) return null;
  const hit = NAME_TO_ISO3.get(n);
  if (hit) return hit;
  const comma = raw.indexOf(',');
  if (comma > 0) {
    const [a, b] = [raw.slice(0, comma), raw.slice(comma + 1)];
    return NAME_TO_ISO3.get(normCountry(`${b} ${a}`)) ?? NAME_TO_ISO3.get(normCountry(a)) ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------
 * OFAC legacy CSV.
 * ---------------------------------------------------------------------------------------- */

/** Rows of a CSV with double-quoted fields; ignores the end-of-file control character. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() && c !== '\x1a')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() && c !== '\x1a')) rows.push(row);
  return rows;
}

const nul = (v: string | undefined) => {
  const t = String(v ?? '').trim();
  return t === '-0-' || t === '-0' ? '' : t;
};

/** OFAC SDN_Type: "individual", "vessel", "aircraft", or -0- for an entity. */
function ofacType(v: string): EntryType {
  const t = nul(v).toLowerCase();
  return t === 'individual' || t === 'vessel' || t === 'aircraft' ? t : 'entity';
}

/** OFAC Program field: "SDGT] [IRGC" or "[RUSSIA-EO14024]". */
export function ofacPrograms(v: string): string[] {
  return nul(v)
    .split(/\]\s*\[/)
    .map((p) => p.replace(/[[\]]/g, '').trim())
    .filter(Boolean);
}

/**
 * Adds an OFAC primary file (SDN.CSV or CONS_PRIM.CSV) and its address file (ADD.CSV or
 * CONS_ADD.CSV). The address file may be empty when you have only the primary one.
 */
export function addOfacCsv(data: SanctionsData, list: 'ofac_sdn' | 'ofac_cons', file: string, primary: string, addresses: string, modified?: string): void {
  const prim = parseCsvRows(primary);
  if (!prim.length || prim[0].length < 4 || !/^\d+$/.test(prim[0][0].trim())) {
    data.skipped.push({ file, reason: 'not an OFAC file in the legacy CSV layout (no header row, entity number first)' });
    return;
  }
  const where = new Map<string, Set<string>>();
  for (const r of parseCsvRows(addresses)) {
    const ent = r[0]?.trim();
    const country = nul(r[4]);
    if (!ent || !/^\d+$/.test(ent) || !country) continue;
    const iso = iso3ForName(country);
    if (!iso) {
      data.unknownCountries[country] = (data.unknownCountries[country] || 0) + 1;
      continue;
    }
    const s = where.get(ent) || new Set<string>();
    s.add(iso);
    where.set(ent, s);
  }
  let n = 0;
  for (const r of prim) {
    const ent = r[0].trim();
    if (!/^\d+$/.test(ent)) continue;
    data.entries.push({ list, id: ent, name: nul(r[1]), type: ofacType(r[2]), programs: ofacPrograms(r[3]), countries: [...(where.get(ent) || [])].sort() });
    n++;
  }
  data.files.push({ list, file, entries: n, ...(modified ? { modified } : {}) });
}

/* ------------------------------------------------------------------------------------------
 * UN consolidated XML (regex reading of a flat, known layout; no XML library needed).
 * ---------------------------------------------------------------------------------------- */

const tag = (xml: string, name: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};
const text = (s: string | undefined) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

export function addUnXml(data: SanctionsData, file: string, xml: string): void {
  const head = xml.match(/<CONSOLIDATED_LIST[^>]*dateGenerated="([^"]+)"/);
  if (!/<CONSOLIDATED_LIST/.test(xml)) {
    data.skipped.push({ file, reason: 'not the UN consolidated list XML (no CONSOLIDATED_LIST element)' });
    return;
  }
  let n = 0;
  const one = (block: string, type: EntryType, addrTag: string) => {
    const name = [tag(block, 'FIRST_NAME')[0], tag(block, 'SECOND_NAME')[0], tag(block, 'THIRD_NAME')[0], tag(block, 'FOURTH_NAME')[0]].map(text).filter(Boolean).join(' ');
    const countries = new Set<string>();
    const places = [...tag(block, addrTag).flatMap((a) => tag(a, 'COUNTRY')), ...tag(block, 'NATIONALITY').flatMap((nat) => tag(nat, 'VALUE'))].map(text).filter(Boolean);
    for (const p of places) {
      const iso = iso3ForName(p);
      if (iso) countries.add(iso);
      else data.unknownCountries[p] = (data.unknownCountries[p] || 0) + 1;
    }
    const listedOn = text(tag(block, 'LISTED_ON')[0]).slice(0, 10);
    data.entries.push({
      list: 'un',
      id: text(tag(block, 'REFERENCE_NUMBER')[0]) || text(tag(block, 'DATAID')[0]),
      name,
      type,
      programs: [text(tag(block, 'UN_LIST_TYPE')[0])].filter(Boolean),
      countries: [...countries].sort(),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(listedOn) ? { listedOn } : {}),
    });
    n++;
  };
  for (const b of tag(xml, 'INDIVIDUAL')) one(b, 'individual', 'INDIVIDUAL_ADDRESS');
  for (const b of tag(xml, 'ENTITY')) one(b, 'entity', 'ENTITY_ADDRESS');
  data.files.push({ list: 'un', file, entries: n, ...(head ? { modified: head[1].slice(0, 10) } : {}) });
}

/* ------------------------------------------------------------------------------------------
 * Country view and name search.
 * ---------------------------------------------------------------------------------------- */

export interface CountrySanctions {
  iso3: string;
  total: number;
  byList: Array<{ list: SanctionsListId; short: string; entries: number; byType: Partial<Record<EntryType, number>> }>;
  /** Programmes with the most entries tied to the country, largest first. */
  programs: Array<{ list: SanctionsListId; program: string; entries: number }>;
  /** UN: entries first listed each year. */
  unListedByYear: Array<{ year: string; entries: number }>;
}

export function countrySanctions(data: SanctionsData, iso3: string): CountrySanctions {
  const iso = iso3.toUpperCase();
  const mine = data.entries.filter((e) => e.countries.includes(iso));
  const lists = [...new Set(data.files.map((f) => f.list))];
  const byList = lists.map((list) => {
    const es = mine.filter((e) => e.list === list);
    const byType: Partial<Record<EntryType, number>> = {};
    for (const e of es) byType[e.type] = (byType[e.type] || 0) + 1;
    return { list, short: SANCTIONS_LISTS[list].short, entries: es.length, byType };
  });
  const prog = new Map<string, { list: SanctionsListId; program: string; entries: number }>();
  for (const e of mine)
    for (const p of e.programs) {
      const k = `${e.list}|${p}`;
      const v = prog.get(k) || { list: e.list, program: p, entries: 0 };
      v.entries++;
      prog.set(k, v);
    }
  const years = new Map<string, number>();
  for (const e of mine) if (e.list === 'un' && e.listedOn) years.set(e.listedOn.slice(0, 4), (years.get(e.listedOn.slice(0, 4)) || 0) + 1);
  return {
    iso3: iso,
    total: mine.length,
    byList,
    programs: [...prog.values()].sort((a, b) => b.entries - a.entries || a.program.localeCompare(b.program)).slice(0, 12),
    unListedByYear: [...years.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, entries]) => ({ year, entries })),
  };
}

const tokens = (s: string) => normCountry(s).split(' ').filter((t) => t.length > 1);

/** Entries whose name holds every word of the query (case and accents ignored). Plain text only. */
export function searchSanctions(data: SanctionsData, query: string, max = 50): SanctionsEntry[] {
  const q = tokens(query);
  if (!q.length) return [];
  const out: SanctionsEntry[] = [];
  for (const e of data.entries) {
    const n = new Set(tokens(e.name));
    if (q.every((t) => n.has(t))) {
      out.push(e);
      if (out.length >= max) break;
    }
  }
  return out;
}

export function sanctionsSentence(name: string, c: CountrySanctions, data: SanctionsData): string {
  if (!data.files.length) return `${name}: no sanctions list files read.`;
  const parts = c.byList.map((l) => `${l.entries} on the ${l.short} list`);
  const top = c.programs[0];
  return `${name}: ${parts.join(', ')} with an address or nationality in the country${top ? `; the largest programme is ${top.program} (${SANCTIONS_LISTS[top.list].short}, ${top.entries})` : ''}.`;
}

export const SANCTIONS_METHOD =
  'Entries on each list you have added, counted for a country when one of their addresses (OFAC, UN) or nationalities (UN) is in it; an entry can count for several countries. Programmes as the list names them. Plain-text name search: every word of the query must appear in the listed name. Not a compliance screen: no aliases, fuzzy matching or ownership rules.';
