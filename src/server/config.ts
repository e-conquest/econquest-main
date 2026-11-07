/**
 * Server start-up: environment, the data folder and the files in it, and the keys saved in
 * Menu > Settings. Every server module imports from here, so .env is read once, before any of
 * them reads process.env.
 *
 * Config comes only from environment variables (.env for `npm run dev`); state lives only under
 * DATA_DIR (default: the data/ folder beside server.ts).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyKeysToEnv, envKeySnapshot, loadSettings, saveSettings, settingsFilePath, settingsSecretBox, type LoadedSettings, type SavedSettings } from '../utils/userSettings';
import { researchFilePath } from '../utils/researchStore';
import { auditFiles } from '../utils/auditStore';
import { dataHealthFiles } from '../utils/dataHealthStore';
import { figureWatchFiles } from '../utils/figureWatchStore';
import { validationFilePath } from '../utils/backtestRun';
import { signOffFilePath } from '../utils/signoff';
import { reviewFilePath } from '../utils/policyReviewStore';
import { watchRulesFilePath } from '../utils/watchRulesStore';
import { workspaceFilePath } from '../utils/workspaceStore';
import { installJsonConsole } from '../utils/serverRuntime';

dotenv.config();
// LOG_FORMAT=json (set in the Docker image): one JSON line per log message on stdout/stderr.
installJsonConsole(process.env);

/** The folder holding server.ts, docs/ and dist/. */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The one state folder. */
export const DATA_DIR = process.env.DATA_DIR || path.join(APP_ROOT, 'data');

// Keys saved in the app (Menu > Settings > API keys) win over .env; see src/utils/userSettings.ts.
export const ENV_FILE_KEYS = envKeySnapshot(process.env);
export const SETTINGS_FILE = settingsFilePath(DATA_DIR);
export let savedSettings: LoadedSettings = loadSettings(SETTINGS_FILE);
// Keys encrypted at rest (src/utils/secretBox.ts): with a master key set, plain keys left from before
// are encrypted now; a master key that is set but unusable, or keys it cannot open, are said once.
{
  const { box, problem } = settingsSecretBox();
  if (problem) console.error(`[settings] ${problem}`);
  if (box && savedSettings.plainOnDisk) {
    try {
      saveSettings(SETTINGS_FILE, savedSettings);
      savedSettings = loadSettings(SETTINGS_FILE);
      console.log(`[settings] Saved keys are now encrypted at rest (master key from ${box.source}).`);
    } catch (error) {
      console.error('[settings] could not encrypt the saved keys:', (error as Error)?.message);
    }
  }
  if (savedSettings.unreadable?.length) {
    console.error(`[settings] ${savedSettings.unreadable.length} saved key(s) cannot be opened (${savedSettings.unreadable.join(', ')}): they were encrypted with a master key that is not set now. Set the same ECONQUEST_SECRET_KEY, or save the keys again in Menu > Settings.`);
  }
}
/** Replace the saved settings held in memory (after a key is saved or removed). */
export function setSavedSettings(next: SavedSettings): void {
  // Keys still sealed with a master key that is not set stay on disk; keep reporting them.
  const unreadable = loadSettings(SETTINGS_FILE).unreadable;
  savedSettings = unreadable?.length ? { ...next, unreadable } : next;
}
applyKeysToEnv(process.env, ENV_FILE_KEYS, savedSettings);

export const RESEARCH_FILE = researchFilePath(DATA_DIR);
// Audit log (Menu > Audit log): append-only, hash-chained. See src/utils/auditLog.ts.
export const AUDIT_FILES = auditFiles(DATA_DIR);
export const DATA_HEALTH_FILES = dataHealthFiles(DATA_DIR);
export const FIGURE_WATCH_FILES = figureWatchFiles(DATA_DIR);
// Pre-registered backtests (Menu > Models & validation). See src/utils/backtest.ts.
export const VALIDATION_FILE = validationFilePath(DATA_DIR);
export const SPEC_DIR = path.join(APP_ROOT, 'docs', 'validation', 'preregistered');
// Report sign-off (Reports > Saved research). See src/utils/signoff.ts.
export const SIGNOFF_FILE = signOffFilePath(DATA_DIR);
// Policy reviews (Reports > Policy reviews). See src/utils/policyReview.ts and docs/POLICY_REVIEW.md.
export const REVIEW_FILE = reviewFilePath(DATA_DIR);
export const WATCH_RULES_FILE = watchRulesFilePath(DATA_DIR);
export const WORKSPACE_FILE = workspaceFilePath(DATA_DIR);
// Every full council run's step timings, one JSON line each (src/utils/councilTiming.ts).
export const COUNCIL_TIMING_FILE = path.join(DATA_DIR, 'local', 'council-timing.jsonl');
/** Scheduled jobs on the server (src/utils/scheduledJobs.ts): last runs of Download all and the backtests. */
export const SCHEDULED_JOBS_FILE = path.join(DATA_DIR, 'local', 'scheduled-jobs.json');
/** Server alerts (src/server/alerts.ts): the last alert sent, with how each route went (no keys). */
export const LAST_ALERT_FILE = path.join(DATA_DIR, 'local', 'last-alert.json');
