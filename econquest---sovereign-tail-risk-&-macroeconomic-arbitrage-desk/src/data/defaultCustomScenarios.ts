import { CustomScenarioParams } from '../types/riskEngine';

export const DEFAULT_CUSTOM_SCENARIO: CustomScenarioParams = {
  id: 'custom_baseline_shock',
  name: 'Custom Macro Shock Workspace',
  description: 'User-calibrated multi-factor macro shock: yield curve shift, terms-of-trade degradation, and FX volatility skew.',
  
  // Sovereign Yield Curves & Credit Spreads
  usYieldCurveShiftBps: 150,
  sovereignSpreadWideningBps: 280,
  curveSteepeningBps: 35,
  
  // Commodity Price Indices
  commodityPriceShockPercent: -20,
  energyOilShockPercent: -25,
  metalsTermsOfTradeShockPercent: -18,
  
  // FX Volatility & Currency Dynamics
  fxImpliedVolSkewJump: 16,
  broadUsdAppreciation: 12,
  reserveDrainPercent: -20,
  
  // Geopolitical, Supply Chain & Banking Nexus
  textStressIndexShockSigma: 2.4,
  aisChokepointDisruptionPct: 30,
  crossBorderContagionRho: 0.22
};

export const PRESET_CUSTOM_SCENARIOS: CustomScenarioParams[] = [
  {
    id: 'preset_stagflation',
    name: 'Global Stagflationary Squeeze',
    description: 'Persistent cost-push inflation with +300 bps Fed tightening, surging energy (+55%), and high-yield sovereign spread expansion (+420 bps).',
    usYieldCurveShiftBps: 300,
    sovereignSpreadWideningBps: 420,
    curveSteepeningBps: 60,
    commodityPriceShockPercent: -10,
    energyOilShockPercent: 55,
    metalsTermsOfTradeShockPercent: -22,
    fxImpliedVolSkewJump: 24,
    broadUsdAppreciation: 16,
    reserveDrainPercent: -28,
    textStressIndexShockSigma: 3.2,
    aisChokepointDisruptionPct: 40,
    crossBorderContagionRho: 0.28
  },
  {
    id: 'preset_sudden_stop',
    name: 'Emerging Market Sudden Stop & Dollar Spike',
    description: 'Catastrophic capital retrenchment: US Dollar surges +24%, emerging sovereign spreads blowout +650 bps, and reserve drain drains 42%.',
    usYieldCurveShiftBps: 220,
    sovereignSpreadWideningBps: 650,
    curveSteepeningBps: 85,
    commodityPriceShockPercent: -35,
    energyOilShockPercent: -22,
    metalsTermsOfTradeShockPercent: -38,
    fxImpliedVolSkewJump: 36,
    broadUsdAppreciation: 24,
    reserveDrainPercent: -42,
    textStressIndexShockSigma: 2.8,
    aisChokepointDisruptionPct: 25,
    crossBorderContagionRho: 0.38
  },
  {
    id: 'preset_chokepoint_energy',
    name: 'Critical Maritime Chokepoint & Energy Embargo',
    description: '75% maritime transit shutdown across Hormuz/Malacca with Brent crude surging +75% and Text Stress Index spiking +5.2σ.',
    usYieldCurveShiftBps: 110,
    sovereignSpreadWideningBps: 320,
    curveSteepeningBps: 40,
    commodityPriceShockPercent: 35,
    energyOilShockPercent: 75,
    metalsTermsOfTradeShockPercent: 20,
    fxImpliedVolSkewJump: 28,
    broadUsdAppreciation: 14,
    reserveDrainPercent: -18,
    textStressIndexShockSigma: 5.2,
    aisChokepointDisruptionPct: 75,
    crossBorderContagionRho: 0.30
  },
  {
    id: 'preset_metals_bust',
    name: 'Industrial Metals & Commodity Super-Bust',
    description: 'Synchronized emerging market demand contraction: metals crash -50%, broad commodities collapse -52%, impairing resource mono-exporters.',
    usYieldCurveShiftBps: -40,
    sovereignSpreadWideningBps: 480,
    curveSteepeningBps: -30,
    commodityPriceShockPercent: -52,
    energyOilShockPercent: -48,
    metalsTermsOfTradeShockPercent: -50,
    fxImpliedVolSkewJump: 20,
    broadUsdAppreciation: 10,
    reserveDrainPercent: -30,
    textStressIndexShockSigma: 1.8,
    aisChokepointDisruptionPct: 15,
    crossBorderContagionRho: 0.22
  },
  {
    id: 'preset_dovish_relief',
    name: 'Reflationary Soft-Landing & Dovish Pivot',
    description: 'Global easing cycle: US Treasury curve falls -120 bps, sovereign spreads compress -150 bps, trade flows accelerate, and volatility normalizes.',
    usYieldCurveShiftBps: -120,
    sovereignSpreadWideningBps: -150,
    curveSteepeningBps: 25,
    commodityPriceShockPercent: 12,
    energyOilShockPercent: 8,
    metalsTermsOfTradeShockPercent: 15,
    fxImpliedVolSkewJump: -8,
    broadUsdAppreciation: -6,
    reserveDrainPercent: 5,
    textStressIndexShockSigma: -1.2,
    aisChokepointDisruptionPct: 0,
    crossBorderContagionRho: -0.10
  }
];

const STORAGE_KEY = 'panoptix_custom_macro_scenarios';

export function loadSavedCustomScenarios(): CustomScenarioParams[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to load custom scenarios from localStorage:', err);
  }
  return PRESET_CUSTOM_SCENARIOS;
}

export function saveCustomScenariosList(list: CustomScenarioParams[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('Failed to save custom scenarios to localStorage:', err);
  }
}
