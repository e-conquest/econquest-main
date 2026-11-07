/**
 * Long histories for the nowcast and forecast models (server and scripts only). The everyday feeds
 * keep a short window on disk (about 40 months of the OECD leading indicator and CPI, BIS policy
 * rates from late 2024), which is too short to fit a model. This pulls the full runs once a week
 * and keeps them in data/live/model-history.json:
 *
 * - BIS central bank policy rates, monthly, from 1990
 * - OECD composite leading indicator via DBnomics, full history
 * - OECD consumer price inflation (y/y) via DBnomics, full history
 *
 * Quarterly GDP (OECD QNA) and the monthly activity indexes already come with their full history.
 * Only real observations; nothing filled in.
 */
import fs from 'fs';
import path from 'path';
import { BIS_API } from './bisDebtSecurities';
import { CBPOL_AREA, CBPOL_DATASET, parseCbpolCsv, type CbpolSeries } from './bisPolicyRates';
import { cliUrl, parseCli, type CliSeries } from './oecdCli';
import { cpiUrl, parseCpi, type CpiSeries } from './oecdInflation';
import { writeFileAtomic } from './atomicWrite';

export type TextFetcher = (url: string) => Promise<string>;

export interface ModelHistory {
  pulledAt: string;
  /** BIS area code -> monthly policy rate (end of month). */
  policyMonthly: Record<string, CbpolSeries> | null;
  cli: CliSeries | null;
  cpi: CpiSeries | null;
  /** What did not answer this time (the previous run's series are kept for those). */
  problems: string[];
}

export const MODEL_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function policyHistoryUrl(): string {
  const areas = [...new Set(Object.values(CBPOL_AREA))].sort().join('+');
  return `${BIS_API}/${CBPOL_DATASET}/M.${areas}/all?startPeriod=1990-01&format=csv`;
}

export const modelHistoryFile = (dataDir: string) => path.join(dataDir, 'live', 'model-history.json');

export function loadModelHistory(dataDir: string): ModelHistory | null {
  try {
    const h = JSON.parse(fs.readFileSync(modelHistoryFile(dataDir), 'utf8')) as ModelHistory;
    return h?.pulledAt ? h : null;
  } catch {
    return null;
  }
}

/** Pulls the three long runs. A source that fails keeps the previous run's copy and is named in problems. */
export async function pullModelHistory(fetcher: TextFetcher, prev: ModelHistory | null = null): Promise<ModelHistory> {
  const problems: string[] = [];
  const [policy, cli, cpi] = await Promise.all([
    fetcher(policyHistoryUrl()).then((t) => {
      const s = parseCbpolCsv(t, 'M');
      return Object.keys(s).length ? s : null;
    }).catch((e) => (problems.push(`BIS policy rates did not answer (${e.message})`), null)),
    // DBnomics one call at a time: the CPI call waits for the leading indicator.
    (async () => {
      let c: CliSeries | null = null;
      let p: CpiSeries | null = null;
      try {
        c = parseCli(await fetcher(cliUrl()), 100_000);
      } catch (e) {
        problems.push(`OECD leading indicator did not answer (${(e as Error).message})`);
      }
      try {
        p = parseCpi(await fetcher(cpiUrl()), 100_000);
      } catch (e) {
        problems.push(`OECD consumer prices did not answer (${(e as Error).message})`);
      }
      return [c, p] as const;
    })(),
  ]).then(([pol, pair]) => [pol, pair[0], pair[1]] as const);
  return {
    pulledAt: new Date().toISOString(),
    policyMonthly: policy ?? prev?.policyMonthly ?? null,
    cli: cli ?? prev?.cli ?? null,
    cpi: cpi ?? prev?.cpi ?? null,
    problems,
  };
}

export function saveModelHistory(dataDir: string, h: ModelHistory): void {
  const file = modelHistoryFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(h));
}

/**
 * Inflation run for a country: the OECD's full history, with a national series (BCB IPCA, Eurostat
 * HICP) appended for the months after the OECD's newest one. The source line names both.
 */
export function spliceInflation(
  oecd: { period: string; value: number }[] | undefined,
  national: { points: { period: string; value: number }[]; short?: string } | undefined,
  oecdLabel = 'OECD CPI via DBnomics'
): { points: { date: string; value: number }[]; source: string } | null {
  const base = (oecd || []).map((p) => ({ date: p.period, value: p.value }));
  const lastOecd = base.length ? base[base.length - 1].date : '';
  const extra = (national?.points || []).filter((p) => p.period > lastOecd).map((p) => ({ date: p.period, value: p.value }));
  const points = [...base, ...extra];
  if (!points.length) return null;
  const source = extra.length && base.length ? `${oecdLabel} to ${lastOecd}, then ${national?.short || 'national series'}` : extra.length ? national?.short || 'national series' : oecdLabel;
  return { points, source };
}
