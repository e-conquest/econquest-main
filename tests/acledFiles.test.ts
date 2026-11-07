import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync, strToU8 } from 'fflate';
import { acledFileReading, addAcledTable, csvRows, emptyAcledFileData, parseAcledWeek } from '../src/utils/acledFiles.ts';
import { acledFileData, loadAcledFolder } from '../src/utils/acledFileStore.ts';
import { toXlsx } from '../src/utils/xlsxExport.ts';
import { acledFigures } from '../src/utils/politicsEvents.ts';
import { checkConnections } from '../src/utils/connectionCheck.ts';

const NOW = new Date('2026-11-06T12:00:00Z');
// The column layout on acleddata.com/use-access/how-use-acleds-aggregated-data (hand-made rows, not ACLED data).
const HEADER = ['WEEK', 'REGION', 'COUNTRY', 'ADMIN1', 'DISORDER_TYPE', 'EVENT_TYPE', 'SUB_EVENT_TYPE', 'EVENTS', 'FATALITIES', 'POPULATION_BEST', 'CENTROID_LONGITUDE', 'CENTROID_LATITUDE'];

/** Saturdays from 2025-11-01 to 2026-10-24 (the week of 10-24 ends 10-30, so October is not whole). */
function saturdays(from = '2025-11-01', to = '2026-10-24'): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 7 * 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function table(weeks = saturdays()): string[][] {
  const rows: string[][] = [HEADER];
  for (const w of weeks) {
    rows.push([w, 'Latin America & the Caribbean', 'Mexico', 'Guerrero', 'Political violence', 'Battles', 'Armed clash', '3', '2', '50000', '-99.9', '17.4']);
    rows.push([w, 'Latin America & the Caribbean', 'Mexico', 'Jalisco', 'Demonstrations', 'Protests', 'Peaceful protest', '1', '0', '80000', '-103.3', '20.6']);
    rows.push([w, 'Latin America & the Caribbean', 'Guatemala', 'Guatemala', 'Demonstrations', 'Protests', 'Peaceful protest', '1', '0', '10000', '-90.5', '14.6']);
  }
  return rows;
}

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');

test('week cells: ISO, Excel serial, text month and slash dates read as the Saturday', () => {
  assert.equal(parseAcledWeek('2026-10-24'), '2026-10-24');
  assert.equal(parseAcledWeek('2026-10-24 00:00:00'), '2026-10-24');
  assert.equal(parseAcledWeek('46319'), '2026-10-24');
  assert.equal(parseAcledWeek('24 October 2026'), '2026-10-24');
  assert.equal(parseAcledWeek('24-Oct-2026'), '2026-10-24');
  assert.equal(parseAcledWeek('10/24/2026'), '2026-10-24');
  assert.equal(parseAcledWeek('03/10/2026'), '2026-10-03'); // 3 Oct is the Saturday, 10 Mar is not
  assert.equal(parseAcledWeek('week 43'), null);
});

test('weekly Admin 1 rows add up into country months; only whole months are used', () => {
  const data = emptyAcledFileData();
  assert.ok(addAcledTable(data, 'LatinAmerica.csv', table(), '2026-11-01T00:00:00.000Z'));
  const r = acledFileReading(data, 'mexico', NOW)!;
  assert.equal(r.country, 'Mexico');
  // Newest week starts 2026-10-24 and ends 10-30, so October is not whole: the window ends in September.
  assert.equal(r.latestEventDate, '2026-10-30');
  assert.equal(r.total.from, '2025-10');
  assert.equal(r.total.to, '2026-09');
  assert.equal(r.months[0].events, 0); // October 2025: before the file starts
  const nov = r.months[1];
  assert.equal(nov.month, '2025-11');
  assert.equal(nov.events, 5 * 4); // five Saturdays, 3 battles + 1 protest each
  assert.equal(nov.fatalities, 5 * 2);
  assert.deepEqual(nov.byType, { Battles: 15, Protests: 5 });
  assert.equal(r.fromFile?.file, 'LatinAmerica.csv');
  assert.equal(r.pulledAt, '2026-11-01T00:00:00.000Z');
  assert.equal(acledFileReading(data, 'Peru', NOW), null);
});

test('a file that ends early: the window ends at its last whole month, and the figures say how old it is', () => {
  const data = emptyAcledFileData();
  addAcledTable(data, 'old.csv', table(saturdays('2025-01-04', '2026-05-30')), '2026-06-02T00:00:00.000Z'); // last week 05-30..06-05
  const r = acledFileReading(data, 'Mexico', NOW)!;
  assert.equal(r.total.to, '2026-05');
  const f = acledFigures(r, NOW);
  assert.match(f.figures[0].source, /aggregated file you downloaded \(old\.csv, saved 2026-06-02, weeks to 2026-06-05\)/);
  assert.match(f.figures[0].source, /download a newer one from myACLED/);
  assert.equal(f.figures[0].tag, 'official');
});

test('not an aggregated file: listed as not read, with the columns it needs', () => {
  const data = emptyAcledFileData();
  assert.equal(addAcledTable(data, 'events.csv', [['event_id_cnty', 'event_date', 'country'], ['MEX1', '2026-01-01', 'Mexico']], ''), false);
  assert.match(data.skipped[0].reason, /needs the columns week, country, event_type, events, fatalities/);
});

test('csv read in pieces gives the same rows as one piece', () => {
  const text = csv(table());
  const rows = [...csvRows(strToU8(text))];
  assert.equal(rows.length, table().length);
  assert.deepEqual(rows[1], table()[1]);
});

test('folder: .xlsx, .csv and .zip are read; the file reaching later wins a country; cached until a file changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acled-'));
  const folder = path.join(dir, 'local', 'acled');
  assert.equal(acledFileData(dir), null);
  fs.mkdirSync(folder, { recursive: true });
  const t = table();
  fs.writeFileSync(path.join(folder, 'LatinAmerica.xlsx'), toXlsx([{ name: 'Sheet1', header: t[0], rows: t.slice(1) }]));
  fs.writeFileSync(path.join(folder, 'older.zip'), zipSync({ 'older.csv': strToU8(csv(table(saturdays('2025-01-04', '2026-03-28')))) }));
  fs.writeFileSync(path.join(folder, 'notes.csv'), 'a,b\n1,2\n');
  const data = loadAcledFolder(folder)!;
  assert.equal(data.files.length, 2);
  assert.equal(data.skipped.length, 1);
  const r = acledFileReading(data, 'Mexico', NOW)!;
  assert.equal(r.fromFile?.file, 'LatinAmerica.xlsx');
  assert.equal(r.total.to, '2026-09');
  assert.equal(r.months[1].events, 20);
  const a = acledFileData(dir);
  assert.equal(acledFileData(dir), a);
  fs.rmSync(path.join(folder, 'LatinAmerica.xlsx'));
  assert.equal(acledFileReading(acledFileData(dir), 'Mexico', NOW)!.fromFile?.file, 'older.zip > older.csv');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('connection row: says what it read, or how to add a file', async () => {
  const run = async (acledFiles?: () => ReturnType<typeof loadAcledFolder>) => (await checkConnections({ env: {}, fetchFn: (async () => { throw new Error('no network'); }) as any, now: NOW, only: ['acled_files'], acledFiles })).results[0];
  assert.match((await run(() => null)).detail, /No ACLED aggregated file in data\/local\/acled\//);
  const data = emptyAcledFileData();
  addAcledTable(data, 'LatinAmerica.csv', table(), '2026-11-01T00:00:00.000Z');
  const ok = await run(() => data);
  assert.equal(ok.state, 'connected');
  assert.match(ok.detail, /LatinAmerica\.csv \(2 countries, weeks 2025-11-01 to 2026-10-24/);
  assert.match(ok.sample || '', /Mexico: \d+ events/);
});
