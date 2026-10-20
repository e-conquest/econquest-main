import React, { useState } from 'react';
import { ALL_NAV_ITEMS, NavDeskItem } from '../data/navigationStructure';
import { SovereignEntity, LayerOutputs, MacroScenario, CustomScenarioParams } from '../types/riskEngine';
import { SovereignCockpit } from './SovereignCockpit';
import { RiskHeatmap } from './RiskHeatmap';
import { CorrelationMatrix } from './CorrelationMatrix';
import { PipelineViewer } from './PipelineViewer';
import { ScorecardWorkbench } from './ScorecardWorkbench';
import { ArbitrageAlphaMonitor } from './ArbitrageAlphaMonitor';
import { StressTestingLab } from './StressTestingLab';
import { YFinanceMarketPanel } from './YFinanceMarketPanel';
import { DataFeedSettings } from './DataFeedSettings';
import { FileIngestWorkbench } from './FileIngestWorkbench';
import { RegulatoryBacktesting } from './RegulatoryBacktesting';
import { WhitePaperViewer } from './WhitePaperViewer';
import { WorldRiskMap } from './WorldRiskMap';
import { YieldCurveMaturityDesk } from './YieldCurveMaturityDesk';
import { ContagionCascadeDesk } from './ContagionCascadeDesk';
import { CentralBankPolicyDesk } from './CentralBankPolicyDesk';
import { PortfolioVarOptimizerDesk } from './PortfolioVarOptimizerDesk';

interface DualPaneWorkspaceProps {
  sovereigns: SovereignEntity[];
  pipelineOutputs: Record<string, LayerOutputs>;
  baselineOutputs: Record<string, LayerOutputs>;
  selectedSovereignId: string;
  onSelectSovereign: (id: string) => void;
  activeScenario: MacroScenario;
  setActiveScenario: (scenario: MacroScenario) => void;
  customParams: CustomScenarioParams;
  setCustomParams: (params: CustomScenarioParams) => void;
  feeds: any[];
  onUpdateFeed: (feed: any) => void;
  onAddFeed: (feed: any) => void;
  onDeleteFeed: (id: string) => void;
  onResetFeeds: () => void;
  onImportFeeds: (feeds: any[]) => void;
  onUpdateSovereigns: (sovereigns: SovereignEntity[]) => void;
  onNavigateToTab: (tab: string) => void;
  onOpenTearSheetModal?: () => void;
}

export const DualPaneWorkspace: React.FC<DualPaneWorkspaceProps> = ({
  sovereigns,
  pipelineOutputs,
  baselineOutputs,
  selectedSovereignId,
  onSelectSovereign,
  activeScenario,
  setActiveScenario,
  customParams,
  setCustomParams,
  feeds,
  onUpdateFeed,
  onAddFeed,
  onDeleteFeed,
  onResetFeeds,
  onImportFeeds,
  onUpdateSovereigns,
  onNavigateToTab,
  onOpenTearSheetModal
}) => {
  const [leftTab, setLeftTab] = useState<string>('cockpit');
  const [rightTab, setRightTab] = useState<string>('yieldcurve');

  const selectedSovereign =
    sovereigns.find((s) => s.id === selectedSovereignId) || sovereigns[0];
  const currentPipelineOutput = pipelineOutputs[selectedSovereign.id];

  const handleSwap = () => {
    const temp = leftTab;
    setLeftTab(rightTab);
    setRightTab(temp);
  };

  const renderDesk = (tabId: string) => {
    switch (tabId) {
      case 'cockpit':
        return (
          <SovereignCockpit
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
            activeScenario={activeScenario}
            customParams={customParams}
            onOpenTearSheetModal={onOpenTearSheetModal}
          />
        );
      case 'yieldcurve':
        return (
          <YieldCurveMaturityDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
            customParams={customParams}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'contagion':
        return (
          <ContagionCascadeDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'centralbank':
        return (
          <CentralBankPolicyDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'portfolio':
        return (
          <PortfolioVarOptimizerDesk
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
            customParams={customParams}
            onOpenTearSheetModal={onOpenTearSheetModal || (() => {})}
          />
        );
      case 'worldmap':
        return (
          <WorldRiskMap
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
            activeScenario={activeScenario}
            customParams={customParams}
          />
        );
      case 'heatmap':
        return (
          <RiskHeatmap
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
            activeScenario={activeScenario}
          />
        );
      case 'correlation':
        return (
          <CorrelationMatrix
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            activeScenario={activeScenario}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'pipeline':
        return (
          <PipelineViewer
            sovereign={selectedSovereign}
            output={currentPipelineOutput}
            allSovereigns={sovereigns}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'scorecard':
        return (
          <ScorecardWorkbench
            sovereign={selectedSovereign}
            allSovereigns={sovereigns}
            onSelectSovereign={onSelectSovereign}
            activeScenario={activeScenario}
          />
        );
      case 'arbitrage':
        return (
          <ArbitrageAlphaMonitor
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'stress':
        return (
          <StressTestingLab
            sovereigns={sovereigns}
            baselineOutputs={baselineOutputs}
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
            customParams={customParams}
            setCustomParams={setCustomParams}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'yfinance':
        return (
          <YFinanceMarketPanel
            sovereigns={sovereigns}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'feeds':
        return (
          <DataFeedSettings
            feeds={feeds}
            onUpdateFeed={onUpdateFeed}
            onAddFeed={onAddFeed}
            onDeleteFeed={onDeleteFeed}
            onResetDefaults={onResetFeeds}
            onImportFeeds={onImportFeeds}
          />
        );
      case 'ingest':
        return (
          <FileIngestWorkbench
            sovereigns={sovereigns}
            onUpdateSovereigns={onUpdateSovereigns}
            onNavigateToTab={onNavigateToTab}
          />
        );
      case 'governance':
        return <RegulatoryBacktesting />;
      case 'whitepaper':
        return <WhitePaperViewer />;
      default:
        return (
          <SovereignCockpit
            sovereigns={sovereigns}
            pipelineOutputs={pipelineOutputs}
            selectedSovereignId={selectedSovereignId}
            onSelectSovereign={onSelectSovereign}
            onNavigateToTab={onNavigateToTab}
            activeScenario={activeScenario}
            onOpenTearSheetModal={onOpenTearSheetModal}
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Dual Pane Control Header */}
      <div className="p-3 bg-[#0d1424] border border-[#1a2742] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/70 border border-cyan-800 px-2 py-0.5 rounded">
            SPLIT VIEW
          </span>
          <span className="text-xs font-medium text-slate-200">
            Simultaneous Multi-Desk Quantitative Execution
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Left Desk Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase">Left:</span>
            <select
              value={leftTab}
              onChange={(e) => setLeftTab(e.target.value)}
              className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {ALL_NAV_ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.icon} {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            className="p-1.5 bg-[#172338] hover:bg-[#213252] border border-[#233352] text-cyan-400 rounded text-xs transition-colors"
            title="Swap Left and Right Desks"
          >
            ⇄
          </button>

          {/* Right Desk Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">Right:</span>
            <select
              value={rightTab}
              onChange={(e) => setRightTab(e.target.value)}
              className="bg-[#111726] border border-[#23314d] text-slate-200 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {ALL_NAV_ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.icon} {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Side-by-side Dual Desks Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left Desk Pane */}
        <div className="border border-[#1a2742] bg-[#080d17]/50 rounded-lg p-3 overflow-hidden shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2742] text-xs font-mono">
            <span className="text-cyan-400 font-bold flex items-center gap-1.5">
              <span>Pane 1:</span>
              <span>{ALL_NAV_ITEMS.find((i) => i.id === leftTab)?.name}</span>
            </span>
            <button
              onClick={() => onNavigateToTab(leftTab)}
              className="text-[10px] text-slate-400 hover:text-slate-200"
              title="Maximize Desk to Fullscreen"
            >
              [⤢ Maximize]
            </button>
          </div>
          <div className="max-h-[82vh] overflow-y-auto pr-1">{renderDesk(leftTab)}</div>
        </div>

        {/* Right Desk Pane */}
        <div className="border border-[#1a2742] bg-[#080d17]/50 rounded-lg p-3 overflow-hidden shadow-lg space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a2742] text-xs font-mono">
            <span className="text-emerald-400 font-bold flex items-center gap-1.5">
              <span>Pane 2:</span>
              <span>{ALL_NAV_ITEMS.find((i) => i.id === rightTab)?.name}</span>
            </span>
            <button
              onClick={() => onNavigateToTab(rightTab)}
              className="text-[10px] text-slate-400 hover:text-slate-200"
              title="Maximize Desk to Fullscreen"
            >
              [⤢ Maximize]
            </button>
          </div>
          <div className="max-h-[82vh] overflow-y-auto pr-1">{renderDesk(rightTab)}</div>
        </div>
      </div>
    </div>
  );
};
