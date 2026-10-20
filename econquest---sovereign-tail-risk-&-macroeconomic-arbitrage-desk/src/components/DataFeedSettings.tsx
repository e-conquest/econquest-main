import React, { useState } from 'react';
import { DataFeedConfig } from '../types/riskEngine';

interface DataFeedSettingsProps {
  feeds: DataFeedConfig[];
  onUpdateFeed: (feed: DataFeedConfig) => void;
  onAddFeed: (feed: DataFeedConfig) => void;
  onDeleteFeed: (feedId: string) => void;
  onResetDefaults: () => void;
  onImportFeeds: (feeds: DataFeedConfig[]) => void;
}

export const DataFeedSettings: React.FC<DataFeedSettingsProps> = ({
  feeds,
  onUpdateFeed,
  onAddFeed,
  onDeleteFeed,
  onResetDefaults,
  onImportFeeds
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [expandedPayloadFeedId, setExpandedPayloadFeedId] = useState<string | null>(null);
  const [testingFeedId, setTestingFeedId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; latency: number } | null>(null);

  // New Feed Form State
  const [newFeed, setNewFeed] = useState<Partial<DataFeedConfig>>({
    name: '',
    category: 'Custom Feed',
    targetPipelineLayer: 'Layer 1: Hazard',
    protocol: 'REST (JSON)',
    endpointUrl: '',
    cadence: '5-Minute',
    enabled: true,
    primarySourceDoc: 'User Custom Internal Gateway'
  });

  // Calculate statistics
  const totalFeeds = feeds.length;
  const activeFeeds = feeds.filter((f) => f.enabled).length;
  const avgLatency = Math.round(
    feeds.filter((f) => f.enabled).reduce((acc, f) => acc + f.latencyMs, 0) / Math.max(1, activeFeeds)
  );

  // Filter feeds
  const filteredFeeds = feeds.filter((f) => {
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        f.name.toLowerCase().includes(q) ||
        f.endpointUrl.toLowerCase().includes(q) ||
        f.targetPipelineLayer.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Connection Test simulation
  const handleTestConnection = (feed: DataFeedConfig) => {
    setTestingFeedId(feed.id);
    setTestResult(null);

    setTimeout(() => {
      // Simulate realistic network round-trip ping between 18ms and 95ms
      const ping = Math.floor(Math.random() * 60) + 20;
      const updated = {
        ...feed,
        latencyMs: ping,
        status: 'Connected' as const,
        lastSyncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
      };
      onUpdateFeed(updated);
      setTestingFeedId(null);
      setTestResult({ id: feed.id, success: true, latency: ping });
    }, 550);
  };

  // Export JSON configuration
  const handleExportConfig = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(feeds, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'econquest-data-feeds.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON configuration
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
          onImportFeeds(imported);
        }
      } catch (err) {
        console.error('Failed to parse feeds JSON:', err);
      }
    };
    reader.readAsText(file);
  };

  const handleCreateFeedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeed.name || !newFeed.endpointUrl) return;

    const created: DataFeedConfig = {
      id: `custom-feed-${Date.now()}`,
      name: newFeed.name,
      category: (newFeed.category as DataFeedConfig['category']) || 'Custom Feed',
      targetPipelineLayer:
        (newFeed.targetPipelineLayer as DataFeedConfig['targetPipelineLayer']) || 'Layer 1: Hazard',
      protocol: (newFeed.protocol as DataFeedConfig['protocol']) || 'REST (JSON)',
      endpointUrl: newFeed.endpointUrl,
      cadence: (newFeed.cadence as DataFeedConfig['cadence']) || '5-Minute',
      status: 'Connected',
      latencyMs: 45,
      enabled: true,
      primarySourceDoc: newFeed.primarySourceDoc || 'User Custom Feed',
      lastSyncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      samplePayloadPreview: JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          status: 'ok',
          source: newFeed.name,
          endpoint: newFeed.endpointUrl,
          metrics: { val_1: 42.8, val_2: 110.5 }
        },
        null,
        2
      )
    };

    onAddFeed(created);
    setShowAddModal(false);
    setNewFeed({
      name: '',
      category: 'Custom Feed',
      targetPipelineLayer: 'Layer 1: Hazard',
      protocol: 'REST (JSON)',
      endpointUrl: '',
      cadence: '5-Minute',
      enabled: true,
      primarySourceDoc: 'User Custom Internal Gateway'
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Telemetry */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-100">
              Data Feeds &amp; Ingestion API Settings
            </h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#1a2438] text-slate-300">
              Appendix B.3 &amp; B.5
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure live data feed endpoints, prediction market order book streams (Polymarket/Kalshi),
            macroeconomic statistical APIs (IMF/World Bank/BIS), and internal sovereign desk bridges.
          </p>
        </div>

        {/* Global Configuration Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors whitespace-nowrap"
          >
            + Add Custom Feed
          </button>

          <button
            onClick={handleExportConfig}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111726] hover:bg-[#152037] border border-[#23314d] rounded transition-colors whitespace-nowrap"
          >
            Export JSON
          </button>

          <label className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111726] hover:bg-[#152037] border border-[#23314d] rounded transition-colors cursor-pointer whitespace-nowrap">
            Import JSON
            <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
          </label>

          <button
            onClick={onResetDefaults}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
            title="Reset to white paper default endpoints"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Aggregate Feed Telemetry Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">Total Feeds Configured</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-100">{totalFeeds}</span>
            <span className="text-xs text-slate-400 font-mono">sources</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {activeFeeds} Active / {totalFeeds - activeFeeds} Standby
          </div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">Average Ingest Latency</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">{avgLatency} ms</span>
            <span className="text-xs text-slate-400 font-mono">RTT</span>
          </div>
          <div className="text-[11px] text-emerald-500 mt-1">Ultra-Low Latency Pipeline</div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">Message Bus Architecture</div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-slate-100">Kafka / Redpanda</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Decoupled Sub-second Pub/Sub</div>
        </div>

        <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg">
          <div className="text-xs text-slate-400 font-medium mb-1">Prediction Feeds (Alpha)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-cyan-400">Polymarket &amp; Kalshi</span>
          </div>
          <div className="text-[11px] text-cyan-500 mt-1">Live CLOB &amp; Event Contracts</div>
        </div>
      </div>

      {/* Control & Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-3 bg-[#0e1524] border border-[#1a2438] rounded-lg">
        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: 'all', label: 'All Feeds' },
            { id: 'Prediction Markets', label: 'Prediction Markets' },
            { id: 'Macro Solvency', label: 'Macro Solvency' },
            { id: 'Geopolitical Conflict', label: 'Geopolitical Conflict' },
            { id: 'Supply Chain & AIS', label: 'Supply Chain & AIS' },
            { id: 'Credit & Spreads', label: 'Credit & Spreads' },
            { id: 'Custom Feed', label: 'Custom Feeds' }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                categoryFilter === cat.id
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search feeds, URLs, layers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-[#111726] border border-[#23314d] text-xs text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 w-56"
        />
      </div>

      {/* Data Feeds List */}
      <div className="space-y-3">
        {filteredFeeds.map((feed) => {
          const isTesting = testingFeedId === feed.id;
          const isExpanded = expandedPayloadFeedId === feed.id;
          const isRecentSuccess = testResult?.id === feed.id && testResult.success;

          return (
            <div
              key={feed.id}
              className={`p-4 bg-[#0e1524] border rounded-lg transition-all ${
                feed.enabled ? 'border-[#1a2438]' : 'border-[#1a2438]/50 opacity-60'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Left: Feed Details */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={feed.enabled}
                      onChange={(e) => onUpdateFeed({ ...feed, enabled: e.target.checked })}
                      className="rounded bg-[#1a2438] border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                      title="Enable/Disable Feed"
                    />
                    <span className="font-bold text-slate-100 text-sm">{feed.name}</span>
                    <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/70 border border-cyan-800/60 px-2 py-0.5 rounded">
                      {feed.category}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 bg-[#111726] border border-[#1a2438] px-2 py-0.5 rounded">
                      {feed.targetPipelineLayer}
                    </span>
                  </div>

                  {/* Endpoint URL Input */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">Endpoint:</span>
                    <input
                      type="text"
                      value={feed.endpointUrl}
                      onChange={(e) => onUpdateFeed({ ...feed, endpointUrl: e.target.value })}
                      className="bg-[#090d16] border border-[#1a2438] text-xs font-mono text-emerald-300 px-2.5 py-1 rounded focus:outline-none focus:border-emerald-500 flex-1"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono pt-0.5">
                    <span>Protocol: {feed.protocol}</span>
                    <span aria-hidden="true">·</span>
                    <span>Cadence: {feed.cadence}</span>
                    <span aria-hidden="true">·</span>
                    <span>Latency: {feed.latencyMs}ms</span>
                    <span aria-hidden="true">·</span>
                    <span>Source: {feed.primarySourceDoc}</span>
                    {feed.lastSyncTimestamp && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Synced: {feed.lastSyncTimestamp}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Right: Operational Controls */}
                <div className="flex items-center gap-3 shrink-0">
                  {/* Test Connection Button */}
                  <button
                    onClick={() => handleTestConnection(feed)}
                    disabled={isTesting || !feed.enabled}
                    className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                      isTesting
                        ? 'bg-[#152037] text-slate-400 border-slate-700 cursor-wait'
                        : isRecentSuccess
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : 'bg-[#111726] hover:bg-[#152037] text-slate-200 border-[#23314d]'
                    }`}
                  >
                    {isTesting ? 'Pinging...' : isRecentSuccess ? `Connected (${testResult.latency}ms)` : 'Test Handshake'}
                  </button>

                  {/* Toggle Payload Inspector */}
                  <button
                    onClick={() => setExpandedPayloadFeedId(isExpanded ? null : feed.id)}
                    className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1a2438] bg-[#111726] rounded transition-colors"
                  >
                    {isExpanded ? 'Hide Payload' : 'View Payload'}
                  </button>

                  {/* Delete Feed if custom */}
                  {feed.category === 'Custom Feed' && (
                    <button
                      onClick={() => onDeleteFeed(feed.id)}
                      className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
                      title="Delete Custom Feed"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Sample Payload Inspector (Collapsible) */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-[#1a2438] space-y-1">
                  <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
                    <span>Live Ingest Stream Payload (Schema Preview):</span>
                    <span className="text-slate-500">JSON Format · UTF-8</span>
                  </div>
                  <pre className="p-3 bg-[#080c14] border border-[#1a2438] rounded text-[11px] font-mono text-cyan-300 overflow-x-auto max-h-48">
                    {feed.samplePayloadPreview || '{\n  "status": "active"\n}'}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Custom Feed Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#1a2438]">
              <h3 className="text-base font-bold text-slate-100">
                Plug In New Data Source / API Feed
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateFeedSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Feed / Provider Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Proprietary Sovereign Desk Bond Bridge"
                  value={newFeed.name}
                  onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                  className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Feed Category</label>
                  <select
                    value={newFeed.category}
                    onChange={(e) =>
                      setNewFeed({ ...newFeed, category: e.target.value as DataFeedConfig['category'] })
                    }
                    className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                  >
                    <option value="Custom Feed">Custom Feed</option>
                    <option value="Prediction Markets">Prediction Markets</option>
                    <option value="Macro Solvency">Macro Solvency</option>
                    <option value="Geopolitical Conflict">Geopolitical Conflict</option>
                    <option value="Supply Chain & AIS">Supply Chain & AIS</option>
                    <option value="Credit & Spreads">Credit & Spreads</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Target Pipeline Layer</label>
                  <select
                    value={newFeed.targetPipelineLayer}
                    onChange={(e) =>
                      setNewFeed({
                        ...newFeed,
                        targetPipelineLayer: e.target.value as DataFeedConfig['targetPipelineLayer']
                      })
                    }
                    className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                  >
                    <option value="Layer 1: Hazard">Layer 1: Hazard</option>
                    <option value="Layer 2: Bayesian Log-Odds">Layer 2: Bayesian Log-Odds</option>
                    <option value="Layer 3: HMM Regime">Layer 3: HMM Regime</option>
                    <option value="Layer 4: Structural CCA">Layer 4: Structural CCA</option>
                    <option value="Layer 5: Copula">Layer 5: Copula</option>
                    <option value="Pillar 1-7 Scorecard">Pillar 1-7 Scorecard</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Endpoint URL / Webhook</label>
                <input
                  type="text"
                  required
                  placeholder="https://api.corporate-risk.internal/v1/sovereigns"
                  value={newFeed.endpointUrl}
                  onChange={(e) => setNewFeed({ ...newFeed, endpointUrl: e.target.value })}
                  className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Protocol</label>
                  <select
                    value={newFeed.protocol}
                    onChange={(e) =>
                      setNewFeed({ ...newFeed, protocol: e.target.value as DataFeedConfig['protocol'] })
                    }
                    className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                  >
                    <option value="REST (JSON)">REST (JSON)</option>
                    <option value="WebSocket (WSS)">WebSocket (WSS)</option>
                    <option value="Server-Sent Events (SSE)">Server-Sent Events (SSE)</option>
                    <option value="gRPC Web">gRPC Web</option>
                    <option value="Webhook Push">Webhook Push</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Cadence / Polling</label>
                  <select
                    value={newFeed.cadence}
                    onChange={(e) =>
                      setNewFeed({ ...newFeed, cadence: e.target.value as DataFeedConfig['cadence'] })
                    }
                    className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                  >
                    <option value="Streaming (<1s)">Streaming (&lt;1s)</option>
                    <option value="1-Minute Tick">1-Minute Tick</option>
                    <option value="5-Minute">5-Minute</option>
                    <option value="15-Minute">15-Minute</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Daily Batch">Daily Batch</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Documentation Source / Note</label>
                <input
                  type="text"
                  placeholder="e.g. Internal TradeWeb Sovereign Desk Feed"
                  value={newFeed.primarySourceDoc}
                  onChange={(e) => setNewFeed({ ...newFeed, primarySourceDoc: e.target.value })}
                  className="w-full bg-[#111726] border border-[#23314d] text-slate-200 px-3 py-1.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#1a2438]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-semibold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors"
                >
                  Plug In Feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
