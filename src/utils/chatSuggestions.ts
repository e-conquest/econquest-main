/**
 * Suggested questions on the Council chat welcome screen, picked from what you hold, what moved on
 * your watchlist and what you asked before. No AI and no numbers made up: each suggestion carries
 * the plain fact that put it there (shown on hover), read from the same figures the agents use.
 * Where nothing qualifies, the fixed examples fill the row, so a new install looks as before.
 *
 * Rules, in order (at most four suggestions):
 * 1. Your book: the country with the largest notional in your holdings, asked the way its asset
 *    class is judged (bonds: cheap or rich; local bonds: the central bank; FX: the currency).
 * 2. Watchlist, up to two: the largest policy-rate move in the last 92 days (BIS), the largest 10Y
 *    yield change over three months of half a point or more (official monthly yields), a debt path
 *    rising five points of GDP or more (the app's debt sustainability run on IMF inputs).
 * 3. Asked before: your latest saved question; asking it again shows what changed since.
 * 4. The fixed examples.
 *
 * Browser-safe.
 */
import type { Holding } from './holdings';
import type { LiveWatchlistItem } from '../types/council';

export type ChatSuggestionKind = 'book' | 'watchlist' | 'recent' | 'example';

export interface ChatSuggestion {
  text: string;
  kind: ChatSuggestionKind;
  /** Why it is offered, in one line (empty for the fixed examples). */
  why: string;
}

export const SUGGESTION_KIND_LABEL: Record<ChatSuggestionKind, string> = {
  book: 'Your holdings',
  watchlist: 'Watchlist',
  recent: 'Asked before',
  example: '',
};

export interface ChatSuggestionInputs {
  holdings: Holding[];
  items: LiveWatchlistItem[];
  /** Saved questions (newest first or any order). */
  recent: Array<{ question: string; askedAt: string }>;
  examples: string[];
  now?: Date;
}

const MAX = 4;
const MOVE_DAYS = 92;
const fmtPct = (v: number) => `${Number(v.toFixed(2))}%`;
const fmtPts = (v: number) => `${v > 0 ? 'up' : 'down'} ${Math.abs(Number(v.toFixed(2)))} points`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Days from a YYYY-MM or YYYY-MM-DD period to now (a month counts from its last day). */
function daysSince(period: string, now: Date): number | null {
  let end: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) end = Date.parse(`${period}T00:00:00Z`);
  else if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    end = Date.UTC(y, m, 0);
  } else return null;
  return Number.isFinite(end) ? (now.getTime() - end) / 86400000 : null;
}

function bookSuggestion(holdings: Holding[], items: LiveWatchlistItem[]): ChatSuggestion | null {
  const byCountry = new Map<string, { total: number; byClass: Map<Holding['assetClass'], number> }>();
  for (const h of holdings) {
    if (!h?.iso3 || !finite(h.notionalUsdMm) || h.notionalUsdMm <= 0) continue;
    const row = byCountry.get(h.iso3) ?? { total: 0, byClass: new Map() };
    row.total += h.notionalUsdMm;
    row.byClass.set(h.assetClass, (row.byClass.get(h.assetClass) ?? 0) + h.notionalUsdMm);
    byCountry.set(h.iso3, row);
  }
  const top = [...byCountry.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))[0];
  if (!top) return null;
  const [iso3, row] = top;
  const item = items.find((i) => i.iso3 === iso3);
  const name = item?.countryName || iso3;
  const mainClass = [...row.byClass.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const why = `Your largest holding: ${name}, $${Number(row.total.toFixed(1))}mm notional`;
  if (mainClass === 'FX') {
    const ccy = item?.currencyCode;
    return { text: ccy ? `Is the ${ccy} strong or weak for its history?` : `Is ${name}'s currency strong or weak for its history?`, kind: 'book', why };
  }
  if (mainClass === 'LC_BOND') return { text: `Is ${name}'s central bank behind the curve?`, kind: 'book', why };
  if (mainClass === 'HC_BOND' || mainClass === 'CDS') return { text: `Are ${name}'s bonds cheap or rich against peers?`, kind: 'book', why };
  return { text: `What are the main risks for ${name} now?`, kind: 'book', why };
}

function watchlistSuggestions(items: LiveWatchlistItem[], now: Date): ChatSuggestion[] {
  const own = items.filter((i) => !i.isBenchmark);
  const out: Array<ChatSuggestion & { score: number }> = [];

  const moves = own
    .map((i) => {
      const m = i.policyRateLastMove;
      if (i.policyRateSource !== 'bis' || !m || !finite(m.fromPct) || !finite(m.toPct) || m.fromPct === m.toPct) return null;
      const age = daysSince(m.period, now);
      if (age === null || age < 0 || age > MOVE_DAYS) return null;
      return { i, m, size: Math.abs(m.toPct - m.fromPct) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.size - a.size);
  if (moves[0]) {
    const { i, m, size } = moves[0];
    const bank = i.policyRateBank || 'The central bank';
    const verb = m.toPct > m.fromPct ? 'raised' : 'cut';
    out.push({ text: `Is ${i.countryName}'s central bank behind the curve?`, kind: 'watchlist', why: `${bank} ${verb} its rate from ${fmtPct(m.fromPct)} to ${fmtPct(m.toPct)} (${m.period}; BIS)`, score: size * 4 });
  }

  const yields = own
    .filter((i) => i.yield10YSource === 'official' && finite(i.yield10YChange3mPts) && Math.abs(i.yield10YChange3mPts!) >= 0.5)
    .sort((a, b) => Math.abs(b.yield10YChange3mPts!) - Math.abs(a.yield10YChange3mPts!));
  if (yields[0]) {
    const i = yields[0];
    out.push({ text: `What is driving ${i.countryName}'s bond yields?`, kind: 'watchlist', why: `10Y yield ${fmtPts(i.yield10YChange3mPts!)} in three months${i.yield10YPeriod ? ` (to ${i.yield10YPeriod})` : ''}`, score: Math.abs(i.yield10YChange3mPts!) * 2 });
  }

  const debt = own
    .map((i) => {
      const d = i.debtSustainability;
      if (!d?.base || !finite(d.debtNow) || !finite(d.base.end)) return null;
      const rise = d.base.end - d.debtNow;
      return rise >= 5 ? { i, d, rise } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.rise - a.rise);
  if (debt[0]) {
    const { i, d, rise } = debt[0];
    out.push({ text: `Is ${i.countryName}'s government debt on a rising path?`, kind: 'watchlist', why: `Debt path ${Math.round(d.debtNow)}% to ${Math.round(d.base!.end)}% of GDP by ${d.base!.year} (${d.base!.label})`, score: rise / 5 });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 2).map(({ score: _s, ...s }) => s);
}

function recentSuggestion(recent: ChatSuggestionInputs['recent'], examples: string[]): ChatSuggestion | null {
  const seen = new Set(examples.map((e) => e.trim().toLowerCase()));
  const latest = [...recent]
    .filter((r) => r && typeof r.question === 'string' && r.question.trim() && r.question.length <= 160 && !seen.has(r.question.trim().toLowerCase()))
    .sort((a, b) => String(b.askedAt).localeCompare(String(a.askedAt)))[0];
  if (!latest) return null;
  const day = String(latest.askedAt).slice(0, 10);
  return { text: latest.question.trim(), kind: 'recent', why: `You asked this${day ? ` on ${day}` : ''}; asking again shows what changed since` };
}

export function chatSuggestions(input: ChatSuggestionInputs): ChatSuggestion[] {
  const now = input.now ?? new Date();
  const picked: ChatSuggestion[] = [];
  const add = (s: ChatSuggestion | null) => {
    if (!s || picked.length >= MAX) return;
    if (picked.some((p) => p.text.toLowerCase() === s.text.toLowerCase())) return;
    picked.push(s);
  };
  add(bookSuggestion(input.holdings || [], input.items || []));
  for (const s of watchlistSuggestions(input.items || [], now)) add(s);
  add(recentSuggestion(input.recent || [], input.examples));
  for (const ex of input.examples) add({ text: ex, kind: 'example', why: '' });
  return picked;
}
