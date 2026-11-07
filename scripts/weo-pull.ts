/**
 * `npm run weo:pull`: downloads past IMF WEO database editions (April and October, plus the
 * September editions some years had) into data/local/weo-vintages/, for the real-time IMF figures
 * and the debt fan coverage test (docs/validation/forecasts/debt_fan_coverage.json).
 *
 *   npm run weo:pull                 every edition from 2005 not saved yet
 *   npm run weo:pull -- --from 2010  from a later year
 *
 * Each edition tries every URL layout the IMF has used (src/utils/weoVintages.ts weoEditionUrls)
 * and is kept only if it reads as a WEO table. Files already saved are left alone. If the IMF
 * refuses automated downloads, nothing is forced: download those editions by hand from the WEO
 * database page and save them in the same folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weoVintageDir } from '../src/utils/weoVintagesStore.ts';
import { decodeWeoBytes, parseWeoTable, weoEditionFileName, weoEditionUrls } from '../src/utils/weoVintages.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dir = weoVintageDir(dataDir);
const i = process.argv.indexOf('--from');
const from = i >= 0 ? Number(process.argv[i + 1]) : 2005;
const now = new Date();
fs.mkdirSync(dir, { recursive: true });

const editions: string[] = [];
for (let y = from; y <= now.getUTCFullYear(); y++) for (const m of ['04', '09', '10']) editions.push(`${y}-${m}`);
const have = new Set(fs.readdirSync(dir));
let saved = 0;
const missed: string[] = [];
for (const v of editions) {
  if (`${v}-28` > now.toISOString().slice(0, 10)) continue;
  const name = weoEditionFileName(v);
  if (have.has(name)) continue;
  let ok = false;
  const tried: string[] = [];
  for (const url of weoEditionUrls(v)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { Accept: '*/*', 'User-Agent': 'econquest open-source research' } });
      if (!r.ok) {
        tried.push(`HTTP ${r.status}`);
        continue;
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if ('reason' in parseWeoTable(decodeWeoBytes(bytes))) {
        tried.push('not a WEO table');
        continue;
      }
      fs.writeFileSync(path.join(dir, name), bytes);
      console.log(`Saved ${name} (${(bytes.length / 1e6).toFixed(1)} MB) from ${url}`);
      saved++;
      ok = true;
      break;
    } catch (e: any) {
      tried.push(String(e?.message || e));
    }
  }
  // Most years have no September edition: only April and October misses are reported.
  if (!ok && !v.endsWith('-09')) missed.push(`${name} (${tried.join('; ')})`);
}
console.log(`Saved ${saved} new edition(s) in ${path.relative(root, dir)}.`);
if (missed.length) console.log(`Not found automatically (download by hand from the IMF WEO database page if needed):\n  ${missed.join('\n  ')}`);
console.log('Check with: npm run weo:vintages');
