import { DataFeedConfig } from '../types/riskEngine';

export const DEFAULT_DATA_FEEDS: DataFeedConfig[] = [
  {
    id: 'feed-polymarket',
    name: 'Polymarket CLOB Order Book API',
    category: 'Prediction Markets',
    targetPipelineLayer: 'Layer 2: Bayesian Log-Odds',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://clob.polymarket.com/markets',
    cadence: '1-Minute Tick',
    status: 'Connected',
    latencyMs: 38,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.2.1',
    lastSyncTimestamp: '2026-10-20 05:28:14 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        market_id: '0x8f2a...c014',
        contract: 'Sovereign Debt Default / Restructuring within 12m',
        condition_id: '0x18ab7e',
        best_bid: 0.122,
        best_ask: 0.128,
        last_traded_price: 0.125,
        volume_24h_usd: 2150000,
        depth_bids: [{ price: 0.122, size: 85000 }, { price: 0.120, size: 140000 }],
        depth_asks: [{ price: 0.128, size: 92000 }, { price: 0.130, size: 165000 }]
      },
      null,
      2
    )
  },
  {
    id: 'feed-kalshi',
    name: 'Kalshi Event Contracts WebSocket',
    category: 'Prediction Markets',
    targetPipelineLayer: 'Layer 2: Bayesian Log-Odds',
    protocol: 'WebSocket (WSS)',
    endpointUrl: 'wss://trading-api.kalshi.com/trade-api/ws/v2/macro',
    cadence: 'Streaming (<1s)',
    status: 'Connected',
    latencyMs: 24,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.2.1',
    lastSyncTimestamp: '2026-10-20 05:30:02 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        channel: 'orderbook_delta',
        market_ticker: 'SOV-RESTRUCT-27',
        bids: [[28, 450]],
        asks: [[30, 600]],
        liquidity_tau: 1.2
      },
      null,
      2
    )
  },
  {
    id: 'feed-worldbank-ids',
    name: 'World Bank International Debt Statistics (IDS) API',
    category: 'Macro Solvency',
    targetPipelineLayer: 'Layer 1: Hazard',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://api.worldbank.org/v2/country/all/indicator/DT.DOD.DECT.CD?format=json',
    cadence: 'Daily Batch',
    status: 'Connected',
    latencyMs: 142,
    enabled: true,
    primarySourceDoc: 'White Paper Appendix A (Indicators 1.2, 1.5, 2.2, 2.9, 2.10)',
    lastSyncTimestamp: '2026-10-20 00:15:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        page: 1,
        pages: 34,
        total: 1680,
        indicator: { id: 'DT.DOD.DECT.CD', value: 'External debt stocks, total (DOD, current US$)' },
        data: [
          { country: { id: 'CHL', value: 'Chile' }, date: '2026', value: 34000000000 },
          { country: { id: 'BLZ', value: 'Belize' }, date: '2026', value: 2900000000 }
        ]
      },
      null,
      2
    )
  },
  {
    id: 'feed-imf-weo',
    name: 'IMF World Economic Outlook (WEO / IFS) API',
    category: 'Macro Solvency',
    targetPipelineLayer: 'Layer 1: Hazard',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M..',
    cadence: 'Daily Batch',
    status: 'Connected',
    latencyMs: 185,
    enabled: true,
    primarySourceDoc: 'White Paper Appendix A (Indicators 1.3, 1.4, 1.7, 5.5, 5.6)',
    lastSyncTimestamp: '2026-10-20 01:00:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        DataSet: {
          Series: {
            REF_AREA: 'CHL',
            INDICATOR: 'GGXWDG_NGDP',
            Obs: [{ TIME_PERIOD: '2026', OBS_VALUE: '39.8' }]
          }
        }
      },
      null,
      2
    )
  },
  {
    id: 'feed-bis-banking',
    name: 'Bank for International Settlements (BIS) CBS Dataflow',
    category: 'Credit & Spreads',
    targetPipelineLayer: 'Layer 5: Copula',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBS_PUB/1.0/',
    cadence: 'Daily Batch',
    status: 'Connected',
    latencyMs: 110,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.5.1 & Appendix A (Indicator 2.12)',
    lastSyncTimestamp: '2026-10-19 22:30:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        dataflow: 'WS_CBS_PUB',
        cross_border_claims_usd_billion: 1420.5,
        matrix_dimension: '42x42',
        tail_correlation_factor_rho: 0.42
      },
      null,
      2
    )
  },
  {
    id: 'feed-acled',
    name: 'ACLED Georeferenced Conflict Events API',
    category: 'Geopolitical Conflict',
    targetPipelineLayer: 'Pillar 1-7 Scorecard',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://api.acleddata.com/acled/read?terms=accept',
    cadence: 'Hourly',
    status: 'Connected',
    latencyMs: 95,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.3.1 & Appendix A (Pillar 6)',
    lastSyncTimestamp: '2026-10-20 05:00:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        status: 200,
        count: 142,
        events: [
          {
            event_id: 'ACLED-99142',
            event_type: 'Direct Attacks on Infrastructure',
            sub_event_type: 'Pipeline Sabotage',
            spatial_multiplier: 1.5,
            fatalities: 0
          }
        ]
      },
      null,
      2
    )
  },
  {
    id: 'feed-ais-maritime',
    name: 'Automatic Identification System (AIS) Maritime Stream',
    category: 'Supply Chain & AIS',
    targetPipelineLayer: 'Layer 3: HMM Regime',
    protocol: 'WebSocket (WSS)',
    endpointUrl: 'wss://stream.aisstream.io/v0/stream/chokepoints',
    cadence: 'Streaming (<1s)',
    status: 'Connected',
    latencyMs: 19,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.3.1 & Scenario C',
    lastSyncTimestamp: '2026-10-20 05:31:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        chokepoint: 'Strait of Malacca',
        coordinates: [1.43, 102.89],
        vessel_count_24h: 312,
        throughput_anomaly_pct: -2.1,
        dark_fleet_pings_detected: 4,
        closure_status: 'NOMINAL_FLOW'
      },
      null,
      2
    )
  },
  {
    id: 'feed-panoptix-nlp',
    name: 'Triton High-Frequency Text Stress Index (TSI)',
    category: 'Supply Chain & AIS',
    targetPipelineLayer: 'Layer 3: HMM Regime',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://gateway.risk.internal/v2/models/finbert-geobert/infer',
    cadence: '5-Minute',
    status: 'Connected',
    latencyMs: 44,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.3.1 (FinBERT/GeoBERT)',
    lastSyncTimestamp: '2026-10-20 05:30:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        model: 'finbert-geobert-v2',
        tsi_z_score: 2.4,
        volatility_sentiment: 'ELEVATED_POLICY_STRESS',
        news_wire_density_per_min: 840,
        cluster_keywords: ['external debt', 'moratorium', 'central bank reserve drain']
      },
      null,
      2
    )
  },
  {
    id: 'feed-sovereign-cds',
    name: 'Sovereign Credit Default Swap (CDS) Composite Feed',
    category: 'Credit & Spreads',
    targetPipelineLayer: 'Layer 2: Bayesian Log-Odds',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://api.marketdata.internal/v1/sovereign-cds/composite',
    cadence: '15-Minute',
    status: 'Connected',
    latencyMs: 52,
    enabled: true,
    primarySourceDoc: 'White Paper Section 3.1.1 & Section 3.2',
    lastSyncTimestamp: '2026-10-20 05:15:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        source: 'Composite Multi-Dealer Sovereign Curve',
        tenor: '5Y',
        quotes: [
          { code: 'CHL', spread_bps: 58, d_1w_bps: -2 },
          { code: 'BLZ', spread_bps: 640, d_1w_bps: +15 },
          { code: 'ARG', spread_bps: 1650, d_1w_bps: +45 }
        ]
      },
      null,
      2
    )
  },
  {
    id: 'feed-yfinance-market',
    name: 'Yahoo Finance (yfinance) Sovereign ETFs & Yield Feed',
    category: 'Yahoo Finance (yfinance)',
    targetPipelineLayer: 'Layer 2: Bayesian Log-Odds',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/EMB?interval=1d',
    cadence: '1-Minute Tick',
    status: 'Connected',
    latencyMs: 32,
    enabled: true,
    primarySourceDoc: 'yfinance Market Telemetry (EMB, PCY, ECH, ^TNX, ^VIX)',
    lastSyncTimestamp: '2026-10-20 06:14:00 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        chart: {
          result: [
            {
              meta: {
                currency: 'USD',
                symbol: 'EMB',
                exchangeName: 'NMS',
                instrumentType: 'ETF',
                regularMarketPrice: 91.42,
                chartPreviousClose: 91.10,
                fiftyTwoWeekHigh: 94.20,
                fiftyTwoWeekLow: 83.10
              },
              indicators: {
                quote: [
                  {
                    close: [90.8, 91.0, 91.2, 91.15, 91.42],
                    volume: [4200000, 3900000, 4820000]
                  }
                ]
              }
            }
          ]
        }
      },
      null,
      2
    )
  },
  {
    id: 'feed-yfinance-fx-commodities',
    name: 'Yahoo Finance (yfinance) FX Spot & Commodity Terms-of-Trade Feed',
    category: 'Yahoo Finance (yfinance)',
    targetPipelineLayer: 'Pillar 1-7 Scorecard',
    protocol: 'REST (JSON)',
    endpointUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/HG=F',
    cadence: '1-Minute Tick',
    status: 'Connected',
    latencyMs: 36,
    enabled: true,
    primarySourceDoc: 'yfinance Terms of Trade (HG=F Copper, CL=F Oil, CLP=X, DXY)',
    lastSyncTimestamp: '2026-10-20 06:14:15 UTC',
    samplePayloadPreview: JSON.stringify(
      {
        chart: {
          result: [
            {
              meta: {
                currency: 'USD/lb',
                symbol: 'HG=F',
                regularMarketPrice: 4.48,
                change: 0.055,
                changePercent: 1.24
              }
            }
          ]
        }
      },
      null,
      2
    )
  }
];
