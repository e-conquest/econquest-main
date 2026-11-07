/**
 * Which events send a server alert (src/utils/serverAlerts.ts), as stated rules with no model:
 *
 * - Data check: the nightly check finds a source that connected at the run before and fails now.
 *   One alert when it breaks, not one every night it stays broken; Menu > Data health keeps the
 *   "failing since" date.
 * - Scheduled job: a run of Download all or the backtests that ends not ok (a failed step, stopped
 *   early, a feed that did not answer, or a crash).
 * - Backtest regression: a pre-registered test, same id and same version, that passed at its last
 *   run and does not pass now. A new version is a new test, so its verdict is not a regression.
 */
import type { SourceCheckRecord } from './dataHealth';
import { changesBetween } from './dataHealth';
import type { ServerAlert } from './serverAlerts';

const LIST_MAX = 8;
const more = (n: number) => (n > LIST_MAX ? [`and ${n - LIST_MAX} more.`] : []);

export function dataCheckAlert(prev: SourceCheckRecord | null | undefined, cur: SourceCheckRecord): ServerAlert | null {
  if (!prev) return null;
  const { broke } = changesBetween(prev, cur);
  if (!broke.length) return null;
  return {
    kind: 'data_check',
    title: `${broke.length} data source${broke.length === 1 ? '' : 's'} stopped answering`,
    lines: [
      ...broke.slice(0, LIST_MAX).map((r) => `${r.name}: ${r.detail}`),
      ...more(broke.length),
      'The app keeps the last good figures. Menu > Data health > Sources shows since when.',
    ],
  };
}

export function jobFailedAlert(label: string, summary: string): ServerAlert {
  return { kind: 'scheduled_job', title: `${label} did not finish cleanly`, lines: [summary, 'Menu > Data health > Scheduled lists every run.'] };
}

interface VerdictLike {
  id: string;
  specVersion: number;
  status: string;
  ranAt: string;
  verdict?: string;
}

/** Same id and version: passed before this run, ran in this run, does not pass now. */
export function backtestRegressions(before: Record<string, VerdictLike> | undefined, after: Record<string, VerdictLike> | undefined, startedAt: string): VerdictLike[] {
  const out: VerdictLike[] = [];
  for (const [key, now] of Object.entries(after || {})) {
    const was = before?.[key];
    if (was?.status === 'passed' && now.ranAt >= startedAt && now.status !== 'passed') out.push(now);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function backtestRegressionAlert(regressed: VerdictLike[]): ServerAlert | null {
  if (!regressed.length) return null;
  return {
    kind: 'backtest_regression',
    title: `${regressed.length} backtest${regressed.length === 1 ? '' : 's'} that passed now ${regressed.length === 1 ? 'fails' : 'fail'}`,
    lines: [
      ...regressed.slice(0, LIST_MAX).map((r) => `${r.id} v${r.specVersion}: ${r.status.replace(/_/g, ' ')}${r.verdict ? ` (${r.verdict.slice(0, 200)})` : ''}`),
      ...more(regressed.length),
      'Failed rules are never tuned. Menu > Models & validation has the full verdicts.',
    ],
  };
}
