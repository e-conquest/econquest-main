/**
 * Pulls GDELT 2.0 raw files (events and Global Knowledge Graph) into data/live/gdelt-raw/.
 *
 *   npm run gdelt:pull                 pull what is left in the look-back
 *   npm run gdelt:pull -- --estimate   only say how many files and roughly how many bytes are left
 *
 * Look-back and GKG sampling come from .env: GDELT_RAW_WEEKS (default 8) and GDELT_GKG_EVERY_HOURS
 * (default 3). Stop with Ctrl+C at any time; the next run carries on.
 */
import dotenv from 'dotenv';
import path from 'path';
import { formatBytes } from '../src/utils/preload.ts';
import { gdeltRawConfig, gdeltRawDir, planPull, pullGdeltRaw } from '../src/utils/gdeltRawStore.ts';

dotenv.config();
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const cfg = gdeltRawConfig(process.env);
const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init);

const plan = await planPull(gdeltRawDir(dataDir), cfg, fetchImpl).catch((err) => {
  console.error(`[GDELT raw] ${err?.message || err}`);
  process.exit(1);
});
const est = plan.estimateBytes === null ? 'size unknown' : `about ${formatBytes(plan.estimateBytes)} to download (raw files are thrown away after reading)`;
console.log(`[GDELT raw] look-back ${cfg.weeks} weeks, one GKG file every ${cfg.gkgEveryMinutes / 60} hours. Left: ${plan.events.length} events files, ${plan.gkg.length} GKG files; ${est}.`);
if (process.argv.includes('--estimate')) process.exit(0);

let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(130);
  stop = true;
  console.log('\n[GDELT raw] stopping after the files in flight (Ctrl+C again to quit now)');
});
let lastPct = -1;
const res = await pullGdeltRaw({
  dataDir,
  cfg,
  fetchImpl,
  shouldStop: () => stop,
  onProgress: ({ done, total }) => {
    const pct = Math.floor((100 * done) / total);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      console.log(`[GDELT raw] ${done} of ${total} files (${pct}%)`);
    }
  },
});
console.log(`[GDELT raw] ${res.note}. Downloaded ${formatBytes(res.bytes)}. Still left: ${res.left.events} events, ${res.left.gkg} GKG files.`);
