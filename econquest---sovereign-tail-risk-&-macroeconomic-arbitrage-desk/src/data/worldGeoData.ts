/**
 * World Geographic Geometry and Maritime Chokepoints Dataset
 * Pre-calibrated GeoJSON-compliant coordinates for global continents, sovereign landmasses,
 * and strategic maritime shipping corridors.
 */

export interface GeoCountryFeature {
  id: string; // ISO 3166-1 alpha-3 code (e.g. 'ARG', 'CHL', 'IDN', 'USA', 'SEC8')
  name: string;
  region: string;
  coordinates: number[][][]; // Multi-polygon longitude/latitude rings [[ [lon, lat], ... ]]
}

export interface MaritimeChokepoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  oilVolumeMbd: number; // Millions of barrels per day
  globalTradeSharePercent: number;
  primaryRisk: string;
  linkedSovereigns: string[];
  status: 'Normal' | 'Elevated' | 'Disrupted';
}

export const MARITIME_CHOKEPOINTS: MaritimeChokepoint[] = [
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    lon: 101.5,
    lat: 2.8,
    oilVolumeMbd: 16.0,
    globalTradeSharePercent: 24.5,
    primaryRisk: 'Naval blockade & South China Sea spillover; critical for East Asian energy supply.',
    linkedSovereigns: ['indonesia', 'sri-lanka'],
    status: 'Elevated'
  },
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lon: 56.4,
    lat: 26.6,
    oilVolumeMbd: 21.0,
    globalTradeSharePercent: 20.8,
    primaryRisk: 'Gulf tanker transit interdiction & mine warfare risk; mono-energy corridor.',
    linkedSovereigns: ['turkey', 'paper-walkthrough'],
    status: 'Elevated'
  },
  {
    id: 'bab-el-mandeb',
    name: 'Bab el-Mandeb & Red Sea',
    lon: 43.3,
    lat: 12.6,
    oilVolumeMbd: 8.8,
    globalTradeSharePercent: 12.0,
    primaryRisk: 'Anti-ship missile attacks, drone strikes, rerouting around Cape of Good Hope (+14 days).',
    linkedSovereigns: ['paper-walkthrough', 'turkey'],
    status: 'Disrupted'
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    lon: 32.3,
    lat: 30.6,
    oilVolumeMbd: 9.0,
    globalTradeSharePercent: 14.5,
    primaryRisk: 'Passage tolls foreign exchange lifeline for North Africa; physical closure hazard.',
    linkedSovereigns: ['paper-walkthrough', 'turkey'],
    status: 'Elevated'
  },
  {
    id: 'bosporus',
    name: 'Turkish Straits (Bosporus/Dardanelles)',
    lon: 29.1,
    lat: 41.1,
    oilVolumeMbd: 3.2,
    globalTradeSharePercent: 4.8,
    primaryRisk: 'Black Sea grain corridor and Russian crude bottleneck regulated by Montreux Convention.',
    linkedSovereigns: ['turkey'],
    status: 'Normal'
  },
  {
    id: 'panama',
    name: 'Panama Canal',
    lon: -79.6,
    lat: 9.1,
    oilVolumeMbd: 1.2,
    globalTradeSharePercent: 5.2,
    primaryRisk: 'Freshwater Gatun Lake drought draft restrictions reducing vessel transits.',
    linkedSovereigns: ['belize', 'chile'],
    status: 'Normal'
  },
  {
    id: 'cape-good-hope',
    name: 'Cape of Good Hope',
    lon: 18.5,
    lat: -34.4,
    oilVolumeMbd: 5.8,
    globalTradeSharePercent: 9.0,
    primaryRisk: 'Bunkering capacity strain, rough South Atlantic sea states during Red Sea diversion.',
    linkedSovereigns: ['south-africa'],
    status: 'Elevated'
  }
];

/**
 * GeoJSON-compliant country boundary coordinates (lon, lat)
 * Optimized for natural rendering on D3 Natural Earth & Mercator projections
 */
export const WORLD_COUNTRIES_GEO: GeoCountryFeature[] = [
  // --- MONITORED CORE SOVEREIGNS ---
  {
    id: 'ARG',
    name: 'Argentina',
    region: 'Latin America',
    coordinates: [[
      [-65, -22], [-62, -22], [-57, -27], [-58, -31], [-54, -34], [-57, -38],
      [-63, -41], [-65, -47], [-68, -52], [-66, -55], [-71, -55], [-73, -51],
      [-72, -44], [-71, -38], [-70, -32], [-69, -27], [-67, -23], [-65, -22]
    ]]
  },
  {
    id: 'CHL',
    name: 'Chile',
    region: 'Latin America',
    coordinates: [[
      [-70, -18], [-68, -20], [-67, -24], [-70, -32], [-71, -38], [-72, -44],
      [-73, -51], [-75, -53], [-74, -46], [-73, -40], [-72, -33], [-71, -25],
      [-70, -18]
    ]]
  },
  {
    id: 'BLZ',
    name: 'Belize',
    region: 'Latin America',
    coordinates: [[
      [-89.2, 15.9], [-89.2, 16.7], [-89.1, 17.8], [-88.3, 18.5], [-88.2, 17.5],
      [-88.1, 16.5], [-88.2, 15.9], [-89.2, 15.9]
    ]]
  },
  {
    id: 'SEC8',
    name: 'Section 8 Case Study (Frontier)',
    region: 'Middle East / North Africa',
    coordinates: [[
      [25, 31.5], [31.5, 31.5], [34, 31], [34.5, 27.8], [32.5, 24], [35, 22],
      [30, 22], [25, 22], [25, 31.5]
    ]]
  },
  {
    id: 'LKA',
    name: 'Sri Lanka',
    region: 'South Asia',
    coordinates: [[
      [79.8, 9.8], [81.8, 8.5], [81.8, 7.0], [80.6, 5.9], [79.8, 6.9],
      [79.7, 8.5], [79.8, 9.8]
    ]]
  },
  {
    id: 'TUR',
    name: 'Turkey',
    region: 'Emerging Europe',
    coordinates: [[
      [26, 41.5], [29, 41.2], [35, 42], [41.5, 41.5], [44, 39], [44.5, 37],
      [42, 37], [36, 36.5], [33, 36], [29, 36.5], [26.5, 38.5], [26, 40],
      [26, 41.5]
    ]]
  },
  {
    id: 'GHA',
    name: 'Ghana',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [-2.8, 11], [-0.1, 11], [0.5, 9.5], [1.1, 6.1], [0.1, 5.6],
      [-2.2, 5.0], [-3.1, 6.5], [-2.8, 8.5], [-2.8, 11]
    ]]
  },
  {
    id: 'IDN',
    name: 'Indonesia',
    region: 'Southeast Asia',
    coordinates: [
      // Sumatra
      [[95.3, 5.6], [98.5, 3.5], [103.5, -1.2], [106, -5.9], [103.5, -4.5], [100, -1.5], [96.5, 2.5], [95.3, 5.6]],
      // Java
      [[105.5, -6.1], [108.5, -6.5], [112.5, -7.0], [114.5, -8.6], [111, -8.2], [106.5, -7.5], [105.5, -6.1]],
      // Kalimantan
      [[109, 2.0], [115, 4.0], [118, 2.5], [117, -1.5], [115, -4.0], [111, -3.0], [109, -1.0], [109, 2.0]]
    ]
  },
  {
    id: 'PAK',
    name: 'Pakistan',
    region: 'South Asia',
    coordinates: [[
      [61, 25], [62, 29.5], [66, 30], [69, 33], [71, 36.5], [74.5, 36.5],
      [74, 31], [71, 27], [68.5, 24], [66, 24.5], [61, 25]
    ]]
  },
  {
    id: 'ZAF',
    name: 'South Africa',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [16.5, -28.5], [20, -28.5], [20, -22], [28, -22], [31.5, -22.5], [32.8, -27],
      [31.5, -30], [28, -32.5], [25, -34], [20, -34.8], [18, -34], [17.5, -30],
      [16.5, -28.5]
    ]]
  },

  // --- GLOBAL CONTINENTS & BENCHMARK POWERS (GEOPOLITICAL REFERENCE CONTEXT) ---
  {
    id: 'USA',
    name: 'United States',
    region: 'North America',
    coordinates: [[
      [-124, 48.5], [-117, 49], [-95, 49], [-82, 45], [-67, 45], [-71, 41],
      [-75, 35], [-81, 25], [-87, 30], [-97, 26], [-106, 31.8], [-117, 32.5],
      [-124, 38], [-124, 48.5]
    ]]
  },
  {
    id: 'CAN',
    name: 'Canada',
    region: 'North America',
    coordinates: [[
      [-140, 69], [-125, 71], [-85, 73], [-60, 62], [-55, 52], [-65, 46],
      [-82, 45], [-95, 49], [-123, 49], [-130, 54], [-140, 60], [-140, 69]
    ]]
  },
  {
    id: 'MEX',
    name: 'Mexico',
    region: 'Latin America',
    coordinates: [[
      [-117, 32.5], [-106, 31.8], [-97, 26], [-97, 20], [-91, 18], [-87, 21.5],
      [-90, 18], [-92, 15], [-97, 16], [-105, 20], [-110, 24], [-115, 30],
      [-117, 32.5]
    ]]
  },
  {
    id: 'BRA',
    name: 'Brazil',
    region: 'Latin America',
    coordinates: [[
      [-60, 5], [-51, 4], [-44, -2.5], [-35, -5], [-35, -9], [-39, -15],
      [-42, -22], [-48, -26], [-53, -33], [-57, -27], [-60, -22], [-68, -11],
      [-73, -7], [-70, 0], [-60, 5]
    ]]
  },
  {
    id: 'COL',
    name: 'Colombia',
    region: 'Latin America',
    coordinates: [[
      [-77, 8], [-72, 12], [-71, 7], [-67, 2], [-70, -4], [-75, -1],
      [-78, 1], [-77, 8]
    ]]
  },
  {
    id: 'PER',
    name: 'Peru',
    region: 'Latin America',
    coordinates: [[
      [-80, -4], [-75, 0], [-70, -4], [-69, -13], [-69, -17], [-75, -15],
      [-80, -8], [-81, -5], [-80, -4]
    ]]
  },
  {
    id: 'GBR',
    name: 'United Kingdom',
    region: 'Europe',
    coordinates: [[
      [-5, 50], [-4.5, 52], [-5.5, 55], [-5, 58.5], [-2, 58.5], [-1.5, 55.5],
      [0.5, 53], [1.5, 51.5], [-5, 50]
    ]]
  },
  {
    id: 'DEU',
    name: 'Germany',
    region: 'Europe',
    coordinates: [[
      [6, 50.5], [8.5, 54.5], [14, 54], [15, 51], [13, 47.5], [8, 47.5],
      [6, 50.5]
    ]]
  },
  {
    id: 'FRA',
    name: 'France',
    region: 'Europe',
    coordinates: [[
      [-4.5, 48.5], [2, 51], [7.5, 49], [7, 44], [3, 42.5], [-1.5, 43.5],
      [-1.5, 46], [-4.5, 48.5]
    ]]
  },
  {
    id: 'ESP',
    name: 'Spain',
    region: 'Europe',
    coordinates: [[
      [-9, 42], [-8, 43.5], [-2, 43.5], [3, 42.5], [0, 39], [-2, 36.5],
      [-6, 36], [-9, 37], [-9, 42]
    ]]
  },
  {
    id: 'ITA',
    name: 'Italy',
    region: 'Europe',
    coordinates: [[
      [7, 45], [12, 46.5], [14, 46], [18, 40], [16, 38], [15, 38.5],
      [12, 42], [9, 44], [7, 45]
    ]]
  },
  {
    id: 'RUS',
    name: 'Russian Federation',
    region: 'Eurasia',
    coordinates: [[
      [30, 60], [40, 68], [60, 73], [90, 75], [140, 72], [175, 66],
      [160, 52], [135, 45], [120, 50], [85, 52], [55, 51], [38, 47],
      [30, 53], [30, 60]
    ]]
  },
  {
    id: 'UKR',
    name: 'Ukraine',
    region: 'Eastern Europe',
    coordinates: [[
      [23, 51], [32, 52], [39, 50], [38, 47], [35, 46], [30, 46],
      [24, 48], [23, 51]
    ]]
  },
  {
    id: 'EGY',
    name: 'Egypt',
    region: 'North Africa',
    coordinates: [[
      [25, 31.5], [31.5, 31.5], [34, 31], [34.5, 27.8], [32.5, 24], [35, 22],
      [30, 22], [25, 22], [25, 31.5]
    ]]
  },
  {
    id: 'SAU',
    name: 'Saudi Arabia',
    region: 'Middle East',
    coordinates: [[
      [36, 29], [42, 31], [48, 30], [50, 26], [55, 23], [55, 17],
      [44, 16], [42, 17], [36, 25], [36, 29]
    ]]
  },
  {
    id: 'IRN',
    name: 'Iran',
    region: 'Middle East',
    coordinates: [[
      [45, 38], [50, 38], [54, 37], [61, 35], [61, 25], [56, 26],
      [50, 29], [48, 32], [45, 38]
    ]]
  },
  {
    id: 'NGA',
    name: 'Nigeria',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [3, 6.5], [3, 13], [14, 13], [14, 10], [9, 5], [5, 4.5], [3, 6.5]
    ]]
  },
  {
    id: 'KEN',
    name: 'Kenya',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [34, 4], [41, 4], [41, -1.5], [39, -4.5], [37, -3], [34, 0], [34, 4]
    ]]
  },
  {
    id: 'ETH',
    name: 'Ethiopia',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [34, 8], [37, 14], [42, 12], [47, 8], [42, 4], [36, 5], [34, 8]
    ]]
  },
  {
    id: 'AGO',
    name: 'Angola',
    region: 'Sub-Saharan Africa',
    coordinates: [[
      [12, -6], [18, -6], [22, -8], [24, -13], [21, -18], [14, -17],
      [12, -14], [12, -6]
    ]]
  },
  {
    id: 'IND',
    name: 'India',
    region: 'South Asia',
    coordinates: [[
      [68, 24], [72, 31], [78, 35], [88, 27], [95, 27], [92, 22],
      [86, 20], [80, 13], [77, 8], [73, 16], [68, 24]
    ]]
  },
  {
    id: 'CHN',
    name: 'China',
    region: 'East Asia',
    coordinates: [[
      [75, 38], [85, 48], [115, 52], [130, 47], [122, 40], [120, 32],
      [118, 24], [108, 21], [100, 22], [92, 28], [80, 32], [75, 38]
    ]]
  },
  {
    id: 'JPN',
    name: 'Japan',
    region: 'East Asia',
    coordinates: [[
      [130, 32], [130, 33], [136, 36], [140, 44], [145, 44], [141, 41],
      [139, 35], [133, 35], [130, 32]
    ]]
  },
  {
    id: 'KOR',
    name: 'South Korea',
    region: 'East Asia',
    coordinates: [[
      [126, 38], [129, 38], [129.5, 35.5], [127, 34.5], [126, 36], [126, 38]
    ]]
  },
  {
    id: 'THA',
    name: 'Thailand',
    region: 'Southeast Asia',
    coordinates: [[
      [98, 20], [105, 15], [102, 12], [101, 6], [99, 10], [98, 15], [98, 20]
    ]]
  },
  {
    id: 'VNM',
    name: 'Vietnam',
    region: 'Southeast Asia',
    coordinates: [[
      [104, 22], [108, 21], [108, 16], [109, 12], [105, 9], [105, 11],
      [106, 17], [104, 22]
    ]]
  },
  {
    id: 'PHL',
    name: 'Philippines',
    region: 'Southeast Asia',
    coordinates: [[
      [120, 18], [122, 16], [125, 10], [125, 6], [121, 8], [120, 14], [120, 18]
    ]]
  },
  {
    id: 'AUS',
    name: 'Australia',
    region: 'Oceania',
    coordinates: [[
      [114, -22], [122, -16], [132, -12], [142, -11], [146, -17], [153, -28],
      [149, -37], [138, -35], [128, -32], [115, -34], [114, -22]
    ]]
  },
  {
    id: 'NZL',
    name: 'New Zealand',
    region: 'Oceania',
    coordinates: [[
      [167, -46], [172, -41], [174, -36], [178, -38], [173, -42], [167, -46]
    ]]
  }
];

export type MapRiskMetric = 'totalModel' | 'geopolitical' | 'var99' | 'hmmRegime';

export interface MapColorThreshold {
  label: string;
  min: number;
  max: number;
  color: string;
  borderColor: string;
  textColor: string;
  bgBadge: string;
  description: string;
}

export const MAP_RISK_SCALES: Record<MapRiskMetric, MapColorThreshold[]> = {
  totalModel: [
    {
      label: 'Low (< 5%)',
      min: 0,
      max: 5,
      color: '#10b981', // Vivid Emerald Green
      borderColor: '#34d399',
      textColor: '#a7f3d0',
      bgBadge: '#064e3b',
      description: 'Nominal solvency, ample reserves & low debt burden'
    },
    {
      label: 'Moderate (5 - 12%)',
      min: 5,
      max: 12,
      color: '#84cc16', // Bright Lime / Chartreuse
      borderColor: '#a3e635',
      textColor: '#d9f99d',
      bgBadge: '#365314',
      description: 'Manageable external debt with minor rollover risks'
    },
    {
      label: 'Stressed (12 - 20%)',
      min: 12,
      max: 20,
      color: '#eab308', // High-Luminance Gold / Yellow
      borderColor: '#facc15',
      textColor: '#fef08a',
      bgBadge: '#713f12',
      description: 'Elevated macro fragility, spread widening & FX drain'
    },
    {
      label: 'Acute (20 - 30%)',
      min: 20,
      max: 30,
      color: '#f97316', // Electric Safety Orange
      borderColor: '#fb923c',
      textColor: '#fed7aa',
      bgBadge: '#7c2d12',
      description: 'Critical refinancing cliff, high Merton default probability'
    },
    {
      label: 'Crisis (> 30%)',
      min: 30,
      max: 100,
      color: '#f43f5e', // Vibrant Neon Crimson / Ruby
      borderColor: '#fb7185',
      textColor: '#ffe4e6',
      bgBadge: '#881337',
      description: 'Imminent debt moratorium, IMF distress or sovereign restructuring'
    }
  ],
  geopolitical: [
    {
      label: 'Stable (< 40)',
      min: 0,
      max: 40,
      color: '#10b981',
      borderColor: '#34d399',
      textColor: '#a7f3d0',
      bgBadge: '#064e3b',
      description: 'Strong institutions, stable governance & low conflict risk'
    },
    {
      label: 'Moderate (40 - 55)',
      min: 40,
      max: 55,
      color: '#84cc16',
      borderColor: '#a3e635',
      textColor: '#d9f99d',
      bgBadge: '#365314',
      description: 'Mild election contestation or routine policy shifts'
    },
    {
      label: 'Vulnerable (55 - 70)',
      min: 55,
      max: 70,
      color: '#f97316',
      borderColor: '#fb923c',
      textColor: '#fed7aa',
      bgBadge: '#7c2d12',
      description: 'Street unrest, elite polarization & contested mandates'
    },
    {
      label: 'Severe (> 70)',
      min: 70,
      max: 100,
      color: '#f43f5e',
      borderColor: '#fb7185',
      textColor: '#ffe4e6',
      bgBadge: '#881337',
      description: 'Active conflict, mutiny/coup risk & expropriation threats'
    }
  ],
  var99: [
    {
      label: 'Low VaR (< 8%)',
      min: 0,
      max: 8,
      color: '#10b981',
      borderColor: '#34d399',
      textColor: '#a7f3d0',
      bgBadge: '#064e3b',
      description: 'Minimal tail loss expectation under Basel III standards'
    },
    {
      label: 'Moderate (8 - 15%)',
      min: 8,
      max: 15,
      color: '#84cc16',
      borderColor: '#a3e635',
      textColor: '#d9f99d',
      bgBadge: '#365314',
      description: 'Normal frontier debt volatility & capital buffer coverage'
    },
    {
      label: 'Elevated (15 - 25%)',
      min: 15,
      max: 25,
      color: '#f97316',
      borderColor: '#fb923c',
      textColor: '#fed7aa',
      bgBadge: '#7c2d12',
      description: 'Significant tail loss potential, liquidity haircuts apply'
    },
    {
      label: 'Critical (> 25%)',
      min: 25,
      max: 100,
      color: '#f43f5e',
      borderColor: '#fb7185',
      textColor: '#ffe4e6',
      bgBadge: '#881337',
      description: 'Extreme tail default loss clustering, FRTB capital surcharge'
    }
  ],
  hmmRegime: [
    {
      label: 'Calm Regime',
      min: 0,
      max: 1,
      color: '#10b981',
      borderColor: '#34d399',
      textColor: '#a7f3d0',
      bgBadge: '#064e3b',
      description: 'Normal macro conditions, stationary spread distributions'
    },
    {
      label: 'Stressed Regime',
      min: 1,
      max: 2,
      color: '#eab308',
      borderColor: '#facc15',
      textColor: '#fef08a',
      bgBadge: '#713f12',
      description: 'Heightened market volatility & transitional contagion risk'
    },
    {
      label: 'Crisis Regime',
      min: 2,
      max: 3,
      color: '#f43f5e',
      borderColor: '#fb7185',
      textColor: '#ffe4e6',
      bgBadge: '#881337',
      description: 'Bifurcated credit distress state with non-linear feedback loops'
    }
  ]
};

/**
 * Calculates display color and styling tokens for a value given a metric
 */
export function getMapColor(value: number, metric: MapRiskMetric): {
  color: string;
  borderColor: string;
  textColor: string;
  bgBadge: string;
  label: string;
  tierIndex: number;
} {
  const scale = MAP_RISK_SCALES[metric];
  for (let idx = 0; idx < scale.length; idx++) {
    const tier = scale[idx];
    if (value >= tier.min && (value < tier.max || tier.max === 100 || tier.max === 3)) {
      return {
        color: tier.color,
        borderColor: tier.borderColor,
        textColor: tier.textColor,
        bgBadge: tier.bgBadge,
        label: tier.label,
        tierIndex: idx
      };
    }
  }
  const fallback = scale[scale.length - 1];
  return {
    color: fallback.color,
    borderColor: fallback.borderColor,
    textColor: fallback.textColor,
    bgBadge: fallback.bgBadge,
    label: fallback.label,
    tierIndex: scale.length - 1
  };
}

