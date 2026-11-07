/**
 * Citations for briefs and notes: every sourced figure gets a numbered marker, and a References
 * list at the end names each source once, with the publisher's page and the date the app read it.
 * Figures worked out by a stated rule ("model") are not references; their method stays beside
 * them. Missing figures are not cited.
 *
 * Each reference also says the licence class of its source (src/utils/licenceLookup.ts), so a
 * reader knows which figures need the provider's permission before they go to a client.
 *
 * Browser-safe.
 */
import { licenceLabelForSource } from './licenceLookup';
import { withheldReason } from './shareMode';

export interface Reference {
  n: number;
  source: string;
  url?: string;
}

/** Publisher pages for the sources the app reads, matched on the source text. */
const SOURCE_PAGES: Array<[RegExp, string]> = [
  [/IMF WEO|World Economic Outlook|IMF DataMapper/i, 'https://www.imf.org/external/datamapper/'],
  [/COFER/i, 'https://data.imf.org/en/datasets/IMF.STA:COFER'],
  [/IMF.*(reserves|balance of payments|BOP|IL\b)|International Liquidity/i, 'https://data.imf.org/'],
  [/\bBIS\b.*polic|policy rate.*\bBIS\b|^BIS\b/i, 'https://data.bis.org/topics/CBPOL'],
  [/BIS.*(debt securities|international bonds)/i, 'https://data.bis.org/topics/DSS'],
  [/QEDS/i, 'https://www.worldbank.org/en/programs/debt-statistics/qeds'],
  [/\bIDS\b|International Debt Statistics/i, 'https://www.worldbank.org/en/programs/debt-statistics/ids'],
  [/Pink Sheet/i, 'https://www.worldbank.org/en/research/commodity-markets'],
  [/World Bank|WGI/i, 'https://data.worldbank.org/'],
  [/OECD/i, 'https://db.nomics.world/OECD'],
  [/Banco Central do Brasil|\bBCB\b|IPCA/i, 'https://www3.bcb.gov.br/sgspub/'],
  [/Eurostat|HICP/i, 'https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table'],
  [/FRED/i, 'https://fred.stlouisfed.org/'],
  [/\bACLED\b/i, 'https://acleddata.com/'],
  [/Banxico|Banco de México/i, 'https://www.banxico.org.mx/SieInternet/'],
  [/Tesouro/i, 'https://www.tesourotransparente.gov.br/'],
  [/EVDS|CBRT/i, 'https://evds3.tcmb.gov.tr/'],
  [/CFTC/i, 'https://publicreporting.cftc.gov/'],
  [/\bTIC\b|Treasury International Capital/i, 'https://home.treasury.gov/data/treasury-international-capital-tic-system'],
  [/Comtrade/i, 'https://comtradeplus.un.org/'],
  [/\bEIA\b/i, 'https://www.eia.gov/opendata/'],
  [/GDELT/i, 'https://www.gdeltproject.org/'],
  [/Polymarket/i, 'https://polymarket.com/'],
  [/New York Fed|EFFR/i, 'https://www.newyorkfed.org/markets/reference-rates/effr'],
];

export function sourceUrl(source: string): string | undefined {
  for (const [re, url] of SOURCE_PAGES) if (re.test(source)) return url;
  return undefined;
}

/** A stated-rule reading, a missing figure or an empty source is not a reference. */
export function isCitable(source: string | undefined, tag?: string): boolean {
  const s = (source || '').trim();
  if (!s || tag === 'model') return false;
  if (/^model\b/i.test(s) || /^missing\b/i.test(s) || /^no source/i.test(s) || /needs setup/i.test(s)) return false;
  return true;
}

/** Numbers sources in the order they are first cited; the same source keeps its number. */
export class References {
  readonly list: Reference[] = [];
  cite(source: string): number {
    const key = source.trim();
    const hit = this.list.find((r) => r.source === key);
    if (hit) return hit.n;
    const ref: Reference = { n: this.list.length + 1, source: key, ...(sourceUrl(key) ? { url: sourceUrl(key) } : {}) };
    this.list.push(ref);
    return ref.n;
  }
  lines(accessed: string): string[] {
    const day = accessed.slice(0, 10);
    const lines = this.list.map((r) => `[${r.n}] ${r.source}.${r.url ? ` ${r.url}` : ''}${day ? ` Read by the app on ${day}.` : ''} Licence: ${licenceLabelForSource(r.source)}.`);
    const held = this.list.filter((r) => withheldReason(r.source)).map((r) => `[${r.n}]`);
    if (held.length)
      lines.push(
        `Before sharing: ${held.join(', ')} ${held.length === 1 ? 'comes from a source' : 'come from sources'} whose terms do not let the figures be passed on, or do not say (Menu > About & data licences). Sharing mode holds them back from table downloads.`
      );
    return lines;
  }
}

const NOTE_LINE = /^- (.+?): (.+) \(([^()]*(?:\([^()]*\)[^()]*)*)\)$/;

/**
 * Notes built from brief rows ("- Label: value (source)"): sourced figures become
 * "- Label: value [n]" and a References section is added. Model and Missing rows keep their text.
 */
export function withNoteReferences<T extends { heading: string; lines: string[] }>(sections: T[], accessed: string): Array<T | { heading: string; lines: string[] }> {
  const refs = new References();
  const out = sections.map((s) => ({
    ...s,
    lines: s.lines.map((line) => {
      const m = NOTE_LINE.exec(line);
      if (!m) return line;
      const [, label, value, source] = m;
      if (/^Missing\b/i.test(value) || !isCitable(source)) return line;
      return `- ${label}: ${value} [${refs.cite(source)}]`;
    }),
  }));
  return refs.list.length ? [...out, { heading: 'References', lines: refs.lines(accessed) }] : out;
}
