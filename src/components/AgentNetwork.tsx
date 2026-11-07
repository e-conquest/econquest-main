import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';

export type AgentStatus = 'waiting' | 'running' | 'done' | 'fallback' | 'skipped' | 'failed';

export interface AgentNode {
  id: string;
  label: string;
  /** What this agent does, in plain words. */
  task: string;
  status: AgentStatus;
  /** From the server: how long it took, or why it was skipped or fell back. */
  ms?: number;
  note?: string;
  /** Named agents inside this node (a desk's analysts), shown as chips. */
  members?: string[];
  /** Hover text, e.g. how the node runs. */
  help?: string;
}

export interface AgentColumn {
  title: string;
  nodes: AgentNode[];
}

export type ProgressSteps = Record<string, { status: AgentStatus; ms?: number; note?: string }>;

const BORDER: Record<AgentStatus, string> = {
  waiting: 'border-slate-200 dark:border-slate-700',
  running: 'border-blue-400 dark:border-blue-500',
  done: 'border-emerald-300 dark:border-emerald-800',
  fallback: 'border-amber-300 dark:border-amber-700',
  skipped: 'border-slate-200 dark:border-slate-700',
  failed: 'border-rose-300 dark:border-rose-800',
};
const DOT: Record<AgentStatus, string> = {
  waiting: 'bg-slate-300 dark:bg-slate-600',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-emerald-500',
  fallback: 'bg-amber-500',
  skipped: 'bg-slate-300 dark:bg-slate-600',
  failed: 'bg-rose-500',
};

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function StatusLine({ node, elapsedMs }: { node: AgentNode; elapsedMs?: number }) {
  const cls = 'flex items-center gap-1 text-xs';
  switch (node.status) {
    case 'running':
      return (
        <div className={`${cls} text-blue-700 dark:text-blue-300`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working{elapsedMs !== undefined ? `, ${Math.floor(elapsedMs / 1000)} s` : ''}
          {node.note ? ` · ${node.note}` : ''}
        </div>
      );
    case 'done':
      return (
        <div className={`${cls} text-emerald-700 dark:text-emerald-400`}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Done{node.ms !== undefined && node.ms >= 50 ? ` in ${secs(node.ms)}` : ''}
          {node.note ? ` · ${node.note}` : ''}
        </div>
      );
    case 'fallback':
      return (
        <div className={`${cls} text-amber-700 dark:text-amber-400`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {node.note || 'Built-in figures used'}
        </div>
      );
    case 'skipped':
      return (
        <div className={`${cls} text-slate-500 dark:text-slate-400`}>
          <MinusCircle className="w-3.5 h-3.5 shrink-0" /> Skipped{node.note ? `: ${node.note}` : ''}
        </div>
      );
    case 'failed':
      return (
        <div className={`${cls} text-rose-700 dark:text-rose-400`}>
          <XCircle className="w-3.5 h-3.5 shrink-0" /> {node.note || 'Failed'}
        </div>
      );
    default:
      return (
        <div className={`${cls} text-slate-500 dark:text-slate-400`}>
          <Circle className="w-3.5 h-3.5" /> {node.note || 'Waiting'}
        </div>
      );
  }
}

/**
 * The agents behind an answer, laid out as the steps they run in, each with its live status.
 * Statuses come from the server as each step actually starts and finishes; nothing is animated
 * on a timer.
 */
export const AgentNetwork: React.FC<{
  title: string;
  columns: AgentColumn[];
  footnote?: string;
  /** Steps always run top to bottom (the narrow Agents side panel on Workspace). */
  stacked?: boolean;
}> = ({ title, columns, footnote, stacked }) => {
  // Seconds on a running node, counted from when this screen first saw it running.
  const seen = useRef<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = columns.some((c) => c.nodes.some((n) => n.status === 'running'));
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [anyRunning]);
  for (const c of columns)
    for (const n of c.nodes) {
      if (n.status === 'running') seen.current[n.id] ??= Date.now();
      else delete seen.current[n.id];
    }
  const total = columns.reduce((a, c) => a + c.nodes.length, 0);
  const finished = columns.reduce((a, c) => a + c.nodes.filter((n) => n.status !== 'waiting' && n.status !== 'running').length, 0);

  return (
    <div className="space-y-2" data-agent-network="true" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="ui-label">{title}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {finished} of {total} finished
        </div>
      </div>
      <div className={`flex flex-col gap-2 ${stacked ? '' : 'lg:flex-row lg:items-stretch'}`}>
        {columns.map((col, ci) => (
          <React.Fragment key={col.title}>
            {ci > 0 && (
              <div className={`flex items-center justify-center text-slate-400 ${stacked ? '' : 'lg:flex-col'}`} aria-hidden="true">
                <ChevronRight className={`w-4 h-4 rotate-90 ${stacked ? '' : 'lg:rotate-0'}`} />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="text-xs text-slate-500 dark:text-slate-400">{col.title}</div>
              {col.nodes.map((n) => (
                <div key={n.id} className={`border ${BORDER[n.status]} bg-white dark:bg-slate-900 px-2 py-1.5`} data-agent-node={n.id} data-status={n.status} title={n.help}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[n.status]}`} />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{n.label}</span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">{n.task}</div>
                  {n.members && n.members.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {n.members.map((m) => (
                        <span key={m} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <span className={`w-1.5 h-1.5 rounded-full ${DOT[n.status]}`} />
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                  <StatusLine node={n} elapsedMs={seen.current[n.id] ? Math.max(0, now - seen.current[n.id]) : undefined} />
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
      {footnote && <p className="text-xs text-slate-500 dark:text-slate-400">{footnote}</p>}
    </div>
  );
};

/** Polls the server for a council run's step statuses while `active`; keeps the last answer after. */
export function useCouncilProgress(progressId: string | null, active: boolean): ProgressSteps {
  const [steps, setSteps] = useState<ProgressSteps>({});
  useEffect(() => {
    if (!progressId) {
      setSteps({});
      return;
    }
    let live = true;
    const pull = () =>
      fetch(`/api/council/progress/${encodeURIComponent(progressId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d?.steps) setSteps(d.steps);
        })
        .catch(() => undefined);
    void pull();
    if (!active) return () => {
      live = false;
    };
    const t = window.setInterval(pull, 600);
    return () => {
      live = false;
      window.clearInterval(t);
      void fetch(`/api/council/progress/${encodeURIComponent(progressId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.steps && setSteps(d.steps))
        .catch(() => undefined);
    };
  }, [progressId, active]);
  return steps;
}
