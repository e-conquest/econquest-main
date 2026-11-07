import React, { useEffect, useMemo, useState } from 'react';
import { toDisplayCase } from '../utils/displayCase';
import {
  AIRuntimeConfig,
  CommandPaletteItem,
  CommandPaletteItemCategory,
  CustomSovereignOnboardingDraft,
  DockerSelfHostGuiConfig,
  ExternalInternalConnectorConfig,
  ExternalInternalConnectorMetricKey,
  IntegrationBroadcastScope,
  IntegrationDeliveryReceipt,
  ModelIntegrityAuditReport,
  SubAgentId,
  TopLevelIntegrationConfig,
  UserPersonaId,
  WorkspaceSessionSnapshot,
} from '../types/council';
import {
  CURATED_NEW_SOVEREIGN_TEMPLATES,
  exportIntegrityAuditCertificateMarkdown,
  exportWorkspaceSessionJsonFile,
  hydrateCustomSovereignFromLiveApi,
  parseAndValidateWorkspaceSessionJson,
} from '../utils/turnkeyReadinessAndCommandEngine';
import {
  Search,
  X,
  CheckCircle2,
  ShieldCheck,
  Globe,
  Database,
  Download,
  Upload,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Plus,
  Terminal,
  AlertTriangle,
  BookOpen,
  Copy,
  Check,
  GitBranch,
  RefreshCw,
  FileText,
  Cpu,
  Server,
  Play,
} from 'lucide-react';

interface GlobalCommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  onSelectCommand: (item: CommandPaletteItem) => void;
}

export const GlobalCommandPaletteModal: React.FC<GlobalCommandPaletteModalProps> = ({
  isOpen,
  onClose,
  items,
  onSelectCommand,
}) => {
  const [query, setQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | CommandPaletteItemCategory>('ALL');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCategoryFilter('ALL');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (!q) return true;
      const inTitle = item.title.toLowerCase().includes(q);
      const inSub = item.subtitle.toLowerCase().includes(q);
      const inBadge = item.categoryBadge.toLowerCase().includes(q);
      const inKeywords = item.keywords.some((k) => k.includes(q));
      return inTitle || inSub || inBadge || inKeywords;
    });
  }, [items, query, categoryFilter]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, categoryFilter]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length > 0
            ? (prev - 1 + filteredItems.length) % filteredItems.length
            : 0
        );
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault();
        onSelectCommand(filteredItems[selectedIndex]);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onSelectCommand, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Search Input Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
          <Search className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to any of 10 Hubs, 36 Sub-Modules (e.g. '8.1 Shadow Rating', '9.1 Restructuring', 'Polymarket', 'India')..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <span className="px-1.5 py-0.5 text-xs tabular-nums bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            ESC
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filter Bar */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
          {(
            [
              { id: 'ALL', label: `All (${items.length})` },
              { id: 'SUB_MODULE', label: '36 Sub-Modules (1.1–10.4)' },
              { id: 'ANALYTICAL_HUB', label: '10 Top Hubs' },
              { id: 'SOVEREIGN_SWITCH', label: 'Sovereigns' },
              { id: 'PERSONA_MODE', label: 'Persona Modes' },
              { id: 'EXPORT_AND_AUDIT', label: 'Audit, ISO-3 & Session' },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              aria-pressed={categoryFilter === cat.id}
              className="ui-pill"
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching module, sovereign, or command found for "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onSelectCommand(item);
                    onClose();
                  }}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-4 transition-colors ${
                    isSelected
                      ? 'bg-blue-50/90 dark:bg-blue-950/50'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`px-2 py-0.5 text-xs tabular-nums font-semibold shrink-0 mt-0.5 border ${
                        item.category === 'SUB_MODULE'
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : item.category === 'ANALYTICAL_HUB'
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : item.category === 'SOVEREIGN_SWITCH'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : item.category === 'PERSONA_MODE'
                          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                      }`}
                    >
                      {item.categoryBadge}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.shortcutHint && (
                      <span className="px-1.5 py-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {item.shortcutHint}
                      </span>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          <span>↑↓ Navigate · Enter Select · ESC Close</span>
          <span>10 Institutional Hubs · 36 Quantitative Modules Indexed</span>
        </div>
      </div>
    </div>
  );
};

interface ModelIntegrityAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditReport: ModelIntegrityAuditReport;
}

interface BackendSweepCheckItem {
  id: string;
  category: 'API_ROUTE' | 'QUANT_ENGINE' | 'DOCS_GIT';
  name: string;
  endpointOrModule: string;
  status: 'PASS' | 'WARN';
  latencyMs: number;
  detail: string;
}

interface BackendFullSweepResponse {
  status: 'ALL_SYSTEMS_NOMINAL' | 'PARTIAL_WARN';
  sweptAt: string;
  totalLatencyMs: number;
  activeIso3: string;
  passedCount: number;
  totalChecks: number;
  gitInitialized: boolean;
  checks: BackendSweepCheckItem[];
}

export const ModelIntegrityAuditModal: React.FC<ModelIntegrityAuditModalProps> = ({
  isOpen,
  onClose,
  auditReport,
}) => {
  const [backendSweep, setBackendSweep] = useState<BackendFullSweepResponse | null>(null);
  const [isSweepingBackend, setIsSweepingBackend] = useState<boolean>(false);

  const runLiveBackendSweep = async () => {
    setIsSweepingBackend(true);
    try {
      const res = await fetch(
        `/api/health/full-sweep?iso3=${encodeURIComponent(auditReport.activeSovereignIso3)}`
      );
      if (res.ok) {
        const data: BackendFullSweepResponse = await res.json();
        setBackendSweep(data);
      }
    } catch {
      // ignore network error and keep deterministic client report
    } finally {
      setIsSweepingBackend(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runLiveBackendSweep();
    }
  }, [isOpen, auditReport.activeSovereignIso3]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Full-Stack Backend, Quant Engine & Model Integrity Sweep Auditor
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Active Sovereign: {auditReport.activeSovereignName} ({auditReport.activeSovereignIso3}) ·{' '}
                {auditReport.watchlistCount}-Sovereign Comparison Universe · Zero Notional Dollar Leakage Enforced
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runLiveBackendSweep}
              disabled={isSweepingBackend}
              className="ui-btn ui-btn-primary inline-flex"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSweepingBackend ? 'animate-spin' : ''}`} />
              <span>{isSweepingBackend ? 'Sweeping APIs...' : 'Run Live Full-Stack Sweep'}</span>
            </button>
            <button
              type="button"
              onClick={() => exportIntegrityAuditCertificateMarkdown(auditReport)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Audit Certificate (.md)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
              <div className="text-xs tabular-nums text-emerald-700 dark:text-emerald-300">
                Turnkey Readiness Score
              </div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
                {auditReport.readinessScorePct}% PASS
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                {auditReport.passedChecksCount} of {auditReport.totalChecksRun} invariants verified
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Accounting Identities
              </div>
              <div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white mt-1">
                100.00% Exact
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                SDIB, Restructuring & Custody Σw = 100%
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Unit-Ratio Discipline
              </div>
              <div className="text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400 mt-1">
                {auditReport.zeroNotionalComplianceVerified ? '0 Notional Leaks' : 'Check Units'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                % GDP · bps · Notches (1–21) · 0–100¢
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Multilateral Feeds
              </div>
              <div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white mt-1">
                {auditReport.provenanceFeeds.length} Verified APIs
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                IMF WEO · World Bank v2 · BIS · Polymarket
              </div>
            </div>
          </div>

          {/* Executive Verdict */}
          <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 text-xs text-slate-800 dark:text-slate-200">
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              Executive Pre-Flight Audit Verdict:{' '}
            </span>
            {auditReport.executiveAuditVerdict}
          </div>

          {/* Live Backend & Express API Route Health Sweep */}
          {backendSweep && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  0. Live Express Backend, Quant Engine & GitHub Repo Sweep ({backendSweep.passedCount}/
                  {backendSweep.totalChecks} Passed · {backendSweep.totalLatencyMs}ms)
                </h3>
                <span className="px-2 py-0.5 text-xs tabular-nums font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {toDisplayCase(backendSweep.status)}
                </span>
              </div>
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 tabular-nums text-xs border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3">Sweep ID</th>
                      <th className="py-2 px-3">Subsystem & Express Endpoint / Engine</th>
                      <th className="py-2 px-3">Live Diagnostic Telemetry</th>
                      <th className="py-2 px-3">Latency</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {backendSweep.checks.map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2 px-3 tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                          {item.id}
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {item.name}
                          </div>
                          <div className="tabular-nums text-xs text-blue-600 dark:text-blue-400">
                            {item.endpointOrModule}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                          {item.detail}
                        </td>
                        <td className="py-2 px-3 tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {item.latencyMs}ms
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs tabular-nums font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            <CheckCircle2 className="w-3 h-3" />
                            {toDisplayCase(item.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Checks Table */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              1. Mathematical Identity, Boundary & Unit-Ratio Verification Matrix
            </h3>
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 tabular-nums text-xs border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 px-3">Check ID & Hub</th>
                    <th className="py-2 px-3">Mathematical Identity / Invariant</th>
                    <th className="py-2 px-3">Expected</th>
                    <th className="py-2 px-3">Observed</th>
                    <th className="py-2 px-3">Residual</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {auditReport.checks.map((chk) => (
                    <tr
                      key={chk.checkId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-2.5 px-3 align-top">
                        <div className="tabular-nums font-semibold text-slate-900 dark:text-white">
                          {chk.checkId}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {chk.hubReference}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {chk.title}
                        </div>
                        <div className="tabular-nums text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                          {chk.formulaChecked}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {chk.diagnosticDetail}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-slate-700 dark:text-slate-300 align-top whitespace-nowrap">
                        {chk.expectedInvariant}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-semibold text-slate-900 dark:text-white align-top whitespace-nowrap">
                        {chk.observedReading}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-emerald-600 dark:text-emerald-400 align-top whitespace-nowrap">
                        {chk.residualDeviationLabel}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs tabular-nums font-semibold ${
                            chk.status === 'PASS'
                              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                              : 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                          }`}
                        >
                          {chk.status === 'PASS' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          {toDisplayCase(chk.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Data Provenance Table */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              2. Multilateral & High-Frequency Data Provenance Matrix
            </h3>
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 tabular-nums text-xs border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 px-3">Institution</th>
                    <th className="py-2 px-3">Endpoint / Series Codes</th>
                    <th className="py-2 px-3">Normalized Metrics Supplied</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {auditReport.provenanceFeeds.map((feed) => (
                    <tr key={feed.feedId}>
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                        {feed.institutionName}
                      </td>
                      <td className="py-2 px-3 tabular-nums text-xs text-blue-600 dark:text-blue-400">
                        {feed.endpointOrDataset}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        {feed.metricsProvided}
                      </td>
                      <td className="py-2 px-3 tabular-nums text-xs">
                        <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold">
                          {toDisplayCase(feed.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface CustomSovereignOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOnboardSovereign: (draft: CustomSovereignOnboardingDraft) => void;
}

export const CustomSovereignOnboardingModal: React.FC<
  CustomSovereignOnboardingModalProps
> = ({ isOpen, onClose, onOnboardSovereign }) => {
  const [draft, setDraft] = useState<CustomSovereignOnboardingDraft>(
    CURATED_NEW_SOVEREIGN_TEMPLATES[0]
  );
  const [isHydrating, setIsHydrating] = useState<boolean>(false);
  const [hydrationNote, setHydrationNote] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectTemplate = (tpl: CustomSovereignOnboardingDraft) => {
    setDraft({ ...tpl });
    setHydrationNote(`Loaded institutional baseline template for ${tpl.countryName} (${tpl.iso3}).`);
  };

  const handleLiveHydrate = async () => {
    setIsHydrating(true);
    setHydrationNote(`Querying live IMF DataMapper WEO v1 & World Bank Open Data v2 for ${draft.iso3}...`);
    const res = await hydrateCustomSovereignFromLiveApi(draft);
    setDraft(res.updatedDraft);
    setHydrationNote(res.liveSourceNote);
    setIsHydrating(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.iso3.trim() || !draft.countryName.trim()) return;
    onOnboardSovereign({
      ...draft,
      iso3: draft.iso3.trim().toUpperCase().slice(0, 3),
      currencyCode: draft.currencyCode.trim().toUpperCase().slice(0, 4),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Custom ISO-3 Sovereign Onboarding Wizard (Live IMF / World Bank Auto-Hydration)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add any new sovereign country on the fly — immediately active across all 10 analytical hubs and 36 sub-modules
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Quick G20 / EM Templates */}
          <div>
            <div className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
              1. Quick-Load Curated G20 / EM Sovereign Template (or Enter Any Custom ISO-3 Below):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CURATED_NEW_SOVEREIGN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.iso3}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl)}
                  aria-pressed={draft.iso3 === tpl.iso3}
                  className="ui-pill"
                >
                  {tpl.iso3} · {tpl.countryName}
                </button>
              ))}
            </div>
          </div>

          {/* Core Identity & Live API Hydration Button */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                ISO-3 Code (3 Letters)
              </label>
              <input
                type="text"
                maxLength={3}
                required
                value={draft.iso3}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, iso3: e.target.value.toUpperCase() }))
                }
                className="w-full px-2.5 py-1.5 tabular-nums font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Country Name
              </label>
              <input
                type="text"
                required
                value={draft.countryName}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, countryName: e.target.value }))
                }
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Currency Code
              </label>
              <input
                type="text"
                maxLength={4}
                required
                value={draft.currencyCode}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    currencyCode: e.target.value.toUpperCase(),
                  }))
                }
                className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Geographic Region
              </label>
              <input
                type="text"
                value={draft.region}
                onChange={(e) => setDraft((prev) => ({ ...prev, region: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70">
            <div className="text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-blue-700 dark:text-blue-300">
                Auto-Hydrate from Multilateral Open Data:{' '}
              </span>
              {hydrationNote ||
                'Query IMF DataMapper WEO v1 & World Bank v2 APIs for this ISO-3 code.'}
            </div>
            <button
              type="button"
              onClick={handleLiveHydrate}
              disabled={isHydrating}
              className="ui-btn ui-btn-primary inline-flex shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isHydrating ? 'Hydrating IMF / WB...' : 'Hydrate Live IMF / WB Data'}
              </span>
            </button>
          </div>

          {/* Normalized Macro & Market Parameters (Zero Notional) */}
          <div>
            <div className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
              2. Ratio-Normalized Macro, Fiscal & Market Parameters (% of GDP, bps, Months Import Cover):
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Gross Debt / GDP (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.debtToGdpPct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, debtToGdpPct: Number(e.target.value) }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Primary Fiscal Balance (% GDP)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.primaryFiscalBalancePct}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      primaryFiscalBalancePct: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Real GDP Growth YoY (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.realGdpGrowthPct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, realGdpGrowthPct: Number(e.target.value) }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Headline CPI Inflation (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.cpiInflationPct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, cpiInflationPct: Number(e.target.value) }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  CB Policy Rate (%)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={draft.policyRatePct}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, policyRatePct: Number(e.target.value) }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  10Y Sovereign Yield (%)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={draft.sovereign10YBondYieldPct}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      sovereign10YBondYieldPct: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  5Y USD CDS Spread (bps)
                </label>
                <input
                  type="number"
                  step="1"
                  value={draft.cds5YSpreadBps}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, cds5YSpreadBps: Number(e.target.value) }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  FX Reserves (Mos. Imports)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={draft.fxReservesMonthsImport}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      fxReservesMonthsImport: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Primary Sovereign Risk & Macro Focus Directive
            </label>
            <input
              type="text"
              value={draft.focusTheme}
              onChange={(e) => setDraft((p) => ({ ...p, focusTheme: e.target.value }))}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
            />
          </div>

          {/* Submit Footer */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                Onboard {draft.countryName} ({draft.iso3}) & Activate Across All 10 Hubs
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface WorkspaceSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSnapshot: WorkspaceSessionSnapshot;
  onRestoreSession: (snapshot: WorkspaceSessionSnapshot) => void;
  onResetFactoryDefaults: () => void;
}

export const WorkspaceSessionModal: React.FC<WorkspaceSessionModalProps> = ({
  isOpen,
  onClose,
  currentSnapshot,
  onRestoreSession,
  onResetFactoryDefaults,
}) => {
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      const validated = parseAndValidateWorkspaceSessionJson(content);
      if (!validated) {
        setImportError(
          'Invalid session JSON file. Expected schemaVersion "ECONQUEST-SESSION-1.0".'
        );
        return;
      }
      setImportError(null);
      onRestoreSession(validated);
      onClose();
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Workspace State Persistence & Session Snapshot Manager
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Auto-saved to browser localStorage · Export or restore complete `.json` research sessions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Active State Summary */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="tabular-nums font-semibold text-slate-900 dark:text-white text-xs">
              Current Live Persisted Workspace State
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-300">
              <div>
                Active Sovereign:{' '}
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white">
                  {currentSnapshot.activeCountryName} ({currentSnapshot.activeIso3})
                </span>
              </div>
              <div>
                Active Persona Lens:{' '}
                <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                  {currentSnapshot.activePersona}
                </span>
              </div>
              <div>
                Active Module:{' '}
                <span className="tabular-nums text-slate-900 dark:text-white">
                  {currentSnapshot.activeNavSection}
                </span>
              </div>
              <div>
                Custom ISO-3 Sovereigns:{' '}
                <span className="tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                  {currentSnapshot.customOnboardedSovereigns.length} onboarded
                </span>
              </div>
            </div>
          </div>

          {importError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {importError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => exportWorkspaceSessionJsonFile(currentSnapshot)}
              className="ui-btn ui-btn-primary"
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <Download className="w-4 h-4" />
                <span>Export Session (.json)</span>
              </div>
              <span className="text-xs text-blue-100 mt-1 text-left">
                Download portable snapshot of watchlists, custom ISO-3s & shocks
              </span>
            </button>

            <label className="flex flex-col items-start p-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors">
              <div className="flex items-center gap-1.5 font-semibold">
                <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Restore Session (.json)</span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-left">
                Upload a saved `.json` session file from a colleague or prior run
              </span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onResetFactoryDefaults();
                onClose();
              }}
              className="flex flex-col items-start p-3.5 bg-slate-50 dark:bg-slate-950 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 border border-slate-200 dark:border-slate-800 transition-colors"
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <RotateCcw className="w-4 h-4" />
                <span>Factory Reset</span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-left">
                Clear custom overrides and restore default watchlists & baseline
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// In-App User Manual, README.md & GitHub Repository Sync Modal
// -----------------------------------------------------------------------------
interface SovereignManualAndGithubModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ManualDocsPayload {
  status: string;
  fetchedAt: string;
  gitReady: boolean;
  hasLogoAsset: boolean;
  files: {
    readme: { path: string; content: string; lines: number; bytes: number };
    userManual: { path: string; content: string; lines: number; bytes: number };
  };
}

const CHAPTER_SHORTCUTS = [
  { id: 'all', label: 'Full Document', query: '' },
  { id: 'pillars', label: '1. 10 Hubs & 3 Activity Pillars', query: 'Analytical Hubs' },
  { id: 'council', label: '2. 9-Agent Council & CRO Gate', query: '9-Agent' },
  { id: 'csv', label: '3. CSV Backtesting & Personas', query: 'CSV Backtesting' },
  { id: 'smcr', label: '4. SMCR-1.0 Report Exports', query: 'SMCR-1.0' },
  { id: 'integration', label: '5. Top-Level App Integration & APIs', query: 'Top-Level' },
];

export const SovereignManualAndGithubModal: React.FC<SovereignManualAndGithubModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeDoc, setActiveDoc] = useState<'userManual' | 'readme'>('userManual');
  const [docsPayload, setDocsPayload] = useState<ManualDocsPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    fetch('/api/docs/manuals')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && data.files) {
          setDocsPayload(data);
        }
      })
      .catch(() => {
        // fallback handled below
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const activeFile =
    activeDoc === 'userManual'
      ? docsPayload?.files.userManual || {
          path: 'docs/USER_MANUAL.md',
          content: '# Sovereign Council Orchestrator User Manual\nLoading documentation...',
          lines: 0,
          bytes: 0,
        }
      : docsPayload?.files.readme || {
          path: 'README.md',
          content: '# EconQuest — Sovereign Council Orchestrator\nLoading README.md...',
          lines: 0,
          bytes: 0,
        };

  const filteredContent = (() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return activeFile.content;
    const sections = activeFile.content.split(/\n(?=##?\s)/);
    const matching = sections.filter((sec) => sec.toLowerCase().includes(q));
    return matching.length > 0
      ? matching.join('\n\n---\n\n')
      : `No section matched filter "${searchFilter}". Clear the filter to view all ${activeFile.lines} lines.`;
  })();

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopiedId(activeDoc);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([activeFile.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeDoc === 'userManual' ? 'USER_MANUAL.md' : 'README.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Sovereign Council Orchestrator — User Manual & GitHub Repository Docs
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Committed files: <span className="text-blue-600 dark:text-blue-400">README.md</span> &{' '}
                <span className="text-emerald-600 dark:text-emerald-400">docs/USER_MANUAL.md</span> · Ready for GitHub Sync
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors"
            >
              {copiedId === activeDoc ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied .md!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Raw Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="ui-btn ui-btn-primary inline-flex"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {activeDoc === 'userManual' ? 'USER_MANUAL.md' : 'README.md'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* GitHub Repository Readiness Bar */}
        <div className="px-6 py-2.5 bg-slate-100/80 dark:bg-slate-950/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 tabular-nums text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              <GitBranch className="w-3 h-3" />
              {docsPayload?.gitReady ? 'Git repo initialised (main)' : 'Git sync ready'}
            </span>
            <span className="text-slate-600 dark:text-slate-400 tabular-nums text-xs">
              Active File: <strong className="text-slate-900 dark:text-white">{activeFile.path}</strong> ({activeFile.lines} lines · {(activeFile.bytes / 1024).toFixed(1)} KB)
            </span>
          </div>

          {/* Document Switcher */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveDoc('userManual');
                setSearchFilter('');
              }}
              aria-pressed={activeDoc === 'userManual'}
              className="ui-pill inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>docs/USER_MANUAL.md (Full Manual)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDoc('readme');
                setSearchFilter('');
              }}
              aria-pressed={activeDoc === 'readme'}
              className="ui-pill inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>README.md (Root Overview)</span>
            </button>
          </div>
        </div>

        {/* Chapter Quick-Jump & Search Bar */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {CHAPTER_SHORTCUTS.map((chap) => (
              <button
                key={chap.id}
                type="button"
                onClick={() => setSearchFilter(chap.query)}
                aria-pressed={searchFilter === chap.query}
                className="ui-pill"
              >
                {chap.label}
              </button>
            ))}
          </div>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter manual sections..."
              className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Markdown Content Viewer */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 dark:bg-slate-950/60">
          {isLoading ? (
            <div className="py-12 text-center text-xs tabular-nums text-slate-500">
              Loading committed documentation from workspace repository...
            </div>
          ) : (
            <pre className="whitespace-pre-wrap tabular-nums text-xs leading-relaxed text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 select-text">
              {filteredContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 6. SELF-HOST DOCKER (macOS & Windows) & LOCAL OLLAMA AGENT RUNTIME GUI STUDIO
// ============================================================================

interface SelfHostAndOllamaRuntimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  runtimeConfig: AIRuntimeConfig;
  onUpdateRuntimeConfig: (next: AIRuntimeConfig) => void;
  onTriggerReverifyCouncil?: () => void;
  activeIso3?: string;
  onApplyConnectorTelemetryToActiveSovereign?: (
    connectorName: string,
    extracted: Partial<Record<ExternalInternalConnectorMetricKey, number>>
  ) => void;
}

interface SelfHostBundleFiles {
  dockerfile: string;
  dockerCompose: string;
  envExample: string;
  startMac: string;
  startWindowsPs1: string;
  startWindowsBat: string;
}

const RECOMMENDED_QUICK_MODELS = [
  { id: 'qwen2.5:7b', label: 'qwen2.5:7b (Fast 4.7GB · Best 8GB–16GB RAM)' },
  { id: 'llama3.1:8b', label: 'llama3.1:8b (Fast 4.9GB · Strong Tool/JSON)' },
  { id: 'qwen2.5:14b', label: 'qwen2.5:14b (Balanced 9GB · 16GB–32GB RAM)' },
  { id: 'qwen2.5:32b', label: 'qwen2.5:32b (Institutional 20GB · 32GB+ Mac/GPU)' },
  { id: 'mistral-nemo:12b', label: 'mistral-nemo:12b (128k Context · 7.1GB)' },
  { id: 'phi4:14b', label: 'phi4:14b (Compact Quantitative Analyst · 9.1GB)' },
];

const RECOMMENDED_DEEP_MODELS = [
  { id: 'deepseek-r1:8b', label: 'deepseek-r1:8b (Reasoning 4.9GB · Fast CoT)' },
  { id: 'deepseek-r1:14b', label: 'deepseek-r1:14b (Reasoning 9GB · High Precision)' },
  { id: 'deepseek-r1:32b', label: 'deepseek-r1:32b (Flagship Reasoning 20GB · 32GB+)' },
  { id: 'qwq:32b', label: 'qwq:32b (Qwen Reasoning 20GB · Macro Synthesis)' },
  { id: 'qwen2.5:32b', label: 'qwen2.5:32b (Dense 32B Instruct · Fast JSON)' },
];

const SUB_AGENT_GUI_CATALOG: Array<{
  id: SubAgentId;
  code: string;
  name: string;
  deskLabel: string;
  deskKey: 'geopolitical' | 'sovereign' | 'macro';
  defaultRoleHint: string;
}> = [
  {
    id: 'ag1_intel_scraper',
    code: 'AG-1',
    name: 'Intelligence Scraper Analyst',
    deskLabel: 'Geopolitical Risk Desk',
    deskKey: 'geopolitical',
    defaultRoleHint: 'Monitors GDELT conflict velocity & Caldara-Iacoviello GPR Z-scores',
  },
  {
    id: 'ag2_transmission_mapper',
    code: 'AG-2',
    name: 'Transmission Mapping Analyst',
    deskLabel: 'Geopolitical Risk Desk',
    deskKey: 'geopolitical',
    defaultRoleHint: 'Maps maritime chokepoint freight spikes into CPI & 5Y CDS bps',
  },
  {
    id: 'ag3_sanctions_legal',
    code: 'AG-3',
    name: 'Sanctions & Legal Indenture Analyst',
    deskLabel: 'Geopolitical Risk Desk',
    deskKey: 'geopolitical',
    defaultRoleHint: 'Audits G7 reserve freeze exposure & NY-Law vs Local-Law basis',
  },
  {
    id: 'ag4_fiscal_auditor',
    code: 'AG-4',
    name: 'Fiscal Auditor & Debt Sustainability',
    deskLabel: 'Sovereign Credit Desk',
    deskKey: 'sovereign',
    defaultRoleHint: 'Tracks IMF SRDSF Gross Financing Needs (GFN) & Bank CET1 doom loop',
  },
  {
    id: 'ag5_external_balance',
    code: 'AG-5',
    name: 'External Balance Sheet & FX Reserves',
    deskLabel: 'Sovereign Credit Desk',
    deskKey: 'sovereign',
    defaultRoleHint: 'Monitors IMF ARA reserve burn velocity & 5Y XCCY swap basis',
  },
  {
    id: 'ag6_political_will',
    code: 'AG-6',
    name: 'Political Will & CAC Holdout Game Theory',
    deskLabel: 'Sovereign Credit Desk',
    deskKey: 'sovereign',
    defaultRoleHint: 'Evaluates ICMA single-limb CAC voting & Minority Report triggers',
  },
  {
    id: 'ag7_hf_nowcaster',
    code: 'AG-7',
    name: 'High-Frequency Growth & Tail Nowcaster',
    deskLabel: 'Macroeconomic Desk',
    deskKey: 'macro',
    defaultRoleHint: 'Computes 5th-percentile Growth-at-Risk (GaR) & 95th-pct Fiscal-at-Risk',
  },
  {
    id: 'ag8_cb_watcher',
    code: 'AG-8',
    name: 'Central Bank Watcher & Fiscal Dominance',
    deskLabel: 'Macroeconomic Desk',
    deskKey: 'macro',
    defaultRoleHint: 'Models Blanchard-Leeper reversal rate r* & NSS 10Y term premium',
  },
  {
    id: 'ag9_global_spillover',
    code: 'AG-9',
    name: 'Global Spillover & Crisis EWS Mapper',
    deskLabel: 'Macroeconomic Desk',
    deskKey: 'macro',
    defaultRoleHint: 'Tracks Kaminsky-Reinhart 5-factor EWS & global dollar plumbing Z-score',
  },
];

const DEFAULT_DOCKER_GUI_CONFIG: DockerSelfHostGuiConfig = {
  targetOs: 'mac_apple_silicon',
  topology: 'host_ollama',
  appPort: 3000,
  ollamaPort: 11434,
  containerName: 'econquest-sovereign-council',
  keepAlive: '24h',
  corsOrigins: '*',
  autoPullOnBoot: true,
};

const DEFAULT_GUI_API_CONNECTORS: ExternalInternalConnectorConfig[] = [
  {
    id: 'conn-wb-gdp',
    name: 'World Bank Open Data v2 (Real GDP Growth)',
    category: 'macro_rest',
    networkScope: 'external',
    url: 'https://api.worldbank.org/v2/country/{{ISO3}}/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=2',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 4500,
    telemetryMappings: {
      gdpGrowth: '1.0.value',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'ok',
  },
  {
    id: 'conn-imf-debt',
    name: 'IMF DataMapper WEO v1 (Gross Debt % GDP)',
    category: 'macro_rest',
    networkScope: 'external',
    url: 'https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP/{{ISO3}}',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 4500,
    telemetryMappings: {
      debtToGdp: 'values.GGXWDG_NGDP.{{ISO3}}.2025',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'ok',
  },
  {
    id: 'conn-internal-lake',
    name: 'Internal Enterprise Sovereign Risk Lake (Intranet / Docker Host)',
    category: 'macro_rest',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:8080/api/v1/sovereign/{{ISO3}}',
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Internal-Desk': 'Sovereign-Macro-Council',
    },
    enabled: false,
    timeoutMs: 3500,
    telemetryMappings: {
      gdpGrowth: 'telemetry.gdpGrowthPct',
      cpiInflation: 'telemetry.cpiInflationPct',
      debtToGdp: 'telemetry.debtToGdpPct',
      cds5yBps: 'telemetry.cds5ySpreadBps',
      fxReservesMonths: 'telemetry.fxReservesMonths',
      policyRate: 'telemetry.policyRatePct',
    },
    injectIntoCouncilPrompt: true,
    lastStatus: 'untested',
  },
  {
    id: 'conn-ollama-gateway',
    name: 'Local / Internal Ollama & vLLM Inference Gateway',
    category: 'llm_gateway',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:11434/api/tags',
    method: 'GET',
    headers: { Accept: 'application/json' },
    enabled: true,
    timeoutMs: 3000,
    telemetryMappings: {},
    injectIntoCouncilPrompt: false,
    lastStatus: 'untested',
  },
  {
    id: 'conn-smcr-webhook',
    name: 'Enterprise Risk Bus & Slack/Teams Outbound Webhook',
    category: 'webhook_bus',
    networkScope: 'internal_host',
    url: 'http://host.docker.internal:9000/webhooks/smcr-verdict',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Council-Standard': 'SMCR-1.0',
    },
    bodyTemplate:
      '{"schema":"SMCR-1.0","iso3":"{{ISO3}}","event":"SOVEREIGN_COUNCIL_VERDICT","status":"ACTIVE_MONITORING"}',
    enabled: false,
    timeoutMs: 4000,
    telemetryMappings: {},
    injectIntoCouncilPrompt: false,
    lastStatus: 'untested',
  },
];

const TELEMETRY_MAPPING_FIELDS: Array<{
  key: ExternalInternalConnectorMetricKey;
  label: string;
  unit: string;
  placeholder: string;
}> = [
  { key: 'gdpGrowth', label: 'Real GDP Growth', unit: '% YoY', placeholder: 'e.g. 1.0.value or telemetry.gdpGrowthPct' },
  { key: 'cpiInflation', label: 'Headline CPI Inflation', unit: '% YoY', placeholder: 'e.g. telemetry.cpiInflationPct' },
  { key: 'debtToGdp', label: 'Gross Debt / GDP', unit: '% GDP', placeholder: 'e.g. values.GGXWDG_NGDP.{{ISO3}}.2025' },
  { key: 'cds5yBps', label: '5Y Sovereign CDS Spread', unit: 'bps', placeholder: 'e.g. telemetry.cds5ySpreadBps' },
  { key: 'fxReservesMonths', label: 'FX Reserves Import Cover', unit: 'Months', placeholder: 'e.g. telemetry.fxReservesMonths' },
  { key: 'policyRate', label: 'Central Bank Policy Rate', unit: '%', placeholder: 'e.g. telemetry.policyRatePct' },
  { key: 'politicalStability', label: 'Political Stability Pctl', unit: '0–100', placeholder: 'e.g. telemetry.politicalStabilityPctl' },
];

export const SelfHostAndOllamaRuntimeModal: React.FC<SelfHostAndOllamaRuntimeModalProps> = ({
  isOpen,
  onClose,
  runtimeConfig,
  onUpdateRuntimeConfig,
  onTriggerReverifyCouncil,
  activeIso3 = 'BRA',
  onApplyConnectorTelemetryToActiveSovereign,
}) => {
  const [activeTab, setActiveTab] = useState<
    | 'global_gui'
    | 'agent_matrix_gui'
    | 'docker_builder_gui'
    | 'api_connectors_gui'
    | 'top_level_integration_gui'
  >('global_gui');
  const [activeDockerFile, setActiveDockerFile] = useState<
    'envCustom' | 'dockerCompose' | 'startMac' | 'startWindowsPs1' | 'dockerfile'
  >('envCustom');
  const [bundleFiles, setBundleFiles] = useState<SelfHostBundleFiles | null>(null);

  // External & Internal API / Host GUI Connector State
  const apiConnectors =
    runtimeConfig.apiConnectors && runtimeConfig.apiConnectors.length > 0
      ? runtimeConfig.apiConnectors
      : DEFAULT_GUI_API_CONNECTORS;

  const [connectorCategoryFilter, setConnectorCategoryFilter] = useState<
    'ALL' | ExternalInternalConnectorConfig['category']
  >('ALL');
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(
    apiConnectors[0]?.id || 'conn-wb-gdp'
  );
  const [sampleTestIso3, setSampleTestIso3] = useState<string>(activeIso3 || 'BRA');
  const [newHeaderKey, setNewHeaderKey] = useState<string>('');
  const [newHeaderVal, setNewHeaderVal] = useState<string>('');
  const [connectorPingState, setConnectorPingState] = useState<{
    loading: boolean;
    connectorId: string;
    ok?: boolean;
    status?: number;
    statusText?: string;
    resolvedUrl?: string;
    latencyMs?: number;
    testedAt?: string;
    isSimulatedPreview?: boolean;
    extractedTelemetry?: Partial<Record<ExternalInternalConnectorMetricKey, number>>;
    jsonPreview?: any;
    message?: string;
  }>({ loading: false, connectorId: '' });

  // Top-Level External Application Integration State
  const integrationCfg: TopLevelIntegrationConfig = {
    requireApiKey: false,
    apiKey: 'smcr_live_9f8a7b6c5d4e3f2a1b',
    webhookHmacSecret: 'whsec_econquest_smcr_v1_hmac_secret',
    autoBroadcastOnRun: true,
    defaultScope: 'all_desks_bundle',
    includeSubAgents: true,
    includeQuantSuites: true,
    ...(runtimeConfig.integrationConfig || {}),
  };

  const [broadcastScope, setBroadcastScope] = useState<IntegrationBroadcastScope>(
    integrationCfg.defaultScope || 'all_desks_bundle'
  );
  const [integrationDeliveries, setIntegrationDeliveries] = useState<IntegrationDeliveryReceipt[]>(
    []
  );
  const [activeSseCount, setActiveSseCount] = useState<number>(0);
  const [broadcastState, setBroadcastState] = useState<{
    loading: boolean;
    message: string | null;
    payloadPreview?: any;
  }>({ loading: false, message: null });
  const [activeSnippetTab, setActiveSnippetTab] = useState<'curl' | 'python' | 'typescript_sse'>(
    'curl'
  );

  const updateIntegrationConfig = (patch: Partial<TopLevelIntegrationConfig>) => {
    onUpdateRuntimeConfig({
      ...runtimeConfig,
      integrationConfig: {
        ...integrationCfg,
        ...patch,
      },
    });
  };

  const fetchIntegrationDeliveries = async () => {
    try {
      const res = await fetch('/api/v1/integration/deliveries');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.deliveries)) {
        setIntegrationDeliveries(data.deliveries);
      }
      if (typeof data?.activeSseSubscribers === 'number') {
        setActiveSseCount(data.activeSseSubscribers);
      }
    } catch {
      // Ignore fetch error
    }
  };

  const handleTriggerIntegrationBroadcast = async () => {
    setBroadcastState({
      loading: true,
      message: `Broadcasting ${broadcastScope} for ${activeIso3} to outbound webhooks & SSE subscribers...`,
    });
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (integrationCfg.requireApiKey && integrationCfg.apiKey) {
        headers['X-SMCR-API-Key'] = integrationCfg.apiKey;
      }
      const res = await fetch('/api/v1/integration/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          iso3: activeIso3,
          scope: broadcastScope,
          eventType: 'manual.gui.broadcast',
        }),
      });
      const data = await res.json();
      setBroadcastState({
        loading: false,
        message: `Broadcast completed for ${activeIso3} (${broadcastScope}) · ${
          Array.isArray(data?.receipts) ? data.receipts.length : 1
        } delivery receipt(s) logged.`,
        payloadPreview: data?.payloadPreview,
      });
      void fetchIntegrationDeliveries();
    } catch (err: any) {
      setBroadcastState({
        loading: false,
        message: err?.message || 'Broadcast request failed.',
      });
    }
  };

  const handleDownloadOpenApiSpec = async () => {
    try {
      const res = await fetch('/api/v1/integration/openapi.json');
      const spec = await res.json();
      downloadFile('econquest-smcr-openapi-3.1.json', JSON.stringify(spec, null, 2));
    } catch {
      // fallback
    }
  };

  const [ollamaStatus, setOllamaStatus] = useState<{
    connected: boolean;
    endpoint: string;
    latencyMs?: number;
    models: string[];
    message: string;
  } | null>(null);
  const [isProbing, setIsProbing] = useState<boolean>(false);

  const [pullStatus, setPullStatus] = useState<{
    loading: boolean;
    targetModel: string;
    message: string | null;
    success?: boolean;
  }>({ loading: false, targetModel: '', message: null });

  const [benchmarkResult, setBenchmarkResult] = useState<{
    loading: boolean;
    phase: string;
    modelName: string;
    latencyMs?: number;
    schemaVerified?: boolean;
    message: string | null;
    sampleOutput?: { stance: string; riskScore: number; summary: string };
  }>({ loading: false, phase: '', modelName: '', message: null });

  const [serverSaveState, setServerSaveState] = useState<{
    saving: boolean;
    savedMessage: string | null;
  }>({ saving: false, savedMessage: null });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const dockerGui: DockerSelfHostGuiConfig = {
    ...DEFAULT_DOCKER_GUI_CONFIG,
    ...(runtimeConfig.dockerGuiConfig || {}),
  };

  const updateDockerGui = (patch: Partial<DockerSelfHostGuiConfig>) => {
    const nextDocker = { ...dockerGui, ...patch };
    let nextOllamaUrl = runtimeConfig.ollamaBaseUrl;
    if (patch.topology === 'host_ollama') {
      nextOllamaUrl = `http://host.docker.internal:${nextDocker.ollamaPort}`;
    } else if (patch.topology === 'bundled_cpu' || patch.topology === 'bundled_gpu') {
      nextOllamaUrl = `http://ollama:${nextDocker.ollamaPort}`;
    } else if (patch.ollamaPort && runtimeConfig.ollamaBaseUrl.includes('host.docker.internal')) {
      nextOllamaUrl = `http://host.docker.internal:${patch.ollamaPort}`;
    }
    onUpdateRuntimeConfig({
      ...runtimeConfig,
      ollamaBaseUrl: nextOllamaUrl,
      dockerGuiConfig: nextDocker,
    });
  };

  const probeOllamaEndpoint = async (urlToProbe?: string) => {
    setIsProbing(true);
    try {
      const targetUrl = urlToProbe || runtimeConfig.ollamaBaseUrl;
      const res = await fetch('/api/ai/ollama-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ollamaBaseUrl: targetUrl }),
      });
      const data = await res.json();
      setOllamaStatus(data);
    } catch (err: any) {
      setOllamaStatus({
        connected: false,
        endpoint: urlToProbe || runtimeConfig.ollamaBaseUrl,
        models: ['qwen2.5:7b', 'deepseek-r1:8b', 'qwen2.5:32b', 'deepseek-r1:32b'],
        message: err?.message || 'Unable to reach Ollama status endpoint.',
      });
    } finally {
      setIsProbing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    probeOllamaEndpoint();
    void fetchIntegrationDeliveries();
    fetch('/api/docs/self-host-bundle')
      .then((r) => r.json())
      .then((data) => {
        if (data?.files) setBundleFiles(data.files);
      })
      .catch(() => {
        // Ignore bundle load error
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveGuiConfigToServer = async (alsoReverify = false) => {
    setServerSaveState({ saving: true, savedMessage: null });
    try {
      const res = await fetch('/api/ai/runtime-config-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeConfig }),
      });
      const data = await res.json();
      setServerSaveState({
        saving: false,
        savedMessage:
          data?.message ||
          'GUI configuration saved to browser localStorage & live server runtime.',
      });
      if (alsoReverify && onTriggerReverifyCouncil) {
        onTriggerReverifyCouncil();
      }
      setTimeout(() => {
        setServerSaveState((prev) => ({ ...prev, savedMessage: null }));
      }, 4500);
    } catch {
      setServerSaveState({
        saving: false,
        savedMessage: 'Saved to local workspace state.',
      });
    }
  };

  const handlePullModel = async (modelName: string) => {
    setPullStatus({
      loading: true,
      targetModel: modelName,
      message: `Requesting 'ollama pull ${modelName}' on ${runtimeConfig.ollamaBaseUrl}...`,
    });
    try {
      const res = await fetch('/api/ai/ollama-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollamaBaseUrl: runtimeConfig.ollamaBaseUrl,
          modelName,
        }),
      });
      const data = await res.json();
      setPullStatus({
        loading: false,
        targetModel: modelName,
        success: Boolean(data.success),
        message: data.message,
      });
      if (data.success) {
        probeOllamaEndpoint();
      }
    } catch (err: any) {
      setPullStatus({
        loading: false,
        targetModel: modelName,
        success: false,
        message: err?.message || `Failed to pull ${modelName}`,
      });
    }
  };

  const handleTestModel = async (modelName: string, phaseLabel: string) => {
    setBenchmarkResult({
      loading: true,
      phase: phaseLabel,
      modelName,
      message: `Running live JSON schema micro-benchmark on ${modelName}...`,
    });
    try {
      const res = await fetch('/api/ai/ollama-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollamaBaseUrl: runtimeConfig.ollamaBaseUrl,
          modelName,
          phase: phaseLabel,
        }),
      });
      const data = await res.json();
      setBenchmarkResult({
        loading: false,
        phase: phaseLabel,
        modelName,
        latencyMs: data.latencyMs,
        schemaVerified: data.schemaVerified,
        sampleOutput: data.sampleOutput,
        message: data.message,
      });
    } catch (err: any) {
      setBenchmarkResult({
        loading: false,
        phase: phaseLabel,
        modelName,
        message: err?.message || 'Benchmark request failed.',
      });
    }
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Dynamically generate .env, docker-compose, and launch commands from GUI inputs
  const customEnvContent = [
    '# ============================================================================',
    '# EconQuest — Generated from Interactive In-App GUI Configuration Studio',
    '# Save as .env in your project root alongside docker-compose.yml',
    '# ============================================================================',
    `PORT=${dockerGui.appPort}`,
    `DEFAULT_AI_PROVIDER=${runtimeConfig.providerMode}`,
    `OLLAMA_BASE_URL=${runtimeConfig.ollamaBaseUrl}`,
    `OLLAMA_QUICK_MODEL=${runtimeConfig.ollamaQuickModel}`,
    `OLLAMA_DEEP_MODEL=${runtimeConfig.ollamaDeepModel}`,
    `OLLAMA_KEEP_ALIVE=${dockerGui.keepAlive}`,
    `OLLAMA_ORIGINS=${dockerGui.corsOrigins}`,
    `OPENAI_COMPATIBLE_BASE_URL=${runtimeConfig.openAiBaseUrl}`,
    `OPENAI_COMPATIBLE_MODEL=${runtimeConfig.openAiModel}`,
    `LLM_TEMPERATURE=${runtimeConfig.temperature ?? 0.2}`,
    `LLM_NUM_CTX=${runtimeConfig.numCtx ?? 8192}`,
    `LLM_TIMEOUT_SECONDS=${runtimeConfig.timeoutSeconds ?? 20}`,
    ...(runtimeConfig.deskModelOverrides?.geopolitical
      ? [`DESK_MODEL_GEOPOLITICAL=${runtimeConfig.deskModelOverrides.geopolitical}`]
      : []),
    ...(runtimeConfig.deskModelOverrides?.sovereign
      ? [`DESK_MODEL_SOVEREIGN=${runtimeConfig.deskModelOverrides.sovereign}`]
      : []),
    ...(runtimeConfig.deskModelOverrides?.macro
      ? [`DESK_MODEL_MACRO=${runtimeConfig.deskModelOverrides.macro}`]
      : []),
    ...(runtimeConfig.deskModelOverrides?.supremeCouncil
      ? [`DESK_MODEL_SUPREME_COUNCIL=${runtimeConfig.deskModelOverrides.supremeCouncil}`]
      : []),
  ].join('\n');

  const profileFlag =
    dockerGui.topology === 'bundled_gpu'
      ? '--profile bundled-ollama-gpu '
      : dockerGui.topology === 'bundled_cpu'
      ? '--profile bundled-ollama '
      : '';

  const macOneLiner = `PORT=${dockerGui.appPort} OLLAMA_BASE_URL=${runtimeConfig.ollamaBaseUrl} OLLAMA_QUICK_MODEL=${runtimeConfig.ollamaQuickModel} OLLAMA_DEEP_MODEL=${runtimeConfig.ollamaDeepModel} bash ./scripts/start-mac.sh`;
  const winOneLiner = `$env:PORT="${dockerGui.appPort}"; $env:OLLAMA_BASE_URL="${runtimeConfig.ollamaBaseUrl}"; $env:OLLAMA_QUICK_MODEL="${runtimeConfig.ollamaQuickModel}"; $env:OLLAMA_DEEP_MODEL="${runtimeConfig.ollamaDeepModel}"; .\\scripts\\start-windows.ps1`;
  const composeUpOneLiner = `PORT=${dockerGui.appPort} DEFAULT_AI_PROVIDER=${runtimeConfig.providerMode} OLLAMA_BASE_URL=${runtimeConfig.ollamaBaseUrl} OLLAMA_QUICK_MODEL=${runtimeConfig.ollamaQuickModel} OLLAMA_DEEP_MODEL=${runtimeConfig.ollamaDeepModel} docker compose ${profileFlag}up -d --build`;

  const activeFileMeta: Record<
    typeof activeDockerFile,
    { filename: string; label: string; content: string }
  > = {
    envCustom: {
      filename: '.env',
      label: '.env (Live GUI-Generated Environment File)',
      content: customEnvContent,
    },
    dockerCompose: {
      filename: 'docker-compose.yml',
      label: 'docker-compose.yml (Host + Bundled Profiles)',
      content: bundleFiles?.dockerCompose || '# Loading docker-compose.yml...',
    },
    startMac: {
      filename: 'start-mac.sh',
      label: 'scripts/start-mac.sh (macOS Metal Launcher)',
      content: bundleFiles?.startMac || '# Loading scripts/start-mac.sh...',
    },
    startWindowsPs1: {
      filename: 'start-windows.ps1',
      label: 'scripts/start-windows.ps1 (Windows WSL2/GPU)',
      content: bundleFiles?.startWindowsPs1 || '# Loading scripts/start-windows.ps1...',
    },
    dockerfile: {
      filename: 'Dockerfile',
      label: 'Dockerfile (Multi-Stage ARM64/AMD64)',
      content: bundleFiles?.dockerfile || '# Loading Dockerfile...',
    },
  };

  const availableOllamaModelOptions = Array.from(
    new Set([
      ...(ollamaStatus?.models || []),
      ...RECOMMENDED_QUICK_MODELS.map((m) => m.id),
      ...RECOMMENDED_DEEP_MODELS.map((m) => m.id),
    ])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-6xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Interactive AI Runtime, 12-Agent Model Studio &amp; Docker Self-Host GUI Configurator
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Provider:{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {runtimeConfig.providerMode}
                </strong>{' '}
                · Phase 1–2: <strong>{runtimeConfig.ollamaQuickModel}</strong> · Phase 3:{' '}
                <strong>{runtimeConfig.ollamaDeepModel}</strong> · Temp:{' '}
                <strong>{(runtimeConfig.temperature ?? 0.2).toFixed(2)}</strong> · Ctx:{' '}
                <strong>{runtimeConfig.numCtx ?? 8192}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab('global_gui')}
                aria-pressed={activeTab === 'global_gui'}
                className="ui-pill"
              >
                1. Global Models &amp; Parameters GUI
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('agent_matrix_gui')}
                aria-pressed={activeTab === 'agent_matrix_gui'}
                className="ui-pill"
              >
                2. Per-Desk &amp; 12-Agent GUI Matrix
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('docker_builder_gui')}
                aria-pressed={activeTab === 'docker_builder_gui'}
                className="ui-pill"
              >
                3. Docker &amp; OS Self-Host GUI Builder
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('api_connectors_gui')}
                aria-pressed={activeTab === 'api_connectors_gui'}
                className="ui-pill"
              >
                4. External &amp; Internal APIs
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('top_level_integration_gui');
                  void fetchIntegrationDeliveries();
                }}
                aria-pressed={activeTab === 'top_level_integration_gui'}
                className="ui-pill"
              >
                5. Top-Level App Integration Bus
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* TAB 1: GLOBAL MODELS, ENDPOINTS & INFERENCE PARAMETERS GUI */}
          {activeTab === 'global_gui' && (
            <>
              {/* Step 1: AI Runtime Provider Selector */}
              <div className="border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/70 dark:bg-slate-950/60">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
                  Step 1 · Select Council Execution Runtime Provider (Click to Switch)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                  {[
                    {
                      id: 'ollama' as const,
                      title: 'Local Ollama Only',
                      desc: '100% self-hosted inference on Mac Metal or Windows GPU/CPU',
                    },
                    {
                      id: 'hybrid' as const,
                      title: 'Hybrid (Ollama → Gemini)',
                      desc: 'Tries Local Ollama first; fails over to Gemini if offline',
                    },
                    {
                      id: 'gemini' as const,
                      title: 'Cloud Google Gemini',
                      desc: 'Google Gemini gemini-3.8-flash with Search Grounding',
                    },
                    {
                      id: 'openai_compatible' as const,
                      title: 'vLLM / LM Studio',
                      desc: 'OpenAI-compatible /v1/chat/completions local server',
                    },
                  ].map((mode) => {
                    const isSelected = runtimeConfig.providerMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            providerMode: mode.id,
                          })
                        }
                        className={`text-left p-3 border transition-colors ${
                          isSelected
                            ? 'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-600 dark:border-emerald-500 text-slate-900 dark:text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold">{mode.title}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                          {mode.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Ollama & OpenAI-Compatible Endpoint GUI Inputs */}
              <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Step 2 · Local Server Endpoint URL &amp; Network Topology (GUI Input)
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Click a preset topology button or type any custom host/IP and port below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => probeOllamaEndpoint()}
                    disabled={isProbing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 border border-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                    <span>{isProbing ? 'Probing...' : 'Probe Ollama Endpoint'}</span>
                  </button>
                </div>

                {/* Preset Topology Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    {
                      url: 'http://localhost:11434',
                      label: 'Host Native (http://localhost:11434)',
                    },
                    {
                      url: 'http://host.docker.internal:11434',
                      label: 'Docker → Mac/Win Host Ollama (http://host.docker.internal:11434)',
                    },
                    {
                      url: 'http://ollama:11434',
                      label: 'Bundled Docker Container (http://ollama:11434)',
                    },
                  ].map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => {
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          ollamaBaseUrl: preset.url,
                        });
                        probeOllamaEndpoint(preset.url);
                      }}
                      aria-pressed={runtimeConfig.ollamaBaseUrl === preset.url}
                      className="ui-pill"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Ollama Base URL (Host or Docker Bridge)
                    </label>
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={runtimeConfig.ollamaBaseUrl}
                        onChange={(e) =>
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            ollamaBaseUrl: e.target.value,
                          })
                        }
                        placeholder="http://host.docker.internal:11434"
                        className="w-full px-3 py-1.5 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      vLLM / LM Studio Base URL (Optional)
                    </label>
                    <input
                      type="text"
                      value={runtimeConfig.openAiBaseUrl}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          openAiBaseUrl: e.target.value,
                        })
                      }
                      placeholder="http://localhost:8000/v1"
                      className="w-full px-3 py-1.5 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      vLLM / OpenAI-Compatible Model Name
                    </label>
                    <input
                      type="text"
                      value={runtimeConfig.openAiModel}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          openAiModel: e.target.value,
                        })
                      }
                      placeholder="Qwen/Qwen2.5-14B-Instruct"
                      className="w-full px-3 py-1.5 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                {ollamaStatus && (
                  <div
                    className={`p-3 border text-xs tabular-nums flex flex-wrap items-center justify-between gap-2 ${
                      ollamaStatus.connected
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    <span>
                      <strong>
                        {ollamaStatus.connected ? 'Connected to local Ollama' : 'Cloud preview or offline note'}:
                      </strong>{' '}
                      {ollamaStatus.message}
                    </span>
                    {ollamaStatus.models.length > 0 && (
                      <span className="text-xs">
                        Models: {ollamaStatus.models.slice(0, 5).join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Per-Phase Agent Model Assignment + In-App Pull & Test */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Phase 1 & 2 Sub-Agents Model Card */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                      Phase 1 &amp; 2 Default · 9 Sub-Agents &amp; Desk Debate Model
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Powers AG-1 to AG-9 parallel desk workers, Devil&apos;s Advocate debates, and
                      Stage 2 Contagion Cascade (unless overridden per-desk/per-agent in Tab 2).
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Select Preset or Enter Any Ollama Tag:
                    </label>
                    <select
                      value={
                        RECOMMENDED_QUICK_MODELS.some((m) => m.id === runtimeConfig.ollamaQuickModel)
                          ? runtimeConfig.ollamaQuickModel
                          : 'custom'
                      }
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            ollamaQuickModel: e.target.value,
                          });
                        }
                      }}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white mb-2"
                    >
                      {RECOMMENDED_QUICK_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value="custom">Custom Ollama Model Tag (Enter Below)...</option>
                    </select>
                    <input
                      type="text"
                      value={runtimeConfig.ollamaQuickModel}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          ollamaQuickModel: e.target.value,
                        })
                      }
                      placeholder="e.g. qwen2.5:7b or llama3.1:8b"
                      className="w-full px-2.5 py-1.5 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handlePullModel(runtimeConfig.ollamaQuickModel)}
                      disabled={pullStatus.loading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Pull {runtimeConfig.ollamaQuickModel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleTestModel(runtimeConfig.ollamaQuickModel, 'PHASE_1_2_SUB_AGENTS')
                      }
                      disabled={benchmarkResult.loading}
                      className="ui-btn ui-btn-primary flex-1 inline-flex justify-center"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Test Sub-Agent JSON</span>
                    </button>
                  </div>
                </div>

                {/* Phase 3 Supreme Council Referees Model Card */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Phase 3 Default · 3 Supreme Council Referees Model
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Powers post-CRO Supreme Council synthesis (SMCR-1.0 Verdict) &amp; Policy
                      Document NLP. Automatically strips <code className="tabular-nums">&lt;think&gt;</code>{' '}
                      blocks from DeepSeek-R1 / QwQ.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Select Reasoning Preset or Enter Any Ollama Tag:
                    </label>
                    <select
                      value={
                        RECOMMENDED_DEEP_MODELS.some((m) => m.id === runtimeConfig.ollamaDeepModel)
                          ? runtimeConfig.ollamaDeepModel
                          : 'custom'
                      }
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            ollamaDeepModel: e.target.value,
                          });
                        }
                      }}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white mb-2"
                    >
                      {RECOMMENDED_DEEP_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value="custom">Custom Reasoning Model Tag (Enter Below)...</option>
                    </select>
                    <input
                      type="text"
                      value={runtimeConfig.ollamaDeepModel}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          ollamaDeepModel: e.target.value,
                        })
                      }
                      placeholder="e.g. deepseek-r1:8b or deepseek-r1:32b"
                      className="w-full px-2.5 py-1.5 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handlePullModel(runtimeConfig.ollamaDeepModel)}
                      disabled={pullStatus.loading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Pull {runtimeConfig.ollamaDeepModel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleTestModel(runtimeConfig.ollamaDeepModel, 'PHASE_3_SUPREME_COUNCIL')
                      }
                      disabled={benchmarkResult.loading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Test Reasoning JSON</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 4: Interactive GUI Sliders & Controls for Inference Parameters */}
              <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Step 4 · LLM Inference Hyperparameters &amp; Council Debate Controls (GUI Inputs)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                  {/* Temperature */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Temperature
                      </span>
                      <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        {(runtimeConfig.temperature ?? 0.2).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={runtimeConfig.temperature ?? 0.2}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          temperature: Number(e.target.value),
                        })
                      }
                      className="w-full accent-emerald-600"
                    />
                    <span className="text-xs text-slate-500 block mt-1">
                      0.1–0.3 recommended for deterministic JSON
                    </span>
                  </div>

                  {/* Context Window num_ctx */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Context Window (<code className="tabular-nums">num_ctx</code>)
                    </label>
                    <select
                      value={runtimeConfig.numCtx ?? 8192}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          numCtx: Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value={2048}>2,048 tokens (Low VRAM)</option>
                      <option value={4096}>4,096 tokens (Standard)</option>
                      <option value={8192}>8,192 tokens (Recommended)</option>
                      <option value={16384}>16,384 tokens (Long Policy Docs)</option>
                      <option value={32768}>32,768 tokens (32GB+ Unified RAM)</option>
                    </select>
                    <span className="text-xs text-slate-500 block mt-1">
                      Ollama context buffer per desk call
                    </span>
                  </div>

                  {/* Step Timeout */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Request Timeout (sec)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      step={5}
                      value={runtimeConfig.timeoutSeconds ?? 20}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          timeoutSeconds: Math.max(5, Math.min(180, Number(e.target.value))),
                        })
                      }
                      className="w-full px-2 py-1 tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                    <span className="text-xs text-slate-500 block mt-1">
                      Increase to 45–90s for 32B reasoning models
                    </span>
                  </div>

                  {/* Max Debate Rounds */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Devil&apos;s Advocate Rounds
                    </label>
                    <select
                      value={runtimeConfig.maxDebateRounds || 2}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          maxDebateRounds: Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value={1}>1 Round (Fast Synthesis)</option>
                      <option value={2}>2 Rounds (Standard Institutional)</option>
                      <option value={3}>3 Rounds (Deep Cross-Examination)</option>
                    </select>
                    <span className="text-xs text-slate-500 block mt-1">
                      Adversarial rounds per desk
                    </span>
                  </div>

                  {/* Search Grounding & Webhook */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Web Search Grounding
                      </span>
                      <input
                        type="checkbox"
                        checked={runtimeConfig.enableSearchGrounding}
                        onChange={(e) =>
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            enableSearchGrounding: e.target.checked,
                          })
                        }
                        className="accent-emerald-600 w-4 h-4"
                      />
                    </label>
                    <input
                      type="text"
                      value={runtimeConfig.webhookTargetUrl}
                      onChange={(e) =>
                        onUpdateRuntimeConfig({
                          ...runtimeConfig,
                          webhookTargetUrl: e.target.value,
                        })
                      }
                      placeholder="Optional Webhook URL..."
                      className="w-full mt-2 px-2 py-1 text-xs tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: PER-DESK & 12-AGENT INDIVIDUAL MODEL & SYSTEM PROMPT MATRIX GUI */}
          {activeTab === 'agent_matrix_gui' && (
            <div className="space-y-5">
              {/* Top Action Bar for Agent Matrix */}
              <div className="border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Individual Desk &amp; Specialist Agent Model / Prompt GUI Assignment
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Enter or select a specific Ollama/LLM model tag and custom analytical instruction
                    for any Desk or Individual Sub-Agent (<code className="tabular-nums">AG-1</code> to{' '}
                    <code className="tabular-nums">AG-9</code>). Leave blank to inherit the Phase 1–2
                    default (<code className="tabular-nums">{runtimeConfig.ollamaQuickModel}</code>).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextAgents: Partial<Record<SubAgentId, string>> = {};
                      SUB_AGENT_GUI_CATALOG.forEach((ag) => {
                        nextAgents[ag.id] = runtimeConfig.ollamaQuickModel;
                      });
                      onUpdateRuntimeConfig({
                        ...runtimeConfig,
                        deskModelOverrides: {
                          geopolitical: runtimeConfig.ollamaQuickModel,
                          sovereign: runtimeConfig.ollamaQuickModel,
                          macro: runtimeConfig.ollamaQuickModel,
                          supremeCouncil: runtimeConfig.ollamaDeepModel,
                        },
                        agentModelOverrides: nextAgents,
                      });
                    }}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    Fill All 9 Agents with {runtimeConfig.ollamaQuickModel}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRuntimeConfig({
                        ...runtimeConfig,
                        deskModelOverrides: {},
                        agentModelOverrides: {},
                        agentPromptOverrides: {},
                      })
                    }
                    className="ui-btn"
                  >
                    Clear Custom Agent Overrides
                  </button>
                </div>
              </div>

              {/* 4 Desk-Level Model Override Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  {
                    key: 'geopolitical' as const,
                    title: 'Geopolitical Desk (AG-1..3)',
                    fallback: runtimeConfig.ollamaQuickModel,
                  },
                  {
                    key: 'sovereign' as const,
                    title: 'Sovereign Credit Desk (AG-4..6)',
                    fallback: runtimeConfig.ollamaQuickModel,
                  },
                  {
                    key: 'macro' as const,
                    title: 'Macroeconomic Desk (AG-7..9)',
                    fallback: runtimeConfig.ollamaQuickModel,
                  },
                  {
                    key: 'supremeCouncil' as const,
                    title: '3 Supreme Council Referees',
                    fallback: runtimeConfig.ollamaDeepModel,
                  },
                ].map((desk) => {
                  const currentVal = runtimeConfig.deskModelOverrides?.[desk.key] || '';
                  return (
                    <div
                      key={desk.key}
                      className="p-3.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
                    >
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        {desk.title}
                      </div>
                      <select
                        value={
                          availableOllamaModelOptions.includes(currentVal) ? currentVal : ''
                        }
                        onChange={(e) => {
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            deskModelOverrides: {
                              ...(runtimeConfig.deskModelOverrides || {}),
                              [desk.key]: e.target.value,
                            },
                          });
                        }}
                        className="w-full px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                      >
                        <option value="">Inherit Default ({desk.fallback})</option>
                        {availableOllamaModelOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={currentVal}
                        onChange={(e) =>
                          onUpdateRuntimeConfig({
                            ...runtimeConfig,
                            deskModelOverrides: {
                              ...(runtimeConfig.deskModelOverrides || {}),
                              [desk.key]: e.target.value,
                            },
                          })
                        }
                        placeholder={`Default: ${desk.fallback}`}
                        className="w-full px-2.5 py-1 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      />
                    </div>
                  );
                })}
              </div>

              {/* 9 Specialist Sub-Agents Individual GUI Table */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      <th className="py-2.5 px-3 font-semibold">Agent</th>
                      <th className="py-2.5 px-3 font-semibold">Specialist Role &amp; Desk</th>
                      <th className="py-2.5 px-3 font-semibold">Assigned Ollama / LLM Model Tag (GUI)</th>
                      <th className="py-2.5 px-3 font-semibold">
                        Custom System Prompt / Focus Directive Override (GUI)
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {SUB_AGENT_GUI_CATALOG.map((ag) => {
                      const agentModelVal = runtimeConfig.agentModelOverrides?.[ag.id] || '';
                      const effectiveModel =
                        agentModelVal ||
                        runtimeConfig.deskModelOverrides?.[ag.deskKey] ||
                        runtimeConfig.ollamaQuickModel;
                      const agentPromptVal = runtimeConfig.agentPromptOverrides?.[ag.id] || '';

                      return (
                        <tr key={ag.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40">
                          <td className="py-2.5 px-3 tabular-nums font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                            {ag.code}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{ag.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {ag.deskLabel} · {ag.defaultRoleHint}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 min-w-[220px]">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                list={`agent-models-${ag.id}`}
                                value={agentModelVal}
                                onChange={(e) =>
                                  onUpdateRuntimeConfig({
                                    ...runtimeConfig,
                                    agentModelOverrides: {
                                      ...(runtimeConfig.agentModelOverrides || {}),
                                      [ag.id]: e.target.value,
                                    },
                                  })
                                }
                                placeholder={`Default: ${effectiveModel}`}
                                className="w-full px-2.5 py-1 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                              />
                              <datalist id={`agent-models-${ag.id}`}>
                                {availableOllamaModelOptions.map((m) => (
                                  <option key={m} value={m} />
                                ))}
                              </datalist>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 min-w-[260px]">
                            <input
                              type="text"
                              value={agentPromptVal}
                              onChange={(e) =>
                                onUpdateRuntimeConfig({
                                  ...runtimeConfig,
                                  agentPromptOverrides: {
                                    ...(runtimeConfig.agentPromptOverrides || {}),
                                    [ag.id]: e.target.value,
                                  },
                                })
                              }
                              placeholder={`Optional custom directive for ${ag.code}...`}
                              className="w-full px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handlePullModel(effectiveModel)}
                                disabled={pullStatus.loading}
                                className="px-2 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                              >
                                Pull
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTestModel(effectiveModel, ag.code)}
                                disabled={benchmarkResult.loading}
                                className="ui-btn ui-btn-primary"
                              >
                                Test
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: INTERACTIVE DOCKER & SELF-HOST GUI BUILDER (macOS & Windows) */}
          {activeTab === 'docker_builder_gui' && (
            <div className="space-y-4">
              {/* Interactive Docker Environment GUI Form */}
              <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Interactive Docker &amp; Self-Host Environment GUI Form Builder
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Enter your preferred operating system, container topology, ports, and Ollama
                    daemon settings below. All launch commands and downloadable{' '}
                    <code className="tabular-nums">.env</code> /{' '}
                    <code className="tabular-nums">docker-compose.yml</code> files update automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  {/* Target OS */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Target Host Operating System
                    </label>
                    <select
                      value={dockerGui.targetOs}
                      onChange={(e) => {
                        const os = e.target.value as DockerSelfHostGuiConfig['targetOs'];
                        updateDockerGui({
                          targetOs: os,
                          topology:
                            os === 'mac_apple_silicon'
                              ? 'host_ollama'
                              : os === 'windows_nvidia'
                              ? 'bundled_gpu'
                              : dockerGui.topology,
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value="mac_apple_silicon">macOS Apple Silicon (M1–M4 Metal GPU)</option>
                      <option value="mac_intel">macOS Intel (x86_64)</option>
                      <option value="windows_nvidia">Windows 10/11 WSL2 (NVIDIA GPU)</option>
                      <option value="windows_cpu">Windows 10/11 (CPU / Host Ollama)</option>
                      <option value="linux">Linux Server / Workstation</option>
                    </select>
                  </div>

                  {/* Container Topology */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Docker ↔ Ollama Topology
                    </label>
                    <select
                      value={dockerGui.topology}
                      onChange={(e) =>
                        updateDockerGui({
                          topology: e.target.value as DockerSelfHostGuiConfig['topology'],
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value="host_ollama">
                        Host Native Ollama Bridge (host.docker.internal)
                      </option>
                      <option value="bundled_cpu">
                        Bundled Docker Container (--profile bundled-ollama)
                      </option>
                      <option value="bundled_gpu">
                        Bundled NVIDIA GPU Container (--profile bundled-ollama-gpu)
                      </option>
                    </select>
                  </div>

                  {/* Web App Port */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      EconQuest Web App Port (<code className="tabular-nums">PORT</code>)
                    </label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={dockerGui.appPort}
                      onChange={(e) =>
                        updateDockerGui({ appPort: Number(e.target.value) || 3000 })
                      }
                      className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Ollama Port */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Ollama Service Port
                    </label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={dockerGui.ollamaPort}
                      onChange={(e) =>
                        updateDockerGui({ ollamaPort: Number(e.target.value) || 11434 })
                      }
                      className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Container Name */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Docker Container Name
                    </label>
                    <input
                      type="text"
                      value={dockerGui.containerName}
                      onChange={(e) => updateDockerGui({ containerName: e.target.value })}
                      className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Model Keep-Alive */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Ollama Model Keep-Alive (<code className="tabular-nums">OLLAMA_KEEP_ALIVE</code>)
                    </label>
                    <select
                      value={dockerGui.keepAlive}
                      onChange={(e) => updateDockerGui({ keepAlive: e.target.value })}
                      className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    >
                      <option value="24h">24h (Keep Warm All Day)</option>
                      <option value="4h">4h (Trading Session)</option>
                      <option value="30m">30m (Balanced VRAM)</option>
                      <option value="5m">5m (Aggressive Unload)</option>
                      <option value="-1">-1 (Never Unload from VRAM)</option>
                    </select>
                  </div>

                  {/* CORS Allowed Origins */}
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      CORS Origins (<code className="tabular-nums">OLLAMA_ORIGINS</code>)
                    </label>
                    <input
                      type="text"
                      value={dockerGui.corsOrigins}
                      onChange={(e) => updateDockerGui({ corsOrigins: e.target.value })}
                      className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Auto-Pull Toggle */}
                  <div className="flex flex-col justify-center p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Auto-Pull Models on Boot
                      </span>
                      <input
                        type="checkbox"
                        checked={dockerGui.autoPullOnBoot}
                        onChange={(e) => updateDockerGui({ autoPullOnBoot: e.target.checked })}
                        className="accent-emerald-600 w-4 h-4"
                      />
                    </label>
                    <span className="text-xs text-slate-500 mt-1">
                      Automatically pulls {runtimeConfig.ollamaQuickModel} &amp;{' '}
                      {runtimeConfig.ollamaDeepModel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Quick-Start OS Cards generated from GUI state */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* macOS Card */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    macOS Launcher (Apple Silicon &amp; Intel)
                  </div>
                  <div className="p-2 bg-slate-950 text-emerald-300 tabular-nums text-xs overflow-x-auto">
                    {macOneLiner}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('mac-cmd', macOneLiner)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                  >
                    {copiedKey === 'mac-cmd' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === 'mac-cmd' ? 'Copied!' : 'Copy Mac Command'}</span>
                  </button>
                </div>

                {/* Windows Card */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Windows 10/11 PowerShell Launcher
                  </div>
                  <div className="p-2 bg-slate-950 text-blue-300 tabular-nums text-xs overflow-x-auto">
                    {winOneLiner}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('win-cmd', winOneLiner)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                  >
                    {copiedKey === 'win-cmd' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === 'win-cmd' ? 'Copied!' : 'Copy PowerShell Cmd'}</span>
                  </button>
                </div>

                {/* Docker Compose Direct Command */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Direct Docker Compose Command
                  </div>
                  <div className="p-2 bg-slate-950 text-amber-300 tabular-nums text-xs overflow-x-auto">
                    {composeUpOneLiner}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('compose-cmd', composeUpOneLiner)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                  >
                    {copiedKey === 'compose-cmd' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === 'compose-cmd' ? 'Copied!' : 'Copy Compose Cmd'}</span>
                  </button>
                </div>
              </div>

              {/* File Viewer & Downloader */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      Object.keys(activeFileMeta) as Array<keyof typeof activeFileMeta>
                    ).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveDockerFile(key)}
                        aria-pressed={activeDockerFile === key}
                        className="ui-pill"
                      >
                        {activeFileMeta[key].filename}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          activeDockerFile,
                          activeFileMeta[activeDockerFile].content
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                    >
                      {copiedKey === activeDockerFile ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Copy File</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadFile(
                          activeFileMeta[activeDockerFile].filename,
                          activeFileMeta[activeDockerFile].content
                        )
                      }
                      className="ui-btn ui-btn-primary inline-flex"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download {activeFileMeta[activeDockerFile].filename}</span>
                    </button>
                  </div>
                </div>
                <pre className="p-4 text-xs tabular-nums leading-relaxed text-slate-800 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-950/60 overflow-x-auto max-h-64 select-text">
                  {activeFileMeta[activeDockerFile].content}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: EXTERNAL & INTERNAL API / HOST GUI CONNECTOR HUB */}
          {activeTab === 'api_connectors_gui' && (() => {
            const filteredConnectors = apiConnectors.filter(
              (c) => connectorCategoryFilter === 'ALL' || c.category === connectorCategoryFilter
            );
            const selectedConnector =
              apiConnectors.find((c) => c.id === selectedConnectorId) || apiConnectors[0];

            const updateSelectedConnector = (patch: Partial<ExternalInternalConnectorConfig>) => {
              if (!selectedConnector) return;
              const nextList = apiConnectors.map((c) =>
                c.id === selectedConnector.id ? { ...c, ...patch } : c
              );
              onUpdateRuntimeConfig({
                ...runtimeConfig,
                apiConnectors: nextList,
              });
            };

            const handleAddConnector = () => {
              const newId = `conn-custom-${Date.now().toString().slice(-5)}`;
              const newConn: ExternalInternalConnectorConfig = {
                id: newId,
                name: 'Custom Internal / External REST Host',
                category: 'macro_rest',
                networkScope: 'internal_host',
                url: 'http://host.docker.internal:8080/api/v1/sovereign/{{ISO3}}',
                method: 'GET',
                headers: { Accept: 'application/json' },
                enabled: true,
                timeoutMs: 4000,
                telemetryMappings: {
                  gdpGrowth: 'telemetry.gdpGrowthPct',
                  cpiInflation: 'telemetry.cpiInflationPct',
                  debtToGdp: 'telemetry.debtToGdpPct',
                  cds5yBps: 'telemetry.cds5ySpreadBps',
                },
                injectIntoCouncilPrompt: true,
                lastStatus: 'untested',
              };
              onUpdateRuntimeConfig({
                ...runtimeConfig,
                apiConnectors: [...apiConnectors, newConn],
              });
              setSelectedConnectorId(newId);
            };

            const handleDeleteConnector = (idToDelete: string) => {
              if (apiConnectors.length <= 1) return;
              const nextList = apiConnectors.filter((c) => c.id !== idToDelete);
              onUpdateRuntimeConfig({
                ...runtimeConfig,
                apiConnectors: nextList,
              });
              if (selectedConnectorId === idToDelete && nextList[0]) {
                setSelectedConnectorId(nextList[0].id);
              }
            };

            const handlePingAndInspectConnector = async (conn: ExternalInternalConnectorConfig) => {
              setConnectorPingState({
                loading: true,
                connectorId: conn.id,
                message: `Pinging ${conn.url} via backend proxy for ISO-3=${sampleTestIso3}...`,
              });
              try {
                const res = await fetch('/api/connectors/ping-and-inspect', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    connector: conn,
                    sampleIso3: sampleTestIso3,
                  }),
                });
                const data = await res.json();
                setConnectorPingState({
                  loading: false,
                  connectorId: conn.id,
                  ok: Boolean(data.ok),
                  status: data.status,
                  statusText: data.statusText,
                  resolvedUrl: data.resolvedUrl,
                  latencyMs: data.latencyMs,
                  testedAt: data.testedAt,
                  isSimulatedPreview: data.isSimulatedPreview,
                  extractedTelemetry: data.extractedTelemetry,
                  jsonPreview: data.jsonPreview,
                  message: data.message,
                });
                const nextList = apiConnectors.map((c) =>
                  c.id === conn.id
                    ? {
                        ...c,
                        lastStatus: (data.ok ? 'ok' : 'error') as
                          | 'ok'
                          | 'error',
                        lastLatencyMs: data.latencyMs,
                        lastTestedAt: data.testedAt,
                      }
                    : c
                );
                onUpdateRuntimeConfig({
                  ...runtimeConfig,
                  apiConnectors: nextList,
                });
              } catch (err: any) {
                setConnectorPingState({
                  loading: false,
                  connectorId: conn.id,
                  ok: false,
                  message: err?.message || 'Ping request failed.',
                });
              }
            };

            return (
              <div className="space-y-4">
                {/* Top Summary & Filter Bar */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      External &amp; Internal API / Host GUI Connector Hub (Server-Proxied)
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Connect internal enterprise hosts (<code className="tabular-nums">host.docker.internal</code>, intranet IPs), external REST macro feeds, LLM gateways, and outbound risk webhooks. Test live JSON responses and map JSON dot-paths directly into sovereign indicators.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 text-xs">
                      {[
                        { id: 'ALL' as const, label: 'All Connectors' },
                        { id: 'macro_rest' as const, label: 'Macro & Data REST' },
                        { id: 'llm_gateway' as const, label: 'LLM Gateways' },
                        { id: 'webhook_bus' as const, label: 'Webhooks & Event Bus' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setConnectorCategoryFilter(tab.id)}
                          aria-pressed={connectorCategoryFilter === tab.id}
                          className="ui-pill"
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddConnector}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add API / Internal Host</span>
                    </button>
                  </div>
                </div>

                {/* Master-Detail Split Grid: Left Directory + Right Interactive Editor & JSON Inspector */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left Column (4 cols): Registered Connectors List */}
                  <div className="lg:col-span-4 space-y-2">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                      Registered APIs &amp; Internal Hosts ({filteredConnectors.length})
                    </div>
                    <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                      {filteredConnectors.map((conn) => {
                        const isSelected = selectedConnector?.id === conn.id;
                        return (
                          <div
                            key={conn.id}
                            onClick={() => setSelectedConnectorId(conn.id)}
                            className={`p-3 border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-600 dark:border-blue-500'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                                {conn.name}
                              </div>
                              <input
                                type="checkbox"
                                checked={conn.enabled}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const nextList = apiConnectors.map((c) =>
                                    c.id === conn.id ? { ...c, enabled: e.target.checked } : c
                                  );
                                  onUpdateRuntimeConfig({
                                    ...runtimeConfig,
                                    apiConnectors: nextList,
                                  });
                                }}
                                title="Enable / Disable Connector"
                                className="accent-emerald-600 w-3.5 h-3.5 mt-0.5 shrink-0"
                              />
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                              <span>{conn.method}</span>
                              <span>·</span>
                              <span
                                className={
                                  conn.networkScope === 'internal_host'
                                    ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                    : 'text-blue-600 dark:text-blue-400 font-semibold'
                                }
                              >
                                {conn.networkScope === 'internal_host' ? 'Internal host' : 'External API'}
                              </span>
                              <span>·</span>
                              <span>
                                {conn.category === 'macro_rest'
                                  ? 'Macro REST'
                                  : conn.category === 'llm_gateway'
                                  ? 'LLM Gateway'
                                  : 'Webhook Bus'}
                              </span>
                              {typeof conn.lastLatencyMs === 'number' && (
                                <>
                                  <span>·</span>
                                  <span className="tabular-nums">{conn.lastLatencyMs}ms</span>
                                </>
                              )}
                            </div>
                            <div className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400 truncate">
                              {conn.url}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column (8 cols): Selected Connector GUI Editor + Live Ping Tester + JSON Mapper */}
                  {selectedConnector && (
                    <div className="lg:col-span-8 space-y-4">
                      {/* Card 1: Endpoint Configuration & Custom Headers */}
                      <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            Connector Configuration · {selectedConnector.name}
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedConnector.enabled}
                                onChange={(e) =>
                                  updateSelectedConnector({ enabled: e.target.checked })
                                }
                                className="accent-emerald-600 w-3.5 h-3.5"
                              />
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                Enabled
                              </span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedConnector.injectIntoCouncilPrompt)}
                                onChange={(e) =>
                                  updateSelectedConnector({
                                    injectIntoCouncilPrompt: e.target.checked,
                                  })
                                }
                                className="accent-blue-600 w-3.5 h-3.5"
                              />
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                Inject into 9-Agent Council Context
                              </span>
                            </label>
                            {apiConnectors.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteConnector(selectedConnector.id)}
                                className="px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Connector Display Name
                            </label>
                            <input
                              type="text"
                              value={selectedConnector.name}
                              onChange={(e) => updateSelectedConnector({ name: e.target.value })}
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Connector Category
                            </label>
                            <select
                              value={selectedConnector.category}
                              onChange={(e) =>
                                updateSelectedConnector({
                                  category: e.target.value as ExternalInternalConnectorConfig['category'],
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            >
                              <option value="macro_rest">Macro / Market REST Feed</option>
                              <option value="llm_gateway">Internal / External LLM Gateway</option>
                              <option value="webhook_bus">Outbound Webhook / Risk Bus</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Network Scope
                            </label>
                            <select
                              value={selectedConnector.networkScope}
                              onChange={(e) =>
                                updateSelectedConnector({
                                  networkScope: e.target.value as ExternalInternalConnectorConfig['networkScope'],
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            >
                              <option value="external">External Public API</option>
                              <option value="internal_host">Internal Host / Docker LAN</option>
                            </select>
                          </div>
                        </div>

                        {/* Method + URL + Timeout */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              HTTP Method
                            </label>
                            <select
                              value={selectedConnector.method}
                              onChange={(e) =>
                                updateSelectedConnector({
                                  method: e.target.value as 'GET' | 'POST',
                                })
                              }
                              className="w-full px-2.5 py-1.5 tabular-nums font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                            </select>
                          </div>

                          <div className="sm:col-span-8">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Endpoint URL (Supports <code className="tabular-nums">{'{{ISO3}}'}</code> &amp;{' '}
                              <code className="tabular-nums">{'{{ISO2}}'}</code> Variables)
                            </label>
                            <input
                              type="text"
                              value={selectedConnector.url}
                              onChange={(e) => updateSelectedConnector({ url: e.target.value })}
                              placeholder="http://host.docker.internal:8080/api/v1/sovereign/{{ISO3}}"
                              className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Timeout (ms)
                            </label>
                            <input
                              type="number"
                              min={1000}
                              max={15000}
                              step={500}
                              value={selectedConnector.timeoutMs || 4000}
                              onChange={(e) =>
                                updateSelectedConnector({
                                  timeoutMs: Math.max(1000, Math.min(15000, Number(e.target.value))),
                                })
                              }
                              className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>

                        {/* Custom HTTP Headers Key-Value Builder */}
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Custom HTTP Request Headers (Proxied Server-Side)
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(selectedConnector.headers || {}).map(([hKey, hVal]) => (
                              <div
                                key={hKey}
                                className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 tabular-nums text-xs"
                              >
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {hKey}:
                                </span>
                                <span className="text-slate-600 dark:text-slate-400">{hVal}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextHeaders = { ...(selectedConnector.headers || {}) };
                                    delete nextHeaders[hKey];
                                    updateSelectedConnector({ headers: nextHeaders });
                                  }}
                                  className="text-slate-400 hover:text-rose-600"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={newHeaderKey}
                              onChange={(e) => setNewHeaderKey(e.target.value)}
                              placeholder="Header Name (e.g. X-Internal-Service)"
                              className="px-2.5 py-1 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                            <input
                              type="text"
                              value={newHeaderVal}
                              onChange={(e) => setNewHeaderVal(e.target.value)}
                              placeholder="Header Value"
                              className="px-2.5 py-1 text-xs tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (!newHeaderKey.trim()) return;
                                updateSelectedConnector({
                                  headers: {
                                    ...(selectedConnector.headers || {}),
                                    [newHeaderKey.trim()]: newHeaderVal,
                                  },
                                });
                                setNewHeaderKey('');
                                setNewHeaderVal('');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200"
                            >
                              + Add Header
                            </button>
                          </div>
                        </div>

                        {selectedConnector.method === 'POST' && (
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              POST JSON Body Template (Supports <code className="tabular-nums">{'{{ISO3}}'}</code>)
                            </label>
                            <textarea
                              rows={2}
                              value={selectedConnector.bodyTemplate || ''}
                              onChange={(e) =>
                                updateSelectedConnector({ bodyTemplate: e.target.value })
                              }
                              className="w-full px-2.5 py-1.5 tabular-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            />
                          </div>
                        )}
                      </div>

                      {/* Card 2: JSON Dot-Path to Sovereign Telemetry Mapper */}
                      {selectedConnector.category === 'macro_rest' && (
                        <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white">
                                Visual JSON Dot-Path to Sovereign Telemetry Mapper
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Map JSON response dot-paths (e.g. <code className="tabular-nums">1.0.value</code> or{' '}
                                <code className="tabular-nums">telemetry.gdpGrowthPct</code>) into live sovereign indicators.
                              </p>
                            </div>
                            {connectorPingState.connectorId === selectedConnector.id &&
                              connectorPingState.extractedTelemetry &&
                              Object.keys(connectorPingState.extractedTelemetry).length > 0 &&
                              onApplyConnectorTelemetryToActiveSovereign && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onApplyConnectorTelemetryToActiveSovereign(
                                      selectedConnector.name,
                                      connectorPingState.extractedTelemetry || {}
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Apply Mapped Values to Active Sovereign ({activeIso3})</span>
                                </button>
                              )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {TELEMETRY_MAPPING_FIELDS.map((field) => {
                              const currentPath =
                                selectedConnector.telemetryMappings?.[field.key] || '';
                              const liveExtractedVal =
                                connectorPingState.connectorId === selectedConnector.id
                                  ? connectorPingState.extractedTelemetry?.[field.key]
                                  : undefined;

                              return (
                                <div
                                  key={field.key}
                                  className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                                      {field.label} ({field.unit})
                                    </span>
                                    {typeof liveExtractedVal === 'number' && (
                                      <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                                        Extracted: {liveExtractedVal}
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    value={currentPath}
                                    onChange={(e) =>
                                      updateSelectedConnector({
                                        telemetryMappings: {
                                          ...(selectedConnector.telemetryMappings || {}),
                                          [field.key]: e.target.value,
                                        },
                                      })
                                    }
                                    placeholder={field.placeholder}
                                    className="w-full px-2 py-1 tabular-nums text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Card 3: Live Server-Proxied Ping Tester & JSON Response Inspector */}
                      <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">
                              Live Endpoint Ping Tester &amp; JSON Response Inspector
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Executes request via backend proxy (<code className="tabular-nums">POST /api/connectors/ping-and-inspect</code>) and evaluates all mapped JSON paths.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={sampleTestIso3}
                              onChange={(e) => setSampleTestIso3(e.target.value)}
                              className="px-2.5 py-1.5 tabular-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                            >
                              {['BRA', 'USA', 'JPN', 'DEU', 'GBR', 'TUR', 'EGY', 'ZAF', 'IND', 'ARG'].map(
                                (iso) => (
                                  <option key={iso} value={iso}>
                                    Test ISO-3: {iso}
                                  </option>
                                )
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={() => handlePingAndInspectConnector(selectedConnector)}
                              disabled={connectorPingState.loading}
                              className="ui-btn ui-btn-primary inline-flex"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>
                                {connectorPingState.loading
                                  ? 'Pinging Endpoint...'
                                  : 'Ping & Inspect Live JSON'}
                              </span>
                            </button>
                          </div>
                        </div>

                        {connectorPingState.connectorId === selectedConnector.id &&
                          connectorPingState.message && (
                            <div className="space-y-2">
                              <div
                                className={`p-3 border tabular-nums text-xs flex flex-wrap items-center justify-between gap-2 ${
                                  connectorPingState.ok
                                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                                    : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                                }`}
                              >
                                <span>{connectorPingState.message}</span>
                                {typeof connectorPingState.latencyMs === 'number' && (
                                  <span className="tabular-nums font-semibold">
                                    Latency: {connectorPingState.latencyMs}ms
                                  </span>
                                )}
                              </div>

                              {connectorPingState.jsonPreview && (
                                <pre className="p-3 tabular-nums text-xs leading-relaxed bg-slate-950 text-emerald-300 overflow-x-auto max-h-56 select-text">
                                  {JSON.stringify(connectorPingState.jsonPreview, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB 5: TOP-LEVEL EXTERNAL APPLICATION INTEGRATION BUS (REST PULL + WEBHOOK PUSH + SSE STREAM + OPENAPI 3.1) */}
          {activeTab === 'top_level_integration_gui' && (() => {
            const originUrl =
              typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
            const curlSnippet = `# 1. Pull Granular Geopolitical Desk Output + 3 Sub-Agents + Chokepoint Quant Suite
curl -s "${originUrl}/api/v1/integration/desks/${activeIso3}?desk=geopolitical&includeSubAgents=true&includeQuant=true" \\
  -H "Accept: application/json" \\
  -H "X-SMCR-API-Key: ${integrationCfg.apiKey}" | jq .

# 2. Pull Complete SMCR-1.0 Sovereign Assessment Bundle (All 3 Desks + CRO Gate + Supreme Council)
curl -s "${originUrl}/api/v1/integration/bundle/${activeIso3}" \\
  -H "X-SMCR-API-Key: ${integrationCfg.apiKey}" | jq .`;

            const pythonSnippet = `import hmac, hashlib, requests

BASE_URL = "${originUrl}"
API_KEY = "${integrationCfg.apiKey}"
HMAC_SECRET = "${integrationCfg.webhookHmacSecret}"

# Pull Sovereign Credit Desk Output (Agents 4-6 + IMF SRDSF DSA & Restructuring NPV)
resp = requests.get(
    f"{BASE_URL}/api/v1/integration/desks/${activeIso3}",
    params={"desk": "sovereign", "includeSubAgents": "true", "includeQuant": "true"},
    headers={"X-SMCR-API-Key": API_KEY},
    timeout=10,
)
payload = resp.json()
print("Desk Consensus Score:", payload["deskOutput"]["debateSynthesis"]["postCascadeRiskScore"])
print("HMAC-SHA256 Header:", resp.headers.get("X-SMCR-Signature-256"))`;

            const tsSseSnippet = `// Subscribe to Real-Time Desk & Supreme Council Outputs via Server-Sent Events (SSE)
const streamUrl = "${originUrl}/api/v1/integration/stream?apiKey=${integrationCfg.apiKey}";
const es = new EventSource(streamUrl);

es.addEventListener("stream.connected", (e) => {
  console.log("Connected to SMCR-1.0 Integration Bus:", JSON.parse(e.data));
});

es.addEventListener("manual.gui.broadcast", (e) => {
  const bundle = JSON.parse(e.data);
  console.log("Received Live Desk Output for", bundle.sovereign.iso3, bundle.scope, bundle);
});`;

            const activeCodeBlock =
              activeSnippetTab === 'curl'
                ? curlSnippet
                : activeSnippetTab === 'python'
                ? pythonSnippet
                : tsSseSnippet;

            return (
              <div className="space-y-4 text-xs">
                {/* Top Summary & OpenAPI 3.1 Bar */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Top-Level Application Integration Bus (<code className="tabular-nums">SMCR-1.0</code> REST Pull · Outbound Webhooks · Live SSE Stream)
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Allow external applications, PMS/OMS engines, or downstream risk dashboards to pull or subscribe to individual desk outputs (Geopolitical, Sovereign, Macro), 9 sub-agent reports, quantitative suites, and Supreme Council verdicts.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadOpenApiSpec}
                      className="ui-btn inline-flex"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Download OpenAPI 3.1 Spec (.json)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void fetchIntegrationDeliveries()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 dark:bg-slate-800 text-white"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Refresh Audit Log</span>
                    </button>
                  </div>
                </div>

                {/* Row 1: 1-Click Desk Output Broadcaster & Security / Auth Configuration */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left: Outbound Desk Broadcaster */}
                  <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        1-Click Outbound Desk Output Broadcaster ({activeIso3})
                      </span>
                      <span className="px-2 py-0.5 tabular-nums text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        SSE Subscribers: {activeSseCount}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Push the active sovereign&apos;s desk outputs to all enabled <code className="tabular-nums">webhook_bus</code> connectors and connected SSE stream listeners with an <code className="tabular-nums">X-SMCR-Signature-256</code> HMAC header.
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Select Granular Desk Output Scope to Broadcast
                      </label>
                      <select
                        value={broadcastScope}
                        onChange={(e) =>
                          setBroadcastScope(e.target.value as IntegrationBroadcastScope)
                        }
                        className="w-full px-2.5 py-1.5 tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      >
                        <option value="all_desks_bundle">
                          Full SMCR-1.0 Bundle (All 3 Desks + 9 Sub-Agents + Quant Suites + Supreme Council)
                        </option>
                        <option value="geopolitical_desk">
                          Geopolitical Risk Desk Only (Debate + AG-1..AG-3 + Chokepoints/Sanctions Quant)
                        </option>
                        <option value="sovereign_desk">
                          Sovereign Credit Desk Only (Debate + AG-4..AG-6 + IMF SRDSF DSA &amp; Restructuring NPV)
                        </option>
                        <option value="macro_desk">
                          Macro &amp; FX Desk Only (Debate + AG-7..AG-9 + BVAR, NSS Curve &amp; Liquidity Z-Score)
                        </option>
                        <option value="supreme_council">
                          Supreme Council Verdict &amp; Half-Kelly LOB Execution Sizing Only
                        </option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={integrationCfg.includeSubAgents}
                          onChange={(e) =>
                            updateIntegrationConfig({ includeSubAgents: e.target.checked })
                          }
                        />
                        <span>Include 9 Sub-Agent JSON Reports</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={integrationCfg.includeQuantSuites}
                          onChange={(e) =>
                            updateIntegrationConfig({ includeQuantSuites: e.target.checked })
                          }
                        />
                        <span>Include Desk Quantitative Suites</span>
                      </label>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => void handleTriggerIntegrationBroadcast()}
                        disabled={broadcastState.loading}
                        className="ui-btn ui-btn-primary inline-flex"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>
                          {broadcastState.loading
                            ? 'Broadcasting Desk Outputs...'
                            : `Broadcast ${activeIso3} Desk Outputs Now`}
                        </span>
                      </button>

                      {broadcastState.payloadPreview && (
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              'broadcast-json',
                              JSON.stringify(broadcastState.payloadPreview, null, 2)
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs tabular-nums bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>
                            {copiedKey === 'broadcast-json' ? 'Copied JSON!' : 'Copy Dispatched JSON'}
                          </span>
                        </button>
                      )}
                    </div>

                    {broadcastState.message && (
                      <div className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 tabular-nums text-xs">
                        {broadcastState.message}
                      </div>
                    )}
                  </div>

                  {/* Right: Security, API Key & HMAC-SHA256 Configuration */}
                  <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      API Key Authentication, HMAC-SHA256 Signing &amp; Auto-Broadcast Policy
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-emerald-700 dark:text-emerald-400">
                        <input
                          type="checkbox"
                          checked={integrationCfg.autoBroadcastOnRun}
                          onChange={(e) =>
                            updateIntegrationConfig({ autoBroadcastOnRun: e.target.checked })
                          }
                        />
                        <span>Auto-Broadcast Desk Outputs on Council Run</span>
                      </label>

                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={integrationCfg.requireApiKey}
                          onChange={(e) =>
                            updateIntegrationConfig({ requireApiKey: e.target.checked })
                          }
                        />
                        <span>Enforce X-SMCR-API-Key Header on Pull/SSE</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Inbound Consumer API Key (<code className="tabular-nums">X-SMCR-API-Key</code>)
                        </label>
                        <input
                          type="text"
                          value={integrationCfg.apiKey}
                          onChange={(e) => updateIntegrationConfig({ apiKey: e.target.value })}
                          className="w-full px-2.5 py-1.5 tabular-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Outbound Webhook HMAC Secret (<code className="tabular-nums">X-SMCR-Signature-256</code>)
                        </label>
                        <input
                          type="text"
                          value={integrationCfg.webhookHmacSecret}
                          onChange={(e) =>
                            updateIntegrationConfig({ webhookHmacSecret: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 tabular-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 tabular-nums text-xs space-y-1 text-slate-600 dark:text-slate-400">
                      <div>
                        <strong>Pull Desk Endpoint:</strong>{' '}
                        <code className="text-blue-600 dark:text-blue-400">
                          GET /api/v1/integration/desks/{activeIso3}?desk=geopolitical|sovereign|macro|all
                        </code>
                      </div>
                      <div>
                        <strong>Pull Full Bundle:</strong>{' '}
                        <code className="text-emerald-600 dark:text-emerald-400">
                          GET /api/v1/integration/bundle/{activeIso3}
                        </code>
                      </div>
                      <div>
                        <strong>Live SSE Stream:</strong>{' '}
                        <code className="text-amber-600 dark:text-amber-400">
                          GET /api/v1/integration/stream
                        </code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 2: Live Outbound Webhook, SSE & REST Pull Delivery Audit Log */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      Live Top-Level Integration Delivery &amp; Consumer Audit Log
                    </span>
                    <span className="tabular-nums text-xs text-slate-500">
                      Showing {integrationDeliveries.length} recent dispatches
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left border-collapse tabular-nums text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                          <th className="py-2 px-2.5">Delivery ID</th>
                          <th className="py-2 px-2.5">ISO-3</th>
                          <th className="py-2 px-2.5">Desk Scope</th>
                          <th className="py-2 px-2.5">Transport</th>
                          <th className="py-2 px-2.5">Target / Consumer</th>
                          <th className="py-2 px-2.5">HTTP</th>
                          <th className="py-2 px-2.5">Latency</th>
                          <th className="py-2 px-2.5">HMAC-SHA256 Signature</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {integrationDeliveries.slice(0, 8).map((dlv) => (
                          <tr
                            key={dlv.deliveryId}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-950/50"
                          >
                            <td className="py-2 px-2.5 font-semibold text-slate-900 dark:text-white">
                              {dlv.deliveryId}
                            </td>
                            <td className="py-2 px-2.5">{dlv.iso3}</td>
                            <td className="py-2 px-2.5 text-blue-600 dark:text-blue-400">
                              {dlv.scope}
                            </td>
                            <td className="py-2 px-2.5">{dlv.transport}</td>
                            <td className="py-2 px-2.5 truncate max-w-[220px]" title={dlv.targetUrl}>
                              {dlv.targetName}
                            </td>
                            <td className="py-2 px-2.5">
                              <span
                                className={`px-1.5 py-0.5 font-semibold ${
                                  dlv.ok
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {dlv.statusCode}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 tabular-nums">{dlv.latencyMs}ms</td>
                            <td
                              className="py-2 px-2.5 text-slate-500 truncate max-w-[180px]"
                              title={dlv.hmacSignature}
                            >
                              {dlv.hmacSignature.slice(0, 22)}...
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Row 3: Downstream Consumer Quickstart Snippets */}
                <div className="border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      Downstream Application Consumer Code Snippets ({activeIso3})
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(
                        [
                          { id: 'curl', label: 'cURL (REST Pull Desks & Bundle)' },
                          { id: 'python', label: 'Python (Desk Pull + HMAC)' },
                          { id: 'typescript_sse', label: 'TypeScript (Live SSE EventStream)' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveSnippetTab(tab.id)}
                          aria-pressed={activeSnippetTab === tab.id}
                          className="ui-pill"
                        >
                          {tab.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => copyText('int-snippet', activeCodeBlock)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{copiedKey === 'int-snippet' ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 tabular-nums text-xs leading-relaxed bg-slate-950 text-emerald-300 overflow-x-auto select-text">
                    {activeCodeBlock}
                  </pre>
                </div>
              </div>
            );
          })()}

          {/* Live Pull / Benchmark Feedback Bar (visible across all tabs when triggered) */}
          {(pullStatus.message || benchmarkResult.message) && (
            <div className="border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs tabular-nums">
              {pullStatus.message && (
                <div className="flex items-center justify-between gap-2 text-slate-800 dark:text-slate-200">
                  <span>
                    <strong>[Model pull]:</strong> {pullStatus.message}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText('pull-cmd', `ollama pull ${pullStatus.targetModel}`)
                    }
                    className="px-2 py-0.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  >
                    {copiedKey === 'pull-cmd'
                      ? 'Copied!'
                      : `Copy: ollama pull ${pullStatus.targetModel}`}
                  </button>
                </div>
              )}
              {benchmarkResult.message && (
                <div className="text-slate-800 dark:text-slate-200 space-y-1">
                  <div>
                    <strong>[AGENT BENCHMARK · {benchmarkResult.phase}]:</strong>{' '}
                    {benchmarkResult.message}
                  </div>
                  {benchmarkResult.sampleOutput && (
                    <div className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                      Stance: <strong>{toDisplayCase(benchmarkResult.sampleOutput.stance)}</strong> · Risk
                      Score: <strong>{benchmarkResult.sampleOutput.riskScore}</strong> ·{' '}
                      {benchmarkResult.sampleOutput.summary}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Persistent GUI Save & Apply Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {serverSaveState.savedMessage ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>{serverSaveState.savedMessage}</span>
              </span>
            ) : (
              <span>
                All inputs above are saved automatically to your browser workspace and can be
                applied to the live server &amp; Council pipeline in 1 click.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadFile('.env', customEnvContent)}
              className="ui-btn inline-flex"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export GUI .env File</span>
            </button>
            <button
              type="button"
              onClick={() => handleSaveGuiConfigToServer(false)}
              disabled={serverSaveState.saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {serverSaveState.saving ? 'Saving to Server...' : 'Save & Apply GUI Configuration'}
              </span>
            </button>
            {onTriggerReverifyCouncil && (
              <button
                type="button"
                onClick={() => {
                  handleSaveGuiConfigToServer(true);
                  onClose();
                }}
                className="ui-btn ui-btn-primary inline-flex"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Save &amp; Run 9-Agent Council Now</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};



