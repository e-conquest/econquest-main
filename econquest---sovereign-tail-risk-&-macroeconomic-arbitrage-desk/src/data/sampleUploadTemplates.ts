/**
 * Caldara & Iacoviello (2022) Geopolitical Risk (GPR) Benchmark Data & Templates
 * Sourced from the Federal Reserve Board GPR Index methodology
 */

export interface GprDataPoint {
  date: string;
  gprGlobal: number;
  gprThreats: number; // GPRT
  gprActs: number;    // GPRA
  gprChile?: number;
  gprArgentina?: number;
  gprTurkey?: number;
  gprIndonesia?: number;
  gprPakistan?: number;
  eventDescription?: string;
}

export const SAMPLE_GPR_SERIES: GprDataPoint[] = [
  { date: '1990-08', gprGlobal: 245.2, gprThreats: 260.1, gprActs: 215.4, eventDescription: 'Gulf War Invasion of Kuwait' },
  { date: '1995-01', gprGlobal: 92.4, gprThreats: 95.0, gprActs: 87.2, eventDescription: 'Calm Baseline Regime' },
  { date: '2001-09', gprGlobal: 382.6, gprThreats: 410.5, gprActs: 326.8, eventDescription: 'September 11 Attacks' },
  { date: '2003-03', gprGlobal: 312.0, gprThreats: 340.2, gprActs: 255.6, eventDescription: 'Iraq War Escalation' },
  { date: '2008-08', gprGlobal: 148.5, gprThreats: 152.0, gprActs: 141.5, eventDescription: 'Georgia Conflict / Lehman Liquidity Shock' },
  { date: '2014-03', gprGlobal: 168.2, gprThreats: 175.4, gprActs: 153.8, eventDescription: 'Crimea Annexation' },
  { date: '2020-01', gprGlobal: 178.4, gprThreats: 195.0, gprActs: 145.2, eventDescription: 'Baghdad Airstrike / Oil Chokepoint Spike' },
  { date: '2022-02', gprGlobal: 310.5, gprThreats: 335.8, gprActs: 260.0, eventDescription: 'Ukraine Conflict Outbreak & Comprehensive Sanctions' },
  { date: '2023-10', gprGlobal: 215.0, gprThreats: 228.4, gprActs: 188.2, eventDescription: 'Middle East Escalation & Red Sea Chokepoint Threats' },
  { date: '2025-06', gprGlobal: 142.0, gprThreats: 148.2, gprActs: 129.6, eventDescription: 'Strait of Malacca Naval Exercises' },
  { date: '2026-03', gprGlobal: 195.4, gprThreats: 210.0, gprActs: 166.2, gprChile: 88.0, gprArgentina: 240.0, gprTurkey: 215.0, gprIndonesia: 190.0, gprPakistan: 265.0, eventDescription: 'Emerging Market Sovereign Debt & Maritime Chokepoint Stress' },
  { date: '2026-10', gprGlobal: 228.6, gprThreats: 252.0, gprActs: 181.8, gprChile: 94.5, gprArgentina: 285.0, gprTurkey: 238.0, gprIndonesia: 205.0, gprPakistan: 295.0, eventDescription: 'Current Active Observation (Section 8 Benchmark)' }
];

export function generateSampleGprCsv(): string {
  const headers = 'date,gpr_global,gpr_threats,gpr_acts,gpr_chl,gpr_arg,gpr_tur,gpr_pak,event_annotation\n';
  const rows = SAMPLE_GPR_SERIES.map(
    (s) =>
      `${s.date},${s.gprGlobal},${s.gprThreats},${s.gprActs},${s.gprChile || 90.0},${s.gprArgentina || 220.0},${s.gprTurkey || 180.0},${s.gprPakistan || 240.0},"${s.eventDescription || ''}"`
  ).join('\n');
  return headers + rows;
}

export function generateSampleMacroCsv(): string {
  return `country_code,country_name,public_debt_gdp,short_term_fx_debt_reserves,net_reserves_imports_months,primary_deficit_gap,political_instability_pitf,commodity_shock,cds_spread_5y_bps
CHL,Chile,39.8,28.4,6.2,0.8,1.8,0.5,58
BLZ,Belize,68.2,74.0,3.4,2.4,3.9,-1.2,640
SEC8,Section 8 Case Study,84.2,132.5,1.8,3.8,5.6,-2.4,720
LKA,Sri Lanka,112.5,185.0,2.1,4.2,6.2,-1.8,1380
ARG,Argentina,89.5,165.0,1.6,3.1,5.4,1.1,1650
TUR,Turkey,34.2,128.0,3.8,2.8,4.8,-2.1,275
PAK,Pakistan,77.2,148.0,1.7,3.6,6.8,-2.0,1180
IDN,Indonesia,39.1,42.0,6.8,1.2,2.5,0.8,82
`;
}
