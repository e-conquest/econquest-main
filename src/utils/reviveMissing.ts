/**
 * A missing figure is NaN in the app (shown as Missing). JSON has no NaN, so a figure the server
 * sends as NaN arrives as null, and code that does arithmetic or .toFixed on it would crash. This
 * walks a reply from the server beside a template built in the browser (the same empty shape) and
 * turns null back into NaN wherever the template holds a number.
 */
export function reviveMissing<T>(value: T, template: unknown): T {
  if (value === null || value === undefined) {
    return (typeof template === 'number' ? Number.NaN : value) as T;
  }
  if (Array.isArray(value)) {
    const t = Array.isArray(template) ? template : [];
    return value.map((v, i) => reviveMissing(v, t[i] ?? t[0])) as unknown as T;
  }
  if (typeof value === 'object' && template && typeof template === 'object' && !Array.isArray(template)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [k, t] of Object.entries(template as Record<string, unknown>)) {
      if (k in out) out[k] = reviveMissing(out[k], t);
    }
    return out as T;
  }
  return value;
}

/** The number fields of a watchlist row, for reviving rows read back from browser storage. */
export const WATCHLIST_ROW_NUMBERS = {
  yield10YPct: Number.NaN,
  cds5YBps: Number.NaN,
  debtToGdpPct: Number.NaN,
  fxReservesMonths: Number.NaN,
};

/** Watchlist groups read back from browser storage, with missing figures as NaN again. */
export function reviveWatchlistGroups<G extends { items: object[] }>(groups: G[]): G[] {
  return groups.map((g) => ({ ...g, items: g.items.map((it) => reviveMissing(it, WATCHLIST_ROW_NUMBERS)) }));
}
