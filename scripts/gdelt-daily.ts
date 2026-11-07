/**
 * Pulls the GDELT 1.0 event files (data.gdeltproject.org/events/) into monthly per-country totals
 * in data/live/gdelt-daily/. Runs alongside `npm run gdelt:pull` (the 2.0 15-minute files).
 *
 *   npm run gdelt:daily                 pull what is left from GDELT_DAILY_FROM (default 2016-01)
 *   npm run gdelt:daily -- --estimate   only say how many files and how many bytes are left
 *   npm run gdelt:daily -- --from 1979  read back to 1979 this time (or set GDELT_DAILY_FROM in .env)
 *
 * Each zip is streamed through and thrown away; only small month files are kept. Stop with Ctrl+C
 * at any time; the next run carries on.
 */
import dotenv from 'dotenv';
import path from 'path';
import { formatBytes } from '../src/utils/preload.ts';
import { v1FromMonth } from '../src/utils/gdeltDaily.ts';
import { gdeltDailyDir, planDailyPull, pullGdeltDaily } from '../src/utils/gdeltDailyStore.ts';

dotenv.config();
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const fromArg = process.argv.indexOf('--from');
const fromMonth = v1FromMonth(fromArg > 0 ? { GDELT_DAILY_FROM: process.argv[fromArg + 1] } : process.env);
const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init);

const plan = await planDailyPull(gdeltDailyDir(dataDir), fromMonth, fetchImpl).catch((err) => {
  console.error(`[GDELT 1.0] ${err?.message || err}`);
  process.exit(1);
});
const kinds = (k: string) => plan.files.filter((f) => f.kind === k).length;
console.log(
  `[GDELT 1.0] from ${fromMonth}. Left: ${plan.files.length} files (${kinds('year')} yearly, ${kinds('month')} monthly, ${kinds('day')} daily), about ${formatBytes(plan.bytes)} to download (zips are streamed and thrown away).`
);
if (process.argv.includes('--estimate')) process.exit(0);

let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(130);
  stop = true;
  console.log('\n[GDELT 1.0] stopping after the files in flight (Ctrl+C again to quit now)');
});
let lastPct = -1;
const res = await pullGdeltDaily({
  dataDir,
  fromMonth,
  fetchImpl,
  shouldStop: () => stop,
  onProgress: ({ done, total, file, bytes }) => {
    const pct = Math.floor((100 * done) / total);
    if (pct !== lastPct) {
      lastPct = pct;
      console.log(`[GDELT 1.0] ${done} of ${total} files (${pct}%), last ${file}, ${formatBytes(bytes)} so far`);
    }
  },
});
console.log(`[GDELT 1.0] ${res.note}. Downloaded ${formatBytes(res.bytes)}. Still left: ${res.left} files.`);
