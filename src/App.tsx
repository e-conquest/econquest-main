/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AIRuntimeConfig,
  CROOverrideState,
  CouncilAssessmentRun,
  CustomSovereignOnboardingDraft,
  ExternalInternalConnectorMetricKey,
  OpenDataSnapshot,
  UserPersonaId,
  WatchlistGroup,
  WatchlistItem,
  WorkspaceLayoutMode,
  WorkspaceSessionSnapshot,
} from './types/council';
import {
  DEFAULT_WATCHLISTS,
  SOVEREIGN_CATALOG,
  addNewDefaultWatchlists,
  loadSeenDefaultWatchlists,
  saveSeenDefaultWatchlists,
  buildAnnotatedChartsForSovereign,
  buildDefaultAssessmentRun,
  buildBaselineOpenData,
  recomputeDerivedOpenDataAnalytics,
  registerCustomSovereignInCatalog,
} from './data/presetsAndBaselines';
import {
  loadCustomSovereignsFromStorage,
  loadWorkspaceSessionFromStorage,
  saveWorkspaceSessionToStorage,
} from './utils/turnkeyReadinessAndCommandEngine';
import { WatchlistSidebar } from './components/WatchlistSidebar';
import { toLive } from './utils/liveFigures';
import { WATCHLIST_CHANNEL, WATCHLIST_STORAGE_KEY, type WatchlistMessage } from './utils/watchlistView';
import { REVEAL_EVENT, TodayPage } from './components/TodayPage';
import { CouncilApprovalCard } from './components/CouncilApprovalCard';
import {
  COUNTRY_TABS,
  DEFAULT_COUNTRY_TAB,
  CountryPage,
  CountryTabId,
} from './components/CountryPage';
import {
  WorkspacePage,

  PORTFOLIO_TABS,
  REPORTS_TABS,
  findTabForDesk,
} from './components/WorkspacePage';
import { PortfolioSummary } from './components/PortfolioSummary';
import { BookBriefPanel } from './components/BookBriefPanel';
import { HoldingsPanel } from './components/HoldingsPanel';
import { PortfolioOverlayPanel } from './components/PortfolioOverlayPanel';
import { START_REVIEW_EVENT } from './utils/reviewHandoff';
import { OPEN_IDEAS_EVENT } from './utils/ideaHandoff';
import { EXPLAIN_EVENT } from './utils/explainHandoff';
import { DEFAULT_REFEREE_MODEL, refereeModelOrDefault } from './utils/refereeModel';
import { ResearchScopeBar, isResearchScope, type ResearchScope } from './components/ResearchScopeBar';
import { ResearchCompare } from './components/ResearchCompare';
import { LiveCountBadge, ResearchHeader, SourcesGrid } from './components/ResearchSections';
import { countryTabForSection, sectionForAnchor, sectionForCountryTab, type ResearchSectionId } from './utils/researchSections';
import { DEFAULT_COUNTRY_TAB_ID, DEFAULT_REPORT, NAV, type ReportTemplate, type WorkflowArea } from './data/navigation';
import { CORE_REPORTS, visibleReport } from './utils/simpleMode';
import { ToolsPage } from './components/ToolsPage';
import type { BriefView } from './components/CountryBriefPanel';
import type { ToolTarget } from './data/toolsCatalog';

import type { WorkspaceTab } from './components/WorkspacePage';

import { loadHoldings, saveHoldings,   type Holding } from './utils/holdings';

type AppArea = 'today' | 'country' | 'compare' | 'portfolio' | 'reports' | 'desks';
import { EconQuestLogo } from './components/EconQuestLogo';
import { lazyNamed, DeskLoading } from './components/LazyDesk';
import { SavedCouncilDocuments } from './components/CouncilDocuments';
import { describeSnapshotSync } from './utils/syncMessages';
import {
  ExecutiveTearSheetAndTradeTicketDrawer,
} from './components/MultiSovereignComparatorAndTicketDrawers';
import {
  computeSovereignNssYieldCurveSuite,
  DEFAULT_NSS_SHOCK_INPUTS,
  StagedTradeTicketSpec,
} from './utils/nssYieldCurveAndCatalystEngine';
import { watchlistYieldFields } from './utils/watchlistYield';
import {
  Sun,
  Moon,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  GraduationCap,
  ScrollText,
  Activity,
  ShieldQuestion,
  NotebookPen,
  Info,
  ChevronDown,
  BookOpen,
  Settings2,
  KeyRound,
  Wrench,
  MessageSquare,
  HardDriveDownload,
  UserRound,
  Users,
} from 'lucide-react';
import { OfflineDataDialog, OfflinePill, useOnlineStatus } from './components/OfflineData';
import { AboutDialog, OPEN_ABOUT_EVENT } from './components/AboutDialog';
import type { PublicAccount } from './utils/auth';
import { fetchAuthStatus } from './utils/authClient';
import { ROLE_LABEL } from './utils/authLabels';
import { OPEN_REGISTER_EVENT } from './components/ValidationBadge';
import { AskCouncilPanel, CouncilChatProvider, type FullCouncilStep } from './components/AskCouncilPanel';
import { useMarketEdgeAnchors } from './components/MarketEdgeScreen';
import { marketEdgePeers } from './utils/marketEdgeAnchors';
import { OPEN_SETTINGS_EVENT, SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { PanelBoundary } from './components/PanelBoundary';
import { reviveMissing, reviveWatchlistGroups } from './utils/reviveMissing';
import { loadCouncilBrief } from './utils/askCouncil';
import { loadShareMode, saveShareMode } from './utils/shareMode';

// Desks load on first use, so the first screen does not download all 41 of them.
// The menu dialogs load when first opened, keeping them out of the first download.
const GlobalTerminalProvenanceAndStatRefController = lazyNamed(() => import('./components/RealTimeDataProvenanceOverlay'), 'GlobalTerminalProvenanceAndStatRefController');
const IcMemoBuilder = lazyNamed(() => import('./components/IcMemoBuilder'), 'IcMemoBuilder');
const ResearchNotebooks = lazyNamed(() => import('./components/ResearchNotebooks'), 'ResearchNotebooks');
const PolicyReviews = lazyNamed(() => import('./components/PolicyReviews'), 'PolicyReviews');
const TeachingEpisodes = lazyNamed(() => import('./components/TeachingEpisodes'), 'TeachingEpisodes');
const AuditLogDialog = lazyNamed(() => import('./components/AuditLogDialog'), 'AuditLogDialog');
const DataHealthDialog = lazyNamed(() => import('./components/DataHealthDialog'), 'DataHealthDialog');
const IdeaJournalDialog = lazyNamed(() => import('./components/IdeaJournalDialog'), 'IdeaJournalDialog');
const ModelRegisterDialog = lazyNamed(() => import('./components/ModelRegisterDialog'), 'ModelRegisterDialog');
const AccountDialog = lazyNamed(() => import('./components/AccountDialog'), 'AccountDialog');
const UsersDialog = lazyNamed(() => import('./components/UsersDialog'), 'UsersDialog');
const CustomSovereignOnboardingModal = lazyNamed(() => import('./components/TurnkeyCommandAndIntegrityModals'), 'CustomSovereignOnboardingModal');
const SelfHostAndOllamaRuntimeModal = lazyNamed(() => import('./components/TurnkeyCommandAndIntegrityModals'), 'SelfHostAndOllamaRuntimeModal');
const SovereignManualAndGithubModal = lazyNamed(() => import('./components/TurnkeyCommandAndIntegrityModals'), 'SovereignManualAndGithubModal');


const THEME_STORAGE_KEY = 'econquest_theme_dark_v1';
const AI_RUNTIME_STORAGE_KEY = 'econquest_ai_runtime_config_v1';

type NavSectionId =
  | 'charts_watchlists'
  | 'forecasting_lab'
  | 'geopolitical_desk'
  | 'supply_chain_matrix'
  | 'global_liquidity'
  | 'market_maker_alpha'
  | 'portfolio_risk_desk'
  | 'backtest_engine'
  | 'risk_analytics'
  | 'council_debates'
  | 'cro_reports'
  | 'policy_doc_lab'
  | 'institutional_quant_desk'
  | 'quant_cds_basis'
  | 'quant_restructuring_npv'
  | 'quant_matrix_econometrics'
  | 'quant_trade_blotter'
  | 'quant_macro_surprise'
  | 'quant_alpha_correlation'
  | 'quant_nss_yield_curve'
  | 'quant_macro_catalyst_calendar'
  | 'quant_portfolio_stress_lab'
  | 'embi_portfolio_pair_book'
  | 'dmo_treasury_auction_sim'
  | 'mpc_imf_document_ai'
  | 'decision_dislocation_screener'
  | 'decision_premortem_killswitch'
  | 'decision_ledger_brier'
  | 'decision_quadrant_stress'
  | 'decision_prediction_markets'
  | 'ratings_shadow_fallen_angel'
  | 'fx_beer_feer_equilibrium'
  | 'debt_investor_base_doom_loop'
  | 'ic_pitchbook_dossier_exporter'
  | 'restructuring_npv_cac_waterfall'
  | 'taylor_rule_fiscal_dominance'
  | 'geopolitical_reserves_chokepoints'
  | 'ngfs_climate_slb_greenium'
  | 'persona_cross_hub_signal_scanner'
  | 'persona_guided_playbook_cockpit'
  | 'persona_strategy_backtester_lab'
  | 'persona_academic_latex_csv_exporter';





/** Reports in the core view: the note builder alone. */
const CORE_REPORTS_TABS: WorkspaceTab[] = [{ id: 'ic', label: 'Notes', hint: '', desks: ['ic_memo_builder'] }];

export default function App() {
  // Hydrate any previously onboarded custom ISO-3 sovereigns into SOVEREIGN_CATALOG on boot
  const [customOnboardedSovereigns, setCustomOnboardedSovereigns] = useState<
    CustomSovereignOnboardingDraft[]
  >(() => {
    const savedCustom = loadCustomSovereignsFromStorage();
    savedCustom.forEach((draft) => registerCustomSovereignInCatalog(draft));
    return savedCustom;
  });

  const savedSessionOnBoot = useMemo(() => loadWorkspaceSessionFromStorage(), []);

  // Default to Crisp Editorial Light Mode (false) unless user previously toggled Dark Mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (savedSessionOnBoot && typeof savedSessionOnBoot.darkMode === 'boolean') {
      return savedSessionOnBoot.darkMode;
    }
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved !== null) return saved === 'true';
    } catch {
      // Ignore storage error
    }
    return false;
  });

  const [isWatchlistCollapsed, setIsWatchlistCollapsed] = useState<boolean>(true);

  // 3-Mode Workspace Layout Switcher (Default: Clean Executive Briefing)
  const [layoutMode, setLayoutMode] = useState<WorkspaceLayoutMode>(
    () => savedSessionOnBoot?.layoutMode || 'executive_brief'
  );
  const [activeNavSection, setActiveNavSection] = useState<NavSectionId>(
    () => (savedSessionOnBoot?.activeNavSection as NavSectionId) || 'quant_nss_yield_curve'
  );
  const [activePersona, setActivePersona] = useState<UserPersonaId>(
    () => savedSessionOnBoot?.activePersona || 'INSTITUTIONAL_PM_IC'
  );

  // Collapse Watchlist sidebar by default to maximize 1-2 screen canvas density
  useEffect(() => {
    setIsWatchlistCollapsed(true);
  }, [activeNavSection]);

  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState<boolean>(false);
  const [isOfflineDataOpen, setIsOfflineDataOpen] = useState<boolean>(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState<boolean>(false);
  // Menu > Data health, and the counts shown beside it (refreshed every 5 minutes).
  const [isDataHealthOpen, setIsDataHealthOpen] = useState<boolean>(false);
  const [dataHealthSummary, setDataHealthSummary] = useState<{ failingSources: number; missingFigures: number; staleFigures: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/data/health/summary')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setDataHealthSummary(j))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isDataHealthOpen]);
  // Menu > Models & validation; a status badge anywhere opens it on its row (undefined = closed).
  const [registerFocus, setRegisterFocus] = useState<string | null | undefined>(undefined);
  // Menu > Idea journal, or "Log idea" on a Council chat answer.
  const [isIdeasOpen, setIsIdeasOpen] = useState(false);
  useEffect(() => {
    const go = () => setIsIdeasOpen(true);
    window.addEventListener(OPEN_IDEAS_EVENT, go);
    return () => window.removeEventListener(OPEN_IDEAS_EVENT, go);
  }, []);
  // Menu > About & data licences (undefined = closed; a string opens it on that source's licence).
  const [aboutFocus, setAboutFocus] = useState<string | null | undefined>(undefined);
  // Menu > Sharing mode: table downloads hold back figures whose sources' terms do not let them be passed on.
  const [shareMode, setShareModeState] = useState<boolean>(() => loadShareMode());
  const toggleShareMode = () =>
    setShareModeState((on) => {
      saveShareMode(!on);
      return !on;
    });
  // Menu > Exam mode (src/utils/examMode.ts): server-wide; no AI step writes while it is on.
  const [exam, setExam] = useState<{ on: boolean; canChange?: boolean; error?: string }>({ on: false });
  useEffect(() => {
    fetch('/api/exam-mode')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setExam({ on: b.on === true, canChange: b.canChange === true }))
      .catch(() => undefined);
  }, []);
  const toggleExam = () => {
    fetch('/api/exam-mode', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !exam.on }) })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        setExam(r.ok ? { on: b.on === true, canChange: true } : { ...exam, error: String(b.error || `HTTP ${r.status}`) });
      })
      .catch(() => setExam({ ...exam, error: 'The app server did not answer.' }));
  };
  // Menu > Account: the signed-in name beside the item, or that sign-in is off.
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountHint, setAccountHint] = useState('');
  const [me, setMe] = useState<PublicAccount | null>(null);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  useEffect(() => {
    void fetchAuthStatus().then((s) => {
      setMe(s?.account ?? null);
      setAccountHint(!s ? '' : s.account ? `${s.account.displayName} · ${ROLE_LABEL[s.account.role]}` : s.mode === 'off' ? 'Sign-in off' : '');
    });
  }, []);
  useEffect(() => {
    const onOpen = (e: Event) => setRegisterFocus(((e as CustomEvent).detail as string | null) ?? null);
    window.addEventListener(OPEN_REGISTER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REGISTER_EVENT, onOpen);
  }, []);
  const onlineStatus = useOnlineStatus();
  // Top-level area. The app always opens on Workspace; there are no roles (Sam, 2026-11-04).
  const [appArea, setAppArea] = useState<AppArea>('today');
  const [countryTab, setCountryTab] = useState<CountryTabId>(DEFAULT_COUNTRY_TAB_ID as CountryTabId);
  const [countryBriefView, setCountryBriefView] = useState<BriefView>('economist');
  const [portfolioTab, setPortfolioTab] = useState<string>(PORTFOLIO_TABS[0].id);
  const [reportsTab, setReportsTab] = useState<string>(REPORTS_TABS[0].id);
  // Report template asked for from a brief or Workspace; otherwise the council brief.
  const [requestedReport, setRequestedReport] = useState<ReportTemplate | null>(null);
  // Bumped when Today sends a new council brief, so Reports rebuilds from it.
  const [reportNonce, setReportNonce] = useState(0);
  // The run whose final council report was written in this session (not the built-in example).
  const [councilReportRunId, setCouncilReportRunId] = useState<string | null>(null);
  // Ties the browser to one council run's step-by-step progress on the server (the agent network).
  const [councilProgressId, setCouncilProgressId] = useState<string | null>(null);
  // Tools is always shown: without the old desks it is the page of tools that run on live data.
  const navAreas = NAV;
  const [holdings, setHoldingsState] = useState<Holding[]>(() => loadHoldings());
  const setHoldings = (next: Holding[]) => {
    setHoldingsState(next);
    saveHoldings(next);
  };
  const openWorkspace = (area: 'portfolio' | 'reports', deskId?: string) => {
    const tabs = area === 'portfolio' ? PORTFOLIO_TABS : REPORTS_TABS;
    const current = area === 'portfolio' ? portfolioTab : reportsTab;
    const tab = (deskId && findTabForDesk(tabs, deskId)) || tabs.find((t) => t.id === current) || tabs[0];
    (area === 'portfolio' ? setPortfolioTab : setReportsTab)(tab.id);
    const desk = deskId && tab.desks.includes(deskId) ? deskId : tab.desks.includes(activeNavSection) ? activeNavSection : tab.desks[0];
    setActiveNavSection(desk as NavSectionId);
    setAppArea(area);
    window.scrollTo({ top: 0 });
  };
  const openCountryPage = (tabId?: string) => {
    // A Country section asked for by its id (e.g. 'macro' from the MarketEdge screen on Today);
    // anything else opens on the Summary.
    const tab =
      COUNTRY_TABS.find((t) => t.id === tabId) || COUNTRY_TABS.find((t) => t.id === DEFAULT_COUNTRY_TAB_ID) || DEFAULT_COUNTRY_TAB;
    setCountryTab(tab.id);
    setAppArea('country');
    window.scrollTo({ top: 0 });
  };
  // Research remembers which scope you last looked at (one country, compare, holdings).
  const [researchScope, setResearchScope] = useState<ResearchScope>('country');
  useEffect(() => {
    if (isResearchScope(appArea)) setResearchScope(appArea);
  }, [appArea]);
  // The section (Summary, Markets & signals, History & data, Sources) carries across scopes, so
  // switching from Brazil's markets to Compare shows markets for the whole watchlist.
  const [researchSection, setResearchSection] = useState<ResearchSectionId>('summary');
  // Set when a country is opened from Compare or My holdings, for the "Back to" link.
  const [researchCameFrom, setResearchCameFrom] = useState<ResearchScope | null>(null);
  useEffect(() => {
    if (appArea !== 'country') setResearchCameFrom(null);
  }, [appArea]);
  useEffect(() => {
    const s = sectionForCountryTab(countryTab);
    if (s) setResearchSection(s);
  }, [countryTab]);
  const openResearchScope = (scope: ResearchScope) => {
    if (scope === 'country') {
      // Keep a specialist desk tab if one is open; otherwise land on the same section.
      if (sectionForCountryTab(countryTab)) setCountryTab(countryTabForSection(researchSection) as CountryTabId);
      returnToCountryPage();
    } else if (scope === 'portfolio') {
      setAppArea('portfolio');
    } else setAppArea('compare');
    window.scrollTo({ top: 0 });
  };
  /** Research > My holdings > History & data: import and edit holdings. */
  const openHoldingsEditor = () => {
    setResearchSection('history');
    setAppArea('portfolio');
    window.scrollTo({ top: 0 });
  };
  const openResearch = () => openResearchScope(researchScope);
  const returnToCountryPage = () => {
    setAppArea('country');
  };
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isHeaderMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setIsHeaderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsHeaderMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isHeaderMenuOpen]);
  const [isCustomSovereignModalOpen, setIsCustomSovereignModalOpen] =
    useState<boolean>(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [isRuntimeModalOpen, setIsRuntimeModalOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai');
  // Settings opens from the Menu, from Cmd/Ctrl + comma (as in most desktop apps), or from any
  // panel that dispatches OPEN_SETTINGS_EVENT (Data connections does, next to a missing key).
  useEffect(() => {
    const open = (e?: Event) => {
      const tab = (e as CustomEvent<{ tab?: SettingsTab }> | undefined)?.detail?.tab;
      if (tab) setSettingsTab(tab);
      setIsSettingsOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        open();
      }
    };
    const openAbout = (e: Event) => setAboutFocus((e as CustomEvent<{ id?: string }>).detail?.id ?? null);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    window.addEventListener(OPEN_ABOUT_EVENT, openAbout);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, open);
      window.removeEventListener(OPEN_ABOUT_EVENT, openAbout);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Persistent Custom Watchlists
  const [watchlists, setWatchlists] = useState<WatchlistGroup[]>(() => {
    let saved: WatchlistGroup[] | null = null;
    if (savedSessionOnBoot?.watchlists && savedSessionOnBoot.watchlists.length > 0) {
      saved = savedSessionOnBoot.watchlists;
    } else {
      try {
        const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length > 0) saved = parsed;
      } catch {
        // Fallback to defaults
      }
    }
    // Missing figures were saved as null (JSON has no NaN); make them NaN again.
    if (saved) saved = reviveWatchlistGroups(saved);
    if (!saved) {
      saveSeenDefaultWatchlists(DEFAULT_WATCHLISTS.map((g) => g.id));
      return DEFAULT_WATCHLISTS;
    }
    // Groups added in a later release (e.g. official 10Y yields) appear once for existing users.
    const { groups, seen } = addNewDefaultWatchlists(saved, loadSeenDefaultWatchlists());
    saveSeenDefaultWatchlists(seen);
    return groups;
  });

  const [activeWatchlistId, setActiveWatchlistId] = useState<string>(
    () =>
      savedSessionOnBoot?.activeWatchlistId ||
      watchlists[0]?.id ||
      'wl_em_sovereign_core'
  );

  // Active Council Run State
  const [run, setRun] = useState<CouncilAssessmentRun>(() =>
    buildDefaultAssessmentRun(savedSessionOnBoot?.activeIso3 || 'BRA')
  );
  const [scenarioInput, setScenarioInput] = useState<string>(
    () => savedSessionOnBoot?.scenarioDirective || SOVEREIGN_CATALOG[0].focusTheme
  );

  const [croDraft, setCroDraft] = useState<CROOverrideState>(() => run.croState);

  const [isTradeTicketDrawerOpen, setIsTradeTicketDrawerOpen] = useState<boolean>(false);
  const [stagedTradeTickets, setStagedTradeTickets] = useState<StagedTradeTicketSpec[]>(
    () =>
      computeSovereignNssYieldCurveSuite(
        buildDefaultAssessmentRun(savedSessionOnBoot?.activeIso3 || 'BRA'),
        DEFAULT_NSS_SHOCK_INPUTS
      ).recommendedCurveTickets.slice(0, 2)
  );

  const handleStageTradeTicket = (ticket: StagedTradeTicketSpec) => {
    setStagedTradeTickets((prev) => {
      const exists = prev.some((t) => t.ticketId === ticket.ticketId);
      if (exists) return prev;
      return [ticket, ...prev];
    });
    setIsTradeTicketDrawerOpen(true);
    setStatusBanner({
      type: 'success',
      message: `Staged IC Trade Ticket: "${ticket.strategyTitle}" (${ticket.iso3} · +${ticket.expected12MCarryRollBps} bps/yr Carry+Roll).`,
    });
  };

  const handleRemoveTradeTicket = (ticketId: string) => {
    setStagedTradeTickets((prev) => prev.filter((t) => t.ticketId !== ticketId));
  };

  const [runtimeConfig, setRuntimeConfig] = useState<AIRuntimeConfig>(() => {
    try {
      const saved = localStorage.getItem(AI_RUNTIME_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.providerMode) {
          // The old 8B referee default moves to qwen2.5:32b (src/utils/refereeModel.ts).
          return { ...parsed, ollamaDeepModel: refereeModelOrDefault(parsed.ollamaDeepModel) || DEFAULT_REFEREE_MODEL } as AIRuntimeConfig;
        }
      }
    } catch {
      // Ignore storage error
    }
    return {
      providerMode: 'gemini',
      geminiQuickModel: 'gemini-3.8-flash',
      geminiDeepModel: 'gemini-3.8-flash',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaQuickModel: 'qwen2.5:7b',
      ollamaDeepModel: DEFAULT_REFEREE_MODEL,
      openAiBaseUrl: 'http://localhost:8000/v1',
      openAiModel: 'gpt-4o',
      webhookTargetUrl: '',
      enableSearchGrounding: true,
      maxDebateRounds: 2,
    };
  });

  // Hydrate server environment defaults (e.g., when self-hosted inside Docker on Mac or Windows)
  useEffect(() => {
    const hasSavedLocalPref = (() => {
      try {
        return Boolean(localStorage.getItem(AI_RUNTIME_STORAGE_KEY));
      } catch {
        return false;
      }
    })();
    fetch('/api/ai/runtime-defaults')
      .then((r) => r.json())
      .then((defaults) => {
        if (!defaults) return;
        setRuntimeConfig((prev) => ({
          ...prev,
          providerMode: !hasSavedLocalPref ? defaults.providerMode || prev.providerMode : prev.providerMode,
          ollamaBaseUrl: !hasSavedLocalPref ? defaults.ollamaBaseUrl || prev.ollamaBaseUrl : prev.ollamaBaseUrl,
          ollamaQuickModel: !hasSavedLocalPref ? defaults.ollamaQuickModel || prev.ollamaQuickModel : prev.ollamaQuickModel,
          ollamaDeepModel: !hasSavedLocalPref ? defaults.ollamaDeepModel || prev.ollamaDeepModel : prev.ollamaDeepModel,
          openAiBaseUrl: !hasSavedLocalPref ? defaults.openAiBaseUrl || prev.openAiBaseUrl : prev.openAiBaseUrl,
          openAiModel: !hasSavedLocalPref ? defaults.openAiModel || prev.openAiModel : prev.openAiModel,
          apiConnectors:
            prev.apiConnectors && prev.apiConnectors.length > 0
              ? prev.apiConnectors
              : defaults.apiConnectors,
          integrationConfig: prev.integrationConfig || defaults.integrationConfig,
        }));
      })
      .catch(() => {
        // Ignore network error
      });
  }, []);

  // Persist AI Runtime config changes
  useEffect(() => {
    try {
      localStorage.setItem(AI_RUNTIME_STORAGE_KEY, JSON.stringify(runtimeConfig));
    } catch {
      // Ignore storage error
    }
  }, [runtimeConfig]);

  const [isFetchingOpenData, setIsFetchingOpenData] = useState<boolean>(false);
  const [isRunningPhase1And2, setIsRunningPhase1And2] = useState<boolean>(false);
  const [isRunningPhase3, setIsRunningPhase3] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'info' | 'warning' | 'success' | 'error';
    message: string;
  } | null>(null);

  // Sync dark mode class on <html> and persist preference
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(darkMode));
    } catch {
      // Ignore storage error
    }
  }, [darkMode]);

  // Persist watchlists
  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlists));
    } catch {
      // Ignore storage quota errors
    }
  }, [watchlists]);

  // The popped-out watchlist (/?view=watchlist) shares the lists through storage: take its
  // additions and removals, and open the country it asks for.
  const openFromPopOut = useRef<(iso3: string) => void>(() => undefined);
  openFromPopOut.current = (iso3: string) => {
    const item = watchlists.flatMap((w) => w.items).find((i) => i.iso3 === iso3) || SOVEREIGN_CATALOG.find((c) => c.iso3 === iso3);
    if (!item) return;
    if (item.iso3 !== run.iso3) handleSelectSovereign(item);
    openCountryPage();
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== WATCHLIST_STORAGE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue);
        if (Array.isArray(next) && next.length) setWatchlists(next as WatchlistGroup[]);
      } catch {
        // ignore a half-written value
      }
    };
    window.addEventListener('storage', onStorage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(WATCHLIST_CHANNEL);
      channel.onmessage = (e: MessageEvent<WatchlistMessage>) => {
        if (e.data?.type === 'open-country' && typeof e.data.iso3 === 'string') openFromPopOut.current(e.data.iso3);
      };
    } catch {
      // no channel support: clicks in the pop-out cannot reach this window
    }
    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    };
  }, []);

  // Build current WorkspaceSessionSnapshot and persist automatically
  const currentWorkspaceSessionSnapshot = useMemo<WorkspaceSessionSnapshot>(
    () => ({
      schemaVersion: 'ECONQUEST-SESSION-1.0',
      savedAtIso: new Date().toISOString(),
      sessionLabel: `${run.countryName} (${run.iso3}) · ${activePersona}`,
      activeIso3: run.iso3,
      activeCountryName: run.countryName,
      activePersona,
      activeNavSection,
      layoutMode,
      darkMode,
      scenarioDirective: scenarioInput,
      watchlists,
      activeWatchlistId,
      customOnboardedSovereigns,
    }),
    [
      run.iso3,
      run.countryName,
      activePersona,
      activeNavSection,
      layoutMode,
      darkMode,
      scenarioInput,
      watchlists,
      activeWatchlistId,
      customOnboardedSovereigns,
    ]
  );

  useEffect(() => {
    saveWorkspaceSessionToStorage(currentWorkspaceSessionSnapshot);
  }, [currentWorkspaceSessionSnapshot]);

  // Pull live open data on initial mount for default sovereign & hydrate all watchlists
  useEffect(() => {
    handlePullLiveOpenData(run.iso3, run.countryName, true);
    handleHydrateLiveWatchlists();
  }, []);

  const handleHydrateLiveWatchlists = async () => {
    try {
      const res = await fetch('/api/data/watchlist-live');
      if (!res.ok) return;
      const data = await res.json();
      const liveItems: WatchlistItem[] = Array.isArray(data?.items) ? data.items : [];
      if (liveItems.length === 0) return;
      const byIso = new Map(liveItems.map((it) => [it.iso3, it]));
      setWatchlists((prev) =>
        prev.map((group) => ({
          ...group,
          items: group.items.map((item) => byIso.get(item.iso3) || item),
        }))
      );
    } catch {
      // Keep cached watchlist if background hydration fails
    }
  };

  const handlePullLiveOpenData = async (
    iso3Target = run.iso3,
    countryNameTarget = run.countryName,
    silent = false,
    /** Pull every feed again now instead of serving the saved copy (Refresh now on the country page). */
    force = false
  ) => {
    setIsFetchingOpenData(true);
    if (!silent) {
      setStatusBanner({
        type: 'info',
        message: `Fetching the latest public data for ${countryNameTarget}…`,
      });
    }
    try {
      const res = await fetch(
        `/api/data/sovereign-snapshot?iso3=${encodeURIComponent(
          iso3Target
        )}&countryName=${encodeURIComponent(countryNameTarget)}${force ? '&refresh=1' : ''}`
      );
      if (res.ok) {
        const raw = await res.json();
        // Missing figures travel as null (JSON has no NaN); turn them back into NaN before use.
        const data = raw?.snapshot
          ? {
              ...raw,
              snapshot: reviveMissing(raw.snapshot, buildBaselineOpenData(raw.snapshot.iso3 || iso3Target)),
              run: raw.run ? reviveMissing(raw.run, buildDefaultAssessmentRun(raw.run.iso3 || iso3Target)) : raw.run,
            }
          : raw;
        if (data?.snapshot && data?.charts) {
          setRun((prev) => {
            if (data.run) {
              return {
                ...data.run,
                scenarioPrompt: prev.scenarioPrompt || data.run.scenarioPrompt,
                policyDocumentTitle: prev.policyDocumentTitle || data.run.policyDocumentTitle,
                policyDocumentSnippet: prev.policyDocumentSnippet || data.run.policyDocumentSnippet,
              };
            }
            return {
              ...prev,
              openData: data.snapshot,
              charts: data.charts,
            };
          });
          if (data.run?.croState) {
            setCroDraft(data.run.croState);
          }
          // Sync active sovereign metrics in watchlists
          const snap = data.snapshot;
          setWatchlists((prev) =>
            prev.map((group) => ({
              ...group,
              items: group.items.map((it) =>
                it.iso3 === snap.iso3
                  ? {
                      ...it,
                      ...watchlistYieldFields(snap),
                      cds5YBps: snap.monetaryAndMarket.cds5YSpreadBps,
                      debtToGdpPct: snap.imfIndicators.debtToGdpPct,
                      fxReservesMonths: snap.worldBankIndicators.fxReservesMonthsImport,
                    }
                  : it
              ),
            }))
          );
          if (!silent) {
            setStatusBanner(describeSnapshotSync(data.snapshot, countryNameTarget));
          }
        }
      }
    } catch {
      if (!silent) {
        setStatusBanner({
          type: 'warning',
          message: `Couldn't reach the data server. ${countryNameTarget} shows the last saved figures; check the data status badge for what is live.`,
        });
      }
    } finally {
      setIsFetchingOpenData(false);
    }
  };

  const handleSelectSovereign = (item: WatchlistItem) => {
    const nextRun = buildDefaultAssessmentRun(item.iso3);
    nextRun.countryName = item.countryName;
    nextRun.scenarioPrompt = item.focusTheme;
    setRun(nextRun);
    setCroDraft(nextRun.croState);
    setScenarioInput(item.focusTheme);
    handlePullLiveOpenData(item.iso3, item.countryName, false);
  };













  const handleApplyConnectorTelemetryToActiveSovereign = (
    connectorName: string,
    extracted: Partial<Record<ExternalInternalConnectorMetricKey, number>>
  ) => {
    const nextOpenData: OpenDataSnapshot = structuredClone(run.openData);
    const appliedFields: string[] = [];

    if (typeof extracted.gdpGrowth === 'number') {
      nextOpenData.imfIndicators.realGdpGrowthPct = extracted.gdpGrowth;
      appliedFields.push(`GDP Growth=${extracted.gdpGrowth}%`);
    }
    if (typeof extracted.cpiInflation === 'number') {
      nextOpenData.imfIndicators.cpiInflationPct = extracted.cpiInflation;
      appliedFields.push(`CPI=${extracted.cpiInflation}%`);
    }
    if (typeof extracted.debtToGdp === 'number') {
      nextOpenData.imfIndicators.debtToGdpPct = extracted.debtToGdp;
      appliedFields.push(`Debt/GDP=${extracted.debtToGdp}%`);
    }
    if (typeof extracted.cds5yBps === 'number') {
      nextOpenData.monetaryAndMarket.cds5YSpreadBps = Math.round(extracted.cds5yBps);
      appliedFields.push(`5Y CDS=${Math.round(extracted.cds5yBps)} bps`);
    }
    if (typeof extracted.fxReservesMonths === 'number') {
      nextOpenData.worldBankIndicators.fxReservesMonthsImport = extracted.fxReservesMonths;
      appliedFields.push(`FX Cover=${extracted.fxReservesMonths} mos`);
    }
    if (typeof extracted.policyRate === 'number') {
      nextOpenData.monetaryAndMarket.policyRatePct = extracted.policyRate;
      appliedFields.push(`Policy Rate=${extracted.policyRate}%`);
    }
    if (typeof extracted.politicalStability === 'number') {
      nextOpenData.worldBankIndicators.politicalStabilityPercentile = extracted.politicalStability;
      appliedFields.push(`Pol Stability=${extracted.politicalStability} pctl`);
    }

    if (appliedFields.length === 0) return;

    nextOpenData.liveApiSourcesActive = Array.from(
      new Set([...(nextOpenData.liveApiSourcesActive || []), `${connectorName} (GUI Connector)`])
    );
    recomputeDerivedOpenDataAnalytics(nextOpenData);
    const updatedCharts = buildAnnotatedChartsForSovereign(nextOpenData);

    setRun((prev) => ({
      ...prev,
      openData: nextOpenData,
      charts: updatedCharts,
    }));
    setStatusBanner({
      type: 'success',
      message: `Applied mapped JSON telemetry from "${connectorName}" to ${run.countryName} (${run.iso3}): ${appliedFields.join(' · ')}.`,
    });
  };

  const handleCreateWatchlist = (name: string, description: string) => {
    const newWl: WatchlistGroup = {
      id: `wl_custom_${Date.now()}`,
      name,
      description,
      isCustom: true,
      items: [SOVEREIGN_CATALOG[0], SOVEREIGN_CATALOG[1]],
    };
    setWatchlists((prev) => [...prev, newWl]);
    setActiveWatchlistId(newWl.id);
    setStatusBanner({
      type: 'success',
      message: `Created custom watchlist "${name}".`,
    });
  };

  const handleDeleteWatchlist = (id: string) => {
    setWatchlists((prev) => {
      const next = prev.filter((w) => w.id !== id);
      if (activeWatchlistId === id && next[0]) {
        setActiveWatchlistId(next[0].id);
      }
      return next;
    });
  };

  const handleAddSovereignToWatchlist = (watchlistId: string, item: WatchlistItem) => {
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== watchlistId) return w;
        const exists = w.items.some((i) => i.iso3 === item.iso3);
        if (exists) return w;
        return { ...w, items: [...w.items, item] };
      })
    );
    handleSelectSovereign(item);
  };

  const handleRemoveSovereignFromWatchlist = (watchlistId: string, iso3: string) => {
    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === watchlistId ? { ...w, items: w.items.filter((i) => i.iso3 !== iso3) } : w
      )
    );
  };


  // Run Phase 1 (Sub-Agents + Devil's Advocate Debates) & Phase 2 (Cross-Desk Cascade), then pause at CRO Checkpoint
  const handleRunCouncilPhase1And2 = async () => {
    const progressId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setCouncilProgressId(progressId);
    setIsRunningPhase1And2(true);
    setStatusBanner({
      type: 'info',
      message: `The nine desk agents are debating ${run.countryName}. The council will pause for your approval before the final report.`,
    });

    try {
      const res = await fetch('/api/council/phase1-and-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iso3: run.iso3,
          countryName: run.countryName,
          progressId,
          scenarioPrompt: scenarioInput,
          runtimeConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Council Phase 1 & 2 failed');
      }
      if (data?.run) {
        setRun(data.run);
        setCroDraft(data.run.croState);
        if (layoutMode === 'executive_brief') {
          setActiveNavSection('cro_reports');
        }
        // The approval card at the top of the page is the notice now; a banner would repeat it.
        setStatusBanner(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Error running Council Phase 1 & 2',
      });
    } finally {
      setIsRunningPhase1And2(false);
    }
  };

  // Run Phase 3 (Supreme Council Synthesis after CRO Approval / Override)
  const handleApproveAndConveneSupremeCouncil = async () => {
    setIsRunningPhase3(true);
    setStatusBanner({
      type: 'info',
      message: `Assumptions approved. Writing the final council report…`,
    });

    try {
      const res = await fetch('/api/council/supreme-council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run,
          croOverrideState: croDraft,
          progressId: councilProgressId,
          runtimeConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Supreme Council synthesis failed');
      }
      if (data?.run) {
        setRun(data.run);
        setCroDraft(data.run.croState);
        setCouncilReportRunId(data.run.runId);
        if (layoutMode === 'executive_brief') {
          setActiveNavSection('cro_reports');
        }
        setStatusBanner({
          type: 'success',
          message: `Final council report written (${data.run.supremeCouncil?.reportId}).`,
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to synthesize Supreme Council report',
      });
    } finally {
      setIsRunningPhase3(false);
    }
  };

  const activeWatchlistItems =
    watchlists.find((w) => w.id === activeWatchlistId)?.items || SOVEREIGN_CATALOG;
  // The core view never shows a built-in figure: only what a real source filled (utils/liveFigures.ts).
  const liveWatchlistItems = useMemo(() => activeWatchlistItems.map(toLive), [activeWatchlistItems]);
  // Council chat: one conversation for the whole app, on Workspace and in the side panel elsewhere.
  const councilAnchors = useMarketEdgeAnchors();
  const councilItems = useMemo(() => marketEdgePeers(liveWatchlistItems, councilAnchors?.peers || []), [liveWatchlistItems, councilAnchors]);
  const [isChatDockOpen, setIsChatDockOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('econquest.chatDock.v1') === '1';
    } catch {
      return false;
    }
  });
  const setChatDock = (open: boolean) => {
    setIsChatDockOpen(open);
    try {
      localStorage.setItem('econquest.chatDock.v1', open ? '1' : '0');
    } catch {
      // storage blocked: remembered for this visit only
    }
  };
  const heldIso3 = useMemo(() => [...new Set(holdings.map((h) => h.iso3))], [holdings]);
  // Risk scores for held countries: the active watchlist first (it may carry live figures), then the catalogue.
  const holdingsRiskLookup = [
    ...activeWatchlistItems,
    ...SOVEREIGN_CATALOG.filter((c) => !activeWatchlistItems.some((w) => w.iso3 === c.iso3)),
  ];
  // Portfolio and Reports see only real figures: the catalogue's built-in values are stripped too.
  const liveRiskLookup = useMemo(() => holdingsRiskLookup.map(toLive), [activeWatchlistItems]);
  // The countries you hold, with only their real figures (Research > My holdings).
  const heldLive = useMemo(() => {
    const held = new Set(holdings.map((h) => h.iso3));
    return liveRiskLookup.filter((w) => held.has(w.iso3));
  }, [holdings, liveRiskLookup]);






  const handleOnboardCustomSovereign = (draft: CustomSovereignOnboardingDraft) => {
    const newItem = registerCustomSovereignInCatalog(draft);
    setCustomOnboardedSovereigns((prev) => {
      const filtered = prev.filter((c) => c.iso3 !== newItem.iso3);
      return [...filtered, draft];
    });
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== activeWatchlistId) return w;
        const exists = w.items.some((i) => i.iso3 === newItem.iso3);
        if (exists) {
          return {
            ...w,
            items: w.items.map((i) => (i.iso3 === newItem.iso3 ? newItem : i)),
          };
        }
        return { ...w, items: [...w.items, newItem] };
      })
    );
    const nextRun = buildDefaultAssessmentRun(newItem.iso3);
    setRun(nextRun);
    setCroDraft(nextRun.croState);
    setScenarioInput(newItem.focusTheme);
    setStatusBanner({
      type: 'success',
      message: `Onboarded ${newItem.countryName} (${newItem.iso3} · ${newItem.currencyCode}) into active watchlist and all 10 analytical hubs (Debt/GDP ${newItem.debtToGdpPct.toFixed(1)}%, 10Y Yield ${newItem.yield10YPct.toFixed(2)}%, 5Y CDS ${newItem.cds5YBps} bps).`,
    });
  };




  /** Opens a ready tool from the Tools page where it lives. */
  const scrollToAnchor = (anchor: string) =>
    window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  const openTool = (t: ToolTarget) => {
    if (t.area === 'today' || t.area === 'compare') {
      if (t.area === 'compare') setResearchSection(sectionForAnchor(t.anchor));
      setAppArea(t.area);
      // Wait for Workspace to render, open the Briefing panel if the section lives there, then bring it into view.
      const reveal = () => window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: t.anchor }));
      window.setTimeout(reveal, 80);
      window.setTimeout(reveal, 300);
      window.setTimeout(() => document.getElementById(t.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 360);
    } else if (t.area === 'country') {
      if (t.brief) setCountryBriefView(t.brief);
      setCountryTab(t.tab as CountryTabId);
      setAppArea('country');
      if (t.anchor) scrollToAnchor(t.anchor);
    } else if (t.area === 'portfolio') {
      setResearchSection(sectionForAnchor(t.anchor));
      setAppArea('portfolio');
      window.scrollTo({ top: 0 });
      if (t.anchor) scrollToAnchor(t.anchor);
    } else openWorkspace('reports');
  };


  const fullCouncilStep: FullCouncilStep = {
    countryName: run.countryName,
    stage: run.stage,
    isRunning: isRunningPhase1And2,
    isApproving: isRunningPhase3,
    deskState: run.croState,
    draft: croDraft,
    result:
      run.supremeCouncil && run.runId === councilReportRunId
        ? { reportId: run.supremeCouncil.reportId, verdict: run.supremeCouncil.decisionVerdict, summary: run.supremeCouncil.executiveSummary, figureCheck: run.figureCheck, timing: run.timing }
        : undefined,
    progressId: councilProgressId,
    onRun: handleRunCouncilPhase1And2,
    onApprove: handleApproveAndConveneSupremeCouncil,
    onChangeDraft: setCroDraft,
  };
  // Reports opens on the council brief once one is saved; before that, on the country note, so the
  // first view is a real document and not "No council brief yet".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openingReport: ReportTemplate = useMemo(() => (loadCouncilBrief() ? DEFAULT_REPORT : 'economist'), [appArea, reportNonce]);
  const sendCouncilToReports = () => {
    setRequestedReport('council');
    setReportNonce((n) => n + 1);
    openWorkspace('reports', 'ic_memo_builder');
  };
  // "Start a policy review" from a Council chat answer: open Reports, where the panel picks up the prefill.
  useEffect(() => {
    const go = () => openWorkspace('reports', 'ic_memo_builder');
    window.addEventListener(START_REVIEW_EVENT, go);
    return () => window.removeEventListener(START_REVIEW_EVENT, go);
  });
  // "Explain" on a figure or chart: the chat answers; off Workspace, its side panel opens to show it.
  useEffect(() => {
    const show = () => {
      if (appArea !== 'today') setChatDock(true);
    };
    window.addEventListener(EXPLAIN_EVENT, show);
    return () => window.removeEventListener(EXPLAIN_EVENT, show);
  });
  // The chat sits on Workspace; elsewhere the header button opens it in a side panel.
  const chatDocked = isChatDockOpen && appArea !== 'today';
  const openChat = () => {
    if (appArea === 'today') document.getElementById('council-question')?.focus();
    else setChatDock(!isChatDockOpen);
  };

  return (
    <CouncilChatProvider items={councilItems}>
    <div className={`min-h-screen bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex flex-col ${chatDocked ? 'lg:pr-[30rem]' : ''}`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-white focus:text-slate-900 dark:focus:bg-slate-900 dark:focus:text-white focus:border focus:border-blue-600"
      >
        Skip to content
      </a>
      {/* PRIMARY TOP BAR: BRAND + 4 COMPACT CATEGORY PILL MENUS + CMD+K SEARCH + PERSONA & ACTIONS */}
      <header className="flex items-center justify-between gap-3 min-w-0 px-4 sm:px-6 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
        {/* Zone 1: EconQuest Crest Logo + Sovereign Council Orchestrator Identity */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setAppArea('today');
          }}
          className="flex items-center gap-2.5 shrink-0 group"
        >
          <EconQuestLogo size={34} />
          <div className="flex flex-col">
            <span className="hidden sm:inline lg:hidden xl:inline text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              EconQuest
            </span>
          </div>
        </a>

        {/* Zone 2: 3 Primary Activity Pillars (Market & Trading | Policy Research | Macroeconomic Research) + Cmd+K Search */}
        <nav className="hidden lg:flex items-center gap-2 text-xs font-medium">
          {navAreas.map((area) => (
            <React.Fragment key={area}>
              {({
              today: (
                <button
                  type="button"
                  onClick={() => setAppArea('today')}
                  aria-current={appArea === 'today' ? 'page' : undefined}
                  aria-pressed={appArea === 'today'}
                  className="ui-pill inline-flex items-center whitespace-nowrap"
                >
                  Workspace
                </button>
              ),
              research: (
                <button
                  type="button"
                  onClick={openResearch}
                  aria-current={isResearchScope(appArea) ? 'page' : undefined}
                  aria-pressed={isResearchScope(appArea)}
                  title="One country, countries side by side, or your holdings"
                  className="ui-pill inline-flex items-center whitespace-nowrap"
                >
                  Research
                </button>
              ),
              reports: (
                <button
                  type="button"
                  onClick={() => openWorkspace('reports')}
                  aria-current={appArea === 'reports' ? 'page' : undefined}
                  aria-pressed={appArea === 'reports'}
                  className="ui-pill inline-flex items-center whitespace-nowrap"
                >
                  Reports
                </button>
              ),
              // Tools lives in Menu, next to Settings (Sam, 2026-11-05).
              desks: null
              } as Record<WorkflowArea, React.ReactNode>)[area]}
            </React.Fragment>
          ))}

        </nav>

        {/* Zone 3: everyday actions stay visible; settings and tools live in one menu */}
        <div className="flex items-center gap-1.5 shrink-0">

          {/* On Workspace the chat is the page itself, so the button only shows elsewhere. */}
          {appArea !== 'today' && (
          <button
            type="button"
            onClick={openChat}
            title={chatDocked ? 'Close the Council chat panel' : 'Open Council chat beside this page: the same conversation as on Workspace'}
            aria-pressed={chatDocked}
            data-chat-toggle="true"
            className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Council chat</span>
          </button>
          )}

          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            {darkMode ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          <OfflinePill status={onlineStatus} onOpen={() => setIsOfflineDataOpen(true)} />

          {exam.on && (
            <span
              title="Exam mode is on: no AI summaries or AI steps; questions asked and countries opened are written to the audit log."
              className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap text-amber-700 dark:text-amber-300"
              data-exam-mode="on"
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exam mode</span>
            </span>
          )}

          {shareMode && (
            <button
              type="button"
              onClick={toggleShareMode}
              title="Sharing mode is on: downloads hold back figures whose sources' terms do not let them be passed on. Click to turn it off."
              className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap text-amber-700 dark:text-amber-300"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sharing mode</span>
            </button>
          )}

          <div className="relative" ref={headerMenuRef}>
            <button
              type="button"
              onClick={() => setIsHeaderMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={isHeaderMenuOpen}
              title="View settings, AI and data connections, manual, saved sessions"
              aria-pressed={isHeaderMenuOpen}
              className="ui-pill inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Menu</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {isHeaderMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-3 space-y-3 text-xs"
              >
                <div className="flex flex-col">
                  {(
                    [
                      {
                        key: 'settings',
                        icon: <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        // The AI model and Backup are tabs in Settings, so they are not listed again here;
                        // the model in use shows beside Settings.
                        label: 'Settings',
                        hint:
                          runtimeConfig.providerMode === 'ollama'
                            ? `AI: Ollama (${runtimeConfig.ollamaQuickModel.split(':')[0]})`
                            : runtimeConfig.providerMode === 'hybrid'
                            ? 'AI: Ollama, then Gemini'
                            : runtimeConfig.providerMode === 'openai_compatible'
                            ? 'AI: local server'
                            : 'AI: Gemini',
                        title: `AI model, free data keys, your own paid data, backup and tools (${navigator.platform.toLowerCase().includes('mac') ? '⌘,' : 'Ctrl+,'})`,
                        onClick: () => setIsSettingsOpen(true),
                        className: '',
                      },
                      {
                        key: 'tools',
                        icon: <Wrench className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Tools',
                        hint: '',
                        onClick: () => {
                          setSettingsTab('tools');
                          setIsSettingsOpen(true);
                        },
                        className: '',
                      },
                      {
                        key: 'offline',
                        icon: <HardDriveDownload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Offline data',
                        hint: onlineStatus?.preloadRunning ? 'Downloading' : onlineStatus && !onlineStatus.online ? 'Offline' : '',
                        onClick: () => setIsOfflineDataOpen(true),
                        className: '',
                      },
                      {
                        key: 'health',
                        icon: <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Data health',
                        hint: dataHealthSummary
                          ? [
                              dataHealthSummary.failingSources ? `${dataHealthSummary.failingSources} failing` : '',
                              dataHealthSummary.missingFigures ? `${dataHealthSummary.missingFigures} missing` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : '',
                        onClick: () => setIsDataHealthOpen(true),
                        className: '',
                      },
                      {
                        key: 'account',
                        icon: <UserRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Account',
                        hint: accountHint,
                        onClick: () => setIsAccountOpen(true),
                        className: '',
                      },
                      ...(me?.role === 'admin'
                        ? [
                            {
                              key: 'users',
                              icon: <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                              label: 'Users',
                              hint: '',
                              onClick: () => setIsUsersOpen(true),
                              className: '',
                            },
                          ]
                        : []),
                      {
                        key: 'audit',
                        icon: <ScrollText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Audit log',
                        hint: '',
                        onClick: () => setIsAuditLogOpen(true),
                        className: '',
                      },
                      {
                        key: 'register',
                        icon: <ShieldQuestion className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Models & validation',
                        hint: '',
                        onClick: () => setRegisterFocus(null),
                        className: '',
                      },
                      {
                        key: 'ideas',
                        icon: <NotebookPen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'Idea journal',
                        hint: '',
                        onClick: () => setIsIdeasOpen(true),
                        className: '',
                      },
                      {
                        key: 'share',
                        icon: <ShieldCheck className={`w-3.5 h-3.5 ${shareMode ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`} />,
                        label: 'Sharing mode',
                        hint: shareMode ? 'On' : 'Off',
                        title: 'On: downloads hold back figures whose sources\' terms do not let them be passed on, or do not say (Menu > About & data licences).',
                        onClick: toggleShareMode,
                        className: '',
                      },
                      {
                        key: 'exam',
                        icon: <GraduationCap className={`w-3.5 h-3.5 ${exam.on ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`} />,
                        label: 'Exam mode',
                        hint: exam.error ? 'Not allowed' : exam.on ? 'On' : 'Off',
                        title: exam.error || (exam.canChange === false ? 'Only the computer running the app, or an admin when sign-in is on, can switch exam mode.' : 'On: no AI summaries or AI steps for anyone using this app; Council chat shows figures only, and questions asked and countries opened go to the audit log.'),
                        onClick: toggleExam,
                        className: '',
                      },
                      {
                        key: 'about',
                        icon: <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'About & data licences',
                        hint: '',
                        onClick: () => setAboutFocus(null),
                        className: '',
                      },
                      {
                        key: 'manual',
                        icon: <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
                        label: 'User manual',
                        hint: '',
                        onClick: () => setIsManualModalOpen(true),
                        className: '',
                      },
                    ]
                  )
                    // The audit log is for admins once accounts exist (src/utils/permissions.ts).
                    .filter((item) => item.key !== 'audit' || !me || me.role === 'admin')
                    .map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      title={'title' in item ? (item as { title?: string }).title : undefined}
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        item.onClick();
                      }}
                      className={`flex items-center gap-2 px-2 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${item.className}`}
                    >
                      {item.icon}
                      <span className="flex-1">{item.label}</span>
                      {item.hint && (
                        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </header>

      {/* SECONDARY CONTEXTUAL BAR: 3-PILLAR SUB-GROUP & MODULE TABS + 1-CLICK SOVEREIGN SWITCHER */}
      <section className={`bg-white dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2 lg:hidden`}>
        <div className="max-w-[1600px] mx-auto flex flex-col gap-2">

          {/* Mobile 3-Pillar Switcher + Cmd+K Trigger */}
          <div className="order-first flex flex-wrap lg:hidden items-center gap-1.5 pb-2 border-b border-slate-200 dark:border-slate-800">
            {navAreas.map((area) => (
              <React.Fragment key={area}>
                {({
              today: (
                <button
                  type="button"
                  onClick={() => setAppArea('today')}
                  aria-pressed={appArea === 'today'}
                  className="ui-pill whitespace-nowrap shrink-0"
                >
                  Workspace
                </button>
              ),
              research: (
                <button
                  type="button"
                  onClick={openResearch}
                  aria-pressed={isResearchScope(appArea)}
                  className="ui-pill whitespace-nowrap shrink-0"
                >
                  Research
                </button>
              ),
              reports: (
                <button
                  type="button"
                  onClick={() => openWorkspace('reports')}
                  aria-pressed={appArea === 'reports'}
                  className="ui-pill whitespace-nowrap shrink-0"
                >
                  Reports
                </button>
              ),
              desks: null
                } as Record<WorkflowArea, React.ReactNode>)[area]}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* STATUS BANNER */}
      {statusBanner && (
        <div
          className={`px-6 py-2.5 border-b text-xs flex items-center justify-between gap-4 ${
            statusBanner.type === 'warning'
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200'
              : statusBanner.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200'
              : statusBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-200'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2 max-w-[1600px]">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-xs underline opacity-75 hover:opacity-100 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE CANVAS: COLLAPSIBLE LEFT WATCHLIST SIDEBAR + RIGHT MAIN VIEWPORT */}
      <main id="main-content" tabIndex={-1} className="focus:outline-none flex-1 max-w-[1600px] w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Watchlist Manager Sidebar (3 columns on desktop when expanded) */}
        {!isWatchlistCollapsed && (
          <aside className="lg:col-span-3">
            <WatchlistSidebar
              watchlists={watchlists}
              activeWatchlistId={activeWatchlistId}
              selectedIso3={run.iso3}
              onSelectWatchlist={setActiveWatchlistId}
              onSelectSovereign={handleSelectSovereign}
              onCreateWatchlist={handleCreateWatchlist}
              onDeleteWatchlist={handleDeleteWatchlist}
              onAddSovereignToWatchlist={handleAddSovereignToWatchlist}
              onRemoveSovereignFromWatchlist={handleRemoveSovereignFromWatchlist}
            />
          </aside>
        )}

        {/* Right Primary Viewport (9 columns when sidebar open, 12 columns when collapsed) */}
        <section className={`${isWatchlistCollapsed ? 'lg:col-span-12' : 'lg:col-span-9'} space-y-3`}>
          {/* On Today the pause sits inside Council chat; elsewhere it shows here so it is never missed. */}
          {run.stage === 'AWAITING_CRO_APPROVAL' && appArea !== 'today' && !chatDocked && (
            <CouncilApprovalCard
              countryName={run.countryName}
              deskState={run.croState}
              draft={croDraft}
              isApproving={isRunningPhase3}
              onApprove={handleApproveAndConveneSupremeCouncil}
              onChangeDraft={setCroDraft}
              onOpenConversation={() => setChatDock(true)}
            />
          )}

          {isResearchScope(appArea) && (
            <ResearchScopeBar
              scope={appArea}
              countryName={run.countryName}
              holdingsCount={holdings.length}
              onChange={openResearchScope}
              cameFrom={researchCameFrom}
            />
          )}

          {appArea === 'compare' && (
            <PanelBoundary name="Compare countries" resetKey={run.iso3}>
              <ResearchCompare
                run={run}
                watchlistName={watchlists.find((w) => w.id === activeWatchlistId)?.name || 'Watchlist'}
                watchlistItems={liveWatchlistItems}
                section={researchSection}
                onSection={setResearchSection}
                onOpenCountry={(item, tab) => {
                  const stored = activeWatchlistItems.find((w) => w.iso3 === item.iso3) || SOVEREIGN_CATALOG.find((c) => c.iso3 === item.iso3);
                  if (stored && item.iso3 !== run.iso3) handleSelectSovereign(stored);
                  openCountryPage(tab);
                  setResearchCameFrom('compare');
                }}
              />
            </PanelBoundary>
          )}

          {appArea === 'today' && (
            <PanelBoundary name="Workspace" resetKey={run.iso3}>
            <TodayPage
              run={run}
              watchlistName={watchlists.find((w) => w.id === activeWatchlistId)?.name || 'Watchlist'}
              watchlistId={activeWatchlistId}
              watchlistItems={liveWatchlistItems}
              stagedTickets={stagedTradeTickets}
              onOpenCountry={(item, sectionId) => {
                // Select the stored row (the live view drops built-in figures but keeps the country).
                const stored = activeWatchlistItems.find((w) => w.iso3 === item.iso3) || SOVEREIGN_CATALOG.find((c) => c.iso3 === item.iso3);
                if (stored && item.iso3 !== run.iso3) handleSelectSovereign(stored);
                openCountryPage(sectionId);
              }}
              onStageTicket={handleStageTradeTicket}
              onOpenTickets={() => setIsTradeTicketDrawerOpen(true)}
              onOpenWatchlistManager={() => setIsWatchlistCollapsed(false)}
              fullCouncil={fullCouncilStep}
              onSendCouncilToReports={sendCouncilToReports}
              coreOnly
              aiProvider={runtimeConfig.providerMode}
              holdingsCount={holdings.length}
              heldIso3={heldIso3}
              onInputAction={(id) => {
                if (id === 'keys' || id === 'ai') {
                  setSettingsTab(id);
                  setIsSettingsOpen(true);
                }
                else if (id === 'watchlist') setIsWatchlistCollapsed(false);
                else if (id === 'country') openCountryPage();
                else if (id === 'holdings') openHoldingsEditor();
                else {
                  setAppArea('desks');
                  window.setTimeout(() => document.querySelector('[data-connections-panel]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
                }
              }}
            />
            </PanelBoundary>
          )}

          {appArea === 'country' && (
            <PanelBoundary name="One country" resetKey={run.iso3}>
            <CountryPage
              run={run}
              watchlistItems={activeWatchlistItems}
              activeTab={countryTab}
              onChangeTab={setCountryTab}
              onSelectCountry={handleSelectSovereign}
              onAddCountry={() => setIsCustomSovereignModalOpen(true)}
              onSync={() => void handlePullLiveOpenData(run.iso3, run.countryName, false, true)}
              isSyncing={isFetchingOpenData}
              onOpenCompare={() => {
                setAppArea('compare');
                window.scrollTo({ top: 0 });
              }}
              briefView={countryBriefView}
              onWriteNote={(view) => {
                setRequestedReport(view);
                openWorkspace('reports', 'ic_memo_builder');
              }}
            />
            </PanelBoundary>
          )}

          {appArea === 'portfolio' && (
            <PanelBoundary name="My holdings" resetKey={researchSection}>
            <div className="space-y-3" data-research-holdings="true">
              <ResearchHeader
                title="My holdings"
                subtitle={
                  holdings.length
                    ? `${holdings.length} ${holdings.length === 1 ? 'position' : 'positions'} in ${heldLive.length} ${heldLive.length === 1 ? 'country' : 'countries'}, from the holdings you imported. Click a country to open it on its own.`
                    : `No holdings imported yet, so this shows your watchlist, ${watchlists.find((w) => w.id === activeWatchlistId)?.name || 'Watchlist'}, at equal weight. Import holdings under History & data.`
                }
                badge={<LiveCountBadge items={heldLive.length ? heldLive : liveWatchlistItems} />}
                section={researchSection}
                onSection={(id) => setResearchSection(id as ResearchSectionId)}
              />

              {researchSection === 'summary' && (
                <>
                  <PanelBoundary name="Book brief">
                    <BookBriefPanel
                      holdings={holdings}
                      riskLookup={liveRiskLookup}
                      watchlist={liveWatchlistItems}
                      stagedTickets={[]}
                      view="pm"
                      onWriteReport={(view) => {
                        setRequestedReport(view === 'client' ? 'client_review' : 'book');
                        openWorkspace('reports', 'ic_memo_builder');
                      }}
                    />
                  </PanelBoundary>
                  <PanelBoundary name="The book">
                    <PortfolioSummary
                      watchlistItems={liveWatchlistItems}
                      riskLookup={liveRiskLookup}
                      holdings={holdings}
                      onManageHoldings={openHoldingsEditor}
                      stagedTickets={[]}
                      onOpenCountry={(live) => {
                        const item = holdingsRiskLookup.find((w) => w.iso3 === live.iso3);
                        if (item && item.iso3 !== run.iso3) handleSelectSovereign(item);
                        openCountryPage();
                        setResearchCameFrom('portfolio');
                      }}
                    />
                  </PanelBoundary>
                </>
              )}

              {researchSection === 'markets' && (
                <PanelBoundary name="Signals on your holdings">
                  <div id="tool-holdings-signals" className="scroll-mt-4" />
                  <PortfolioOverlayPanel holdings={holdings} watchlist={liveWatchlistItems} onManageHoldings={openHoldingsEditor} />
                </PanelBoundary>
              )}

              {researchSection === 'history' && (
                <PanelBoundary name="Your holdings">
                  <HoldingsPanel
                    holdings={holdings}
                    countries={holdingsRiskLookup}
                    onChange={setHoldings}
                    onClose={() => setResearchSection('summary')}
                  />
                </PanelBoundary>
              )}

              {researchSection === 'sources' && (
                <PanelBoundary name="Sources across your holdings">
                  <SourcesGrid
                    items={heldLive.length ? heldLive : liveWatchlistItems}
                    title={heldLive.length ? 'What is live for the countries you hold' : 'What is live across your watchlist (no holdings imported)'}
                    empty="No countries yet."
                    onOpenCountry={(live) => {
                      const item = holdingsRiskLookup.find((w) => w.iso3 === live.iso3);
                      if (item && item.iso3 !== run.iso3) handleSelectSovereign(item);
                      openCountryPage('overview');
                      setResearchCameFrom('portfolio');
                    }}
                  />
                </PanelBoundary>
              )}

            </div>
            </PanelBoundary>
          )}

          {appArea === 'reports' && (
            <PanelBoundary name="Reports">
            <WorkspacePage
              ariaLabel="Reports sections"
              title="Reports"
              subtitle={`Documents to hand to the investment committee, risk and clients. Current country: ${run.countryName}`}
              tabs={CORE_REPORTS_TABS}
              activeTabId={reportsTab}
              activeDesk={activeNavSection}
              onChangeTab={(tabId) => {
                setReportsTab(tabId);
                const cfg = REPORTS_TABS.find((t) => t.id === tabId) || REPORTS_TABS[0];
                setActiveNavSection(cfg.desks[0] as NavSectionId);
              }}
              onChangeDesk={(d) => setActiveNavSection(d as NavSectionId)}
              renderDesk={(d) =>
                d === 'ic_memo_builder' ? (
                  <Suspense fallback={<DeskLoading />}>
                  <div id="tool-policy-reviews" className="mb-3 scroll-mt-4">
                    <PanelBoundary name="Policy reviews">
                      <PolicyReviews countries={liveWatchlistItems} defaultIso3={run.iso3} />
                    </PanelBoundary>
                  </div>
                  <div id="tool-council-docs" className="mb-3 scroll-mt-4">
                    <PanelBoundary name="Council documents">
                      <SavedCouncilDocuments
                        items={liveWatchlistItems}
                        onOpenCountry={(item) => {
                          const stored = activeWatchlistItems.find((w) => w.iso3 === item.iso3) || SOVEREIGN_CATALOG.find((c) => c.iso3 === item.iso3);
                          if (stored && item.iso3 !== run.iso3) handleSelectSovereign(stored);
                          openCountryPage('macro');
                        }}
                      />
                    </PanelBoundary>
                  </div>
                  <IcMemoBuilder
                    key={`${d}-${requestedReport || openingReport}-${reportNonce}`}
                    run={run}
                    stagedTickets={[]}
                    holdings={holdings}
                    riskLookup={liveRiskLookup}
                    peers={liveWatchlistItems}
                    defaultAudience={visibleReport(requestedReport || openingReport)}
                    audiences={CORE_REPORTS}
                  />
                  <div id="tool-notebooks" className="mt-3 scroll-mt-4">
                    <PanelBoundary name="Research notebooks">
                      <ResearchNotebooks countries={liveWatchlistItems} />
                    </PanelBoundary>
                  </div>
                  <div id="tool-episodes" className="mt-3 scroll-mt-4">
                    <PanelBoundary name="Teaching episodes">
                      <TeachingEpisodes countries={liveWatchlistItems} />
                    </PanelBoundary>
                  </div>
                  </Suspense>
                ) : null
              }
            />
            </PanelBoundary>
          )}

          {appArea === 'desks' && (
            <ToolsPage
              run={run}
              items={liveWatchlistItems}
              watchlistName={watchlists.find((w) => w.id === activeWatchlistId)?.name || 'Watchlist'}
              onOpen={openTool}
            />
          )}

        </section>
      </main>

      {/* GLOBAL REAL-TIME DATA PROVENANCE OVERLAY & INTERACTIVE STATISTICAL REFERENCE TOOLTIP CONTROLLER */}
      <Suspense fallback={null}>
      <GlobalTerminalProvenanceAndStatRefController
        run={run}
        activeNavSection={activeNavSection}
        onRefreshLiveOpenData={() => handlePullLiveOpenData(run.iso3, run.countryName, false)}
        isFetchingData={isFetchingOpenData}
      />
      </Suspense>

      {isCustomSovereignModalOpen && (
        <Suspense fallback={null}>
      <CustomSovereignOnboardingModal
        isOpen={isCustomSovereignModalOpen}
        onClose={() => setIsCustomSovereignModalOpen(false)}
        onOnboardSovereign={handleOnboardCustomSovereign}
      />
        </Suspense>
      )}

      {isOfflineDataOpen && <OfflineDataDialog onClose={() => setIsOfflineDataOpen(false)} />}
      <Suspense fallback={null}>{isAuditLogOpen && <AuditLogDialog onClose={() => setIsAuditLogOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{isDataHealthOpen && <DataHealthDialog onClose={() => setIsDataHealthOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{isIdeasOpen && <IdeaJournalDialog onClose={() => setIsIdeasOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{registerFocus !== undefined && <ModelRegisterDialog focusId={registerFocus} onClose={() => setRegisterFocus(undefined)} />}</Suspense>
      <Suspense fallback={null}>{isUsersOpen && me && <UsersDialog me={me} onClose={() => setIsUsersOpen(false)} />}</Suspense>
      <Suspense fallback={null}>{isAccountOpen && <AccountDialog onClose={() => setIsAccountOpen(false)} />}</Suspense>
      {aboutFocus !== undefined && <AboutDialog focusId={aboutFocus} onClose={() => setAboutFocus(undefined)} />}
      {isManualModalOpen && (
        <Suspense fallback={null}>
      <SovereignManualAndGithubModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
      />
        </Suspense>
      )}

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenAiModel={() => setIsRuntimeModalOpen(true)}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        aiConfig={runtimeConfig}
        onAiConfigChange={setRuntimeConfig}
        tools={
          <ToolsPage
            run={run}
            items={liveWatchlistItems}
            watchlistName={watchlists.find((w) => w.id === activeWatchlistId)?.name || 'Watchlist'}
            onOpen={(t) => {
              setIsSettingsOpen(false);
              openTool(t);
            }}
            inDialog
          />
        }
      />

      {isRuntimeModalOpen && (
        <Suspense fallback={null}>
      <SelfHostAndOllamaRuntimeModal
        isOpen={isRuntimeModalOpen}
        onClose={() => setIsRuntimeModalOpen(false)}
        runtimeConfig={runtimeConfig}
        onUpdateRuntimeConfig={setRuntimeConfig}
        onTriggerReverifyCouncil={handleRunCouncilPhase1And2}
        activeIso3={run.iso3}
        onApplyConnectorTelemetryToActiveSovereign={handleApplyConnectorTelemetryToActiveSovereign}
      />
        </Suspense>
      )}

      {/* 1-CLICK EXECUTIVE TEAR-SHEET & IC TRADE TICKET QUICK-DRAWER */}
      <ExecutiveTearSheetAndTradeTicketDrawer
        isOpen={isTradeTicketDrawerOpen}
        onClose={() => setIsTradeTicketDrawerOpen(false)}
        activeRun={run}
        stagedTickets={stagedTradeTickets}
        onAddTicket={handleStageTradeTicket}
        onRemoveTicket={handleRemoveTradeTicket}
        onNavigateToSection={(sec) => {
          setLayoutMode('executive_brief');
    setAppArea('desks');
          setActiveNavSection(sec as NavSectionId);
        }}
      />

      {/* Council chat side panel on Research and Reports: the same conversation as on Workspace. */}
      {chatDocked && (
        <aside
          className="fixed z-40 inset-y-0 right-0 w-full lg:w-[30rem] bg-slate-50 dark:bg-[#0B0F17] border-l border-slate-200 dark:border-slate-800 p-2"
          aria-label="Council chat"
          data-chat-dock="true"
        >
          <PanelBoundary name="Council chat">
            <AskCouncilPanel
              onOpenCountry={(item) => {
                const stored = activeWatchlistItems.find((w) => w.iso3 === item.iso3) || SOVEREIGN_CATALOG.find((c) => c.iso3 === item.iso3);
                if (stored && item.iso3 !== run.iso3) handleSelectSovereign(stored);
                openCountryPage('macro');
              }}
              onSendToReports={sendCouncilToReports}
              fullCouncil={fullCouncilStep}
              onClose={() => setChatDock(false)}
            />
          </PanelBoundary>
        </aside>
      )}
    </div>
    </CouncilChatProvider>
  );
}
