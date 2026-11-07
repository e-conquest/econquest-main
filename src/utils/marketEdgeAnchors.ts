/**
 * MarketEdge benchmarks: the five markets always shown on the MarketEdge screen, whatever the
 * watchlist holds (Sam, 2026-11-04): United States, China, Russia, United Kingdom, EU, India.
 *
 * Only the UK is a full country in the app (brief, CDS), so it joins the peer rows.
 * The other four are benchmark rows: their official 10Y yield where a free source exists, the
 * spread over US Treasuries, and your own CDS quote if your CDS file or LSEG covers them.
 *
 * Sources, checked on fred.stlouisfed.org on 2026-11-04:
 * - United States: IRLTLT01USM156N (OECD, monthly), the same series as the spread benchmark.
 * - United Kingdom: IRLTLT01GBM156N (OECD, monthly).
 * - EU: the German 10Y Bund, IRLTLT01DEM156N (latest Sep 2026), the usual euro benchmark. The
 *   euro-area composite (IRLTLT01EZM156N) stopped at Jan 2026, so it is not used.
 * - Russia: the OECD series (IRLTLT01RUM156N) stopped in Jun 2018. No free current source.
 * - India: INDIRLTLT01STM (OECD, monthly; latest Sep 2026).
 * - China: no free official 10Y source is wired in yet.
 */
import type { LiveWatchlistItem } from '../types/council';
import { toLive } from './liveFigures';
import { FRED_10Y_SERIES, US_10Y_SERIES, describeOfficialYield, type OfficialYieldObservation } from './officialYields';
import type { OwnCdsQuote } from './ownCds';
import { formatPeriod } from './officialYields';
import { cliMissing } from './oecdCli';
import { formatMonth } from './oecdSdmx';

export interface MarketEdgeAnchorDef {
  iso3: string;
  name: string;
  /** What the yield is, e.g. "German Bund 10Y". */
  instrument?: string;
  fredSeries?: string;
  /** Said instead of a yield when there is no free source. */
  noYieldReason?: string;
  /** Said instead of a CDS figure when there is no market at all. */
  noCdsReason?: string;
}

export const MARKET_EDGE_ANCHORS: MarketEdgeAnchorDef[] = [
  { iso3: 'USA', name: 'United States', instrument: 'US Treasury 10Y', fredSeries: US_10Y_SERIES },
  { iso3: 'CHN', name: 'China', noYieldReason: 'No free official source wired in yet' },
  {
    iso3: 'RUS',
    name: 'Russia',
    noYieldReason: 'OECD series stopped in Jun 2018; no free current source',
    noCdsReason: 'No CDS market since the 2022 credit event and sanctions',
  },
  { iso3: 'GBR', name: 'United Kingdom', instrument: 'UK gilt 10Y', fredSeries: FRED_10Y_SERIES.GBR },
  { iso3: 'EUU', name: 'EU (euro benchmark)', instrument: 'German Bund 10Y', fredSeries: 'IRLTLT01DEM156N' },
  { iso3: 'IND', name: 'India', instrument: 'India G-sec 10Y', fredSeries: 'INDIRLTLT01STM' },
];

export const MARKET_EDGE_ANCHOR_ISO3 = MARKET_EDGE_ANCHORS.map((a) => a.iso3);

/** What the server sends for one benchmark. */
export interface MarketEdgeAnchor {
  iso3: string;
  countryName: string;
  instrument?: string;
  yield?: OfficialYieldObservation;
  noYieldReason?: string;
  cds?: OwnCdsQuote;
  noCdsReason?: string;
  /** OECD composite leading indicator, with the date the app pulled it. */
  cli?: import('./oecdCli').CliReading & { pulledAt: string };
  /** Set when the OECD answered but publishes no CLI for this area. */
  cliPulledAt?: string;
}

export interface MarketEdgeAnchorsReply {
  anchors: MarketEdgeAnchor[];
  /** Benchmarks that are full countries in the app (the UK), with their live watchlist figures. */
  peers: LiveWatchlistItem[];
  us10Y?: OfficialYieldObservation;
  fetchedAt: string;
}

/** Builds one benchmark from what the feeds returned. A feed that did not answer says so. */
export function buildAnchor(def: MarketEdgeAnchorDef, yieldObs: OfficialYieldObservation | null | undefined, cds?: OwnCdsQuote): MarketEdgeAnchor {
  return {
    iso3: def.iso3,
    countryName: def.name,
    instrument: def.instrument,
    ...(yieldObs ? { yield: yieldObs } : { noYieldReason: def.noYieldReason || 'FRED did not answer' }),
    ...(cds && !def.noCdsReason ? { cds } : def.noCdsReason ? { noCdsReason: def.noCdsReason } : {}),
  };
}

export interface BenchmarkRow {
  iso3: string;
  countryName: string;
  yieldPct?: number;
  yieldNote: string;
  spreadBps?: number;
  cdsBps?: number;
  cdsNote: string;
  /** OECD leading indicator in words, or why it is missing. */
  cliNote: string;
}

/**
 * Rows for the benchmarks that are not already in the peer list. The US row has no spread (it is
 * the benchmark). Without your own quote, CDS says there is no feed rather than show a sample.
 */
export function benchmarkRows(anchors: MarketEdgeAnchor[], peerIso3: string[], us10YPct?: number): BenchmarkRow[] {
  const have = new Set(peerIso3);
  return anchors
    .filter((a) => !have.has(a.iso3))
    .map((a) => ({
      iso3: a.iso3,
      countryName: a.countryName,
      yieldPct: a.yield?.valuePct,
      yieldNote: a.yield ? `${a.instrument ? `${a.instrument}, ` : ''}official, ${describeOfficialYield(a.yield).when}` : a.noYieldReason || 'No source',
      spreadBps: a.yield && us10YPct !== undefined && a.iso3 !== 'USA' ? Math.round((a.yield.valuePct - us10YPct) * 100) : undefined,
      cdsBps: a.cds?.bps,
      cdsNote: a.cds ? `Your ${a.cds.source}, ${formatPeriod(a.cds.date)}` : a.noCdsReason || 'No CDS feed (add it to your CDS file)',
      cliNote: a.cli
        ? `OECD leading indicator ${a.cli.level.toFixed(2)}, ${formatMonth(a.cli.month)}${a.cli.phase ? ` (${a.cli.phase})` : ''}`
        : `OECD leading indicator: Missing (${cliMissing(!!a.cliPulledAt).short})`,
    }));
}

/** Watchlist plus the benchmarks that are full countries, without duplicates. */
export function marketEdgePeers(watchlist: LiveWatchlistItem[], anchorPeers: LiveWatchlistItem[]): LiveWatchlistItem[] {
  const have = new Set(watchlist.map((w) => w.iso3));
  // Benchmark rows arrive raw from the server: drop their built-in figures too.
  return [...watchlist, ...anchorPeers.filter((p) => !have.has(p.iso3)).map((p) => ({ ...toLive(p), isBenchmark: true }))];
}
