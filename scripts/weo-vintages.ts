/**
 * Checks the past IMF WEO editions saved in data/local/weo-vintages/ (one file per edition, as the
 * IMF's WEO database download gives them: WEOOct2019all.xls, WEOApr2024all.xls ...).
 *
 *   npm run weo:vintages
 *   npm run weo:vintages -- --country TUR --code NGDP_RPCH --as-of 2019-06-01
 *
 * Prints each edition read, the files skipped with the reason, and (with --country) what the
 * latest edition out by --as-of (default today) said for that country and indicator.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWeoVintages, weoVintageDir } from '../src/utils/weoVintagesStore.ts';
import { vintageLabel, weoAsOf, WEO_VINTAGE_CODES } from '../src/utils/weoVintages.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const store = loadWeoVintages(dataDir, { fresh: true });
console.log(`Folder: ${weoVintageDir(dataDir)}`);
if (!store.editions.length && !store.skipped.length) {
  console.log('No files yet. Download past editions from the IMF WEO database page (the "By Countries" tab-delimited file for each edition) and save them here.');
}
for (const e of store.editions) {
  const countries = Object.keys(e.rows).length;
  const codes = new Set(Object.values(e.rows).flatMap((r) => Object.keys(r)));
  console.log(`${vintageLabel(e.vintage)} (${e.file}): ${countries} countries, ${codes.size} of ${WEO_VINTAGE_CODES.length} indicators`);
}
for (const s of store.skipped) console.log(`SKIPPED ${s.file}: ${s.reason}`);

const country = arg('country');
if (country) {
  const code = arg('code') || 'NGDP_RPCH';
  const asOf = arg('as-of') || new Date().toISOString().slice(0, 10);
  const got = weoAsOf(store, country, code, asOf);
  if (!got) console.log(`\n${country.toUpperCase()} ${code}: no edition out by ${asOf} holds it`);
  else {
    console.log(`\n${country.toUpperCase()} ${code} as of ${asOf}: ${vintageLabel(got.vintage)} edition${got.units ? `, ${got.units}` : ''}`);
    for (const v of got.values.slice(-10)) console.log(`  ${v.year}  ${v.value}  ${v.kind}`);
  }
}
