/**
 * Where data and price disagree: one line per country, ranked.
 *
 * Each signal is a stated rule on figures the app already shows, never a forecast:
 * - Policy: real policy rate against inflation and its target (room to cut, or behind the curve).
 * - Real 10Y yield against the median of the countries on screen.
 * - Refinancing: BIS international government bonds falling due within a year.
 * - FX: BIS real exchange rate against its 10-year average, and carry over the US rate per unit
 *   of three-month volatility.
 *
 * Rank = size of the gap (0 to 1) times how much the figures can be trusted: live or official
 * figures count fully, AI estimates 0.7, sample values 0.5. A gap built on sample data can still
 * show, but below a smaller one built on live data, and every line says which it is.
 */
import { formatMonth } from './oecdSdmx';
import type { LiveWatchlistItem } from '../types/council';
import { POLITICAL_FISCAL_CATEGORIES, upcomingOfficialEvents } from '../data/officialCalendar';
import { INFLATION_TARGETS } from './marketsMacro';
import { formatPeriod } from './officialYields';
import { carryToVol, effrSourceText, reerLabel } from './fxValuation';

export type Quality = 'live' | 'estimate' | 'sample';
export const QUALITY_WEIGHT: Record<Quality, number> = { live: 1, estimate: 0.7, sample: 0.5 };
export const QUALITY_LABEL: Record<Quality, string> = { live: 'Live data', estimate: 'AI estimate', sample: 'Sample data' };

export type DivergenceKind = 'policy' | 'cds' | 'real_yield' | 'refinancing' | 'fx_value' | 'carry';

export interface Divergence {
  kind: DivergenceKind;
  /** Short name, e.g. "Room to cut". */
  label: string;
  /** The gap in one sentence. */
  headline: string;
  /** The figures behind it, each with where it came from. */
  evidence: Array<{ text: string; source: string }>;
  /** What it could mean, in plain words. Not advice. */
  soWhat: string;
  size: number;
  quality: Quality;
  score: number;
}

export interface CountryDivergence {
  iso3: string;
  countryName: string;
  top: Divergence;
  others: Divergence[];
  catalyst?: { date: string; title: string; daysUntil: number; legalDeadline?: boolean };
  /** e.g. "10Y +12 bps, CDS -5 bps since your last look". */
  change?: string;
}

export type LastLook = Record<string, { cds5YBps?: number; cdsSource?: string; yield10YPct?: number; yieldSource?: string }>;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const worst = (...q: Quality[]): Quality => (q.includes('sample') ? 'sample' : q.includes('estimate') ? 'estimate' : 'live');
const p1 = (v: number) => `${v.toFixed(1)}%`;

function make(d: Omit<Divergence, 'score'>): Divergence {
  return { ...d, size: Number(d.size.toFixed(3)), score: Number((d.size * QUALITY_WEIGHT[d.quality]).toFixed(3)) };
}

export const cpiTag = (it: LiveWatchlistItem): { q: Quality; src: string } =>
  it.cpiSource === 'oecd' && it.cpiMonth
    ? { q: 'live', src: `${it.oecdCpi?.short || 'OECD'} monthly, ${formatMonth(it.cpiMonth)}` }
    : it.cpiSource === 'live'
      ? { q: 'live', src: 'IMF, live' }
      : { q: 'sample', src: 'sample' };
export const policyTag = (it: LiveWatchlistItem): { q: Quality; src: string } =>
  it.policyRateSource === 'bis'
    ? { q: 'live', src: `BIS${it.policyRateBank ? ` (${it.policyRateBank})` : ''}${it.policyRateDate ? `, ${it.policyRateDate.length === 7 ? 'end of ' : ''}${it.policyRateDate}` : ''}${it.policyRateStale ? ', may be out of date' : ''}` }
    : it.policyRateSource === 'ai_estimate'
      ? { q: 'estimate', src: 'AI estimate' }
      : { q: 'sample', src: 'sample' };
export const yieldTag = (it: LiveWatchlistItem): { q: Quality; src: string } =>
  it.yield10YSource === 'official' && it.yield10YPeriod
    ? { q: 'live', src: `official, ${formatPeriod(it.yield10YPeriod)}` }
    : it.yield10YSource === 'ai_estimate'
      ? { q: 'estimate', src: 'AI estimate' }
      : it.yield10YSource === 'uploaded'
        ? { q: 'live', src: 'your upload' }
        : { q: 'sample', src: 'sample' };
export const cdsTag = (it: LiveWatchlistItem): { q: Quality; src: string } =>
  it.cds5YSource === 'own'
    ? { q: 'live', src: `your ${it.cds5YProvider || 'data'}${it.cds5YDate ? `, ${formatPeriod(it.cds5YDate)}` : ''}` }
    : it.cds5YSource === 'ai_estimate'
      ? { q: 'estimate', src: 'AI estimate' }
      : { q: 'sample', src: 'sample' };

/** Real policy rate against inflation and target. */
export function policySignal(it: LiveWatchlistItem): Divergence | null {
  if (it.cpiInflationPct === undefined || it.policyRatePct === undefined) return null;
  const real = it.policyRatePct - it.cpiInflationPct;
  const target = INFLATION_TARGETS[it.iso3];
  const gap = target ? it.cpiInflationPct - target.pct : undefined;
  const c = cpiTag(it);
  const pr = policyTag(it);
  const evidence = [
    { text: `Policy rate ${it.policyRatePct.toFixed(2)}%`, source: pr.src },
    { text: `Inflation ${p1(it.cpiInflationPct)}${target ? ` against a ${p1(target.pct)} target` : ''}`, source: c.src },
  ];
  const quality = worst(c.q, pr.q);
  if (real > 3 && (gap === undefined || gap <= 1)) {
    return make({
      kind: 'policy',
      label: gap === undefined ? 'High real rate' : 'Room to cut',
      headline: `Real policy rate ${p1(real)}${gap !== undefined ? ` with inflation ${Math.abs(gap).toFixed(1)} pts ${gap >= 0 ? 'above' : 'below'} target` : ''}.`,
      evidence,
      soWhat: 'Policy is tight for where inflation is. If cuts come sooner than markets expect, local yields could fall.',
      size: clamp((real - 2) / 5),
      quality,
    });
  }
  if (real < 0 && (gap === undefined || gap > 0)) {
    return make({
      kind: 'policy',
      label: 'Behind the curve',
      headline: `Real policy rate ${p1(real)}${gap !== undefined ? ` with inflation ${gap.toFixed(1)} pts above target` : ''}.`,
      evidence,
      soWhat: 'Policy is loose for where inflation is. Hikes or a weaker currency could follow, pushing local yields up.',
      size: clamp((-real + (gap ?? 0)) / 6),
      quality,
    });
  }
  return null;
}

/** Real 10Y yields against the median of the countries on screen. */
export function realYieldSignals(items: LiveWatchlistItem[]): Map<string, Divergence> {
  const withCpi = items.filter(
    (i): i is LiveWatchlistItem & { cpiInflationPct: number; yield10YPct: number } => i.cpiInflationPct !== undefined && i.yield10YPct !== undefined
  );
  const out = new Map<string, Divergence>();
  if (withCpi.length < 4) return out;
  const reals = withCpi.map((i) => i.yield10YPct - (i.cpiInflationPct as number)).sort((a, b) => a - b);
  const mid = reals.length % 2 ? reals[(reals.length - 1) / 2] : (reals[reals.length / 2 - 1] + reals[reals.length / 2]) / 2;
  for (const it of withCpi) {
    const real = it.yield10YPct - (it.cpiInflationPct as number);
    const diff = real - mid;
    if (Math.abs(diff) < 2) continue;
    const y = yieldTag(it);
    const c = cpiTag(it);
    out.set(
      it.iso3,
      make({
        kind: 'real_yield',
        label: diff > 0 ? 'High real yield' : 'Low real yield',
        headline: `Real 10Y yield ${p1(real)}, ${Math.abs(diff).toFixed(1)} pts ${diff > 0 ? 'above' : 'below'} the median of ${withCpi.length} countries (${p1(mid)}).`,
        evidence: [
          { text: `10Y yield ${it.yield10YPct.toFixed(2)}%`, source: y.src },
          { text: `Inflation ${p1(it.cpiInflationPct as number)}`, source: c.src },
        ],
        soWhat:
          diff > 0
            ? 'Pays well above inflation compared with peers: a cushion for holders if inflation stays put.'
            : 'Pays little above inflation compared with peers: exposed if inflation rises.',
        size: clamp(Math.abs(diff) / 8),
        quality: worst(y.q, c.q),
      })
    );
  }
  return out;
}

/** International government bonds falling due within a year, as a share of those outstanding (BIS). */
export function refinancingSignal(it: LiveWatchlistItem): Divergence | null {
  if (!it.intlBondsUsdBn || it.intlBondsDue1yUsdBn === undefined) return null;
  const share = it.intlBondsDue1yUsdBn / it.intlBondsUsdBn;
  if (share < 0.1) return null;
  return make({
    kind: 'refinancing',
    label: 'Heavy refinancing',
    headline: `$${it.intlBondsDue1yUsdBn.toFixed(1)}bn of $${it.intlBondsUsdBn.toFixed(1)}bn international government bonds fall due within a year (${(share * 100).toFixed(0)}%).`,
    evidence: [{ text: `BIS debt securities, ${it.intlBondsAsOf || 'latest quarter'}`, source: 'official' }],
    soWhat: 'New issuance is likely. Supply can cheapen existing bonds around the deal.',
    size: clamp(share / 0.3),
    quality: 'live',
  });
}

/** Real exchange rate more than 10% from its 10-year average (BIS). */
export function fxValueSignal(it: LiveWatchlistItem): Divergence | null {
  if (it.reerGapPct === undefined) return null;
  const label = reerLabel(it.reerGapPct);
  if (label === 'near average') return null;
  return make({
    kind: 'fx_value',
    label: label === 'strong' ? 'Currency strong for its history' : 'Currency weak for its history',
    headline: `Real exchange rate ${Math.abs(it.reerGapPct).toFixed(0)}% ${it.reerGapPct > 0 ? 'above' : 'below'} its 10-year average${it.reerPeriod ? ` (${formatPeriod(it.reerPeriod)})` : ''}.`,
    evidence: [{ text: 'BIS real broad effective exchange rate', source: 'official' }],
    soWhat:
      label === 'strong'
        ? 'Dear against its own past: exporters lose ground and the currency has room to give back. Real rates can trend, so this is a yardstick, not a fair value.'
        : 'Cheap against its own past: a cushion for buyers of the currency. Real rates can trend, so this is a yardstick, not a fair value.',
    size: clamp((Math.abs(it.reerGapPct) - 5) / 30),
    quality: 'live',
  });
}

/** Carry over the US rate per unit of three-month volatility: high means the carry pays well for the swings. */
export function carrySignal(it: LiveWatchlistItem): Divergence | null {
  if (it.policyRatePct === undefined || it.usFedFundsPct === undefined || it.fxVol3mPct === undefined) return null;
  const cv = carryToVol(it.policyRatePct, it.usFedFundsPct, it.fxVol3mPct);
  if (!cv || cv.ratio < 0.5) return null;
  const pr = policyTag(it);
  return make({
    kind: 'carry',
    label: 'Carry pays for the swings',
    headline: `Policy rate ${cv.carryPts.toFixed(1)} pts over the US, ${cv.ratio.toFixed(2)} times the currency's ${it.fxVol3mPct.toFixed(1)}% three-month volatility.`,
    evidence: [
      { text: `Policy rate ${it.policyRatePct.toFixed(2)}%`, source: pr.src },
      { text: `US fed funds ${it.usFedFundsPct.toFixed(2)}%`, source: effrSourceText({ source: it.usFedFundsSource, date: it.usFedFundsDate }) },
      { text: `Volatility ${it.fxVol3mPct.toFixed(1)}%`, source: `ECB rates${it.fxVolTo ? `, to ${it.fxVolTo}` : ''}` },
    ],
    soWhat: 'Holding the currency earns more than its recent swings would usually take away. Carry can unwind fast when markets turn.',
    size: clamp((cv.ratio - 0.3) / 1.2),
    quality: worst(pr.q, 'live'),
  });
}

function changeSince(it: LiveWatchlistItem, last: LastLook | null | undefined): string | undefined {
  const prev = last?.[it.iso3];
  if (!prev) return undefined;
  const parts: string[] = [];
  const sameYieldSource = (prev.yieldSource || 'sample') === (it.yield10YSource || 'sample');
  const dy = it.yield10YPct === undefined || prev.yield10YPct === undefined ? 0 : Math.round((it.yield10YPct - prev.yield10YPct) * 100);
  if (sameYieldSource && dy !== 0) parts.push(`10Y ${dy > 0 ? '+' : ''}${dy} bps`);
  const dc = it.cds5YBps === undefined || prev.cds5YBps === undefined || prev.cdsSource !== it.cds5YSource ? 0 : Math.round(it.cds5YBps - prev.cds5YBps);
  if (dc !== 0) parts.push(`CDS ${dc > 0 ? '+' : ''}${dc} bps`);
  return parts.length ? `${parts.join(', ')} since your last look` : 'No change since your last look';
}

/** One line per country with at least one signal, strongest first. */
export function rankDivergences(items: LiveWatchlistItem[], lastLook?: LastLook | null, now: Date = new Date()): CountryDivergence[] {
  const realY = realYieldSignals(items);
  const events = upcomingOfficialEvents(items.map((i) => i.iso3), 60, now);
  const out: CountryDivergence[] = [];
  for (const it of items) {
    const all = [policySignal(it), realY.get(it.iso3), refinancingSignal(it), fxValueSignal(it), carrySignal(it)]
      .filter((d): d is Divergence => Boolean(d) && (d as Divergence).score > 0)
      .sort((a, b) => b.score - a.score);
    if (!all.length) continue;
    const mine = events.filter((e) => e.iso3 === it.iso3);
    // Policy gaps resolve at rate decisions; the others at elections, budgets and IMF dates.
    const ev =
      (all[0].kind === 'policy'
        ? mine.find((e) => e.category === 'MPC_DECISION')
        : mine.find((e) => POLITICAL_FISCAL_CATEGORIES.includes(e.category))) || mine[0];
    out.push({
      iso3: it.iso3,
      countryName: it.countryName,
      top: all[0],
      others: all.slice(1),
      ...(ev ? { catalyst: { date: ev.date, title: ev.title, daysUntil: ev.daysUntil, ...(ev.dateKind ? { legalDeadline: true } : {}) } } : {}),
      change: changeSince(it, lastLook),
    });
  }
  return out.sort((a, b) => b.top.score - a.top.score);
}
