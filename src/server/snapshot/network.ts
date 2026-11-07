/**
 * One country's live snapshot from the network: the free feeds for that country pulled together
 * into one OpenDataSnapshot.
 */

import { BIS_LABEL } from '../../utils/bisDebtSecurities';
import { HC_SPREAD_FEED_LABEL } from '../../utils/hardCurrencySpread.ts';
import { IDS_LABEL, QEDS_LABEL } from '../../utils/debtSchedule';
import { OWN_CDS_LABEL } from '../../utils/ownCds';
import { OpenDataSnapshot, PolymarketContract } from '../../types/council.ts';
import { applyGuiMacroConnectorsToSnapshot } from '../integrations';
import { buildBaselineOpenData, recomputeDerivedOpenDataAnalytics } from '../../data/presetsAndBaselines.ts';
import { fetchDebtSchedule, fetchHcSpread, fetchOfficial10YYield, fetchUs10YYield, loadOwnCds } from '../feeds/rates';
import { fetchFxYearEnd, fetchGlobalLivePlumbing } from '../feeds/markets';
import { fetchGdeltQuarterly, GDELT_REFRESH_DAYS } from '../feeds/gdelt';
import { fetchWithTimeout } from '../http';
import { officialYieldFeedLabel } from '../../utils/officialYields.ts';
import { polymarketMoves } from '../../utils/oddsMoves.ts';
import { IMF_EXTRA } from '../../utils/imfFiscal';

function getLatestImfValue(series: Record<string, number> | undefined, targetYears: string[]): number | undefined {
  if (!series || typeof series !== 'object') return undefined;
  for (const yr of targetYears) {
    if (typeof series[yr] === 'number' && !Number.isNaN(series[yr])) {
      return series[yr];
    }
  }
  return undefined;
}

/** The WEO year getLatestImfValue would pick, so a figure can say which year it is for. */
function latestImfYear(series: Record<string, number> | undefined, targetYears: string[]): string | undefined {
  if (!series || typeof series !== 'object') return undefined;
  return targetYears.find((yr) => typeof series[yr] === 'number' && !Number.isNaN(series[yr]));
}

export async function fetchLiveOpenDataSnapshotNetwork(
  iso3: string,
  countryNameHint?: string
): Promise<OpenDataSnapshot> {
  const normalizedIso = (iso3 || 'BRA').toUpperCase().trim();
  const baseline = buildBaselineOpenData(normalizedIso);
  if (countryNameHint) {
    baseline.countryName = countryNameHint;
  }

  const activeSources: string[] = [];
  // Which figures a live feed actually filled, by path; everything else is the built-in value.
  baseline.liveFields = {};
  const markLive = (path: string, source: string) => {
    baseline.liveFields![path] = source;
  };
  let liveReservesUsdBn: number | undefined;
  let liveShortTermDebtPctReserves: number | undefined;

  await Promise.allSettled([
    // 1. Expanded World Bank Open Data v2 API (6 structural & external balance indicators)
    (async () => {
      const wbIndicators = [
        'FI.RES.TOTL.MO', // FX Reserves in Months of Imports
        'FI.RES.TOTL.CD', // Total International Reserves (USD, including Gold)
        'BN.CAB.XOKA.GD.ZS', // Current Account Balance (% of GDP)
        'DT.DOD.DECT.GN.ZS', // Total External Debt Stocks (% of GNI)
        'DT.DOD.DSTC.IR.ZS', // Short-Term Debt (% of Total Reserves)
        'PV.EST', // WGI Political Stability & Absence of Violence (-2.5 to +2.5)
      ];
      const results = await Promise.allSettled(
        wbIndicators.map(async (ind) => {
          const res = await fetchWithTimeout(
            `https://api.worldbank.org/v2/country/${normalizedIso}/indicator/${ind}?format=json&per_page=6`
          );
          if (!res.ok) return { ind, row: null };
          const data: any = await res.json();
          const rows = Array.isArray(data?.[1]) ? data[1] : [];
          const validRow = rows.find((r: any) => typeof r?.value === 'number' && !Number.isNaN(r.value));
          return { ind, row: validRow };
        })
      );

      let latestWbYear = '';
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.row) continue;
        const { ind, row } = r.value;
        const val = Number(row.value);
        if (row.date && String(row.date) > latestWbYear) latestWbYear = String(row.date);

        if (ind === 'FI.RES.TOTL.MO') {
          baseline.worldBankIndicators.fxReservesMonthsImport = Number(val.toFixed(2)); markLive('wb.fxReservesMonthsImport', `World Bank, ${row.date}`);
        } else if (ind === 'FI.RES.TOTL.CD' && val > 1e8) {
          liveReservesUsdBn = Number((val / 1e9).toFixed(1));
        } else if (ind === 'BN.CAB.XOKA.GD.ZS') {
          baseline.worldBankIndicators.currentAccountPctGdp = Number(val.toFixed(2)); markLive('wb.currentAccountPctGdp', `World Bank, ${row.date}`);
        } else if (ind === 'DT.DOD.DECT.GN.ZS') {
          baseline.worldBankIndicators.externalDebtPctGni = Number(val.toFixed(1)); markLive('wb.externalDebtPctGni', `World Bank, ${row.date}`);
        } else if (ind === 'DT.DOD.DSTC.IR.ZS' && val > 0) {
          liveShortTermDebtPctReserves = Number(val.toFixed(1));
        } else if (ind === 'PV.EST') {
          // Convert WGI estimate (-2.5 to +2.5) into 0-100 percentile scale
          const pctl = Math.max(2, Math.min(98, ((val + 2.5) / 5.0) * 100));
          baseline.worldBankIndicators.politicalStabilityPercentile = Number(pctl.toFixed(1)); markLive('wb.politicalStabilityPercentile', `World Bank WGI, ${row.date}`);
        }
      }
      if (latestWbYear) {
        activeSources.push(`World Bank Open Data v2 (${latestWbYear} Live)`);
      }
    })(),

    // 2. Expanded IMF DataMapper WEO API (Debt/GDP, 2027F Debt, CPI Inflation, Real GDP Growth, Primary Balance)
    (async () => {
      // Primary balance is the Fiscal Monitor series on DataMapper (GGXONLB_G01_GDP_PT); the WEO code
      // GGXONLB_NGDP comes back empty there. NGAP_NPGDP is asked for in case the IMF adds it.
      const imfMetrics = ['GGXWDG_NGDP', 'PCPIPCH', 'NGDP_RPCH', 'GGXONLB_G01_GDP_PT', 'NGAP_NPGDP', ...Object.keys(IMF_EXTRA)];
      const results = await Promise.allSettled(
        imfMetrics.map(async (metric) => {
          const res = await fetchWithTimeout(
            `https://www.imf.org/external/datamapper/api/v1/${metric}/${normalizedIso}`
          );
          if (!res.ok) return { metric, series: null };
          const data: any = await res.json();
          return { metric, series: data?.values?.[metric]?.[normalizedIso] };
        })
      );

      let imfHit = false;
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.series) continue;
        const { metric, series } = r.value;
        if (metric === 'GGXWDG_NGDP') {
          const cur = getLatestImfValue(series, ['2025', '2026', '2024']);
          const f2027 = getLatestImfValue(series, ['2027', '2028', '2026']);
          if (typeof cur === 'number') {
            baseline.imfIndicators.debtToGdpPct = Number(cur.toFixed(1)); markLive('imf.debtToGdpPct', 'IMF WEO');
            (baseline.imfIndicators.years ||= {})['imf.debtToGdpPct'] = latestImfYear(series, ['2025', '2026', '2024']) || '';
            imfHit = true;
          }
          if (typeof f2027 === 'number') {
            baseline.imfIndicators.debtToGdpForecast2027Pct = Number(f2027.toFixed(1)); markLive('imf.debtToGdpForecast2027Pct', 'IMF WEO forecast');
            (baseline.imfIndicators.years ||= {})['imf.debtToGdpForecast2027Pct'] = latestImfYear(series, ['2027', '2028', '2026']) || '';
          }
        } else if (metric === 'PCPIPCH') {
          const cpi = getLatestImfValue(series, ['2025', '2026', '2024']);
          if (typeof cpi === 'number') {
            baseline.imfIndicators.cpiInflationPct = Number(cpi.toFixed(2)); markLive('imf.cpiInflationPct', 'IMF WEO');
            (baseline.imfIndicators.years ||= {})['imf.cpiInflationPct'] = latestImfYear(series, ['2025', '2026', '2024']) || '';
            imfHit = true;
          }
        } else if (metric === 'NGDP_RPCH') {
          const gdp = getLatestImfValue(series, ['2025', '2026', '2024']);
          if (typeof gdp === 'number') {
            baseline.imfIndicators.realGdpGrowthPct = Number(gdp.toFixed(2)); markLive('imf.realGdpGrowthPct', 'IMF WEO');
            (baseline.imfIndicators.years ||= {})['imf.realGdpGrowthPct'] = latestImfYear(series, ['2025', '2026', '2024']) || '';
            imfHit = true;
          }
        } else if (metric === 'NGAP_NPGDP') {
          // Output gap: the IMF publishes it for some countries only; elsewhere it stays unset.
          const gap = getLatestImfValue(series, ['2025', '2026', '2024']);
          if (typeof gap === 'number') {
            baseline.imfIndicators.outputGapPct = Number(gap.toFixed(2)); markLive('imf.outputGapPct', 'IMF WEO');
            (baseline.imfIndicators.years ||= {})['imf.outputGapPct'] = latestImfYear(series, ['2025', '2026', '2024']) || '';
          }
        } else if (IMF_EXTRA[metric]) {
          // Fiscal Monitor revenue, expenditure and overall balance; WEO unemployment and current
          // account (codes checked against the DataMapper indicator list, 2026-11-07).
          const { field, dp } = IMF_EXTRA[metric];
          const val = getLatestImfValue(series, ['2025', '2026', '2024']);
          if (typeof val === 'number') {
            (baseline.imfIndicators as Record<string, unknown>)[field] = Number(val.toFixed(dp));
            markLive(`imf.${field}`, `IMF ${IMF_EXTRA[metric].dataset}`);
            (baseline.imfIndicators.years ||= {})[`imf.${field}`] = latestImfYear(series, ['2025', '2026', '2024']) || '';
          }
        } else if (metric === 'GGXONLB_G01_GDP_PT') {
          const pb = getLatestImfValue(series, ['2025', '2026', '2024']);
          if (typeof pb === 'number') {
            baseline.imfIndicators.primaryFiscalBalancePct = Number(pb.toFixed(2)); markLive('imf.primaryFiscalBalancePct', 'IMF WEO');
            (baseline.imfIndicators.years ||= {})['imf.primaryFiscalBalancePct'] = latestImfYear(series, ['2025', '2026', '2024']) || '';
            imfHit = true;
          }
        }
      }
      if (imfHit) {
        activeSources.push('IMF DataMapper WEO v1 (4-Indicator Live)');
      }
    })(),

    // 3. Unfiltered Live Polymarket Gamma API (Ranked by sovereign, central bank, tariff, & macro relevance)
    (async () => {
      const polyRes = await fetchWithTimeout(
        `https://gamma-api.polymarket.com/events?limit=45&active=true&closed=false`
      );
      if (polyRes.ok) {
        const events = await polyRes.json();
        if (Array.isArray(events) && events.length > 0) {
          const countryTerms = [
            baseline.countryName.toLowerCase(),
            normalizedIso.toLowerCase(),
            baseline.currencyCode.toLowerCase(),
            baseline.region.toLowerCase(),
          ];
          const macroTerms = [
            'fed',
            'rate',
            'inflation',
            'tariff',
            'recession',
            'oil',
            'treasury',
            'debt',
            'central bank',
            'sanction',
            'ceasefire',
            'trade',
            'gdp',
          ];

          const scoredEvents = events
            .map((ev: any, idx: number) => {
              const market = Array.isArray(ev?.markets) && ev.markets.length > 0 ? ev.markets[0] : null;
              const title = String(ev?.title || market?.question || '').trim();
              if (!title) return null;

              let prob: number | null = null;
              try {
                const rawPrices = market?.outcomePrices;
                const prices = typeof rawPrices === 'string' ? JSON.parse(rawPrices) : rawPrices;
                if (Array.isArray(prices) && prices.length > 0) {
                  const p0 = Number(prices[0]);
                  if (Number.isFinite(p0) && p0 >= 0 && p0 <= 1) prob = Math.round(p0 * 100);
                }
              } catch {
                prob = null;
              }
              // No price means no odds to show: skip it rather than show 50%.
              if (prob === null) return null;

              const lower = title.toLowerCase();
              let relevance = 0;
              for (const ct of countryTerms) {
                if (ct && ct.length > 2 && lower.includes(ct)) relevance += 25;
              }
              for (const mt of macroTerms) {
                if (lower.includes(mt)) relevance += 8;
              }

              const vol = Math.round(Number(ev?.volume || market?.volume || 0));
              const contract: PolymarketContract = {
                id: String(ev?.id || `pm-live-${idx}`),
                question: title,
                probabilityPct: prob,
                volumeUsd: vol > 0 ? vol : 0,
                category: relevance >= 25 ? `${baseline.countryName} Event` : 'Global Macro / Geopolitics',
                url: ev?.slug ? `https://polymarket.com/event/${ev.slug}` : 'https://polymarket.com',
                ...polymarketMoves(market),
              };
              return { contract, relevance, vol };
            })
            .filter((x): x is { contract: PolymarketContract; relevance: number; vol: number } => Boolean(x))
            .sort((a, b) => b.relevance - a.relevance || b.vol - a.vol);

          if (scoredEvents.length > 0) {
            baseline.polymarketContracts = scoredEvents.slice(0, 4).map((s) => s.contract);
            markLive('polymarket.contracts', `Polymarket, pulled ${new Date().toISOString().slice(0, 10)}`);
            activeSources.push('Polymarket Gamma API (100% Live Contracts)');
          }
        }
      }
    })(),

    // 4. GDELT news tone and headlines, pulled every GDELT_REFRESH_DAYS days per country and kept on
    // disk; every figure carries the date it was pulled.
    (async () => {
      const pull = await fetchGdeltQuarterly(normalizedIso, baseline.countryName);
      if (!pull) return;
      const day = pull.pulledAt.slice(0, 10);
      baseline.gdeltMetrics.averageTone = pull.tone;
      markLive('gdelt.averageTone', `GDELT, pulled ${day}`);
      // Scale negative GDELT tone (-8..+2) into a 0..100 conflict intensity index
      baseline.gdeltMetrics.conflictIntensityIndex = Math.round(Math.max(18, Math.min(94, 42 + Math.max(0, -pull.tone) * 9.5)));
      markLive('gdelt.conflictIntensityIndex', `GDELT, pulled ${day}`);
      // The pull's own headlines replace any built-in ones, even when it found none.
      baseline.gdeltMetrics.topHeadlines = pull.headlines;
      if (pull.headlines.length) markLive('gdelt.topHeadlines', `GDELT, pulled ${day}`);
      baseline.gdeltPull = { pulledAt: pull.pulledAt, tone: pull.tone, ...(pull.toneShift ? { toneShift: pull.toneShift } : {}) };
      activeSources.push(`GDELT news tone and headlines (pulled ${day}, refreshed every ${GDELT_REFRESH_DAYS} days)`);
    })(),

    // 5. Global Live FX & NY Fed Plumbing
    (async () => {
      const plumbing = await fetchGlobalLivePlumbing();
      if (plumbing.activeSources.length > 0) {
        activeSources.push(...plumbing.activeSources);
      }
      const ccy = baseline.currencyCode.toUpperCase();
      const liveFx = plumbing.fxRatesVsUsd[ccy];
      if (typeof liveFx === 'number' && liveFx > 0) {
        baseline.monetaryAndMarket.exchangeRatePerUsd = Number(
          liveFx.toFixed(liveFx > 100 ? 1 : liveFx > 10 ? 2 : 3)
        ); markLive('market.exchangeRatePerUsd', 'Live FX');
        const yearEnd = await fetchFxYearEnd();
        const base = yearEnd?.rates[ccy];
        if (typeof base === 'number' && base > 0) {
          // Positive = the local currency gained against the dollar since the last close of last year.
          const ytdPct = ((base - liveFx) / base) * 100;
          baseline.monetaryAndMarket.fxYtdChangePct = Number(ytdPct.toFixed(2)); markLive('market.fxYtdChangePct', `Live FX vs ECB rate of ${yearEnd!.date}`);
        }
      }
      baseline.livePlumbingOverrides = {
        usSofrRatePct: plumbing.usSofrRatePct,
        usEffrRatePct: plumbing.usEffrRatePct,
        fedOnRrpBalanceUsdBn: plumbing.fedOnRrpBalanceUsdBn,
        fxRatesVsUsd: plumbing.fxRatesVsUsd,
        fetchedAt: new Date(plumbing.timestamp).toISOString(),
      };
    })(),

  ]);

  // 6b. Official 10Y yield (OECD via FRED, Brazil's Treasury or Turkey's EVDS), with its date.
  const officialYield = await fetchOfficial10YYield(normalizedIso);
  if (officialYield) {
    baseline.monetaryAndMarket.sovereign10YBondYieldPct = officialYield.valuePct; markLive('market.sovereign10YBondYieldPct', 'Official');
    baseline.official10YYield = officialYield;
    activeSources.push(officialYieldFeedLabel(officialYield));
  }

  // 6b''. US 10Y benchmark, for the spread over Treasuries. It carries its own source and date and
  // is not counted as a live feed for the country.
  const us10Y = await fetchUs10YYield();
  if (us10Y) baseline.us10YYield = us10Y;
  else delete baseline.us10YYield;

  // 6b'''. Hard-currency (USD) bond spread over Treasuries, the free stand-in for CDS (BCRP EMBIG,
  // eight Latin American countries, monthly). Labelled a bond spread everywhere, never CDS.
  const hcSpread = (await fetchHcSpread())?.countries[normalizedIso];
  if (hcSpread) {
    baseline.monetaryAndMarket.hcBondSpreadBps = Math.round(hcSpread.bps); markLive('market.hcBondSpreadBps', HC_SPREAD_FEED_LABEL);
    baseline.hcBondSpread = hcSpread;
    activeSources.push(`${HC_SPREAD_FEED_LABEL}, ${hcSpread.period}`);
  } else {
    delete baseline.monetaryAndMarket.hcBondSpreadBps;
    delete baseline.hcBondSpread;
  }

  // 6b'. Own-account 5Y CDS: the user's licensed quote, the only CDS source.
  const ownCds = (await loadOwnCds()).get(normalizedIso);
  if (ownCds) {
    baseline.monetaryAndMarket.cds5YSpreadBps = Math.round(ownCds.bps); markLive('market.cds5YSpreadBps', `Your data, ${ownCds.source}`);
    baseline.ownCds5Y = { bps: ownCds.bps, date: ownCds.date, source: ownCds.source };
    activeSources.push(`${OWN_CDS_LABEL} (${ownCds.source}, 5Y CDS)`);
  } else {
    delete baseline.ownCds5Y;
  }

  // 6c. Government external debt falling due (QEDS, IDS). Replaces nothing: the brief shows these
  // beside the sample maturity profile, which stays labelled sample.
  const debtSchedule = await fetchDebtSchedule(normalizedIso);
  if (debtSchedule) {
    baseline.debtSchedule = debtSchedule;
    if (debtSchedule.qeds) activeSources.push(`${QEDS_LABEL} (government external debt due by quarter)`);
    if (debtSchedule.ids) activeSources.push(`${IDS_LABEL} (public external debt service by year)`);
    if (debtSchedule.bis) activeSources.push(`${BIS_LABEL} (government debt securities outstanding)`);
  }

  // 7. Apply any user-configured GUI External/Internal Macro REST Connectors
  await applyGuiMacroConnectorsToSnapshot(baseline, normalizedIso, activeSources);

  // Dynamically recompute DSA (r - g), Greenspan-Guidotti Debt Rollover, Yield Curve & Real Policy Rate
  recomputeDerivedOpenDataAnalytics(baseline, {
    liquidReservesUsdBn: liveReservesUsdBn,
    shortTermDebtPctReserves: liveShortTermDebtPctReserves,
  });

  // Only feeds that actually answered count as live; never inherit the sample list.
  const verifiedLiveSources = Array.from(new Set(activeSources));
  baseline.liveApiSourcesActive = verifiedLiveSources;
  baseline.fetchedAt = new Date().toISOString();
  baseline.dataStatus = { verifiedLiveSources, checkedAt: baseline.fetchedAt };
  return baseline;
}
