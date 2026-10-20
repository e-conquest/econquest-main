import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import { YFinanceQuote, SovereignEntity } from '../types/riskEngine';
import { BENCHMARK_YFINANCE_QUOTES, fetchYFinanceQuote } from '../services/yfinanceService';

interface YFinanceMarketPanelProps {
  sovereigns: SovereignEntity[];
  onSelectSovereign: (id: string) => void;
  onNavigateToTab: (tab: string) => void;
}

export const YFinanceMarketPanel: React.FC<YFinanceMarketPanelProps> = ({
  sovereigns,
  onSelectSovereign,
  onNavigateToTab
}) => {
  const [quotes, setQuotes] = useState<YFinanceQuote[]>(BENCHMARK_YFINANCE_QUOTES);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EMB');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [customTickerInput, setCustomTickerInput] = useState<string>('');
  const [isLoadingCustom, setIsLoadingCustom] = useState<boolean>(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Active selected quote
  const activeQuote = useMemo(() => {
    return quotes.find((q) => q.symbol === selectedSymbol) || quotes[0];
  }, [quotes, selectedSymbol]);

  // Filter quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (activeCategory !== 'all') {
        if (activeCategory === 'etf' && q.category !== 'Sovereign ETF') return false;
        if (activeCategory === 'fx' && q.category !== 'FX Currency') return false;
        if (activeCategory === 'commodity' && q.category !== 'Commodity') return false;
        if (activeCategory === 'rates' && q.category !== 'Rates & Volatility') return false;
      }
      if (searchFilter) {
        const query = searchFilter.toLowerCase();
        return (
          q.symbol.toLowerCase().includes(query) ||
          q.name.toLowerCase().includes(query) ||
          q.relevanceToDesk.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [quotes, activeCategory, searchFilter]);

  // Handle adding custom ticker
  const handleAddCustomTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTickerInput.trim()) return;

    setIsLoadingCustom(true);
    setQueryError(null);

    try {
      const fetched = await fetchYFinanceQuote(customTickerInput);
      setQuotes((prev) => {
        const without = prev.filter((item) => item.symbol !== fetched.symbol);
        return [fetched, ...without];
      });
      setSelectedSymbol(fetched.symbol);
      setCustomTickerInput('');
    } catch {
      setQueryError(`Unable to fetch quote for "${customTickerInput}". Verify ticker syntax.`);
    } finally {
      setIsLoadingCustom(false);
    }
  };

  // Sparkline data formatted for Recharts
  const chartData = useMemo(() => {
    return activeQuote.historicalSparkline.map((val, idx) => ({
      point: `T-${activeQuote.historicalSparkline.length - 1 - idx}d`,
      price: val
    }));
  }, [activeQuote]);

  // Link to sovereign if applicable
  const linkedSovereign = useMemo(() => {
    if (!activeQuote.linkedSovereignId) return null;
    return sovereigns.find((s) => s.id === activeQuote.linkedSovereignId);
  }, [activeQuote, sovereigns]);

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              yfinance API Gateway
            </span>
            <h2 className="text-lg font-bold text-slate-100">
              Yahoo Finance Real-Time Market Metrics &amp; Macro Benchmarks
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Live sovereign ETF benchmarks, FX currency spot cushions, commodity terms-of-trade futures, and US Treasury yields
            calibrating Layer 2 High-Frequency signals and Pillar 2 external vulnerability.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              // Trigger refresh simulation across all quotes
              setQuotes((prev) =>
                prev.map((q) => {
                  const jitter = (Math.random() - 0.49) * 0.003 * q.price;
                  const newPrice = Math.round((q.price + jitter) * 100) / 100;
                  const newChange = Math.round((q.change + jitter) * 100) / 100;
                  return {
                    ...q,
                    price: newPrice,
                    change: newChange,
                    changePercent: Math.round((newChange / newPrice) * 10000) / 100
                  };
                })
              );
            }}
            className="px-3 py-1.5 text-xs font-mono rounded bg-[#152037] hover:bg-[#1c2c4c] border border-[#233355] text-slate-200 transition-colors flex items-center gap-1.5"
          >
            <span>↻ Sync Feed Quotes</span>
          </button>
        </div>
      </div>

      {/* 4 Cornerstone Macro Dashboard KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. US 10-Year Yield */}
        <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>US 10Y Yield (^TNX)</span>
            <span className="text-emerald-400 font-semibold">+0.042%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">4.28%</div>
          <div className="text-[11px] text-slate-500">Global risk-free hurdle rate (Scenario A driver)</div>
        </div>

        {/* 2. EMB Sovereign ETF */}
        <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>EM Sovereign Debt (EMB)</span>
            <span className="text-emerald-400 font-semibold">+0.35%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">$91.42</div>
          <div className="text-[11px] text-slate-500">USD emerging sovereign credit spread barometer</div>
        </div>

        {/* 3. Copper Futures */}
        <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Copper Futures (HG=F)</span>
            <span className="text-emerald-400 font-semibold">+1.24%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">$4.48 /lb</div>
          <div className="text-[11px] text-slate-500">Chile terms-of-trade export revenue anchor</div>
        </div>

        {/* 4. VIX Tail Risk */}
        <div className="p-4 bg-[#090d16] border border-[#1a2438] rounded-lg space-y-1">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>CBOE Volatility (^VIX)</span>
            <span className="text-rose-400 font-semibold">+4.11%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">16.45 pts</div>
          <div className="text-[11px] text-slate-500">Student-t copula degrees of freedom (ν) tuning</div>
        </div>
      </div>

      {/* Main Workbench Layout: Left Quotes List, Right Inspection & Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Ticker Ingest + Filtered List (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Custom yfinance Ticker Query Input */}
          <div className="p-4 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                Plug In Custom yfinance Ticker
              </span>
              <span className="text-[11px] font-mono text-cyan-400">REST v8 / Real-Time Proxy</span>
            </div>

            <form onSubmit={handleAddCustomTicker} className="flex gap-2">
              <input
                type="text"
                value={customTickerInput}
                onChange={(e) => setCustomTickerInput(e.target.value)}
                placeholder="Enter symbol (e.g. ECH, CL=F, ^TNX, BND, USDMXN=X, AAPL)..."
                className="flex-1 bg-[#111726] border border-[#23314d] text-slate-100 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isLoadingCustom}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isLoadingCustom ? 'Fetching...' : '+ Add Ticker'}
              </button>
            </form>

            {queryError && (
              <div className="text-xs text-rose-400 font-mono bg-rose-950/40 p-2 rounded border border-rose-800/40">
                {queryError}
              </div>
            )}
          </div>

          {/* Category Filter Chips & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Category Tabs */}
            <div className="flex items-center gap-1 bg-[#090d16] p-1 border border-[#1a2438] rounded-lg text-xs font-mono overflow-x-auto">
              {[
                { id: 'all', label: `All (${quotes.length})` },
                { id: 'etf', label: 'Sovereign ETFs' },
                { id: 'fx', label: 'FX Pairs' },
                { id: 'commodity', label: 'Commodities' },
                { id: 'rates', label: 'Rates & Vol' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id)}
                  className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                    activeCategory === tab.id
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Quick Search */}
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search symbol, name..."
              className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-3 py-1 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Quotes Table */}
          <div className="bg-[#0e1524] border border-[#1a2438] rounded-lg overflow-hidden font-mono">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-[#090d16] border-b border-[#1a2438] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <div className="col-span-3">Symbol / Asset</div>
              <div className="col-span-3 text-right">Price / Spot</div>
              <div className="col-span-3 text-right">Day Chg (%)</div>
              <div className="col-span-3 text-right">Category</div>
            </div>

            <div className="divide-y divide-[#162032] max-h-[480px] overflow-y-auto">
              {filteredQuotes.map((q) => {
                const isSelected = q.symbol === activeQuote.symbol;
                const isUp = q.change >= 0;

                return (
                  <div
                    key={q.symbol}
                    onClick={() => setSelectedSymbol(q.symbol)}
                    className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#152037] border-l-4 border-l-emerald-500 text-slate-100'
                        : 'hover:bg-[#121b2d] text-slate-300'
                    }`}
                  >
                    {/* Symbol & Name */}
                    <div className="col-span-3">
                      <div className="font-bold text-slate-100 flex items-center gap-1.5">
                        <span>{q.symbol}</span>
                        {q.linkedSovereignId && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" title="Linked to Sovereign Case Study"></span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[150px] font-sans">
                        {q.name}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="col-span-3 text-right font-bold text-slate-100">
                      {q.category === 'FX Currency'
                        ? q.price.toFixed(2)
                        : q.category === 'Rates & Volatility'
                        ? `${q.price.toFixed(2)}%`
                        : `$${q.price.toFixed(2)}`}
                    </div>

                    {/* Change */}
                    <div className="col-span-3 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          isUp
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                            : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
                        }`}
                      >
                        {isUp ? '+' : ''}
                        {q.changePercent.toFixed(2)}%
                      </span>
                    </div>

                    {/* Category */}
                    <div className="col-span-3 text-right text-[11px] text-slate-400 truncate">
                      {q.category}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Instrument Deep Dive, Recharts Trend & Desk Linkage (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 bg-[#0e1524] border border-[#1a2438] rounded-lg space-y-4 font-mono">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#1a2438] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-slate-100">{activeQuote.symbol}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-[#162138] text-slate-300">
                    {activeQuote.category}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 font-sans">{activeQuote.name}</div>
              </div>

              <div className="text-right">
                <div className="text-xl font-bold text-slate-100">
                  {activeQuote.category === 'Rates & Volatility'
                    ? `${activeQuote.price.toFixed(2)}%`
                    : `$${activeQuote.price.toFixed(2)}`}
                </div>
                <div
                  className={`text-xs font-semibold ${
                    activeQuote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activeQuote.change >= 0 ? '+' : ''}
                  {activeQuote.change.toFixed(2)} ({activeQuote.changePercent.toFixed(2)}%)
                </div>
              </div>
            </div>

            {/* Recharts Price Movement Sparkline */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>5-Day Trajectory (Recharts)</span>
                <span className="text-slate-500 font-sans text-[10px]">yfinance Daily Closes</span>
              </div>
              <div className="h-40 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="point" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#475569"
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      tickFormatter={(v) => `${v.toFixed(1)}`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#090d16', borderColor: '#1a2438', fontSize: 11 }}
                      labelStyle={{ color: '#cbd5e1' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke={activeQuote.change >= 0 ? '#10b981' : '#f43f5e'}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Key Statistics Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs pt-1">
              <div className="p-2.5 bg-[#090d16] border border-[#1a2438] rounded">
                <div className="text-slate-500 text-[10px]">Day Range</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {activeQuote.dayLow.toFixed(2)} - {activeQuote.dayHigh.toFixed(2)}
                </div>
              </div>

              <div className="p-2.5 bg-[#090d16] border border-[#1a2438] rounded">
                <div className="text-slate-500 text-[10px]">52-Week Range</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {activeQuote.yearLow.toFixed(2)} - {activeQuote.yearHigh.toFixed(2)}
                </div>
              </div>

              <div className="p-2.5 bg-[#090d16] border border-[#1a2438] rounded">
                <div className="text-slate-500 text-[10px]">Trading Volume</div>
                <div className="font-bold text-slate-200 mt-0.5">{activeQuote.volume}</div>
              </div>

              <div className="p-2.5 bg-[#090d16] border border-[#1a2438] rounded">
                <div className="text-slate-500 text-[10px]">Implied Volatility (IV)</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {activeQuote.impliedVol ? `${activeQuote.impliedVol.toFixed(1)}%` : 'N/A'}
                </div>
              </div>
            </div>

            {/* Relevance to Quantitative Sovereign Desk */}
            <div className="p-3 bg-[#111726] border border-[#1a2438] rounded space-y-1">
              <div className="text-[11px] font-bold text-emerald-400">Quantitative Pipeline Relevance:</div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed">
                {activeQuote.relevanceToDesk}
              </p>
            </div>

            {/* Linked Sovereign Quick Action Button */}
            {linkedSovereign && (
              <div className="p-3 bg-cyan-950/30 border border-cyan-800/50 rounded flex items-center justify-between gap-2">
                <div className="text-xs font-sans text-cyan-200">
                  Linked to benchmark study: <strong className="text-white">{linkedSovereign.name}</strong>
                </div>
                <button
                  onClick={() => {
                    onSelectSovereign(linkedSovereign.id);
                    onNavigateToTab('pipeline');
                  }}
                  className="px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-sans transition-colors shrink-0"
                >
                  View Desk →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
