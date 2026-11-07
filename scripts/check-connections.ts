/**
 * Checks every data source from this computer and prints one line per source.
 *
 *   npm run check:data            the table
 *   npm run check:data -- --json  the same as JSON
 *   npm run check:data -- --no-save  do not keep this run in the history
 *
 * Each run is kept in data/local/data-health/source-checks.jsonl (states and reasons only, never
 * keys), the same history as the nightly check, and the end of the table says which sources
 * broke or came back since the last saved run.
 *
 * Reads the same .env as the app, and the keys saved in the app (Menu > Settings > API keys),
 * which win over .env just as they do in the app. Keys are never printed. Needs no running server.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { checkConnections, formatReport, isFailure } from '../src/utils/connectionCheck.ts';
import { formatChanges, recordFromReport } from '../src/utils/dataHealth.ts';
import { appendCheck, dataHealthFiles, readChecks } from '../src/utils/dataHealthStore.ts';
import { ucdpData } from '../src/utils/ucdpStore.ts';
import { acledFileData } from '../src/utils/acledFileStore.ts';
import { applyKeysToEnv, envKeySnapshot, keySources, loadSettings, settingsFilePath } from '../src/utils/userSettings.ts';

dotenv.config();

const envFileKeys = envKeySnapshot(process.env);
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const saved = loadSettings(settingsFilePath(dataDir));
applyKeysToEnv(process.env, envFileKeys, saved);

const report = await checkConnections({
  env: process.env,
  keySources: keySources(envFileKeys, saved),
  ucdp: () => ucdpData(dataDir),
  acledFiles: () => acledFileData(dataDir),
  readFile: (p) => {
    try {
      return { text: fs.readFileSync(p, 'utf8'), modified: fs.statSync(p).mtime };
    } catch {
      return null;
    }
  },
});

const files = dataHealthFiles(dataDir);
const record = recordFromReport(report, 'terminal');
const previous = readChecks(files).at(-1);
const keep = !process.argv.includes('--no-save');
if (keep) appendCheck(files, record);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(report));
  console.log('');
  console.log(formatChanges(previous, record));
  if (keep) console.log(`Saved in ${path.relative(process.cwd(), files.checks) || files.checks}.`);
}
process.exitCode = report.results.some((r) => isFailure(r.state)) ? 1 : 0;
