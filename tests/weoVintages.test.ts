import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeoStore, decodeWeoBytes, parseWeoTable, publishedBy, vintageFromFileName, vintageLabel, weoAsOf, weoReleasesForYear } from '../src/utils/weoVintages.ts';

const HEADER = ['WEO Country Code', 'ISO', 'WEO Subject Code', 'Country', 'Subject Descriptor', 'Subject Notes', 'Units', 'Scale', 'Country/Series-specific Notes', '2016', '2017', '2018', '2019', '2020', 'Estimates Start After'];
const row = (iso: string, code: string, vals: string[], est: string) => ['1', iso, code, 'x', 'x', 'x', 'Percent change', '', 'x', ...vals, est].join('\t');
const table = (rows: string[]) => [HEADER.join('\t'), ...rows, '', 'International Monetary Fund, World Economic Outlook Database, October 2018'].join('\n');

const OCT2018 = table([
  row('TUR', 'NGDP_RPCH', ['3.2', '7.4', '3.5', '0.4', '2.6'], '2017'),
  row('TUR', 'GGXWDG_NGDP', ['28.3', '28.3', '29.5', '30.0', '30.4'], '2017'),
  row('TUR', 'NGDPD', ['863.7', '851.1', '713.5', '706.2', '749.1'], '2017'),
  row('BRA', 'PCPIPCH', ['8.7', '3.4', '3.7', '4.2', 'n/a'], '2017'),
]);
const APR2019 = table([row('TUR', 'NGDP_RPCH', ['3.2', '7.4', '2.6', '-2.5', '2.5'], '2018')]);

const latin1 = (s: string) => new Uint8Array([...s].map((ch) => ch.charCodeAt(0) & 0xff));
const utf16 = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) & 0xff;
    out[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return out;
};

test('edition from the file name, published by the end of its month', () => {
  assert.equal(vintageFromFileName('WEOOct2019all.xls'), '2019-10');
  assert.equal(vintageFromFileName('WEOApr2024all.xls'), '2024-04');
  assert.equal(vintageFromFileName('WEOSep2006all.xls'), '2006-09');
  assert.equal(vintageFromFileName('weo_october_2020.tsv'), '2020-10');
  assert.equal(vintageFromFileName('weo.xls'), null);
  assert.equal(publishedBy('2019-10'), '2019-10-31');
  assert.equal(publishedBy('2024-04'), '2024-04-30');
  assert.equal(vintageLabel('2019-10'), 'October 2019');
});

test('decodes Windows-1252 and UTF-16 files alike', () => {
  const text = 'ISO\tWEO Subject Code\tCôte';
  assert.equal(decodeWeoBytes(latin1(text)), text);
  assert.equal(decodeWeoBytes(utf16(text)), text);
});

test('keeps the chosen indicators, skips blanks, reads Estimates Start After', () => {
  const p = parseWeoTable(OCT2018);
  assert.ok('rows' in p);
  assert.deepEqual(Object.keys(p.rows).sort(), ['BRA', 'TUR']);
  assert.equal(p.rows.TUR.NGDPD, undefined, 'indicator not kept');
  assert.deepEqual(p.rows.BRA.PCPIPCH.years, { 2016: 8.7, 2017: 3.4, 2018: 3.7, 2019: 4.2 });
  assert.equal(p.rows.TUR.NGDP_RPCH.estimatesAfter, 2017);
  assert.match((parseWeoTable('<html>') as { reason: string }).reason, /No WEO header/);
});

test('weoAsOf picks the latest edition out by that date and tags each year', () => {
  const store = buildWeoStore([
    { name: 'WEOApr2019all.xls', bytes: utf16(APR2019) },
    { name: 'WEOOct2018all.xls', bytes: latin1(OCT2018) },
    { name: 'notes.txt', bytes: latin1('hello') },
  ]);
  assert.deepEqual(store.editions.map((e) => e.vintage), ['2018-10', '2019-04']);
  assert.equal(store.skipped.length, 1);
  assert.equal(weoAsOf(store, 'TUR', 'NGDP_RPCH', '2018-10-15'), null, 'October 2018 counts as out only on 31 October');
  const oct = weoAsOf(store, 'tur', 'NGDP_RPCH', '2019-03-01')!;
  assert.equal(oct.vintage, '2018-10');
  assert.deepEqual(oct.values.find((v) => v.year === '2019'), { year: '2019', value: 0.4, kind: 'projection' });
  assert.equal(oct.values.find((v) => v.year === '2017')!.kind, 'actual');
  const apr = weoAsOf(store, 'TUR', 'NGDP_RPCH', '2019-06-01')!;
  assert.equal(apr.vintage, '2019-04');
  assert.equal(apr.values.find((v) => v.year === '2018')!.kind, 'actual');
  assert.equal(weoAsOf(store, 'TUR', 'GGXWDG_NGDP', '2019-06-01')!.vintage, '2018-10', 'the newer edition lacks it, so the older one answers');
  assert.equal(weoAsOf(store, 'MEX', 'NGDP_RPCH', '2019-06-01'), null);
});

test('releases for a year show how the IMF number moved', () => {
  const store = buildWeoStore([
    { name: 'WEOOct2018all.xls', bytes: latin1(OCT2018) },
    { name: 'WEOApr2019all.xls', bytes: latin1(APR2019) },
  ]);
  assert.deepEqual(weoReleasesForYear(store, 'TUR', 'NGDP_RPCH', '2019'), [
    { vintage: '2018-10', value: 0.4, kind: 'projection' },
    { vintage: '2019-04', value: -2.5, kind: 'projection' },
  ]);
  assert.deepEqual(weoReleasesForYear(store, 'TUR', 'NGDP_RPCH', '2018').map((r) => r.kind), ['projection', 'actual']);
});

test('reads the saved files from data/local/weo-vintages', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { loadWeoVintages } = await import('../src/utils/weoVintagesStore.ts');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weo-'));
  assert.deepEqual(loadWeoVintages(dataDir, { fresh: true }), { editions: [], skipped: [] }, 'no folder reads as empty');
  fs.mkdirSync(path.join(dataDir, 'local', 'weo-vintages'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'local', 'weo-vintages', 'WEOOct2018all.xls'), Buffer.from(latin1(OCT2018)));
  const store = loadWeoVintages(dataDir, { fresh: true });
  assert.deepEqual(store.editions.map((e) => e.vintage), ['2018-10']);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('panel reply: every edition for one year, with a sentence', async () => {
  const { weoVintageReply } = await import('../src/utils/weoVintages.ts');
  const store = buildWeoStore([
    { name: 'WEOOct2018all.xls', bytes: latin1(OCT2018) },
    { name: 'WEOApr2019all.xls', bytes: latin1(APR2019) },
  ]);
  const r = weoVintageReply(store, 'tur', 'NGDP_RPCH', '2019');
  assert.equal(r.year, '2019');
  assert.deepEqual(r.years, ['2016', '2017', '2018', '2019', '2020']);
  assert.equal(r.releases.length, 2);
  assert.equal(r.releases[0].label, 'October 2018');
  assert.match(r.sentence!, /went from 0\.4 \(October 2018, projection\) to -2\.5 \(April 2019, projection\), down 2\.9 across 2 editions/);
  const none = weoVintageReply({ editions: [], skipped: [] }, 'TUR', 'NGDP_RPCH');
  assert.equal(none.year, null);
  assert.equal(none.releases.length, 0);
});
