import React, { useMemo, useState } from 'react';
import type { CouncilAssessmentRun, LiveWatchlistItem } from '../types/council';
import { lazyNamed, DeskLoading } from './LazyDesk';
import { PanelBoundary } from './PanelBoundary';
import { PanelBuilder } from './PanelBuilder';
import { DivergenceList } from './DivergenceList';
import { MarketEdgeScreen, useMarketEdgeAnchors } from './MarketEdgeScreen';
import { ScenarioExposurePanel } from './ScenarioExposurePanel';
import { FedBalanceSheetPanel } from './FedBalanceSheetPanel';
import { StoryLeadsPanel } from './StoryLeadsPanel';
import { LiveCountBadge, ResearchHeader, SourcesGrid } from './ResearchSections';
import { marketEdgePeers } from '../utils/marketEdgeAnchors';
import type { ResearchSectionId } from '../utils/researchSections';
// Charts load only when the Summary section opens.
const RegimeQuadrant = lazyNamed(() => import('./RegimeQuadrant'), 'RegimeQuadrant');

// Workspace records each visit under this key (TodayPage.tsx); Compare only reads it, so opening
// Compare does not reset "since your last visit".
const LAST_VISIT_KEY = 'econquest_today_last_visit_v2';
function loadLastVisitRows(): Record<string, { cds5YBps?: number; yield10YPct?: number }> | undefined {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    return raw ? JSON.parse(raw).rows : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Research > Compare countries: the watchlist side by side, in the same four sections as one
 * country. Summary (where data and price disagree, growth and inflation), Markets & signals
 * (MarketEdge, scenario exposure), History & data (the compare table, CSV and Excel), Sources.
 */
export const ResearchCompare: React.FC<{
  run: CouncilAssessmentRun;
  watchlistName: string;
  watchlistItems: LiveWatchlistItem[];
  section: ResearchSectionId;
  onSection: (id: ResearchSectionId) => void;
  /** Opens one country under Research > One country, on the given country tab. */
  onOpenCountry: (item: LiveWatchlistItem, tab?: string) => void;
}> = ({ run, watchlistName, watchlistItems, section, onSection, onOpenCountry }) => {
  const [lastLook] = useState(loadLastVisitRows);
  const anchors = useMarketEdgeAnchors();
  const edgeItems = useMemo(() => marketEdgePeers(watchlistItems, anchors?.peers || []), [watchlistItems, anchors]);
  const open = (tab: string) => (item: LiveWatchlistItem) => onOpenCountry(item, tab);

  return (
    <div className="space-y-3" data-no-stat-ref="true" data-research-compare="true">
      <ResearchHeader
        title={watchlistName}
        subtitle={`${watchlistItems.length} ${watchlistItems.length === 1 ? 'country' : 'countries'} side by side. Click a country to open it on its own.`}
        badge={<LiveCountBadge items={watchlistItems} />}
        section={section}
        onSection={(id) => onSection(id as ResearchSectionId)}
      />

      {section === 'summary' && (
        <>
          <div id="tool-story-leads" className="scroll-mt-4">
            <PanelBoundary name="Story leads">
              <StoryLeadsPanel items={watchlistItems} onOpenCountry={open('history')} />
            </PanelBoundary>
          </div>
          <div id="tool-divergences" className="scroll-mt-4">
            <PanelBoundary name="Where data and price disagree">
              <DivergenceList items={edgeItems} lastLook={lastLook} onOpenCountry={open('macro')} />
            </PanelBoundary>
          </div>
          <div id="tool-regime" className="scroll-mt-4">
            <PanelBoundary name="Growth and inflation">
              <React.Suspense fallback={<DeskLoading />}>
                <RegimeQuadrant items={edgeItems} onOpenCountry={open('macro')} />
              </React.Suspense>
            </PanelBoundary>
          </div>
        </>
      )}

      {section === 'markets' && (
        <>
          <div id="tool-marketedge" className="scroll-mt-4">
            <PanelBoundary name="MarketEdge">
              <MarketEdgeScreen
                watchlist={watchlistItems}
                anchors={anchors}
                highlightIso3={run.iso3}
                onOpenCountry={open('macro')}
                intro="Your watchlist plus the US, China, Russia, UK, EU and India, always shown."
              />
            </PanelBoundary>
          </div>
          <div id="tool-scenarios" className="scroll-mt-4">
            <PanelBoundary name="Scenarios">
              <ScenarioExposurePanel items={edgeItems} onOpenCountry={open('macro')} />
            </PanelBoundary>
          </div>
          <div id="tool-fed-balance-sheet" className="scroll-mt-4">
            <PanelBoundary name="Fed balance sheet">
              <FedBalanceSheetPanel />
            </PanelBoundary>
          </div>
        </>
      )}

      {section === 'history' && (
        <div id="tool-panel" className="scroll-mt-4">
          <PanelBoundary name="Compare countries">
            <PanelBuilder countries={watchlistItems.map((w) => ({ iso3: w.iso3, countryName: w.countryName }))} />
          </PanelBoundary>
        </div>
      )}

      {section === 'sources' && (
        <PanelBoundary name="Sources across the watchlist">
          <SourcesGrid
            items={watchlistItems}
            title={`What is live across ${watchlistName}`}
            empty="No countries on this watchlist yet. Add some from the watchlist in the corner."
            onOpenCountry={open('overview')}
          />
        </PanelBoundary>
      )}
    </div>
  );
};
