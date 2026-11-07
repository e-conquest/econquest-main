import type { OpenDataSnapshot } from '../types/council';

/**
 * Keeps the last good figures when a refresh comes back short.
 *
 * A country snapshot is pulled from several feeds at once. Before this, a refresh during a Wi-Fi
 * drop (or one slow IMF answer) was saved over the good copy and not retried for a week, so the
 * figures read Missing for days. Now any figure the new pull lacks but the saved copy had is kept,
 * with its original source label plus "kept from the <date> pull", and the snapshot is marked so
 * the server retries it within the hour.
 *
 * Never carried: the 5Y CDS (it follows the own-data switch in Settings, which may have been turned
 * off on purpose) and anything the saved copy itself had only as a built-in value.
 */

/** Feed groups: the liveFields paths each covers, the source-list entries that name it, and its companion objects. */
interface FeedGroup {
  paths: (path: string) => boolean;
  source: RegExp;
  companions: (keyof OpenDataSnapshot)[];
}

const GROUPS: FeedGroup[] = [
  { paths: (p) => p.startsWith('imf.'), source: /IMF/i, companions: [] },
  { paths: (p) => p.startsWith('wb.'), source: /World Bank/i, companions: [] },
  { paths: (p) => p.startsWith('gdelt.'), source: /GDELT/i, companions: ['gdeltPull'] },
  { paths: (p) => p.startsWith('polymarket.'), source: /Polymarket/i, companions: ['polymarketContracts'] },
  { paths: (p) => p === 'market.exchangeRatePerUsd' || p === 'market.fxYtdChangePct', source: /Spot FX|ExchangeRate|Frankfurter|Live FX/i, companions: [] },
  { paths: (p) => p === 'market.sovereign10YBondYieldPct', source: /FRED|Tesouro|EVDS|official 10Y/i, companions: ['official10YYield'] },
];

/** Where each liveFields prefix lives on the snapshot. */
const SECTION: Record<string, keyof OpenDataSnapshot> = {
  imf: 'imfIndicators',
  wb: 'worldBankIndicators',
  market: 'monetaryAndMarket',
  gdelt: 'gdeltMetrics',
};

const NEVER_CARRY = new Set(['market.cds5YSpreadBps']);

export const KEPT_MARK = 'kept from the';

export function keptLabel(label: string, pulledAt: number): string {
  const base = label.replace(/ · kept from the \d{4}-\d{2}-\d{2} pull$/, '');
  if (base !== label) return label; // already carried once: keep the original date
  return `${base} · ${KEPT_MARK} ${new Date(pulledAt).toISOString().slice(0, 10)} pull`;
}

function readPath(snap: OpenDataSnapshot, path: string): { section: any; key: string } | null {
  const [prefix, key] = path.split('.', 2);
  if (!key) return null;
  if (prefix === 'polymarket') return null; // contracts live on their own companion object
  const name = SECTION[prefix];
  const section = name ? (snap as any)[name] : undefined;
  return section && typeof section === 'object' ? { section, key } : null;
}

export interface MergeResult {
  snapshot: OpenDataSnapshot;
  /** Figures copied from the saved copy, by path. */
  carried: string[];
  /** True when the new pull missed something it should be retried for soon. */
  incomplete: boolean;
}

/**
 * `fresh` is the new pull, `prev` the saved copy pulled at `prevPulledAt`. Returns the snapshot to
 * save. `fresh` is not modified.
 */
export function mergeLastGood(fresh: OpenDataSnapshot, prev: OpenDataSnapshot | null | undefined, prevPulledAt: number): MergeResult {
  const out: OpenDataSnapshot = structuredClone(fresh);
  out.liveFields = { ...(out.liveFields || {}) };
  const freshSources = out.dataStatus?.verifiedLiveSources ?? [];
  const nothingLive = freshSources.length === 0 && Object.keys(out.liveFields).length === 0;
  if (!prev?.liveFields || !prev.dataStatus) return { snapshot: out, carried: [], incomplete: nothingLive };

  const carried: string[] = [];
  const carriedGroups = new Set<FeedGroup>();
  for (const [path, label] of Object.entries(prev.liveFields)) {
    if (NEVER_CARRY.has(path) || out.liveFields[path] || !label || label === 'AI estimate') continue;
    const group = GROUPS.find((g) => g.paths(path));
    if (!group) continue; // policy rate (applied when served), user connectors: not ours to keep
    if (path !== 'polymarket.contracts') {
      const from = readPath(prev, path);
      const to = readPath(out, path);
      if (!from || !to || from.section[from.key] === undefined) continue;
      to.section[to.key] = structuredClone(from.section[from.key]);
    }
    out.liveFields[path] = keptLabel(label, prevPulledAt);
    const prevYear = prev.imfIndicators?.years?.[path];
    if (path.startsWith('imf.') && prevYear) out.imfIndicators.years = { ...(out.imfIndicators.years || {}), [path]: prevYear };
    carried.push(path);
    carriedGroups.add(group);
  }

  for (const group of carriedGroups) {
    for (const c of group.companions) {
      if ((out as any)[c] === undefined && (prev as any)[c] !== undefined) (out as any)[c] = structuredClone((prev as any)[c]);
    }
  }

  // Government debt falling due: one block from QEDS, IDS and BIS; keep the saved one if the new pull has none.
  let keptDebt = false;
  if (!out.debtSchedule && prev.debtSchedule) {
    out.debtSchedule = structuredClone(prev.debtSchedule);
    keptDebt = true;
  }

  const prevSources = prev.dataStatus.verifiedLiveSources || [];
  const kept = prevSources
    .filter((s) => !freshSources.includes(s))
    .filter((s) => [...carriedGroups].some((g) => g.source.test(s)) || (keptDebt && /QEDS|IDS|BIS debt securities/.test(s)))
    .map((s) => keptLabel(s, prevPulledAt));
  if (kept.length) {
    const sources = Array.from(new Set([...freshSources, ...kept]));
    out.liveApiSourcesActive = sources;
    out.dataStatus = { verifiedLiveSources: sources, checkedAt: out.dataStatus?.checkedAt || out.fetchedAt };
  }

  return { snapshot: out, carried, incomplete: nothingLive || carried.length > 0 || keptDebt };
}
