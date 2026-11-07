/**
 * `npm run sanctions:pull`: downloads the OFAC and UN sanctions lists into data/local/sanctions/
 * (src/utils/sanctionsLists.ts). Each file is kept only if it reads as that list; an older copy is
 * replaced only by one that reads. If a site refuses automated downloads, nothing is forced:
 * download the file by hand from the page named and save it in the same folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanctionsDir } from '../src/utils/sanctionsStore.ts';
import { addOfacCsv, addUnXml, emptySanctionsData, SANCTIONS_LISTS } from '../src/utils/sanctionsLists.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dir = sanctionsDir(dataDir);
fs.mkdirSync(dir, { recursive: true });

const OFAC = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/';
const FILES: Array<{ name: string; urls: string[]; page: string; check: (text: string) => boolean }> = [
  ...['SDN.CSV', 'ADD.CSV', 'CONS_PRIM.CSV', 'CONS_ADD.CSV'].map((name) => ({
    name,
    urls: [`${OFAC}${name}`, `https://www.treasury.gov/ofac/downloads/${name.toLowerCase().replace('cons_', 'consolidated/cons_')}`],
    page: SANCTIONS_LISTS.ofac_sdn.url,
    check: (t: string) => {
      if (!name.includes('ADD')) {
        const d = emptySanctionsData();
        addOfacCsv(d, 'ofac_sdn', name, t, '');
        return d.entries.length > 0;
      }
      return /^"?\d+"?,/.test(t.trimStart());
    },
  })),
  {
    name: 'consolidated.xml',
    urls: ['https://scsanctions.un.org/resources/xml/en/consolidated.xml'],
    page: SANCTIONS_LISTS.un.url,
    check: (t: string) => {
      const d = emptySanctionsData();
      addUnXml(d, 'consolidated.xml', t);
      return d.entries.length > 0;
    },
  },
];

const missed: string[] = [];
for (const f of FILES) {
  const tried: string[] = [];
  let ok = false;
  for (const url of f.urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { Accept: '*/*', 'User-Agent': 'econquest open-source research' } });
      if (!r.ok) {
        tried.push(`HTTP ${r.status}`);
        continue;
      }
      const text = await r.text();
      if (!f.check(text)) {
        tried.push('did not read as the list');
        continue;
      }
      fs.writeFileSync(path.join(dir, f.name), text);
      console.log(`Saved ${f.name} (${(text.length / 1e6).toFixed(1)} MB) from ${url}`);
      ok = true;
      break;
    } catch (e: any) {
      tried.push(String(e?.message || e));
    }
  }
  if (!ok) missed.push(`${f.name}: ${tried.join('; ')} (download it by hand from ${f.page})`);
}
if (missed.length) {
  console.log(`\nNot saved (${missed.length}):`);
  for (const m of missed) console.log(`  ${m}`);
}
console.log(`\nFolder: ${dir}`);
