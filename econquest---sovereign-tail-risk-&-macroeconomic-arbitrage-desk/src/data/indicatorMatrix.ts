/**
 * Appendix A: Complete 7-Pillar Indicator & Threshold Audit Matrix
 * All 83 indicators, weights, operational units, scoring directions, and explicit threshold boundaries
 */

import { IndicatorDefinition } from '../types/riskEngine';

export interface PillarMetadata {
  id: number;
  name: string;
  description: string;
  standardWeight: number; // e.g. 0.25 for 25%
  islandWeight: number;   // e.g. proportional scaling
  keyFocus: string;
}

export const PILLARS_METADATA: PillarMetadata[] = [
  {
    id: 1,
    name: 'Fiscal and Debt',
    description: "Government capacity and willingness to service debt from its own budget over 1-3 years.",
    standardWeight: 0.25,
    islandWeight: 0.25 * (85 / 95),
    keyFocus: 'Debt sustainability, financing needs, primary balance gap, sovereign restructuring history'
  },
  {
    id: 2,
    name: 'External Fragility & Currency',
    description: 'Foreign exchange liquidity, reserve adequacy (ARA metric), and currency mismatch risks.',
    standardWeight: 0.15,
    islandWeight: 0.15 * (85 / 95),
    keyFocus: 'Net usable reserves, external financing need, hot money exposure, FX convertibility'
  },
  {
    id: 3,
    name: 'Institutional Integrity & Property Rights',
    description: 'Sovereign contract enforceability, expropriation records, and judicial rule of law.',
    standardWeight: 0.15,
    islandWeight: 0.15 * (85 / 95),
    keyFocus: '20-year expropriation record, ICSID compliance, BIT treaties, V-Dem executive constraints'
  },
  {
    id: 4,
    name: 'Political Dynamics & Policy Predictability',
    description: 'Regime stability, political disruption channels, mutiny risks, and election contestation.',
    standardWeight: 0.15,
    islandWeight: 0.15 * (85 / 95),
    keyFocus: 'Street pressure against adjustment, elite cohesion, coup risk, election contestation'
  },
  {
    id: 5,
    name: 'Macro & Financial System Fragility',
    description: 'Domestic macro transmission channels and sovereign-bank nexus diabolical feedback loops.',
    standardWeight: 0.10,
    islandWeight: 0.10 * (85 / 95),
    keyFocus: 'Banks claims on sovereign, FX loan mismatch, bank capitalization, credit-to-GDP gap, inflation'
  },
  {
    id: 6,
    name: 'Security, Conflict & Social Stability',
    description: 'Physical asset security, operational violence, and supply chain infrastructure disruption.',
    standardWeight: 0.10,
    islandWeight: 0.10 * (85 / 95),
    keyFocus: 'Operational violence, UCDP battle deaths, ACLED direct attacks, gang control, youth unemployment'
  },
  {
    id: 7,
    name: 'Climate Vulnerability & Catastrophic Risk',
    description: 'Physical, fiscal, and disaster transition risks; scaled to 15% for Small Island & Coastal States.',
    standardWeight: 0.05,
    islandWeight: 0.15,
    keyFocus: 'Expected annual disaster loss, 1-in-100y tail loss, parametric pools (CCRIF/ARC), coastal exposure'
  }
];

export const INDICATOR_MATRIX: IndicatorDefinition[] = [
  // Pillar 1: Fiscal and debt (25%)
  { id: '1.1', pillar: 1, name: 'Debt service (interest + principal)', unit: '% of revenue', weight: 0.20, s0: 10, s25: 20, s50: 30, s75: 45, s100: 60, direction: 1, primarySource: 'IMF Article IV DSA' },
  { id: '1.2', pillar: 1, name: 'FX debt service due in 24m', unit: '% of FX reserves', weight: 0.15, s0: 10, s25: 25, s50: 50, s75: 75, s100: 100, direction: 1, primarySource: 'World Bank IDS / Eurobonds' },
  { id: '1.3', pillar: 1, name: 'Gross government debt', unit: '% of GDP', weight: 0.15, s0: 30, s25: 45, s50: 60, s75: 80, s100: 100, direction: 1, primarySource: 'IMF WEO / Stress path' },
  { id: '1.4', pillar: 1, name: 'Gross financing need', unit: '% of GDP', weight: 0.10, s0: 5, s25: 10, s50: 15, s75: 20, s100: 25, direction: 1, primarySource: 'IMF Fiscal Monitor' },
  { id: '1.5', pillar: 1, name: 'Foreign-currency share of debt', unit: '% of debt', weight: 0.10, s0: 20, s25: 35, s50: 50, s75: 65, s100: 80, direction: 1, primarySource: 'Article IV / World Bank IDS' },
  { id: '1.6', pillar: 1, name: 'Primary balance gap', unit: 'pp of GDP', weight: 0.05, s0: 0, s25: -1, s50: -2, s75: -3.5, s100: -5, direction: -1, primarySource: 'WEO / Debt-stabilizing calc' },
  { id: '1.7', pillar: 1, name: 'Change in debt/GDP over 5y', unit: 'pp of GDP', weight: 0.05, s0: -5, s25: 0, s50: 5, s75: 10, s100: 15, direction: 1, primarySource: 'IMF WEO' },
  { id: '1.8', pillar: 1, name: 'Default record (20y restructurings)', unit: 'count', weight: 0.10, s0: 0, s25: 0.5, s50: 1, s75: 2, s100: 3, direction: 1, primarySource: 'BoC-BoE Default Database' },
  { id: '1.9', pillar: 1, name: 'Contingent liabilities & arrears', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IMF Article IV / Budget docs' },

  // Pillar 2: External Fragility (15% standard / 13.4% island)
  { id: '2.1', pillar: 2, name: 'Net usable reserves (% ARA)', unit: '% of ARA', weight: 0.15, s0: 150, s25: 125, s50: 100, s75: 75, s100: 50, direction: -1, primarySource: 'IMF ARA Data / Central Bank' },
  { id: '2.2', pillar: 2, name: 'External financing need', unit: '% net reserves', weight: 0.15, s0: 50, s25: 75, s50: 100, s75: 150, s100: 200, direction: 1, primarySource: 'IMF BoP / World Bank IDS' },
  { id: '2.3', pillar: 2, name: 'Hot money exposure', unit: '% net reserves', weight: 0.10, s0: 10, s25: 25, s50: 50, s75: 75, s100: 100, direction: 1, primarySource: 'IMF Investor Base Dataset' },
  { id: '2.4', pillar: 2, name: 'Dollarized bank deposits', unit: '% deposits', weight: 0.10, s0: 10, s25: 25, s50: 40, s75: 55, s100: 70, direction: 1, primarySource: 'IMF FSI / Central Bank' },
  { id: '2.5', pillar: 2, name: 'Exchange regime & convertibility', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IMF AREAER' },
  { id: '2.6', pillar: 2, name: 'Official backstop reliance', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IMF MONA Program Database' },
  { id: '2.7', pillar: 2, name: 'USD banking system access', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'FATF Lists / OFAC SDN' },
  { id: '2.8', pillar: 2, name: 'Current account balance', unit: '% of GDP', weight: 0.05, s0: 0, s25: -2, s50: -4, s75: -6, s100: -8, direction: -1, primarySource: 'IMF DataMapper' },
  { id: '2.9', pillar: 2, name: 'Short-term external debt', unit: '% net reserves', weight: 0.05, s0: 10, s25: 25, s50: 50, s75: 75, s100: 100, direction: 1, primarySource: 'World Bank IDS API' },
  { id: '2.10', pillar: 2, name: 'External debt / exports', unit: '% exports', weight: 0.05, s0: 100, s25: 150, s50: 200, s75: 250, s100: 300, direction: 1, primarySource: 'World Bank IDS' },
  { id: '2.11', pillar: 2, name: 'Export concentration', unit: '% exports', weight: 0.05, s0: 20, s25: 35, s50: 50, s75: 65, s100: 80, direction: 1, primarySource: 'UN Comtrade API' },
  { id: '2.12', pillar: 2, name: 'REER vs 10-year average', unit: '% above avg', weight: 0.05, s0: 0, s25: 5, s50: 10, s75: 18, s100: 25, direction: 1, primarySource: 'BIS REER API' },

  // Pillar 3: Institutional Integrity (15% standard / 13.4% island)
  { id: '3.1', pillar: 3, name: 'Investor treatment record (20y)', unit: 'level 0-4', weight: 0.15, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'UNCTAD ISDS Navigator' },
  { id: '3.2', pillar: 3, name: 'Arbitration award compliance', unit: 'level 0-4', weight: 0.15, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'ICSID Case Database' },
  { id: '3.3', pillar: 3, name: 'Bilateral Investment Treaties', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'UNCTAD IIA Navigator' },
  { id: '3.4', pillar: 3, name: '3-year change in WGI', unit: 'percentile pts', weight: 0.10, s0: 5, s25: 0, s50: -3, s75: -6, s100: -10, direction: -1, primarySource: 'World Bank WGI API' },
  { id: '3.5', pillar: 3, name: 'WGI composite percentile', unit: 'percentile', weight: 0.10, s0: 80, s25: 60, s50: 40, s75: 25, s100: 10, direction: -1, primarySource: 'World Bank WGI API' },
  { id: '3.6', pillar: 3, name: 'Executive constraints (V-Dem)', unit: 'index 0-1', weight: 0.10, s0: 0.85, s25: 0.70, s50: 0.50, s75: 0.30, s100: 0.15, direction: -1, primarySource: 'V-Dem Dataset' },
  { id: '3.7', pillar: 3, name: 'Civil justice index (WJP)', unit: 'index 0-1', weight: 0.10, s0: 0.70, s25: 0.60, s50: 0.50, s75: 0.40, s100: 0.30, direction: -1, primarySource: 'WJP Rule of Law Index' },
  { id: '3.8', pillar: 3, name: 'Budget & data credibility', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IMF DSBB / Open Budget' },
  { id: '3.9', pillar: 3, name: 'State role expansion', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'OECD SOE Data' },
  { id: '3.10', pillar: 3, name: 'Central bank independence', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Garriga CBI Index / Article IV' },

  // Pillar 4: Political Dynamics (15% standard / 13.4% island)
  { id: '4.1', pillar: 4, name: 'Street pressure vs adjustment', unit: 'level 0-4', weight: 0.15, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'ACLED / GDELT Protests' },
  { id: '4.2', pillar: 4, name: 'Military & elite cohesion', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Crisis Group / IISS' },
  { id: '4.3', pillar: 4, name: 'Regime type & factionalism', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'V-Dem Classification' },
  { id: '4.4', pillar: 4, name: 'Coup risk & history', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Powell-Thyne Coup Dataset' },
  { id: '4.5', pillar: 4, name: 'Election timing & contestation', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IFES ElectionGuide / NELDA' },
  { id: '4.6', pillar: 4, name: 'Policy predictability by decree', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Randori Event Log' },
  { id: '4.7', pillar: 4, name: 'Legislative passage capacity', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IDB Political Institutions' },
  { id: '4.8', pillar: 4, name: 'Stance toward creditors', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Official Statements / Speeches' },
  { id: '4.9', pillar: 4, name: 'Outside patron reliance', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'SIPRI / AidData' },
  { id: '4.10', pillar: 4, name: 'Geopolitical position / GPR', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Caldara-Iacoviello GPR / OFAC' },
  { id: '4.11', pillar: 4, name: 'Leader & succession risk', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Geddes-Wright-Frantz Dataset' },

  // Pillar 5: Macro & Financial Fragility (10% standard / 8.9% island)
  { id: '5.1', pillar: 5, name: "Banks' claims on sovereign", unit: '% bank assets', weight: 0.10, s0: 10, s25: 15, s50: 25, s75: 35, s100: 45, direction: 1, primarySource: 'IMF MFS API' },
  { id: '5.2', pillar: 5, name: 'Bank FX loan mismatch', unit: '% total loans', weight: 0.10, s0: 10, s25: 20, s50: 35, s75: 50, s100: 65, direction: 1, primarySource: 'IMF FSI API' },
  { id: '5.3', pillar: 5, name: 'Weakest large bank status', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Central Bank FSRs' },
  { id: '5.4', pillar: 5, name: 'Credit growth vs export price', unit: 'correlation', weight: 0.10, s0: 0.10, s25: 0.25, s50: 0.40, s75: 0.55, s100: 0.70, direction: 1, primarySource: 'World Bank Pink Sheet / IMF' },
  { id: '5.5', pillar: 5, name: 'Inflation rate (12m)', unit: '% YoY', weight: 0.10, s0: 3, s25: 6, s50: 10, s75: 20, s100: 40, direction: 1, primarySource: 'IMF WEO / National Stats' },
  { id: '5.6', pillar: 5, name: 'Real GDP growth next year', unit: '% YoY', weight: 0.10, s0: 5, s25: 3.5, s50: 2, s75: 0, s100: -2, direction: -1, primarySource: 'IMF WEO / Stress Path' },
  { id: '5.7', pillar: 5, name: 'State-owned bank assets', unit: '% bank assets', weight: 0.05, s0: 10, s25: 20, s50: 35, s75: 50, s100: 65, direction: 1, primarySource: 'World Bank BRSS Survey' },
  { id: '5.8', pillar: 5, name: 'Non-bank shadow credit', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'IMF FSAP / GSMA' },
  { id: '5.9', pillar: 5, name: 'Credit-to-GDP gap', unit: 'pp of GDP', weight: 0.05, s0: 0, s25: 2, s50: 5, s75: 10, s100: 15, direction: 1, primarySource: 'BIS Credit-to-GDP Gaps API' },
  { id: '5.10', pillar: 5, name: 'Non-performing loans (NPL)', unit: '% total loans', weight: 0.05, s0: 3, s25: 5, s50: 8, s75: 12, s100: 18, direction: 1, primarySource: 'IMF FSI / World Bank WDI' },
  { id: '5.11', pillar: 5, name: 'Real deposit growth (12m)', unit: '% YoY', weight: 0.05, s0: 5, s25: 0, s50: -5, s75: -10, s100: -15, direction: -1, primarySource: 'IMF IFS API' },
  { id: '5.12', pillar: 5, name: 'Growth volatility (15y SD)', unit: 'pp', weight: 0.05, s0: 1.5, s25: 2.5, s50: 3.5, s75: 5, s100: 7, direction: 1, primarySource: 'IMF WEO Real GDP History' },
  { id: '5.13', pillar: 5, name: 'Real policy rate', unit: '%', weight: 0.05, s0: 4, s25: 6, s50: 8, s75: 10, s100: 12, direction: 1, primarySource: 'BIS CBPOL API less CPI' },
  { id: '5.14', pillar: 5, name: 'GDP per capita', unit: 'US$', weight: 0.05, s0: 30000, s25: 15000, s50: 6000, s75: 2500, s100: 1000, direction: -1, primarySource: 'IMF DataMapper NGDPDPC' },

  // Pillar 6: Security, Conflict & Social Stability (10% standard / 8.9% island)
  { id: '6.1', pillar: 6, name: 'Armed conflict intensity', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'UCDP GED API' },
  { id: '6.2', pillar: 6, name: 'Homicide rate', unit: 'per 100k', weight: 0.10, s0: 2, s25: 5, s50: 10, s75: 20, s100: 40, direction: 1, primarySource: 'World Bank WDI / UNODC' },
  { id: '6.3', pillar: 6, name: 'Gang control & extortion', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Global Organized Crime Index' },
  { id: '6.4', pillar: 6, name: 'Direct attacks on business/staff', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'ACLED Strategic Events API' },
  { id: '6.5', pillar: 6, name: 'State territorial control', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'Crisis Group / ACLED' },
  { id: '6.6', pillar: 6, name: 'Youth unemployment (15-24)', unit: '% labor force', weight: 0.10, s0: 8, s25: 12, s50: 18, s75: 25, s100: 35, direction: 1, primarySource: 'World Bank WDI / ILOSTAT' },
  { id: '6.7', pillar: 6, name: 'Criminal markets score', unit: 'score 1-10', weight: 0.05, s0: 3, s25: 4, s50: 5.5, s75: 7, s100: 8, direction: 1, primarySource: 'GOCI Index Dataset' },
  { id: '6.8', pillar: 6, name: 'Cyber attacks on state systems', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'ITU Global Cybersecurity Index' },
  { id: '6.9', pillar: 6, name: 'Political violence trend ratio', unit: 'ratio 12m/5y', weight: 0.05, s0: 0.8, s25: 1, s50: 1.5, s75: 2, s100: 3, direction: 1, primarySource: 'ACLED API Trend Analysis' },
  { id: '6.10', pillar: 6, name: 'Inequality & excluded groups', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'World Bank Gini / ETH EPR' },
  { id: '6.11', pillar: 6, name: 'Food insecurity (IPC 3+)', unit: '% population', weight: 0.05, s0: 2, s25: 5, s50: 10, s75: 20, s100: 30, direction: 1, primarySource: 'IPC API / FEWS NET' },
  { id: '6.12', pillar: 6, name: 'Regional spillover conflict', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'UCDP / UNHCR API' },
  { id: '6.13', pillar: 6, name: 'Global Terrorism Index', unit: 'score 0-10', weight: 0.05, s0: 1, s25: 2.5, s50: 4, s75: 6, s100: 8, direction: 1, primarySource: 'IEP GTI Dataset' },
  { id: '6.14', pillar: 6, name: 'Security forces capacity/conduct', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'US State Dept Human Rights' },

  // Pillar 7: Climate Vulnerability & Catastrophic Risk (5% standard / 15.0% island)
  { id: '7.1', pillar: 7, name: 'Expected annual disaster loss', unit: '% of GDP', weight: 0.15, s0: 0.1, s25: 0.3, s50: 0.7, s75: 1.5, s100: 3, direction: 1, primarySource: 'UNDRR GAR Risk Data' },
  { id: '7.2', pillar: 7, name: '1-in-100y tail disaster loss', unit: '% of GDP', weight: 0.10, s0: 2, s25: 5, s50: 10, s75: 25, s100: 50, direction: 1, primarySource: 'UNDRR Probable Max Loss' },
  { id: '7.3', pillar: 7, name: 'Back-to-back disaster chance', unit: '% prob in 3y', weight: 0.10, s0: 5, s25: 10, s50: 20, s75: 35, s100: 50, direction: 1, primarySource: 'EM-DAT / Cat Models' },
  { id: '7.4', pillar: 7, name: 'Hazard-exposed export share', unit: '% exports', weight: 0.10, s0: 10, s25: 20, s50: 35, s75: 50, s100: 65, direction: 1, primarySource: 'WTTC / FAO / Port Stats' },
  { id: '7.5', pillar: 7, name: 'Insurance protection gap', unit: '% uninsured', weight: 0.10, s0: 40, s25: 60, s50: 75, s75: 88, s100: 95, direction: 1, primarySource: 'Swiss Re Sigma Annual' },
  { id: '7.6', pillar: 7, name: 'Financial protection layering', unit: 'level 0-4', weight: 0.10, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'CCRIF / World Bank Cat DDO' },
  { id: '7.7', pillar: 7, name: 'Parametric cover basis risk', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'CCRIF / ARC Payout Histories' },
  { id: '7.8', pillar: 7, name: 'Low-lying coastal concentration', unit: '% population', weight: 0.05, s0: 5, s25: 10, s50: 20, s75: 35, s100: 50, direction: 1, primarySource: 'CIESIN LECZ Dataset' },
  { id: '7.9', pillar: 7, name: 'Climate-driven conflict', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'ACLED / SPEI Drought Index' },
  { id: '7.10', pillar: 7, name: 'Fossil fuel transition risk', unit: '% exports', weight: 0.05, s0: 5, s25: 15, s50: 30, s75: 50, s100: 70, direction: 1, primarySource: 'UN Comtrade HS27 API' },
  { id: '7.11', pillar: 7, name: 'ND-GAIN climate vulnerability', unit: 'score 0-1', weight: 0.05, s0: 0.35, s25: 0.40, s50: 0.45, s75: 0.52, s100: 0.58, direction: 1, primarySource: 'ND-GAIN Dataset' },
  { id: '7.12', pillar: 7, name: 'Water stress (WRI Aqueduct)', unit: 'level 0-4', weight: 0.05, s0: 0, s25: 1, s50: 2, s75: 3, s100: 4, direction: 1, primarySource: 'WRI Aqueduct Country Rankings' },
  { id: '7.13', pillar: 7, name: 'Post-disaster GDP recovery speed', unit: 'years', weight: 0.05, s0: 1, s25: 2, s50: 3, s75: 4.5, s100: 6, direction: 1, primarySource: 'IMF Post-Disaster Reviews' }
];
