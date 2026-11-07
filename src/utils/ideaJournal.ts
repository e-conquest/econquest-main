/**
 * Trade idea journal (seven-groups plan, Phase 3): log an idea with its thesis, instrument,
 * direction, horizon and invalidation; the record is fixed and hashed when it is logged, and scored
 * from the same free feeds when the horizon comes. Scoring, not a signal: it keeps the record of
 * calls honest, it does not make them.
 *
 * Instruments (the ones the app has daily free history for):
 * - fx: a currency against the US dollar (ECB reference rates). Long = expects the currency to
 *   strengthen. Move = % change in the idea's direction from the entry fixing. Optional
 *   invalidation: an adverse move of that many % on any ECB day before the horizon ends the idea as
 *   invalidated (a miss).
 * - policy: the central bank's policy rate (BIS daily). Up, down or unchanged at the horizon.
 *
 * Entry level = the latest published value on the day the idea is logged (stated with its date).
 * The horizon is scored on the first published value on or after the horizon date. Ideas are never
 * edited; the store is append-only, and the hash (SHA-256 of the record's canonical JSON, computed
 * on the server) lets anyone check a record was not changed after it was logged.
 *
 * Browser-safe, pure (hashing is done by the caller).
 */

export type IdeaInstrument = 'fx' | 'policy';
export type IdeaDirection = 'long' | 'short' | 'up' | 'down' | 'unchanged';
export const IDEA_TYPES = ['carry', 'value', 'momentum', 'macro', 'policy', 'event', 'other'] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

export const IDEA_MIN_DAYS = 7;
export const IDEA_MAX_DAYS = 730;
export const THESIS_MAX = 2000;

export interface IdeaInput {
  iso3: string;
  instrument: IdeaInstrument;
  direction: IdeaDirection;
  horizonDays: number;
  /** fx only: adverse move in % that ends the idea early. */
  invalidationPct?: number;
  thesis: string;
  type: IdeaType;
}

export interface Idea extends IdeaInput {
  id: string;
  loggedAt: string;
  author: string;
  /** Currency (fx) or BIS area (policy). */
  target: string;
  entry: { date: string; level: number };
  horizonDate: string;
  hash: string;
}

export type IdeaStatus = 'open' | 'hit' | 'miss' | 'invalidated' | 'no_data';

export interface IdeaScore {
  status: IdeaStatus;
  /** fx: % move in the idea's direction; policy: change in points. */
  move?: number;
  /** The published value the idea was scored on, and its date. */
  at?: { date: string; level: number };
  note?: string;
}

/** Problems with an idea as typed, or an empty list. */
export function validateIdea(x: Partial<IdeaInput>): string[] {
  const out: string[] = [];
  if (!x.iso3 || !/^[A-Z]{3}$/.test(x.iso3)) out.push('a country (ISO3 code)');
  if (x.instrument !== 'fx' && x.instrument !== 'policy') out.push('an instrument (currency or policy rate)');
  const okDir = x.instrument === 'fx' ? ['long', 'short'] : ['up', 'down', 'unchanged'];
  if (!x.direction || !okDir.includes(x.direction)) out.push(`a direction (${okDir.join(', ')})`);
  if (!Number.isInteger(x.horizonDays) || x.horizonDays! < IDEA_MIN_DAYS || x.horizonDays! > IDEA_MAX_DAYS) out.push(`a horizon of ${IDEA_MIN_DAYS} to ${IDEA_MAX_DAYS} days`);
  if (x.invalidationPct !== undefined && (x.instrument !== 'fx' || !(x.invalidationPct > 0 && x.invalidationPct <= 50))) out.push('an invalidation between 0 and 50% (currency ideas only)');
  if (!x.thesis || !x.thesis.trim()) out.push('a thesis');
  else if (x.thesis.length > THESIS_MAX) out.push(`a thesis of at most ${THESIS_MAX} characters`);
  if (!x.type || !(IDEA_TYPES as readonly string[]).includes(x.type)) out.push(`a type (${IDEA_TYPES.join(', ')})`);
  return out;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** The record's canonical JSON (sorted keys, no hash): what the hash is taken over. */
export function canonicalIdea(i: Omit<Idea, 'hash'> | Idea): string {
  const { hash: _h, ...rest } = i as Idea;
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(sort(rest));
}

/** Latest published value on or before `date`. */
export function valueOnOrBefore(points: Array<{ date: string; value: number }>, date: string): { date: string; level: number } | null {
  let found: { date: string; level: number } | null = null;
  for (const p of points) if (p.date <= date && Number.isFinite(p.value)) found = { date: p.date, level: p.value };
  return found;
}

/**
 * Scores an idea against the published series (fx: units per USD; policy: %), oldest first.
 * `today` is YYYY-MM-DD.
 */
export function scoreIdea(idea: Idea, points: Array<{ date: string; value: number }>, today: string): IdeaScore {
  const after = points.filter((p) => p.date > idea.entry.date && Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (idea.instrument === 'fx') {
    const sign = idea.direction === 'long' ? 1 : -1;
    // Units per USD falling = the currency strengthening, so a long gains when the rate falls.
    const moveAt = (v: number) => Number((sign * 100 * (idea.entry.level / v - 1)).toFixed(2));
    for (const p of after) {
      if (p.date >= idea.horizonDate) {
        const m = moveAt(p.value);
        return { status: m > 0 ? 'hit' : 'miss', move: m, at: { date: p.date, level: p.value } };
      }
      if (idea.invalidationPct !== undefined && moveAt(p.value) <= -idea.invalidationPct) {
        return { status: 'invalidated', move: moveAt(p.value), at: { date: p.date, level: p.value }, note: `adverse move of ${idea.invalidationPct}% reached before the horizon` };
      }
    }
  } else {
    const p = after.find((x) => x.date >= idea.horizonDate);
    if (p) {
      const ch = Number((p.value - idea.entry.level).toFixed(4));
      const hit = idea.direction === 'up' ? ch > 0 : idea.direction === 'down' ? ch < 0 : ch === 0;
      return { status: hit ? 'hit' : 'miss', move: ch, at: { date: p.date, level: p.value } };
    }
  }
  if (today < idea.horizonDate) {
    const last = after[after.length - 1];
    return { status: 'open', ...(last ? { at: { date: last.date, level: last.value }, move: idea.instrument === 'fx' ? Number(((idea.direction === 'long' ? 1 : -1) * 100 * (idea.entry.level / last.value - 1)).toFixed(2)) : Number((last.value - idea.entry.level).toFixed(4)) } : {}) };
  }
  return { status: 'no_data', note: 'the horizon has passed but no published value on or after it has been read yet' };
}

export const IDEA_METHOD = `Each idea is fixed when it is logged: country, instrument (currency against the US dollar, ECB reference rates; or the policy rate, BIS daily), direction, horizon (${IDEA_MIN_DAYS} to ${IDEA_MAX_DAYS} days), optional invalidation, thesis and type. Entry = the latest published value on the day it is logged; the record is hashed (SHA-256 of its canonical JSON) and appended, never edited. At the horizon it is scored on the first published value on or after the horizon date: a currency idea is a hit when the move in its direction is above zero, a policy idea when the rate moved the way it said. Scoring, not a signal.`;

export interface IdeaSummaryRow {
  type: IdeaType | 'all';
  closed: number;
  hits: number;
  hitRate: number | null;
  /** Average fx move in % over closed fx ideas. */
  avgFxMove: number | null;
  open: number;
}

export function summariseIdeas(scored: Array<{ idea: Idea; score: IdeaScore }>): IdeaSummaryRow[] {
  const row = (type: IdeaSummaryRow['type'], xs: typeof scored): IdeaSummaryRow => {
    const closed = xs.filter((x) => x.score.status === 'hit' || x.score.status === 'miss' || x.score.status === 'invalidated');
    const hits = closed.filter((x) => x.score.status === 'hit').length;
    const fx = closed.filter((x) => x.idea.instrument === 'fx' && x.score.move !== undefined);
    return {
      type,
      closed: closed.length,
      hits,
      hitRate: closed.length ? Number((hits / closed.length).toFixed(3)) : null,
      avgFxMove: fx.length ? Number((fx.reduce((a, x) => a + x.score.move!, 0) / fx.length).toFixed(2)) : null,
      open: xs.filter((x) => x.score.status === 'open').length,
    };
  };
  const types = IDEA_TYPES.filter((t) => scored.some((x) => x.idea.type === t));
  return [row('all', scored), ...types.map((t) => row(t, scored.filter((x) => x.idea.type === t)))];
}
