/**
 * 12-Month Sovereign Risk Historical Progression Data Generator
 * Calibrated for the WorldRiskMap time-series range slider and replay engine.
 * Grounded in empirical crisis windows and macro trajectories from the White Paper.
 */

import { SovereignEntity, LayerOutputs } from '../types/riskEngine';

export interface SovereignMonthlySnapshot {
  sovereignId: string;
  monthIndex: number; // 0 to 11
  monthLabel: string; // 'Nov 2025' ... 'Oct 2026'
  shortLabel: string; // 'Nov 25'
  totalModelRisk: number; // Percentage (e.g. 18.5)
  geopoliticalFragility: number; // 0 - 100
  var99: number; // Percentage
  hmmRegime: 'Calm' | 'Stressed' | 'Crisis';
  cdsSpreadBps: number;
  deltaFromLive: number; // totalModelRisk - liveMonthRisk
  eventNote?: string;
}

export interface GlobalMonthlySnapshot {
  monthIndex: number;
  monthLabel: string;
  shortLabel: string;
  macroHeadline: string;
  macroDescription: string;
  globalAvgTotalModelRisk: number;
  crisisCount: number;
  stressedCount: number;
  calmCount: number;
  sovereigns: Record<string, SovereignMonthlySnapshot>;
}

export const MONTH_DEFINITIONS: { monthIndex: number; monthLabel: string; shortLabel: string; headline: string; description: string }[] = [
  {
    monthIndex: 0,
    monthLabel: 'November 2025',
    shortLabel: 'Nov 25',
    headline: 'Global Disinflation Pause & Baseline Solvency',
    description: 'Central banks pause rate cuts amidst sticky core inflation. Emerging market capital outflows remain modest.'
  },
  {
    monthIndex: 1,
    monthLabel: 'December 2025',
    shortLabel: 'Dec 25',
    headline: 'Year-End Cross-Currency Liquidity Tightening',
    description: 'Year-end balance sheet window dressing causes brief dollar funding strain and FX implied volatility spikes.'
  },
  {
    monthIndex: 2,
    monthLabel: 'January 2026',
    shortLabel: 'Jan 26',
    headline: 'Q1 Frontier Sovereign Refinancing Wall',
    description: 'Eurobond maturity wall opens for low-income and frontier sovereigns; primary market syndication spreads widen.'
  },
  {
    monthIndex: 3,
    monthLabel: 'February 2026',
    shortLabel: 'Feb 26',
    headline: 'Commodity Terms-of-Trade Bifurcation',
    description: 'Hydrocarbon prices firm while industrial metals soften; divergent current account pressures surface across LatAm & Africa.'
  },
  {
    monthIndex: 4,
    monthLabel: 'March 2026',
    shortLabel: 'Mar 26',
    headline: 'Maritime Corridor Advisory & Red Sea Rerouting',
    description: 'Heightened naval tension in Bab el-Mandeb and Suez; maritime shipping reroutes via Cape of Good Hope add 12-16 days.'
  },
  {
    monthIndex: 5,
    monthLabel: 'April 2026',
    shortLabel: 'Apr 26',
    headline: 'Spring IMF / World Bank Debt Framework Reviews',
    description: 'G20 Common Framework restructurings debated; conditional sovereign credit facilities announced for distressed states.'
  },
  {
    monthIndex: 6,
    monthLabel: 'May 2026',
    shortLabel: 'May 26',
    headline: 'Federal Reserve Hawkish Terminal Rate Repricing',
    description: 'Higher-for-longer policy expectations spark broad USD appreciation (+4.5%) and domestic currency depreciation runs.'
  },
  {
    monthIndex: 7,
    monthLabel: 'June 2026',
    shortLabel: 'Jun 26',
    headline: 'Frontier Foreign Exchange Reserve Drain',
    description: 'Non-resident portfolio outflows drain bilateral central bank reserves in net energy-importing sovereign jurisdictions.'
  },
  {
    monthIndex: 8,
    monthLabel: 'July 2026',
    shortLabel: 'Jul 26',
    headline: 'Geopolitical Text Stress Index (TSI) Surge (+2.4σ)',
    description: 'Section 8 Case Study sovereign experiences 450 bps CDS spread widening and prediction market trading surge.'
  },
  {
    monthIndex: 9,
    monthLabel: 'August 2026',
    shortLabel: 'Aug 26',
    headline: 'Tropical Storm Season & Coastal Infrastructure Stress',
    description: 'Pillar 7 climate catastrophe risk rises across Caribbean and Pacific island/coastal states (15% Pillar switch).'
  },
  {
    monthIndex: 10,
    monthLabel: 'September 2026',
    shortLabel: 'Sep 26',
    headline: 'Prediction Market Alpha Divergence Window',
    description: 'Polymarket and Kalshi implied default probabilities diverge from structural CCA model signals, opening RV alpha basis.'
  },
  {
    monthIndex: 11,
    monthLabel: 'October 2026',
    shortLabel: 'Oct 26 (Live)',
    headline: 'Current Benchmark & Active Macro Vector Output',
    description: 'Live quantitative risk engine calibration reflecting real-time scenario vectors, high-frequency CDS, and bayesian posterior.'
  }
];

/**
 * Builds the 12-month historical time series for all mapped sovereigns
 */
export function generate12MonthMapProgression(
  sovereigns: SovereignEntity[],
  pipelineOutputs: Record<string, LayerOutputs>
): GlobalMonthlySnapshot[] {
  return MONTH_DEFINITIONS.map((def) => {
    const m = def.monthIndex;
    const progress = m / 11; // 0.0 at Nov 25 to 1.0 at Oct 26
    const sovSnapshots: Record<string, SovereignMonthlySnapshot> = {};

    let totalModelSum = 0;
    let crisisCount = 0;
    let stressedCount = 0;
    let calmCount = 0;

    sovereigns.forEach((sov) => {
      const liveOutput = pipelineOutputs[sov.id];
      const liveHazard = liveOutput ? liveOutput.calibratedPosteriorHazard * 100 : 5.0;
      const liveVar99 = liveOutput ? liveOutput.var99 : 6.0;
      const liveGeo = (sov.pillarScores.p4_politicalDynamics + sov.pillarScores.p6_securityConflict) / 2;
      const liveCds = sov.cdsSpread5yBps;

      let historicalHazard: number;
      let historicalGeo: number;
      let historicalVar: number;
      let historicalCds: number;
      let eventNote: string | undefined;

      // Sovereign-specific empirical paths
      if (sov.id === 'paper-walkthrough') {
        // Section 8 walkthrough: experienced 450 bps CDS widening and TSI surge in late summer
        if (m < 5) {
          historicalHazard = liveHazard * 0.62 + (m * 0.8);
          historicalCds = liveCds - (11 - m) * 35;
          historicalVar = liveVar99 * 0.7 + (m * 0.4);
          historicalGeo = liveGeo - 10 + m * 0.8;
        } else if (m < 8) {
          historicalHazard = liveHazard * 0.78 + (m - 5) * 1.6;
          historicalCds = liveCds - (11 - m) * 40;
          historicalVar = liveVar99 * 0.82 + (m - 5) * 0.9;
          historicalGeo = liveGeo - 6 + m * 0.9;
          if (m === 7) eventNote = 'TSI text stress indicator accelerates above +1.8σ';
        } else if (m < 11) {
          historicalHazard = liveHazard * 0.92 + (m - 8) * 0.7;
          historicalCds = liveCds - (11 - m) * 20;
          historicalVar = liveVar99 * 0.94 + (m - 8) * 0.4;
          historicalGeo = liveGeo - 2;
          if (m === 8) eventNote = 'CDS term structure inverts; 5Y spreads widen +450 bps';
        } else {
          historicalHazard = liveHazard;
          historicalCds = liveCds;
          historicalVar = liveVar99;
          historicalGeo = liveGeo;
          eventNote = 'Live Calibrated Section 8 Benchmark';
        }
      } else if (sov.id === 'sri-lanka') {
        // High post-crisis baseline stabilizing over the last year
        const stabilization = (11 - m) * 0.45;
        historicalHazard = liveHazard + stabilization;
        historicalCds = liveCds + (11 - m) * 25;
        historicalVar = liveVar99 + (11 - m) * 0.3;
        historicalGeo = liveGeo + (11 - m) * 0.4;
        if (m === 4) eventNote = 'IMF 2nd review completion milestone';
        if (m === 11) eventNote = 'Restructuring terms finalized';
      } else if (sov.id === 'argentina') {
        // Volatile oscillation with reserves cycle
        const wave = Math.sin(m * 0.9) * 3.8;
        historicalHazard = liveHazard - (11 - m) * 0.5 + wave;
        historicalCds = liveCds + wave * 45;
        historicalVar = liveVar99 + wave * 0.4;
        historicalGeo = liveGeo + wave * 0.3;
        if (m === 6) eventNote = 'Agricultural harvest dollar liquidation window';
      } else if (sov.id === 'belize') {
        // Blue bond post-restructuring, seasonal hurricane watch in August
        const hurricaneBump = m === 9 ? 4.2 : 0;
        historicalHazard = liveHazard - (11 - m) * 0.2 + hurricaneBump;
        historicalCds = liveCds + (11 - m) * 12 + (m === 9 ? 45 : 0);
        historicalVar = liveVar99 + (m === 9 ? 1.8 : 0);
        historicalGeo = liveGeo;
        if (m === 9) eventNote = 'Atlantic Cat-4 hurricane watch activates P7 15% switch';
      } else if (sov.id === 'chile') {
        // Solid macroeconomic foundation with minimal drift
        const microNoise = Math.sin(m * 0.7) * 0.25;
        historicalHazard = liveHazard + microNoise;
        historicalCds = liveCds + microNoise * 4;
        historicalVar = liveVar99 + microNoise * 0.1;
        historicalGeo = liveGeo;
      } else if (sov.id === 'ukraine') {
        // High distress war-risk plateau
        const noise = Math.cos(m * 0.8) * 1.8;
        historicalHazard = liveHazard - (11 - m) * 0.3 + noise;
        historicalCds = liveCds + noise * 30;
        historicalVar = liveVar99 + noise * 0.5;
        historicalGeo = liveGeo + noise * 0.4;
      } else if (sov.id === 'turkey') {
        // Disinflation gradual normalization
        const easing = (11 - m) * 0.35;
        historicalHazard = liveHazard + easing;
        historicalCds = liveCds + (11 - m) * 18;
        historicalVar = liveVar99 + (11 - m) * 0.25;
        historicalGeo = liveGeo + (11 - m) * 0.2;
      } else {
        // General emerging and frontier sovereign trajectory
        const drift = (1 - progress) * (Math.sin(m * 0.6 + sov.name.length) * 1.5 - 0.8);
        historicalHazard = liveHazard + drift;
        historicalCds = Math.round(liveCds + drift * 20);
        historicalVar = liveVar99 + drift * 0.2;
        historicalGeo = liveGeo + drift * 0.3;
      }

      // Bound values strictly
      if (m === 11) {
        historicalHazard = liveHazard;
        historicalGeo = liveGeo;
        historicalVar = liveVar99;
        historicalCds = liveCds;
      } else {
        historicalHazard = Math.round(Math.max(0.5, Math.min(99.0, historicalHazard)) * 10) / 10;
        historicalGeo = Math.round(Math.max(5.0, Math.min(99.0, historicalGeo)) * 10) / 10;
        historicalVar = Math.round(Math.max(1.0, Math.min(99.0, historicalVar)) * 10) / 10;
        historicalCds = Math.max(20, Math.round(historicalCds));
      }

      // Regime classification
      let regime: 'Calm' | 'Stressed' | 'Crisis' = 'Calm';
      if (historicalHazard >= 20 || historicalVar >= 25) {
        regime = 'Crisis';
        crisisCount++;
      } else if (historicalHazard >= 8 || historicalVar >= 15) {
        regime = 'Stressed';
        stressedCount++;
      } else {
        regime = 'Calm';
        calmCount++;
      }

      const delta = Math.round((historicalHazard - liveHazard) * 10) / 10;
      totalModelSum += historicalHazard;

      sovSnapshots[sov.id] = {
        sovereignId: sov.id,
        monthIndex: m,
        monthLabel: def.monthLabel,
        shortLabel: def.shortLabel,
        totalModelRisk: historicalHazard,
        geopoliticalFragility: historicalGeo,
        var99: historicalVar,
        hmmRegime: regime,
        cdsSpreadBps: historicalCds,
        deltaFromLive: delta,
        eventNote
      };
    });

    const globalAvg = sovereigns.length > 0
      ? Math.round((totalModelSum / sovereigns.length) * 10) / 10
      : 12.0;

    return {
      monthIndex: m,
      monthLabel: def.monthLabel,
      shortLabel: def.shortLabel,
      macroHeadline: def.headline,
      macroDescription: def.description,
      globalAvgTotalModelRisk: globalAvg,
      crisisCount,
      stressedCount,
      calmCount,
      sovereigns: sovSnapshots
    };
  });
}
