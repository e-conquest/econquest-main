/**
 * Historical 7-Pillar Time-Series Data Generator (12 Months to 10 Years)
 * Grounded in empirical sovereign crisis windows (2016 - 2026) per the White Paper
 */

import { SovereignEntity } from '../types/riskEngine';

export type TimeHorizon = '12m' | '3y' | '5y' | '10y';

export interface HistoricalPillarPoint {
  date: string;
  composite: number;
  p1_fiscalDebt: number;
  p2_externalFragility: number;
  p3_institutionalIntegrity: number;
  p4_politicalDynamics: number;
  p5_macroFragility: number;
  p6_securityConflict: number;
  p7_climateCatastrophe: number;
  eventNote?: string;
}

export function generateHistoricalPillarData(
  sovereign: SovereignEntity,
  horizon: TimeHorizon
): HistoricalPillarPoint[] {
  const current = sovereign.pillarScores;
  const points: HistoricalPillarPoint[] = [];

  // Anchor historical patterns based on sovereign profiles
  const isChile = sovereign.id === 'chile';
  const isBelize = sovereign.id === 'belize';
  const isSriLanka = sovereign.id === 'sri-lanka';
  const isArgentina = sovereign.id === 'argentina';
  const isWalkthrough = sovereign.id === 'paper-walkthrough';

  if (horizon === '12m') {
    // 12 monthly observations: 2025-11 to 2026-10
    const months = [
      'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26',
      'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26'
    ];

    months.forEach((m, idx) => {
      const progress = idx / 11; // 0 to 1
      // Add subtle noise and trend
      const trend = isWalkthrough
        ? (idx - 5) * 1.4 // Walkthrough had 450bps widening & TSI surge leading to Oct 2026
        : isChile
        ? Math.sin(idx * 0.8) * 1.5
        : isBelize
        ? (11 - idx) * 0.4 // Restructuring recovery
        : Math.sin(idx * 0.6) * 2.2;

      const p1 = Math.min(100, Math.max(5, current.p1_fiscalDebt - (1 - progress) * (isWalkthrough ? 8 : 2) + trend * 0.4));
      const p2 = Math.min(100, Math.max(5, current.p2_externalFragility - (1 - progress) * (isWalkthrough ? 10 : 1) + trend * 0.5));
      const p3 = Math.min(100, Math.max(5, current.p3_institutionalIntegrity + (trend * 0.2)));
      const p4 = Math.min(100, Math.max(5, current.p4_politicalDynamics - (1 - progress) * (isWalkthrough ? 9 : 1) + trend * 0.6));
      const p5 = Math.min(100, Math.max(5, current.p5_macroFragility - (1 - progress) * (isWalkthrough ? 7 : 2) + trend * 0.5));
      const p6 = Math.min(100, Math.max(5, current.p6_securityConflict + trend * 0.3));
      const p7 = Math.min(100, Math.max(5, current.p7_climateCatastrophe + (idx === 8 && isBelize ? 12 : 0))); // hurricane season bump

      const comp = Math.round((p1 * 0.25 + p2 * 0.15 + p3 * 0.15 + p4 * 0.15 + p5 * 0.10 + p6 * 0.10 + p7 * 0.05) * 10) / 10;

      let note: string | undefined;
      if (idx === 11) note = 'Current Benchmark (Oct 2026)';
      else if (idx === 5 && isWalkthrough) note = 'Initial CDS Term Spread Widening';
      else if (idx === 8 && isBelize) note = 'Atlantic Cat-4 Hurricane Watch';

      points.push({
        date: m,
        composite: comp,
        p1_fiscalDebt: Math.round(p1 * 10) / 10,
        p2_externalFragility: Math.round(p2 * 10) / 10,
        p3_institutionalIntegrity: Math.round(p3 * 10) / 10,
        p4_politicalDynamics: Math.round(p4 * 10) / 10,
        p5_macroFragility: Math.round(p5 * 10) / 10,
        p6_securityConflict: Math.round(p6 * 10) / 10,
        p7_climateCatastrophe: Math.round(p7 * 10) / 10,
        eventNote: note
      });
    });
  } else if (horizon === '3y') {
    // 12 quarterly observations: Q4 2023 to Q3 2026
    const quarters = [
      'Q4 23', 'Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25',
      'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'
    ];

    quarters.forEach((q, idx) => {
      const offset = (11 - idx) * (isSriLanka ? 1.8 : isArgentina ? -1.2 : 0.8);
      const p1 = Math.min(100, Math.max(10, current.p1_fiscalDebt + (isSriLanka ? (11 - idx) * 1.5 : -offset * 0.5)));
      const p2 = Math.min(100, Math.max(10, current.p2_externalFragility + (isSriLanka ? (11 - idx) * 1.9 : -offset * 0.7)));
      const p3 = Math.min(100, Math.max(10, current.p3_institutionalIntegrity + offset * 0.2));
      const p4 = Math.min(100, Math.max(10, current.p4_politicalDynamics + offset * 0.6));
      const p5 = Math.min(100, Math.max(10, current.p5_macroFragility + (isSriLanka ? (11 - idx) * 1.2 : offset * 0.4)));
      const p6 = Math.min(100, Math.max(10, current.p6_securityConflict + offset * 0.3));
      const p7 = Math.min(100, Math.max(10, current.p7_climateCatastrophe + (idx === 3 || idx === 7 ? 6 : 0)));

      const comp = Math.round((p1 * 0.25 + p2 * 0.15 + p3 * 0.15 + p4 * 0.15 + p5 * 0.10 + p6 * 0.10 + p7 * 0.05) * 10) / 10;

      let note: string | undefined;
      if (idx === 0) note = 'Global Rate Tightening Peak';
      else if (idx === 6) note = 'Terms-of-Trade Realignment';
      else if (idx === 11) note = 'Oct 2026 Evaluation';

      points.push({
        date: q,
        composite: comp,
        p1_fiscalDebt: Math.round(p1 * 10) / 10,
        p2_externalFragility: Math.round(p2 * 10) / 10,
        p3_institutionalIntegrity: Math.round(p3 * 10) / 10,
        p4_politicalDynamics: Math.round(p4 * 10) / 10,
        p5_macroFragility: Math.round(p5 * 10) / 10,
        p6_securityConflict: Math.round(p6 * 10) / 10,
        p7_climateCatastrophe: Math.round(p7 * 10) / 10,
        eventNote: note
      });
    });
  } else if (horizon === '5y') {
    // 5 annual points: 2022, 2023, 2024, 2025, 2026
    const years = ['2022', '2023', '2024', '2025', '2026'];

    years.forEach((yr, idx) => {
      let deltaP1 = 0;
      let deltaP2 = 0;
      let deltaP4 = 0;
      let deltaP5 = 0;
      let deltaP7 = 0;

      if (yr === '2022') {
        deltaP2 = 14; // Global inflation & commodity shock
        deltaP5 = 12;
        if (isSriLanka) {
          deltaP1 = 22;
          deltaP2 = 25;
        }
      } else if (yr === '2023') {
        deltaP4 = 6;
      }

      const p1 = Math.min(100, Math.max(10, current.p1_fiscalDebt + deltaP1 - (idx === 4 ? 0 : 3)));
      const p2 = Math.min(100, Math.max(10, current.p2_externalFragility + deltaP2 - (idx === 4 ? 0 : 2)));
      const p3 = current.p3_institutionalIntegrity;
      const p4 = Math.min(100, Math.max(10, current.p4_politicalDynamics + deltaP4));
      const p5 = Math.min(100, Math.max(10, current.p5_macroFragility + deltaP5));
      const p6 = current.p6_securityConflict;
      const p7 = Math.min(100, Math.max(10, current.p7_climateCatastrophe + deltaP7));

      const comp = Math.round((p1 * 0.25 + p2 * 0.15 + p3 * 0.15 + p4 * 0.15 + p5 * 0.10 + p6 * 0.10 + p7 * 0.05) * 10) / 10;

      let note: string | undefined;
      if (yr === '2022') note = 'Global Commodity Shock & Fed Hikes';
      else if (yr === '2024') note = 'Bilateral Debt Restructurings';
      else if (yr === '2026') note = 'Panoptix Calibrated Baseline';

      points.push({
        date: yr,
        composite: comp,
        p1_fiscalDebt: Math.round(p1 * 10) / 10,
        p2_externalFragility: Math.round(p2 * 10) / 10,
        p3_institutionalIntegrity: Math.round(p3 * 10) / 10,
        p4_politicalDynamics: Math.round(p4 * 10) / 10,
        p5_macroFragility: Math.round(p5 * 10) / 10,
        p6_securityConflict: Math.round(p6 * 10) / 10,
        p7_climateCatastrophe: Math.round(p7 * 10) / 10,
        eventNote: note
      });
    });
  } else {
    // 10 years: 2017 to 2026
    const years = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];

    years.forEach((yr, idx) => {
      let deltaP1 = 0;
      let deltaP2 = 0;
      let deltaP4 = 0;
      let deltaP5 = 0;
      let deltaP7 = 0;

      // 2020 COVID shock (Section 4.2 Forensic Rule 6)
      if (yr === '2020') {
        deltaP1 = 15;
        deltaP5 = 18;
      } else if (yr === '2019' && isChile) {
        deltaP4 = 16; // 2019 Estallido Social unrest in Chile
      } else if (yr === '2022' && isSriLanka) {
        deltaP1 = 28;
        deltaP2 = 32;
        deltaP5 = 24;
      } else if (yr === '2021' && isBelize) {
        deltaP1 = 16; // Pre-Blue Bond restructuring peak
      }

      const p1 = Math.min(100, Math.max(10, current.p1_fiscalDebt + deltaP1 - (idx === 9 ? 0 : 4)));
      const p2 = Math.min(100, Math.max(10, current.p2_externalFragility + deltaP2 - (idx === 9 ? 0 : 3)));
      const p3 = Math.min(100, Math.max(10, current.p3_institutionalIntegrity + (yr === '2017' ? -4 : 0)));
      const p4 = Math.min(100, Math.max(10, current.p4_politicalDynamics + deltaP4));
      const p5 = Math.min(100, Math.max(10, current.p5_macroFragility + deltaP5));
      const p6 = current.p6_securityConflict;
      const p7 = Math.min(100, Math.max(10, current.p7_climateCatastrophe + deltaP7));

      const comp = Math.round((p1 * 0.25 + p2 * 0.15 + p3 * 0.15 + p4 * 0.15 + p5 * 0.10 + p6 * 0.10 + p7 * 0.05) * 10) / 10;

      let note: string | undefined;
      if (yr === '2019' && isChile) note = '2019 Chilean Social Protest Unrest';
      else if (yr === '2020') note = '2020 COVID Pandemic Collapse (Forensic Rule 6)';
      else if (yr === '2021' && isBelize) note = 'Belize Blue Bond Restructuring';
      else if (yr === '2022') note = '2022 Global War & Energy Inflation Surge';
      else if (yr === '2026') note = 'October 2026 Current Benchmark';

      points.push({
        date: yr,
        composite: comp,
        p1_fiscalDebt: Math.round(p1 * 10) / 10,
        p2_externalFragility: Math.round(p2 * 10) / 10,
        p3_institutionalIntegrity: Math.round(p3 * 10) / 10,
        p4_politicalDynamics: Math.round(p4 * 10) / 10,
        p5_macroFragility: Math.round(p5 * 10) / 10,
        p6_securityConflict: Math.round(p6 * 10) / 10,
        p7_climateCatastrophe: Math.round(p7 * 10) / 10,
        eventNote: note
      });
    });
  }

  return points;
}
