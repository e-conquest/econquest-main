/**
 * The credit lines a source's own terms ask the app to show wherever its figures appear. Only the
 * sources whose terms state a visible credit are here; the wording is taken from those terms (see
 * the same rows in src/data/dataLicences.ts, which quote them).
 *
 * Browser-safe.
 */
import { licenceRowsForSource } from '../utils/licenceLookup';

export interface RequiredCredit {
  /** Register row id in src/data/dataLicences.ts. */
  id: 'erapi' | 'gdelt' | 'fred' | 'acled';
  /** Linked words, shown as given. */
  text: string;
  url: string;
  /** Text shown after the link, if any. */
  after?: string;
}

export const REQUIRED_CREDITS: RequiredCredit[] = [
  // https://www.exchangerate-api.com/docs/free : "Rates By Exchange Rate API" linked on any page using the rates.
  { id: 'erapi', text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
  // https://www.gdeltproject.org/about.html#termsofuse : citation and link back.
  { id: 'gdelt', text: 'Source: The GDELT Project', url: 'https://www.gdeltproject.org/' },
  // https://fred.stlouisfed.org/docs/api/terms_of_use.html : the notice on any product using the API.
  {
    id: 'fred',
    text: 'This product uses the FRED® API',
    url: 'https://fred.stlouisfed.org/',
    after: ' but is not endorsed or certified by the Federal Reserve Bank of St. Louis.',
  },
  // https://acleddata.com/attributionpolicy : "ACLED as the source of the data must be clearly and prominently acknowledged".
  { id: 'acled', text: 'Source: ACLED (Armed Conflict Location & Event Data)', url: 'https://acleddata.com/', after: '; monthly counts worked out by the app.' },
];

/** The required credits for the sources named in these source texts, in register order. */
export function creditsForSources(sources: Array<string | undefined>): RequiredCredit[] {
  const ids = new Set(sources.flatMap((s) => licenceRowsForSource(s).map((r) => r.id)));
  return REQUIRED_CREDITS.filter((c) => ids.has(c.id));
}

export function requiredCredit(id: RequiredCredit['id']): RequiredCredit {
  return REQUIRED_CREDITS.find((c) => c.id === id)!;
}

/** Plain text of a credit, for exports and tests. */
export function creditText(c: RequiredCredit): string {
  return `${c.text}${c.after ?? ''} (${c.url})`;
}
