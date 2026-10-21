/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SidebarNav } from './components/SidebarNav';
import { DualPaneWorkspace } from './components/DualPaneWorkspace';
import { DeskContextBar } from './components/DeskContextBar';
import { CommandPalette } from './components/CommandPalette';
import { GuiTemplateModal } from './components/GuiTemplateModal';
import { RiskAlertTicker } from './components/RiskAlertTicker';

import { SovereignCockpit } from './components/SovereignCockpit';
import { PipelineViewer } from './components/PipelineViewer';
import { ScorecardWorkbench } from './components/ScorecardWorkbench';
import { ArbitrageAlphaMonitor } from './components/ArbitrageAlphaMonitor';
import { StressTestingLab } from './components/StressTestingLab';
import { RegulatoryBacktesting } from './components/RegulatoryBacktesting';
import { WhitePaperViewer } from './components/WhitePaperViewer';
import { DataFeedSettings } from './components/DataFeedSettings';
import { FileIngestWorkbench } from './components/FileIngestWorkbench';
import { RiskHeatmap } from './components/RiskHeatmap';
import { CorrelationMatrix } from './components/CorrelationMatrix';
import { YFinanceMarketPanel } from './components/YFinanceMarketPanel';
import { WorldRiskMap } from './components/WorldRiskMap';
import { YieldCurveMaturityDesk } from './components/YieldCurveMaturityDesk';
import { ContagionCascadeDesk } from './components/ContagionCascadeDesk';
import { CentralBankPolicyDesk } from './components/CentralBankPolicyDesk';
import { PortfolioVarOptimizerDesk } from './components/PortfolioVarOptimizerDesk';
import { IcTearSheetModal } from './components/IcTearSheetModal';

import { BENCHMARK_SOVEREIGNS } from './data/sovereignData';
import { DEFAULT_DATA_FEEDS } from './data/defaultDataFeeds';
import { DEFAULT_CUSTOM_SCENARIO } from './data/defaultCustomScenarios';
import { runRiskPipeline } from './math/riskCalculations';
import { FITTED_MODELS, hasObservedHistory } from './math/fittedModels';
import {
  MacroScenario,
  LayerOutputs,
  DataFeedConfig,
  SovereignEntity,
  CustomScenarioParams,
  GuiLayoutTemplate
} from './types/riskEngine';

export default function ExperimentalApp() {
  const [activeTab, setActiveTab] = useState<string>('cockpit');
  const [sovereigns, setSovereigns] = useState<SovereignEntity[]>(
    () => BENCHMARK_SOVEREIGNS.filter(s => hasObservedHistory(s.code))
  );
  const [selectedSovereignId, setSelectedSovereignId] = useState<string>('chile');
  const [activeScenario, setActiveScenario] = useState<MacroScenario>('baseline');

  // GUI Layout Template State ('topbar' | 'sidebar' | 'dual_pane')
  const [activeLayout, setActiveLayout] = useState<GuiLayoutTemplate>(() => {
    try {
      const saved = localStorage.getItem('panoptix_gui_layout');
      if (saved === 'topbar' || saved === 'sidebar' || saved === 'dual_pane') {
        return saved as GuiLayoutTemplate;
      }
    } catch {
      // fallback
    }
    return 'topbar';
  });

  const handleSelectLayout = (layout: GuiLayoutTemplate) => {
    setActiveLayout(layout);
    try {
      localStorage.setItem('panoptix_gui_layout', layout);
    } catch (e) {
      console.warn('Failed to persist GUI layout:', e);
    }
  };

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isTearSheetOpen, setIsTearSheetOpen] = useState(false);

  // Keyboard shortcut listener (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Persistent Data Feeds Configuration
  const [feeds, setFeeds] = useState<DataFeedConfig[]>(() => {
    try {
      const saved = localStorage.getItem('econquest_data_feeds');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return DEFAULT_DATA_FEEDS;
      }
    } catch {
      // Fallback to defaults
    }
    return DEFAULT_DATA_FEEDS;
  });

  const saveFeeds = (updatedFeeds: DataFeedConfig[]) => {
    setFeeds(updatedFeeds);
    try {
      localStorage.setItem('econquest_data_feeds', JSON.stringify(updatedFeeds));
    } catch (err) {
      console.warn('Failed to persist feeds to localStorage:', err);
    }
  };

  const handleUpdateFeed = (updatedFeed: DataFeedConfig) => {
    const next = feeds.map((f) => (f.id === updatedFeed.id ? updatedFeed : f));
    saveFeeds(next);
  };

  const handleAddFeed = (newFeed: DataFeedConfig) => {
    const next = [newFeed, ...feeds];
    saveFeeds(next);
  };

  const handleDeleteFeed = (feedId: string) => {
    const next = feeds.filter((f) => f.id !== feedId);
    saveFeeds(next);
  };

  const handleResetDefaults = () => {
    saveFeeds(DEFAULT_DATA_FEEDS);
  };

  const handleImportFeeds = (imported: DataFeedConfig[]) => {
    saveFeeds(imported);
  };

  // Custom Macro Scenario State
  const [customScenarioParams, setCustomScenarioParams] = useState<CustomScenarioParams>(() => {
    try {
      const saved = localStorage.getItem('panoptix_active_custom_scenario');
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return DEFAULT_CUSTOM_SCENARIO;
  });

  const handleUpdateCustomParams = (params: CustomScenarioParams) => {
    setCustomScenarioParams(params);
    try {
      localStorage.setItem('panoptix_active_custom_scenario', JSON.stringify(params));
    } catch (e) {
      console.warn('Failed to persist active custom scenario:', e);
    }
  };

  // Compute live pipeline outputs for all sovereigns under current macro scenario
  const pipelineOutputs: Record<string, LayerOutputs> = useMemo(() => {
    const outputs: Record<string, LayerOutputs> = {};
    sovereigns.forEach((s) => {
      outputs[s.id] = runRiskPipeline(s, activeScenario, true, 0.4, customScenarioParams);
    });
    return outputs;
  }, [sovereigns, activeScenario, customScenarioParams]);

  // Baseline outputs for stress comparison
  const baselineOutputs: Record<string, LayerOutputs> = useMemo(() => {
    const outputs: Record<string, LayerOutputs> = {};
    sovereigns.forEach((s) => {
      outputs[s.id] = runRiskPipeline(s, 'baseline', true);
    });
    return outputs;
  }, [sovereigns]);

  const selectedSovereign = useMemo(() => {
    return (
      sovereigns.find((s) => s.id === selectedSovereignId) ||
      sovereigns[0]
    );
  }, [sovereigns, selectedSovereignId]);

  const currentPipelineOutput = pipelineOutputs[selectedSovereign.id];

  const arbitrageAlertCount = useMemo(() => {
    return Object.values(pipelineOutputs).filter((out) => out.isArbitrageAlert).length;
  }, [pipelineOutputs]);

  // Desk Render Router
  const renderDeskContent = (tabId: string) => {
    switch (tabId) {
      case 'cockpit':
        return (
          <SovereignCockpit
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
            activeScenario={activeScenario}
            customParams={customScenarioParams}
            onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
          />
        );
      case 'yieldcurve':
        return (
          <YieldCurveMaturityDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            customParams={customScenarioParams}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'contagion':
        return (
          <ContagionCascadeDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'centralbank':
        return (
          <CentralBankPolicyDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'portfolio':
        return (
          <PortfolioVarOptimizerDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            customParams={customScenarioParams}
            onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
          />
        );
      case 'worldmap':
        return (
          <WorldRiskMap
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
            activeScenario={activeScenario}
            customParams={customScenarioParams}
          />
        );
      case 'heatmap':
        return (
          <RiskHeatmap
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
            activeScenario={activeScenario}
          />
        );
      case 'pipeline':
        return (
          <PipelineViewer
            sovereign={selectedSovereign}
            output={currentPipelineOutput}
            allSovereigns={sovereigns}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'scorecard':
        return (
          <ScorecardWorkbench
            sovereign={selectedSovereign}
            allSovereigns={sovereigns}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
          />
        );
      case 'correlation':
        return (
          <CorrelationMatrix
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            activeScenario={activeScenario}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'arbitrage':
        return (
          <ArbitrageAlphaMonitor
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'stress':
        return (
          <StressTestingLab
            sovereigns={sovereigns}
            baselineOutputs={baselineOutputs}
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
            customParams={customScenarioParams}
            setCustomParams={handleUpdateCustomParams}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'governance':
        return <RegulatoryBacktesting />;
      case 'whitepaper':
        return <WhitePaperViewer />;
      case 'yfinance':
        return (
          <YFinanceMarketPanel
            sovereigns={sovereigns}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
          />
        );
      case 'feeds':
        return (
          <DataFeedSettings
            feeds={feeds}
            onUpdateFeed={handleUpdateFeed}
            onAddFeed={handleAddFeed}
            onDeleteFeed={handleDeleteFeed}
            onResetDefaults={handleResetDefaults}
            onImportFeeds={handleImportFeeds}
          />
        );
      case 'ingest':
        return (
          <FileIngestWorkbench
            sovereigns={sovereigns}
            onUpdateSovereigns={setSovereigns}
            onNavigateToTab={setActiveTab}
          />
        );
      default:
        return (
          <SovereignCockpit
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            onNavigateToTab={setActiveTab}
            activeScenario={activeScenario}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col selection:bg-emerald-500/20 selection:text-emerald-300">
      <div role="note" className="border-b border-amber-500/30 bg-amber-950/40 px-6 py-3 text-xs text-amber-200">
        <strong>Research-only annual models.</strong> Fitted Firth / LightGBM and Gaussian HMM; observed data through 2024,
        not live forecasts. Holdout blend Brier {FITTED_MODELS.hazard.test.blend.brier.toFixed(4)} versus constant
        baseline {FITTED_MODELS.hazard.test.constantTrainingRate.brier.toFixed(4)} (lower is better).
        {' '}The fictional SEC8 case is excluded. Other risk layers, market inputs and replay charts remain illustrative.
        {' '}Default-onset estimates are conditional on no current default and are not forecasts for countries already in default.
      </div>
      {/* TEMPLATE 2: EXECUTIVE SIDEBAR LAYOUT */}
      {activeLayout === 'sidebar' ? (
        <div className="flex flex-1 min-h-screen">
          <SidebarNav
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            sovereigns={sovereigns}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={setSelectedSovereignId}
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
            arbitrageCount={arbitrageAlertCount}
            activeLayout={activeLayout}
            onOpenTemplateModal={() => setIsTemplateModalOpen(true)}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          />

          <div className="flex-1 flex flex-col min-w-0">
            {/* Real-time Sovereign VaR Breaches & Arbitrage Alert Ticker */}
            <div className="border-b border-[#1a2438]">
              <RiskAlertTicker
                sovereigns={sovereigns}
                pipelineOutputs={pipelineOutputs}
                activeScenario={activeScenario}
                onSelectSovereign={setSelectedSovereignId}
                onNavigateToTab={setActiveTab}
              />
            </div>

            <main className="flex-1 w-full px-6 py-6 overflow-y-auto">
              <DeskContextBar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                sovereigns={sovereigns}
                selectedSovereignId={selectedSovereignId}
                onSelectSovereign={setSelectedSovereignId}
                activeScenario={activeScenario}
                activeLayout={activeLayout}
                onSelectLayout={handleSelectLayout}
                onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
              />
              {renderDeskContent(activeTab)}
            </main>
          </div>
        </div>
      ) : activeLayout === 'dual_pane' ? (
        /* TEMPLATE 3: DUAL-DESK SPLIT WORKSPACE */
        <>
          <Navbar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
            arbitrageCount={arbitrageAlertCount}
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={setSelectedSovereignId}
            activeLayout={activeLayout}
            onOpenTemplateModal={() => setIsTemplateModalOpen(true)}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          />

          <main className="flex-1 w-full px-6 py-6">
            <DeskContextBar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              sovereigns={sovereigns}
              selectedSovereignId={selectedSovereignId}
              onSelectSovereign={setSelectedSovereignId}
              activeScenario={activeScenario}
              activeLayout={activeLayout}
              onSelectLayout={handleSelectLayout}
              onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
            />

            <DualPaneWorkspace
              sovereigns={sovereigns}
              pipelineOutputs={pipelineOutputs}
              baselineOutputs={baselineOutputs}
              selectedSovereignId={selectedSovereignId}
              onSelectSovereign={setSelectedSovereignId}
              activeScenario={activeScenario}
              setActiveScenario={setActiveScenario}
              customParams={customScenarioParams}
              setCustomParams={handleUpdateCustomParams}
              feeds={feeds}
              onUpdateFeed={handleUpdateFeed}
              onAddFeed={handleAddFeed}
              onDeleteFeed={handleDeleteFeed}
              onResetFeeds={handleResetDefaults}
              onImportFeeds={handleImportFeeds}
              onUpdateSovereigns={setSovereigns}
              onNavigateToTab={setActiveTab}
              onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
            />
          </main>
        </>
      ) : (
        /* TEMPLATE 1: INSTITUTIONAL CLUSTERED TOPBAR (DEFAULT) */
        <>
          <Navbar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
            arbitrageCount={arbitrageAlertCount}
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={setSelectedSovereignId}
            activeLayout={activeLayout}
            onOpenTemplateModal={() => setIsTemplateModalOpen(true)}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          />

          <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
            <DeskContextBar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              sovereigns={sovereigns}
              selectedSovereignId={selectedSovereignId}
              onSelectSovereign={setSelectedSovereignId}
              activeScenario={activeScenario}
              activeLayout={activeLayout}
              onSelectLayout={handleSelectLayout}
              onOpenTearSheetModal={() => setIsTearSheetOpen(true)}
            />

            {renderDeskContent(activeTab)}
          </main>
        </>
      )}

      {/* Institutional Desk Footer */}
      <footer className="border-t border-[#1a2438] bg-[#080c14] px-6 py-4 mt-auto">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 font-mono">
          <div className="flex items-center gap-2">
            <span>EconQuest / Panoptix Methodology</span>
            <span aria-hidden="true">·</span>
            <span>FRTB MAR20 / Basel III IMA</span>
            <span aria-hidden="true">·</span>
            <span>Quasi-Monte Carlo (Sobol N=100k)</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsTemplateModalOpen(true)}
              className="text-cyan-400 hover:text-cyan-300 transition-colors font-bold"
            >
              ⚙️ Layout Options ({activeLayout})
            </button>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => setActiveTab('yfinance')}
              className="text-slate-400 hover:text-slate-200 transition-colors"
            >
              yfinance Market
            </button>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => setActiveTab('ingest')}
              className="text-slate-400 hover:text-slate-200 transition-colors"
            >
              CSV / Excel Ingest
            </button>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => setActiveTab('feeds')}
              className="text-slate-400 hover:text-slate-200 transition-colors"
            >
              API Feeds ({feeds.filter((f) => f.enabled).length} Active)
            </button>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => setActiveTab('whitepaper')}
              className="text-slate-400 hover:text-slate-200 transition-colors"
            >
              Academic White Paper
            </button>
            <span aria-hidden="true">·</span>
            <span>Port 3000</span>
          </div>
        </div>
      </footer>

      {/* Universal Command Palette (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigateToTab={setActiveTab}
        sovereigns={sovereigns}
        onSelectSovereign={setSelectedSovereignId}
        onSelectScenario={setActiveScenario}
        onSelectLayout={handleSelectLayout}
        activeTab={activeTab}
        activeScenario={activeScenario}
        activeLayout={activeLayout}
      />

      {/* GUI Template Options Modal */}
      <GuiTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        currentTemplate={activeLayout}
        onSelectTemplate={handleSelectLayout}
      />

      {/* Investment Committee Risk Tear-Sheet & JSON/CSV Snapshot Modal */}
      <IcTearSheetModal
        isOpen={isTearSheetOpen}
        onClose={() => setIsTearSheetOpen(false)}
        sovereigns={sovereigns}
        pipelineOutputs={pipelineOutputs}
        selectedSovereignId={selectedSovereignId}
        onSelectSovereign={setSelectedSovereignId}
        activeScenario={activeScenario}
        customParams={customScenarioParams}
      />
    </div>
  );
}
