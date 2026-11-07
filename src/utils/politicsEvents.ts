/**
 * Politics and events for the Politics & Events Agent (Sam, 2026-11-05).
 *
 * Only figures a feed filled, each with the date it was pulled:
 * - GDELT: average news tone for the country over its weekly pull, and the latest headlines.
 * - World Bank Worldwide Governance Indicators: political stability and absence of violence,
 *   as a percentile rank among countries (yearly).
 * - Polymarket: prediction-market odds on contracts that name the country (market prices, not a
 *   forecast by the app).
 * - GDELT 2.0 raw files: weekly event counts (protests, sanctions, violence, Goldstein) and the
 *   economic themes in the news (GKG), latest complete week against the weeks before.
 * - UCDP downloaded CSV files: armed conflicts in the country, battle deaths, non-state and
 *   one-sided violence for the latest year UCDP has coded (utils/ucdpConflict.ts).
 *
 * The rules on top (tone bands, stability bands) are stated here and shown with the figures.
 */
import type { OpenDataSnapshot } from '../types/council';
import type { UcdpReading } from './ucdpConflict';
import type { V1Reading } from './gdeltDaily';
import { EVENT_SURGE_RULE, GOLDSTEIN_RULE, isEventSurge, type GdeltRawReading } from './gdeltRaw';
import { ACLED_RISING_RULE, ACLED_SHORT, acledLagMonths, acledMonthLabel, acledRising, type AcledReading } from './acled';

export interface PoliticsFigures {
  tone?: { value: number; pulledAt: string };
  headlines?: Array<{ title: string; source: string; publishedAt: string; url: string }>;
  headlinesPulledAt?: string;
  stability?: { percentile: number; year: string };
  markets?: Array<{ question: string; probabilityPct: number; volumeUsd: number; url: string; change1dPts?: number; change1wPts?: number; change1mPts?: number }>;
  marketsPulledAt?: string;
  /** GDELT raw files: events and economic themes for the latest week. */
  raw?: GdeltRawReading;
  /** UCDP conflict figures from the downloaded files. */
  conflict?: UcdpReading;
  /** GDELT 1.0 monthly history: latest complete month against all months on disk. */
  history?: V1Reading;
  /** ACLED conflict events (your own ACLED account): twelve months of counts. */
  acledEvents?: AcledReading;
  /** Why the ACLED figures are missing, in words. */
  acledMissing?: string;
}

export const GDELT_SHORT = 'GDELT news tone';
export const WGI_SHORT = 'World Bank governance indicators (political stability)';
export const POLYMARKET_SHORT = 'Polymarket';
export const GDELT_EVENTS_SHORT = 'GDELT 2.0 events files';
export const GDELT_GKG_SHORT = 'GDELT Global Knowledge Graph';

/** Date in a liveFields label such as "GDELT, pulled 2026-11-02" or "World Bank WGI, 2024". */
const dateIn = (label: string | undefined, re: RegExp) => (label?.match(re) || [])[1] || '';

/** Only figures a feed marked live; nothing built in. Undefined when none is live. */
export function politicsFromSnapshot(snap: OpenDataSnapshot): PoliticsFigures | undefined {
  const lf = snap.liveFields || {};
  const out: PoliticsFigures = {};
  const tone = snap.gdeltMetrics?.averageTone;
  if (lf['gdelt.averageTone'] && typeof tone === 'number' && Number.isFinite(tone)) {
    out.tone = { value: tone, pulledAt: dateIn(lf['gdelt.averageTone'], /(\d{4}-\d{2}-\d{2})/) };
  }
  if (lf['gdelt.topHeadlines'] && snap.gdeltMetrics?.topHeadlines?.length) {
    out.headlines = snap.gdeltMetrics.topHeadlines.slice(0, 3).map((h) => ({ title: h.title, source: h.sourceDomain, publishedAt: h.publishedAt, url: h.url }));
    out.headlinesPulledAt = dateIn(lf['gdelt.topHeadlines'], /(\d{4}-\d{2}-\d{2})/);
  }
  const pct = snap.worldBankIndicators?.politicalStabilityPercentile;
  if (lf['wb.politicalStabilityPercentile'] && typeof pct === 'number' && Number.isFinite(pct)) {
    out.stability = { percentile: pct, year: dateIn(lf['wb.politicalStabilityPercentile'], /((?:19|20)\d{2})/) };
  }
  if (lf['polymarket.contracts']) {
    const name = (snap.countryName || '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
    const iso = new RegExp(`\\b${(snap.iso3 || 'zzz').toLowerCase()}\\b`);
    // Only contracts whose question names the country; regional or global ones say nothing about it.
    const mine = (snap.polymarketContracts || []).filter((c) => {
      const q = c.question.toLowerCase();
      return (name.length > 2 && q.includes(name)) || iso.test(q);
    });
    if (mine.length) {
      out.markets = mine.slice(0, 3).map((c) => ({
        question: c.question,
        probabilityPct: c.probabilityPct,
        volumeUsd: c.volumeUsd,
        url: c.url,
        ...(c.change1dPts !== undefined ? { change1dPts: c.change1dPts } : {}),
        ...(c.change1wPts !== undefined ? { change1wPts: c.change1wPts } : {}),
        ...(c.change1mPts !== undefined ? { change1mPts: c.change1mPts } : {}),
      }));
      out.marketsPulledAt = dateIn(lf['polymarket.contracts'], /(\d{4}-\d{2}-\d{2})/);
    }
  }
  if (snap.gdeltRaw?.weekStart) out.raw = snap.gdeltRaw;
  if (snap.ucdp?.latest) out.conflict = snap.ucdp;
  if (snap.gdeltDaily?.month) out.history = snap.gdeltDaily;
  if (snap.acled?.months?.length) out.acledEvents = snap.acled;
  else if (snap.acledMissing) out.acledMissing = snap.acledMissing;
  // A reason alone is not a figure: it rides along only when something else is on hand.
  const figures = Object.keys(out).filter((k) => k !== 'acledMissing');
  return figures.length ? out : undefined;
}

export type ToneBand = 'very negative' | 'negative' | 'mixed' | 'positive';

/** GDELT tone runs roughly -10 to +10; most country coverage sits a little below zero. */
export function toneBand(tone: number): ToneBand {
  return tone <= -4 ? 'very negative' : tone <= -1.5 ? 'negative' : tone < 1 ? 'mixed' : 'positive';
}
export const TONE_RULE = 'at or below -4 = very negative, -4 to -1.5 = negative, -1.5 to +1 = mixed, +1 or above = positive';

export type StabilityBand = 'low' | 'below the middle' | 'above the middle' | 'high';

export function stabilityBand(percentile: number): StabilityBand {
  return percentile < 25 ? 'low' : percentile < 50 ? 'below the middle' : percentile < 75 ? 'above the middle' : 'high';
}
export const STABILITY_RULE = 'percentile rank among countries: under 25 = low, 25-50 = below the middle, 50-75 = above the middle, 75 or more = high';

export function formatUsd(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`;
}

/** "Mon 2 Nov" style week label: "week of 2026-11-02". */
const weekOf = (r: GdeltRawReading) => `week of ${r.weekStart}${r.complete ? '' : ' (in progress)'}`;
const signed = (v: number, d = 0) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

/**
 * Figures and plain sentences from the GDELT raw files for the Politics & Events Agent. Counts are
 * what the files hold; the surge reading is a stated rule on top (tagged as a model reading).
 */
export function rawGdeltFigures(r: GdeltRawReading): {
  figures: Array<{ label: string; value: string; source: string; tag: 'live' | 'model' }>;
  sentences: string[];
  surge: boolean;
} {
  const figures: Array<{ label: string; value: string; source: string; tag: 'live' | 'model' }> = [];
  const sentences: string[] = [];
  const pulled = r.pulledAt ? `pulled ${r.pulledAt.slice(0, 10)}` : 'pull date unknown';
  const filesNote = r.eventsFilesRead < r.eventsFilesExpected ? `; ${r.eventsFilesRead} of ${r.eventsFilesExpected} 15-minute files read` : '';
  let surge = false;
  if (r.events) {
    const e = r.events;
    const base = e.baseline;
    const vs = base ? ` vs ${base.count} a week on average over the ${r.baselineWeeks} weeks before${e.changePct !== undefined ? ` (${signed(e.changePct)}%)` : ''}` : '';
    figures.push({
      label: `Events, ${weekOf(r)}`,
      value: `${e.count} events: ${e.protests} protests, ${e.sanctions} sanctions or embargoes, ${e.violence} violent${vs}`,
      source: `${GDELT_EVENTS_SHORT}, ${pulled}; an event counts where it took place or when the country is an actor${filesNote}`,
      tag: 'live',
    });
    figures.push({
      label: 'Event intensity (Goldstein)',
      value: `${signed(e.goldsteinMean, 2)}${base ? ` (weeks before ${signed(base.goldsteinMean, 2)})` : ''}`,
      source: `${GDELT_EVENTS_SHORT}; ${GOLDSTEIN_RULE}`,
      tag: 'live',
    });
    surge = isEventSurge(r);
    if (base) {
      if (surge) {
        figures.push({ label: 'Event reading', value: 'surge', source: `Rule: ${EVENT_SURGE_RULE}`, tag: 'model' });
        sentences.push(`Reported events jumped to ${e.count} in the ${weekOf(r)}, ${signed(e.changePct || 0)}% on the weeks before.`);
      } else {
        sentences.push(`Reported events ran at ${e.count} in the ${weekOf(r)}${e.changePct !== undefined ? `, ${signed(e.changePct)}% on the weeks before` : ''}.`);
      }
      if (base.protests > 0 && e.protests >= 2 * base.protests && e.protests >= 5) sentences.push(`Protests rose to ${e.protests}, against ${base.protests} a week before.`);
      if (e.sanctions >= 3 && e.sanctions >= 2 * Math.max(1, base.sanctions)) sentences.push(`Sanctions and embargo events rose to ${e.sanctions}.`);
    }
  }
  if (r.gkg && r.gkg.articles > 0) {
    const g = r.gkg;
    const sample = g.sampleShare !== null && g.sampleShare < 1 ? `; shares of the articles in the ${Math.round(g.sampleShare * 1000) / 10}% of GKG files read` : '';
    const top = g.themes.slice(0, 4);
    if (top.length) {
      figures.push({
        label: `Economic themes in the news, ${weekOf(r)}`,
        value: top.map((t) => `${t.label} ${t.sharePct}%${t.baselineSharePct !== undefined ? ` (before ${t.baselineSharePct}%)` : ''}`).join('; '),
        source: `${GDELT_GKG_SHORT}, ${pulled}; share of ${g.articles} articles that name a place in the country${sample}`,
        tag: 'live',
      });
      const risers = top.filter((t) => t.baselineSharePct !== undefined && t.sharePct >= 1.5 * (t.baselineSharePct || 0) && t.sharePct - (t.baselineSharePct || 0) >= 2);
      if (risers.length) sentences.push(`More of the coverage is about ${risers.map((t) => t.label.toLowerCase()).join(' and ')} than in the weeks before.`);
    }
    figures.push({ label: 'News tone (GKG articles)', value: signed(g.toneMean, 2), source: `${GDELT_GKG_SHORT}, ${pulled}; ${TONE_RULE}`, tag: 'live' });
  }
  const names = [...r.topPersons.slice(0, 3).map((p) => p.name), ...r.topOrgs.slice(0, 3).map((o) => o.name)];
  if (names.length) figures.push({ label: 'Most named in economic coverage (4 weeks)', value: names.join(', '), source: `${GDELT_GKG_SHORT}, ${pulled}`, tag: 'live' });
  return { figures, sentences, surge };
}

/**
 * Figures and sentences from ACLED monthly counts for the Politics & Events Agent. Counts are what
 * ACLED returned for the window shown; the "rising" reading is a stated rule on top.
 */
export function acledFigures(r: AcledReading, now = new Date()): {
  figures: Array<{ label: string; value: string; source: string; tag: 'live' | 'official' | 'model' }>;
  sentences: string[];
  rising: boolean;
} {
  const window = `${acledMonthLabel(r.total.from)} to ${acledMonthLabel(r.total.to)}`;
  const lag = acledLagMonths(r, now);
  const file = r.fromFile;
  const lagNote =
    lag < 3 ? '' : file ? `; the file ends ${r.latestEventDate}, about ${lag} months ago: download a newer one from myACLED` : `; newest event ${r.latestEventDate}, so your ACLED access lags about ${lag} months`;
  const src = file
    ? `ACLED (Armed Conflict Location & Event Data) aggregated file you downloaded (${file.file}, saved ${r.pulledAt.slice(0, 10)}, weeks to ${r.latestEventDate}), country = ${r.country}; weekly Admin 1 counts added into months by the app, a week counted in the month it starts${lagNote}`
    : `ACLED (Armed Conflict Location & Event Data), accessed ${r.pulledAt.slice(0, 10)}, country = ${r.country}; monthly counts worked out by the app${lagNote}`;
  const tag = file ? ('official' as const) : ('live' as const);
  const types = Object.entries(r.total.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t.toLowerCase()} ${n}`).join(', ');
  const figures: Array<{ label: string; value: string; source: string; tag: 'live' | 'official' | 'model' }> = [
    { label: `Conflict events, ${window}`, value: `${r.total.events} events (${types}); ${r.total.fatalities} reported fatalities`, source: src, tag },
    { label: 'Conflict events a month', value: `${r.recentAvg} over the last three months, against ${r.priorAvg} over the nine before`, source: `${ACLED_SHORT}${file ? ' (downloaded file)' : ''}; ${window}`, tag },
  ];
  const rising = acledRising(r);
  const sentences: string[] = [];
  if (rising) {
    figures.push({ label: 'Conflict reading', value: 'rising', source: `Rule: ${ACLED_RISING_RULE}`, tag: 'model' });
    sentences.push(`ACLED records more conflict events lately: ${r.recentAvg} a month over the last three months against ${r.priorAvg} before.`);
  } else {
    sentences.push(`ACLED records ${r.total.events} conflict events over ${window}.`);
  }
  return { figures, sentences, rising };
}
