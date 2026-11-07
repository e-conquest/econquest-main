import type { LiveWatchlistItem } from '../types/council';
import type { StagedTradeTicketSpec } from './nssYieldCurveAndCatalystEngine';
import { summariseBook, type Holding } from './holdings';
import { missingReason, toLive, type FigureKey } from './liveFigures';
import { cdsSourceNote, yieldSourceNote } from './watchlistYield';
import { upcomingOfficialEvents } from '../data/officialCalendar';
import { missingRow, when, type BriefGroup, type BriefRow, type CountryBrief, type NoteSection } from './countryNotes';

/**
 * Book-level briefs and reports for the portfolio manager (internal) and the private wealth
 * adviser (plain language for a client). They work on imported holdings, or on the watchlist
 * at equal weight when nothing is imported, and say which.
 *
 * Every judgement is a stated rule on the figures shown. Rows come in with built-in figures already
 * removed (toLive), so a country without your own CDS or an official yield simply
 * has no value for it: averages use only the countries that have one and say what share of the book
 * that is, and nothing is filled in (Sam, 2026-11-04).
 */

type Item = LiveWatchlistItem;

export interface BookLine {
  iso3: string;
  countryName: string;
  item?: Item;
  /** Share of the book, 0..1 (gross notional, or equal weight). */
  weight: number;
  grossUsdMm?: number;
  netCreditUsdMm?: number;
  dv01UsdK?: number;
}

export interface BookView {
  fromHoldings: boolean;
  lines: BookLine[];
  grossUsdMm?: number;
  netCreditUsdMm?: number;
  dv01UsdK?: number;
  missingDuration?: number;
  /** Held countries the app does not cover. */
  uncovered: string[];
}

export function bookView(holdings: Holding[], riskLookup: Item[], watchlist: Item[]): BookView {
  if (holdings.length) {
    const b = summariseBook(holdings, riskLookup);
    return {
      fromHoldings: true,
      lines: b.rows,
      grossUsdMm: b.grossUsdMm,
      netCreditUsdMm: b.netCreditUsdMm,
      dv01UsdK: b.dv01UsdK,
      missingDuration: b.missingDuration,
      uncovered: b.uncovered,
    };
  }
  const n = watchlist.length || 1;
  const lines: BookLine[] = watchlist.map((i) => ({ iso3: i.iso3, countryName: i.countryName, item: toLive(i), weight: 1 / n }));
  return {
    fromHoldings: false,
    lines: lines.sort((a, b) => a.countryName.localeCompare(b.countryName)),
    uncovered: [],
  };
}

/** Effective number of countries: 1 / sum of squared weights (equal weights give the count). */
export function effectiveNames(lines: BookLine[]): number {
  const s = lines.reduce((a, l) => a + l.weight * l.weight, 0);
  return s > 0 ? 1 / s : 0;
}

/** 5Y CDS bands used across the app (see bankerNote accessBand). */
export function cdsBand(cds: number): 'investment grade-like' | 'high yield' | 'stressed' | 'distressed' {
  return cds < 200 ? 'investment grade-like' : cds < 400 ? 'high yield' : cds < 1000 ? 'stressed' : 'distressed';
}

const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;
const usd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 1 })}mm`;
const signedUsd = (v: number) => (v < 0 ? `−${usd(-v)}` : usd(v));
const cdsNote = (i: Item) => cdsSourceNote(i).replace(/^Your/, 'your');

/** Weighted average over the lines that have a real figure, and the share of the book they make up. */
interface Covered {
  value: number;
  /** Share of the covered book (countries the app knows) that has this figure. */
  share: number;
  missing: string[];
}

interface BookFacts {
  covered: BookLine[];
  wCovered: number;
  avg: (f: (i: Item) => number | undefined) => Covered | undefined;
  missingOf: (f: (i: Item) => number | undefined) => string[];
  top: BookLine | undefined;
  top3Weight: number;
  eff: number;
  stressedWeight: number;
  officialYieldWeight: number;
  ownCdsWeight: number;
  events: Array<{ date: string; daysUntil: number; title: string; iso3: string; sourceName: string; weight: number }>;
}

function facts(v: BookView, now: Date): BookFacts {
  const covered = v.lines.filter((l) => l.item);
  const wCovered = covered.reduce((a, l) => a + l.weight, 0) || 1;
  const missingOf = (f: (i: Item) => number | undefined) => covered.filter((l) => f(l.item!) === undefined).map((l) => l.countryName);
  const avg = (f: (i: Item) => number | undefined): Covered | undefined => {
    const have = covered.filter((l) => f(l.item!) !== undefined);
    const w = have.reduce((a, l) => a + l.weight, 0);
    if (!w) return undefined;
    return { value: have.reduce((a, l) => a + f(l.item!)! * l.weight, 0) / w, share: w / wCovered, missing: missingOf(f) };
  };
  const byWeight = [...v.lines].sort((a, b) => b.weight - a.weight);
  const weightOf = new Map(v.lines.map((l) => [l.iso3, l.weight]));
  return {
    covered,
    wCovered,
    avg,
    missingOf,
    top: byWeight[0],
    top3Weight: byWeight.slice(0, 3).reduce((a, l) => a + l.weight, 0),
    eff: effectiveNames(v.lines),
    stressedWeight: covered.filter((l) => (l.item!.cds5YBps ?? 0) >= 400).reduce((a, l) => a + l.weight, 0),
    officialYieldWeight: covered.filter((l) => l.item!.yield10YSource === 'official').reduce((a, l) => a + l.weight, 0),
    ownCdsWeight: covered.filter((l) => l.item!.cds5YSource === 'own').reduce((a, l) => a + l.weight, 0),
    events: upcomingOfficialEvents(
      v.lines.map((l) => l.iso3),
      30,
      now
    ).map((e) => ({ ...e, weight: weightOf.get(e.iso3) ?? 0 })),
  };
}

const pctOfBook = (c: Covered) => (c.share >= 0.999 ? 'all of the book' : `${pct0(c.share)} of the book; missing for ${c.missing.join(', ')}`);

/** A book-level average: shown from the countries that have the figure, or Missing with the fix. */
function bookRow(f: BookFacts, label: string, key: FigureKey, get: (i: Item) => number | undefined, fmt: (v: number) => string, source: string): BriefRow {
  const c = f.avg(get);
  if (!c) {
    const first = f.covered[0];
    const r = missingReason(key, first?.iso3 ?? '');
    return missingRow(label, { ...r, short: `${r.short} for every country` });
  }
  return { label, value: fmt(c.value), source: `${source}, ${pctOfBook(c)}`, verified: false };
}

const basisNote = (v: BookView) =>
  v.fromHoldings ? 'Weights are your imported holdings by gross notional.' : 'No holdings imported: this is your watchlist at equal weight.';

/* ------------------------------------------------------------------------------------------
 * Portfolio manager: the book as a whole.
 * ------------------------------------------------------------------------------------------ */

export function pmBookBrief(v: BookView, tickets: StagedTradeTicketSpec[], now: Date = new Date()): CountryBrief {
  if (!v.lines.length) return { headline: 'No holdings and an empty watchlist.', judgements: [], groups: [] };
  const f = facts(v, now);
  const top3 = [...v.lines].sort((a, b) => b.weight - a.weight).slice(0, 3).map((l) => `${l.countryName} ${pct0(l.weight)}`);
  const j: string[] = [];

  j.push(
    f.top && f.top.weight > 0.25
      ? `Concentrated: ${f.top.countryName} is ${pct0(f.top.weight)} of the book, and the three largest positions are ${pct0(f.top3Weight)}.`
      : `Spread out: the weights are equivalent to about ${f.eff.toFixed(1)} equal positions, and the largest is ${f.top ? `${f.top.countryName} at ${pct0(f.top.weight)}` : 'none'}.`
  );
  // Only your own CDS counts; without it there is no statement about stress either way.
  const noCds = f.missingOf((i) => i.cds5YBps);
  if (noCds.length < f.covered.length)
    j.push(
      (f.stressedWeight > 0
        ? `${pct0(f.stressedWeight / f.wCovered)} of the book is in countries with 5Y CDS at 400 bps or wider (stressed or distressed).`
        : 'No position with CDS data is in a country with 5Y CDS at 400 bps or wider.') + (noCds.length ? ` No CDS for ${noCds.join(', ')}.` : '')
    );
  if (f.events.length) {
    const soon = f.events.filter((e) => e.daysUntil <= 14);
    const affected = new Set(soon.map((e) => e.iso3));
    const w = v.lines.filter((l) => affected.has(l.iso3)).reduce((a, l) => a + l.weight, 0);
    j.push(
      soon.length
        ? `${soon.length} official ${soon.length === 1 ? 'event' : 'events'} in the next 14 days affect countries making up ${pct0(w)} of the book; the first is ${soon[0].title} (${when(soon[0])}).`
        : `No official events in the next 14 days; the next is ${f.events[0].title} (${when(f.events[0])}).`
    );
  }
  if (v.fromHoldings && v.dv01UsdK !== undefined)
    j.push(`A 10 bp widening in all spreads would cost about ${usd(Math.abs(v.dv01UsdK * 10) / 1000)} on the credit positions with a duration.`);
  if (tickets.length) {
    const names = [...new Set(tickets.map((t) => t.countryName))];
    j.push(`${tickets.length} staged trade ${tickets.length === 1 ? 'idea' : 'ideas'}, in ${names.join(', ')}; they are not in the weights above until booked.`);
  }
  if (v.uncovered.length) j.push(`The app does not cover ${v.uncovered.join(', ')}: these count in notional but have no figures.`);

  const book: BriefRow[] = [
    { label: 'Basis', value: v.fromHoldings ? 'Your holdings' : 'Watchlist, equal weight', source: basisNote(v), verified: false },
    ...(v.fromHoldings
      ? [
          { label: 'Gross notional', value: usd(v.grossUsdMm ?? 0), source: 'your holdings', verified: false },
          { label: 'Net credit exposure', value: signedUsd(v.netCreditUsdMm ?? 0), source: 'your holdings', verified: false },
          {
            label: 'Credit DV01',
            value: `${(v.dv01UsdK ?? 0) < 0 ? '−' : ''}$${Math.abs(v.dv01UsdK ?? 0).toFixed(1)}k per bp`,
            source: v.missingDuration ? `your holdings; ${v.missingDuration} without duration left out` : 'your holdings',
            verified: false,
          },
        ]
      : []),
    { label: 'Effective number of countries', value: f.eff.toFixed(1), source: 'from the weights', verified: false },
    { label: 'Three largest positions', value: pct0(f.top3Weight), source: 'share of the book', verified: false },
    bookRow(f, 'Weighted 5Y CDS', 'cds', (i) => i.cds5YBps, (x) => `${x.toFixed(0)} bps`, 'your CDS data'),
    bookRow(f, 'Weighted 10Y yield', 'yield', (i) => i.yield10YPct, (x) => `${x.toFixed(2)}%`, 'official yields'),
  ];

  // The Portfolio page already lists each country's weight and the staged ideas,
  // so the brief shows the book-level figures and the calendar; the review covers the rest.
  const groups: BriefGroup[] = [
    { title: 'The book', rows: book },
    {
      title: 'Next 30 days',
      rows: f.events.length
        ? f.events.slice(0, 6).map((e) => ({ label: e.title, value: when(e), source: `${pct0(e.weight)} of book · ${e.sourceName}`, verified: true }))
        : [{ label: 'Official events', value: 'None on file', source: 'official calendar', verified: false }],
    },
  ];

  return {
    headline: `${v.fromHoldings ? 'Your book' : 'Your watchlist'}: ${v.lines.length} ${v.lines.length === 1 ? 'country' : 'countries'}. Largest positions: ${top3.join('; ')}.`,
    judgements: j,
    groups,
  };
}

export const BOOK_SECTIONS: Record<string, string> = {
  summary: 'Summary',
  concentration: 'Concentration',
  figures: 'Figures by country',
  events: 'Next 30 days',
  trades: 'Staged trade ideas',
  method: 'Method and sources',
};

export function buildBookSections(
  v: BookView,
  tickets: StagedTradeTicketSpec[],
  include: (id: string) => boolean,
  now: Date = new Date()
): NoteSection[] {
  const brief = pmBookBrief(v, tickets, now);
  const f = facts(v, now);
  const out: NoteSection[] = [];
  const add = (id: string, lines: string[]) => include(id) && out.push({ id, heading: BOOK_SECTIONS[id], lines });

  add('summary', [brief.headline, ...(brief.sampleWarning ? [brief.sampleWarning] : []), ...brief.judgements.map((x) => `- ${x}`)]);
  add('concentration', [
    basisNote(v),
    `- Largest position: ${f.top ? `${f.top.countryName}, ${pct0(f.top.weight)}` : 'none'}.`,
    `- Three largest positions: ${pct0(f.top3Weight)} of the book.`,
    `- Effective number of countries: ${f.eff.toFixed(1)} (1 / sum of squared weights).`,
    ...(v.fromHoldings
      ? [`- Gross ${usd(v.grossUsdMm ?? 0)}, net credit ${signedUsd(v.netCreditUsdMm ?? 0)}, credit DV01 $${(v.dv01UsdK ?? 0).toFixed(1)}k per bp.`]
      : []),
  ]);
  add(
    'figures',
    [...v.lines].sort((a, b) => b.weight - a.weight).map((l) => {
      const i = l.item;
      if (!i) return `- ${l.countryName}: ${pct0(l.weight)} of the book, not a country the app covers.`;
      const parts = [
        i.cds5YBps !== undefined ? `5Y CDS ${Math.round(i.cds5YBps)} bps (${cdsNote(i)}, ${cdsBand(i.cds5YBps)})` : '5Y CDS: Missing (needs your CDS data)',
        i.yield10YPct !== undefined ? `10Y ${i.yield10YPct.toFixed(2)}% (${yieldSourceNote(i)})` : `10Y yield: Missing (${missingReason('yield', i.iso3).short.toLowerCase()})`,
      ];
      return `- ${l.countryName}: ${pct0(l.weight)} of the book, ${parts.join(', ')}.`;
    })
  );
  add(
    'events',
    f.events.length
      ? f.events.map((e) => `- ${e.date}: ${e.title} (${pct0(e.weight)} of the book; source: ${e.sourceName})`)
      : ['No official events on file for these countries in the next 30 days.']
  );
  add(
    'trades',
    tickets.length
      ? tickets.map((t) => `- **${t.strategyTitle}** (${t.countryName}). Entry ${t.entrySpreadOrYieldBps} bps, target ${t.targetSpreadOrYieldBps}, stop ${t.stopLossSpreadOrYieldBps}; conviction ${t.convictionScore0To100}/100.`)
      : ['No staged trade tickets.']
  );
  add('method', [
    'CDS bands: under 200 bps investment grade-like, 200 to 400 high yield, 400 to 1,000 stressed, 1,000 and over distressed.',
    'Only real figures are used: your own CDS data, official or uploaded 10Y yields, and live feeds. A missing figure is named, never filled in; averages say what share of the book they cover. Official dates come from the central bank and statistics calendars on file.',
    'Model output for discussion. Not investment advice, and not validated for client use.',
  ]);
  return out;
}

/* ------------------------------------------------------------------------------------------
 * Private wealth: the client's portfolio in plain language. No trade levels, scores or DV01.
 * ------------------------------------------------------------------------------------------ */

const stressed = (l: BookLine) => (l.item?.cds5YBps ?? 0) >= 400;

export function clientBrief(v: BookView, now: Date = new Date()): CountryBrief {
  if (!v.lines.length) return { headline: 'No holdings to describe yet.', judgements: [], groups: [] };
  const f = facts(v, now);
  const j: string[] = [];
  j.push(
    f.top && f.top.weight > 0.25
      ? `A large part of the portfolio, about ${pct0(f.top.weight)}, is linked to one country, ${f.top.countryName}. Spreading this more widely would reduce the effect of bad news there.`
      : `The portfolio is spread across ${v.lines.length} countries; the largest, ${f.top?.countryName}, is about ${pct0(f.top?.weight ?? 0)}.`
  );
  if (f.stressedWeight > 0)
    j.push(`Markets charge ${f.covered.filter(stressed).map((l) => l.countryName).join(', ')} a lot more to borrow than most governments, which is a sign of strain.`);
  const soon = f.events.filter((e) => e.daysUntil <= 30);
  if (soon.length) j.push(`There ${soon.length === 1 ? 'is one official date' : `are ${soon.length} official dates`} in the next month that could move prices; the first is ${soon[0].title} (${when(soon[0])}).`);

  return {
    headline: `${v.fromHoldings ? 'The client’s portfolio' : 'The watchlist (no client holdings imported)'}: ${v.lines.length} ${v.lines.length === 1 ? 'country' : 'countries'}.`,
    judgements: j,
    groups: [
      {
        title: 'Holdings in plain terms',
        rows: [...v.lines]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 8)
          .map((l) => ({
            label: l.countryName,
            value: `${pct0(l.weight)} of the portfolio`,
            source: l.item ? (l.item.yield10YPct !== undefined ? `10-year government bond yield ${l.item.yield10YPct.toFixed(1)}%` : 'covered') : 'not covered',
            verified: false,
          })),
      },
      {
        title: 'Dates to watch',
        rows: soon.length
          ? soon.slice(0, 6).map((e) => ({ label: e.title, value: when(e), source: e.sourceName, verified: true }))
          : [{ label: 'Official dates', value: 'None in the next month', source: 'official calendar', verified: false }],
      },
    ],
  };
}

export const CLIENT_REVIEW_SECTIONS: Record<string, string> = {
  summary: 'Summary',
  holdings: 'What you hold',
  risks: 'What could go wrong',
  dates: 'Dates to watch',
  important: 'Important information',
};

export function buildClientReviewSections(v: BookView, include: (id: string) => boolean, now: Date = new Date()): NoteSection[] {
  const brief = clientBrief(v, now);
  const f = facts(v, now);
  const out: NoteSection[] = [];
  const add = (id: string, lines: string[]) => include(id) && out.push({ id, heading: CLIENT_REVIEW_SECTIONS[id], lines });

  add('summary', [...brief.judgements]);
  add('holdings', [
    ...[...v.lines]
      .sort((a, b) => b.weight - a.weight)
      .map((l) => `- ${l.countryName}: about ${pct0(l.weight)} of your emerging market holdings.`),
    ...(v.fromHoldings ? [] : ['(Draft based on the adviser’s watchlist; import the client’s holdings for their real weights.)']),
  ]);
  const strained = f.covered.filter(stressed).sort((a, b) => b.weight - a.weight);
  add('risks', [
    'Bond prices fall when investors worry about a government’s finances or when interest rates rise. Emerging market bonds can also be hard to sell quickly in a stressed market, and currency moves can add to losses.',
    ...strained.slice(0, 4).map((l) => `- ${l.countryName}: markets already price a real chance of difficulty here.`),
  ]);
  add(
    'dates',
    f.events.length ? f.events.slice(0, 6).map((e) => `- ${when(e)}: ${e.title}`) : ['No scheduled official dates for these countries in the next month.']
  );
  add('important', [
    'Figures come from official sources and live market data. Where a figure has not come in, it is left out rather than estimated. We do not give countries a risk rating.',
    'This note is for discussion with your adviser. It is not a personal recommendation to buy or sell, and the value of investments can go down as well as up.',
  ]);
  return out;
}
