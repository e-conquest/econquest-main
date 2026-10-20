export interface NavDeskItem {
  id: string;
  name: string;
  shortName: string;
  subtitle: string;
  category: 'risk_intel' | 'quant_models' | 'alpha_markets' | 'data_ingest';
  icon: string;
  badge?: string;
}

export interface NavCluster {
  id: 'risk_intel' | 'quant_models' | 'alpha_markets' | 'data_ingest';
  name: string;
  description: string;
  items: NavDeskItem[];
}

export const WORKSPACE_CLUSTERS: NavCluster[] = [
  {
    id: 'risk_intel',
    name: 'Risk Intelligence',
    description: 'Executive dashboards, systemic heatmaps, and cross-sovereign macro correlations',
    items: [
      {
        id: 'cockpit',
        name: 'Sovereign Cockpit',
        shortName: 'Cockpit',
        subtitle: 'Executive Multi-Asset Risk Desk & VaR Telemetry',
        category: 'risk_intel',
        icon: '📊'
      },
      {
        id: 'worldmap',
        name: 'World Risk Map',
        shortName: 'World Map',
        subtitle: 'Global Geopolitical & Total Model Risk Choropleth',
        category: 'risk_intel',
        icon: '🌐',
        badge: 'D3 Live'
      },
      {
        id: 'heatmap',
        name: 'Risk Heatmap',
        shortName: 'Heatmap',
        subtitle: 'Cross-Sovereign Systemic Contagion & Tail Risk',
        category: 'risk_intel',
        icon: '🗺️'
      },
      {
        id: 'correlation',
        name: 'Correlation Matrix',
        shortName: 'Correlation',
        subtitle: 'D3.js 7-Pillar Indicator Transmission Channels',
        category: 'risk_intel',
        icon: '🕸️'
      },
      {
        id: 'contagion',
        name: 'Systemic Contagion Network',
        shortName: 'Contagion',
        subtitle: 'Bilateral Spillover Topology & 3-Round Cascade Simulator',
        category: 'risk_intel',
        icon: '🔗',
        badge: 'Cascade'
      }
    ]
  },
  {
    id: 'quant_models',
    name: 'Quantitative Models',
    description: '6-layer mathematical pipeline, calibrated scorecards, and reflexive stress simulations',
    items: [
      {
        id: 'pipeline',
        name: '6-Layer Risk Pipeline',
        shortName: 'Pipeline',
        subtitle: 'Firth Hazard, Bayesian Update, Merton CCA & L-VaR',
        category: 'quant_models',
        icon: '🔬'
      },
      {
        id: 'yieldcurve',
        name: 'Yield Curve & Maturity Wall',
        shortName: 'Yield Curve',
        subtitle: 'Nelson-Siegel Term Structure, 2s10s Slope & 2026–2032 Rollover Wall',
        category: 'quant_models',
        icon: '📉',
        badge: 'Term'
      },
      {
        id: 'centralbank',
        name: 'Central Bank & Taylor Rule',
        shortName: 'Central Bank',
        subtitle: 'Policy Rate Cycles, Taylor Rule Gap, REER & Reserve Adequacy',
        category: 'quant_models',
        icon: '🏛️',
        badge: 'Macro'
      },
      {
        id: 'scorecard',
        name: '7-Pillar Scorecard',
        shortName: 'Scorecard',
        subtitle: 'Forensic Diagnostics & 10Y Recharts Indicator Trends',
        category: 'quant_models',
        icon: '📋'
      },
      {
        id: 'stress',
        name: 'Stress Lab & What-If',
        shortName: 'Stress Lab',
        subtitle: 'Custom Macro Scenario Builder & Reflexive Feedback',
        category: 'quant_models',
        icon: '⚡',
        badge: 'What-If'
      },
      {
        id: 'governance',
        name: 'FRTB Governance',
        shortName: 'Governance',
        subtitle: 'Basel III / FRTB Validation, Kupiec & Acerbi-Szekely',
        category: 'quant_models',
        icon: '⚖️'
      },
      {
        id: 'whitepaper',
        name: 'Methodology White Paper',
        shortName: 'White Paper',
        subtitle: 'Complete Econometric Specifications & Proofs',
        category: 'quant_models',
        icon: '📄'
      }
    ]
  },
  {
    id: 'alpha_markets',
    name: 'Markets & Alpha',
    description: 'Prediction market arbitrage, portfolio VaR optimization, and Yahoo Finance market metrics',
    items: [
      {
        id: 'portfolio',
        name: 'Portfolio VaR & Hedge Book',
        shortName: 'Portfolio VaR',
        subtitle: 'Multi-Sovereign Euler Component VaR & Automated CDS Hedge Optimizer',
        category: 'alpha_markets',
        icon: '💼',
        badge: 'Book'
      },
      {
        id: 'arbitrage',
        name: 'Arbitrage Alpha Monitor',
        shortName: 'Arbitrage',
        subtitle: 'Prediction Market Divergence & Institutional Playbook',
        category: 'alpha_markets',
        icon: '🎯'
      },
      {
        id: 'yfinance',
        name: 'Yahoo Finance Telemetry',
        shortName: 'yfinance',
        subtitle: 'Live Sovereign Bond ETFs, FX, Rates & Commodities',
        category: 'alpha_markets',
        icon: '📈'
      }
    ]
  },
  {
    id: 'data_ingest',
    name: 'Data & Ingest',
    description: 'External data source API configurations and CSV/Excel file ingestion',
    items: [
      {
        id: 'feeds',
        name: 'API Data Feeds',
        shortName: 'API Feeds',
        subtitle: 'Custom Endpoints, Polling Cadence & Layer Mappings',
        category: 'data_ingest',
        icon: '🔌'
      },
      {
        id: 'ingest',
        name: 'CSV / Excel Ingest',
        shortName: 'File Ingest',
        subtitle: 'Upload Custom Macro Data & Caldara-Iacoviello GPR',
        category: 'data_ingest',
        icon: '📥'
      }
    ]
  }
];

export const ALL_NAV_ITEMS: NavDeskItem[] = WORKSPACE_CLUSTERS.flatMap((c) => c.items);

export function getNavItemById(id: string): NavDeskItem {
  return (
    ALL_NAV_ITEMS.find((item) => item.id === id) || {
      id: 'cockpit',
      name: 'Sovereign Cockpit',
      shortName: 'Cockpit',
      subtitle: 'Executive Multi-Asset Risk Desk',
      category: 'risk_intel',
      icon: '📊'
    }
  );
}

export function getClusterByItemId(id: string): NavCluster {
  const item = getNavItemById(id);
  return WORKSPACE_CLUSTERS.find((c) => c.id === item.category) || WORKSPACE_CLUSTERS[0];
}
