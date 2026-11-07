/**
 * Hard-currency (US dollar) sovereign bond spread: the extra yield a government's dollar bonds pay
 * over US Treasuries of similar maturity, in basis points. It stands in for 5Y CDS, which no free
 * source publishes (Sam, 2026-11-06). It is a BOND spread, not CDS, and every label says so.
 *
 * Source: Banco Central de Reserva del Perú (BCRP), BCRPData, "Indicadores de riesgo para países
 * emergentes: EMBIG". BCRP republishes J.P. Morgan's EMBI Global spread (via Reuters) for eight
 * Latin American countries plus the Latin American and emerging-market aggregates. Free, no key.
 *
 *   https://estadisticas.bcrp.gob.pe/estadisticas/series/api/<codes>/json/<from>/<to>/ing
 *
 * Monthly averages, published about three weeks after the month ends, so the figure always shows
 * its month. Countries outside the eight read Missing with the reason: no free official source
 * publishes the spread for them. (BCRP's daily EMBIG series stopped updating in 2026; the monthly
 * PN436xx series are the current ones.)
 */

/** BCRP monthly EMBIG series (current set, from Jan 2016). */
export const BCRP_EMBIG_SERIES: Record<string, string> = {
  PER: 'PN43672XM',
  ARG: 'PN43673XM',
  BRA: 'PN43674XM',
  CHL: 'PN43675XM',
  COL: 'PN43676XM',
  ECU: 'PN43677XM',
  MEX: 'PN43678XM',
  VEN: 'PN43679XM',
};
/** Aggregates, shown for context beside a country. */
export const BCRP_EMBIG_AGGREGATES = { latam: 'PN43680XM', em: 'PN43681XM' } as const;

export const HC_SPREAD_LABEL = 'USD bond spread';
export const HC_SPREAD_LONG = 'Hard-currency (USD) government bond spread over US Treasuries (J.P. Morgan EMBI Global)';
/** Pushed into dataStatus.verifiedLiveSources when a country's spread is filled. */
export const HC_SPREAD_FEED_LABEL = 'BCRP EMBIG (USD bond spread)';
export const HC_SPREAD_SOURCE = 'J.P. Morgan EMBI Global via Banco Central de Reserva del Perú (BCRPData)';
export const HC_SPREAD_NOT_CDS =
  'This is a bond spread, not CDS: it is the extra yield on the government\'s US dollar bonds over US Treasuries, a monthly average. It moves with CDS but is not the same contract or the same number.';

export interface HcSpreadObservation {
  iso3: string;
  bps: number;
  /** YYYY-MM, monthly average. */
  period: string;
  seriesId: string;
  source: string;
  url: string;
  /** Change against 3 and 12 calendar months earlier, in bps, when those months are in the series. */
  change3mBps?: number;
  change12mBps?: number;
  /** Up to 36 months, oldest first, for the history chart. */
  history: Array<{ period: string; bps: number }>;
}

export interface HcSpreadPull {
  /** When the pull answered, ISO. */
  at: string;
  countries: Record<string, HcSpreadObservation>;
  aggregates: { latam?: { bps: number; period: string }; em?: { bps: number; period: string } };
}

export function hasHcSpreadSource(iso3: string): boolean {
  return Boolean(BCRP_EMBIG_SERIES[iso3]);
}

/** Every series in one request; BCRP joins codes with "-". Monthly periods are YYYY-M. */
export function bcrpEmbigUrl(now = new Date(), monthsBack = 40): string {
  const codes = [...Object.values(BCRP_EMBIG_SERIES), BCRP_EMBIG_AGGREGATES.latam, BCRP_EMBIG_AGGREGATES.em];
  const end = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
  const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const start = `${s.getUTCFullYear()}-${s.getUTCMonth() + 1}`;
  return `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${codes.join('-')}/json/${start}/${end}/ing`;
}

/** Why a BCRP reply could not be read, in words, for the connection check and the server log. */
export function describeBcrpReply(text: string | undefined): string {
  const t = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!t) return 'BCRP answered with an empty reply.';
  if (/^<(!doctype|html)/i.test(t))
    return /<script[^>]+src=/i.test(t) && !/periods/i.test(t)
      ? "BCRP's site answered with a web page that only loads a script (its bot check) instead of data, so it is not letting the app read the series from this computer."
      : 'BCRP answered with a web page instead of data.';
  const doc = safeJson(t) as { config?: { series?: Array<{ name?: string }> }; periods?: unknown[] } | null;
  if (!doc) return `BCRP answered, but not with JSON the app could read (it began "${t.slice(0, 60).replace(/\s+/g, ' ')}"; ${bcrpParseError(t)}).`;
  const names = (doc.config?.series || []).map((s) => String(s?.name ?? '').split(' - ').pop()).join(', ');
  if (!Array.isArray(doc.periods) || !doc.periods.length) return `BCRP answered with no months of data${names ? ` (series: ${names})` : ''}.`;
  return `BCRP answered, but its series were not the eight countries and two aggregates the app reads, in that order (it sent: ${names || 'no series names'}).`;
}

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

/** "Sep.2026", "Set.2026", "Sep.26", "2026-9" -> "2026-09", else null. */
export function parseBcrpMonth(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*[.\s-]?(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${y}-${String(mo).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return null;
}

/** EMBIG spreads run from under 100 bps to tens of thousands after a default (Venezuela). */
export const plausibleSpreadBps = (v: number) => Number.isFinite(v) && v > 0 && v < 100000;

function monthsBefore(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/**
 * Reads BCRP's JSON reply: { config: { series: [{ name }] }, periods: [{ name, values: [] }] },
 * values in the order the codes were asked for, "n.d." where there is none. Columns are matched
 * to codes by position, and checked against the series name so a reordered reply is refused
 * rather than misread.
 */
export function parseBcrpEmbig(body: unknown, url: string, at = new Date().toISOString()): HcSpreadPull | null {
  const doc = typeof body === 'string' ? safeJson(body.replace(/^\uFEFF/, '').trim()) : body;
  if (!doc || typeof doc !== 'object') return null;
  const periods = (doc as { periods?: unknown }).periods;
  const series = (doc as { config?: { series?: Array<{ name?: string }> } }).config?.series;
  if (!Array.isArray(periods) || !Array.isArray(series)) return null;
  const codes = [...Object.entries(BCRP_EMBIG_SERIES), ['_latam', BCRP_EMBIG_AGGREGATES.latam], ['_em', BCRP_EMBIG_AGGREGATES.em]] as Array<[string, string]>;
  if (series.length !== codes.length) return null;
  const nameWords: Record<string, RegExp> = {
    PER: /Per[uú]/i, ARG: /Argentin/i, BRA: /Bra[sz]il/i, CHL: /Chile/i, COL: /Colombia/i, ECU: /Ecuador/i,
    MEX: /M[eé]xic/i, VEN: /Venezuela/i, _latam: /Latin/i, _em: /Emerg/i,
  };
  for (let i = 0; i < codes.length; i++) {
    const want = nameWords[codes[i][0]];
    if (want && !want.test(String(series[i]?.name ?? ''))) return null;
  }
  const cols: Array<Map<string, number>> = codes.map(() => new Map());
  for (const p of periods as Array<{ name?: unknown; values?: unknown }>) {
    const period = parseBcrpMonth(p?.name);
    if (!period || !Array.isArray(p.values)) continue;
    p.values.forEach((raw, i) => {
      if (i >= cols.length) return;
      const v = Number(String(raw).replace(',', '.'));
      if (String(raw).trim() !== '' && plausibleSpreadBps(v)) cols[i].set(period, v);
    });
  }
  const out: HcSpreadPull = { at, countries: {}, aggregates: {} };
  codes.forEach(([iso3, seriesId], i) => {
    const entries = [...cols[i].entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) return;
    const [period, bps] = entries[entries.length - 1];
    if (iso3 === '_latam' || iso3 === '_em') {
      out.aggregates[iso3 === '_latam' ? 'latam' : 'em'] = { bps, period };
      return;
    }
    const obs: HcSpreadObservation = {
      iso3,
      bps,
      period,
      seriesId,
      source: HC_SPREAD_SOURCE,
      url,
      history: entries.slice(-36).map(([p, v]) => ({ period: p, bps: v })),
    };
    const c3 = cols[i].get(monthsBefore(period, 3));
    const c12 = cols[i].get(monthsBefore(period, 12));
    if (c3 !== undefined) obs.change3mBps = Math.round(bps - c3);
    if (c12 !== undefined) obs.change12mBps = Math.round(bps - c12);
    out.countries[iso3] = obs;
  });
  return Object.keys(out.countries).length ? out : null;
}

/**
 * BCRP's reply as JSON. On Sam's Mac (2026-11-06) it began with the JSON object but did not parse
 * as a whole, so after a plain parse fails the object is cut out on its own (from the first "{"
 * to the brace that closes it, outside strings), and raw line breaks or tabs inside its strings,
 * which JSON does not allow, are turned into spaces.
 */
export function bcrpJson(raw: string): unknown {
  const s = raw.replace(/^\uFEFF/, '').trim();
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(s);
  if (whole !== undefined) return whole;
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const obj = s.slice(start, end >= 0 ? end + 1 : undefined);
  const cut = tryParse(obj);
  if (cut !== undefined) return cut;
  const cleaned = tryParse(obj.replace(/[\u0000-\u001F]+/g, ' '));
  return cleaned === undefined ? null : cleaned;
}

/** Why the reply did not parse, with its end, for the check's message. */
export function bcrpParseError(raw: string): string {
  const s = raw.replace(/^\uFEFF/, '').trim();
  try {
    JSON.parse(s);
    return '';
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 120) : 'parse error';
    return `${msg}; ${s.length} characters, ending "${s.slice(-60).replace(/\s+/g, ' ')}"`;
  }
}

function safeJson(s: string): unknown {
  return bcrpJson(s);
}

/** Why the spread reads Missing for a country. */
export function hcSpreadMissing(iso3: string): { kind: 'setup' | 'unreachable'; short: string; help: string } {
  if (hasHcSpreadSource(iso3))
    return {
      kind: 'unreachable',
      short: 'BCRP did not answer',
      help: 'The central bank of Peru (BCRPData, free, no key) publishes this spread monthly and did not answer. Press Refresh now, or download it under Menu > Offline data.',
    };
  return {
    kind: 'setup',
    short: 'No free source',
    help: 'No free official source publishes a US dollar bond spread for this country. BCRP covers Argentina, Brazil, Chile, Colombia, Ecuador, Mexico, Peru and Venezuela.',
  };
}

/** "Sep 2026 avg" from "2026-09". */
export function hcSpreadWhen(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1] ?? m} ${y} avg`;
}

/** One line for agents, Explain and documents. */
export function describeHcSpread(o: Pick<HcSpreadObservation, 'bps' | 'period' | 'change12mBps'>): string {
  const chg = o.change12mBps !== undefined ? `, ${o.change12mBps >= 0 ? '+' : ''}${o.change12mBps} bps on a year earlier` : '';
  return `${Math.round(o.bps)} bps over US Treasuries (${hcSpreadWhen(o.period)}${chg}; J.P. Morgan EMBI Global via BCRP; a bond spread, not CDS)`;
}
