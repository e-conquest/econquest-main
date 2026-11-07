/**
 * `npm run mac:validate`: the checks that can only run on Sam's Mac (live feeds, saved WEO
 * editions, Ollama) in one command, with one report file to send back.
 *
 * This module holds the parts that need no I/O: the step list, the --skip / --only options, key
 * redaction and the report text. scripts/mac-validate.ts runs the steps.
 */

export interface ValidateStep {
  id: string;
  title: string;
  /** npm script and its arguments. */
  npm: string[];
  /** Needs the app running (Docker on 3737 or `npm run dev` on 3000). */
  needsApp?: boolean;
  /** What a failure usually means, shown under a failed step. */
  hint: string;
}

export const VALIDATE_STEPS: ValidateStep[] = [
  {
    id: 'data',
    title: 'Data sources (check:data)',
    npm: ['run', 'check:data'],
    hint: 'A source that is down or refuses automated requests is named in the table; a key you have not set is not a failure.',
  },
  {
    id: 'backtest',
    title: 'Pre-registered backtests (backtest)',
    npm: ['run', 'backtest'],
    hint: 'Needs the BIS, DBnomics and CFTC. A FAILED verdict is a result, not a fault; a Problem line is a fault.',
  },
  {
    id: 'weo',
    title: 'Saved IMF WEO editions (weo:vintages)',
    npm: ['run', 'weo:vintages'],
    hint: 'Reads data/local/weo-vintages/. Missing editions: download them by hand from imf.org (the site refuses the script).',
  },
  {
    id: 'forecast',
    title: 'Forecast evaluations (forecast:evaluate)',
    npm: ['run', 'forecast:evaluate'],
    hint: 'Uses the saved WEO editions. A FAILED verdict is a result; tests are never re-tuned after a fail.',
  },
  {
    id: 'signals',
    title: 'Currency signal tests (signals:evaluate)',
    npm: ['run', 'signals:evaluate'],
    hint: 'Uses the saved ECB history. A FAILED verdict is a result; tests are never re-tuned after a fail.',
  },
  {
    id: 'council',
    title: 'Council regression on the real model (council:regress)',
    npm: ['run', 'council:regress'],
    needsApp: true,
    hint: 'Needs the app running and the Ollama app (not a Docker Ollama) on port 11434 with qwen2.5:32b. A stale-app warning means: run npm run update first.',
  },
];

export interface ValidateOptions {
  steps: ValidateStep[];
  /** Unknown names given to --skip or --only. */
  unknown: string[];
}

/** Reads `--skip a,b` and `--only a,b` (ids from VALIDATE_STEPS). --only wins over --skip. */
export function parseValidateArgs(argv: string[], all: ValidateStep[] = VALIDATE_STEPS): ValidateOptions {
  const listAfter = (flag: string): string[] | null => {
    const i = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return null;
    const raw = argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1] || '';
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  };
  const ids = new Set(all.map((s) => s.id));
  const only = listAfter('--only');
  const skip = listAfter('--skip') || [];
  const unknown = [...(only || []), ...skip].filter((x) => !ids.has(x));
  const steps = all.filter((s) => (only ? only.includes(s.id) : !skip.includes(s.id)));
  return { steps, unknown: [...new Set(unknown)] };
}

/** Values of environment variables that look like secrets, longest first, for redaction. */
export function secretValues(env: Record<string, string | undefined>, extra: string[] = []): string[] {
  const vals = Object.entries(env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD|PASS\b/i.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string);
  return [...new Set([...vals, ...extra.filter((v) => v && v.length >= 8)])].sort((a, b) => b.length - a.length);
}

/** Replaces every secret value in the text with [hidden]. Keys never reach the report. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('[hidden]');
  return out;
}

/** Strips terminal colour codes. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface StepResult {
  id: string;
  title: string;
  status: StepStatus;
  /** Exit code, when the step ran. */
  code?: number | null;
  ms: number;
  /** Why a step was skipped. */
  reason?: string;
  output: string;
  hint?: string;
}

export interface ValidateEnv {
  ranAt: string;
  commit: string;
  /** Files changed in the folder (git status --porcelain), at most a few. */
  dirty: string[];
  node: string;
  platform: string;
  /** Running app found, with its URL and whether its code matches this folder. */
  app: { url: string; sameCode: boolean | null } | null;
  /** Ollama at 127.0.0.1:11434: version and model names, or why not. */
  ollama: { version?: string; models: string[]; error?: string };
}

export function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const MAX_OUTPUT = 60_000;

/** Keeps the start and the end of a long output (the end usually holds the verdicts). */
export function clip(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  return `${text.slice(0, head)}\n\n[... ${text.length - max} characters cut ...]\n\n${text.slice(text.length - (max - head))}`;
}

/** The Markdown report: environment, one summary row per step, then each step's output. */
export function renderReport(env: ValidateEnv, results: StepResult[]): string {
  const okN = results.filter((r) => r.status === 'ok').length;
  const failN = results.filter((r) => r.status === 'failed').length;
  const skipN = results.filter((r) => r.status === 'skipped').length;
  const lines: string[] = [];
  lines.push('# econquest Mac validation');
  lines.push('');
  lines.push(`Ran ${env.ranAt} on commit ${env.commit}. ${okN} ok, ${failN} failed, ${skipN} skipped.`);
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push(`- Node ${env.node} on ${env.platform}`);
  lines.push(`- Folder: ${env.dirty.length ? `${env.dirty.length} changed file(s): ${env.dirty.slice(0, 8).join(', ')}` : 'no local changes'}`);
  lines.push(
    `- App: ${
      env.app
        ? `${env.app.url}${env.app.sameCode === false ? ' — running OLDER or different code than this folder (run npm run update)' : env.app.sameCode ? ', same code as this folder' : ''}`
        : 'not running (council regression skipped)'
    }`
  );
  lines.push(
    `- Ollama (127.0.0.1:11434): ${
      env.ollama.error ? env.ollama.error : `${env.ollama.version ? `version ${env.ollama.version}, ` : ''}${env.ollama.models.length} models: ${env.ollama.models.join(', ') || 'none'}`
    }`
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Step | Result | Time |');
  lines.push('| --- | --- | --- |');
  for (const r of results) {
    const res = r.status === 'ok' ? 'ok' : r.status === 'skipped' ? `skipped: ${r.reason || ''}` : `FAILED (exit ${r.code ?? '?'})`;
    lines.push(`| ${r.title} | ${res} | ${r.status === 'skipped' ? '' : fmtMs(r.ms)} |`);
  }
  lines.push('');
  lines.push('A FAILED verdict inside a test step (for example a backtest that fails its pre-registered test) is a result, not a fault: the step is ok when the command itself finished.');
  for (const r of results) {
    if (r.status === 'skipped') continue;
    lines.push('');
    lines.push(`## ${r.title}`);
    lines.push('');
    if (r.status === 'failed' && r.hint) {
      lines.push(`Hint: ${r.hint}`);
      lines.push('');
    }
    lines.push('```');
    lines.push(clip(r.output.trimEnd()) || '(no output)');
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}
