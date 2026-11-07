/**
 * GDELT 1.0 event files: file list, the 57- and 58-column layouts, streaming a zip through, month
 * files that never count a file twice, and the long-run reading.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { v1Figures, filesFrom, lineSplitter, parseFileSizes, v1FromMonth, v1Reader, v1Reading, v1Series, type V1Month } from '../src/utils/gdeltDaily.ts';
import { gdeltDailyDir, gdeltDailySeries, loadMonth, pullGdeltDaily } from '../src/utils/gdeltDailyStore.ts';
import { emptyEventAgg } from '../src/utils/gdeltRaw.ts';

/** A row in the GDELT 1.0 layout: ActionGeo country at 51; 57 columns (backfile) or 58 (daily). */
function row(o: { date: string; a1?: string; a2?: string; geo?: string; root: string; code?: string; quad: number; gold: number; tone?: number }, daily: boolean): string {
  const c = Array.from({ length: daily ? 58 : 57 }, () => '');
  c[0] = '1';
  c[1] = o.date;
  c[7] = o.a1 || '';
  c[17] = o.a2 || '';
  c[26] = o.code || `${o.root}0`;
  c[28] = o.root;
  c[29] = String(o.quad);
  c[30] = String(o.gold);
  c[33] = '3';
  c[34] = String(o.tone ?? -2);
  c[51] = o.geo || '';
  if (daily) c[57] = 'https://example.org/a';
  return c.join('\t');
}

const SIZES = ['1088704384 GDELT.MASTERREDUCEDV2.1979-2013.zip', '14276482 1979.zip', '10975322 200601.zip', '1729307 20130401.export.CSV.zip', '7259875 20160101.export.CSV.zip', '7300000 20160102.export.CSV.zip'].join('\n');

test('file list: kinds, periods, the master file left out, GDELT_DAILY_FROM', () => {
  const files = parseFileSizes(SIZES);
  assert.deepEqual(files.map((f) => `${f.kind}:${f.period}`), ['year:1979', 'month:2006-01', 'day:2013-04-01', 'day:2016-01-01', 'day:2016-01-02']);
  assert.equal(files[0].months.length, 12);
  assert.equal(v1FromMonth({}), '2016-01');
  assert.equal(v1FromMonth({ GDELT_DAILY_FROM: '1979' }), '1979-01');
  assert.equal(filesFrom(files, '2016-01').length, 2);
  assert.equal(filesFrom(files, '1979-06').length, 5, 'a year file counts when any of its months is in range');
});

test('rows: place from ActionGeo (FIPS) or either actor; backfile by event month, daily by file month', () => {
  const back = v1Reader({ keepMonths: new Set(['1979-03']) });
  back.line(row({ date: '19790315', geo: 'BR', root: '14', quad: 3, gold: -6.5 }, false));
  back.line(row({ date: '19790320', a1: 'BRA', a2: 'ARG', root: '19', quad: 4, gold: -10 }, false));
  back.line(row({ date: '19790420', geo: 'BR', root: '05', quad: 1, gold: 3 }, false));
  back.line('too\tshort');
  const t = back.result();
  assert.equal(t.skipped, 1);
  assert.equal(t.months['1979-03'].world, 2);
  assert.equal(t.months['1979-04'], undefined, 'months outside the file range are not kept');
  const br = t.months['1979-03'].countries.BRA;
  assert.equal(br.n, 2);
  assert.equal(br.protests, 1);
  assert.equal(br.violence, 1);
  assert.equal(t.months['1979-03'].countries.ARG.n, 1);
  const day = v1Reader({ fileMonth: '2016-01' });
  day.line(row({ date: '20151201', geo: 'CI', root: '16', code: '163', quad: 4, gold: -8 }, true));
  assert.equal(day.result().months['2016-01'].countries.CHL.sanctions, 1, 'Chile is CI in FIPS; counted in the file month');
});

test('line splitter joins lines broken across chunks', () => {
  const got: string[] = [];
  const s = lineSplitter((l) => got.push(l));
  s.push('ab\r\nc');
  s.push('d\ne');
  s.end();
  assert.deepEqual(got, ['ab', 'cd', 'e']);
});

test('pull streams the zips, saves months, and a second pull adds nothing twice', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gdelt-v1-'));
  const z = (name: string, rows: string[]) => zipSync({ [name.replace('.zip', '')]: strToU8(rows.join('\n') + '\n') });
  const bodies: Record<string, Uint8Array> = {
    '20160101.export.CSV.zip': z('20160101.export.CSV.zip', [row({ date: '20160101', geo: 'TU', root: '14', quad: 3, gold: -6 }, true), row({ date: '20160101', geo: 'FR', root: '04', quad: 1, gold: 1 }, true)]),
  };
  const seen: string[] = [];
  const fetchImpl = async (url: string) => {
    seen.push(url);
    if (url.endsWith('/filesizes')) return new Response(SIZES);
    const name = url.split('/').pop()!;
    if (bodies[name]) return new Response(new Blob([bodies[name] as Uint8Array<ArrayBuffer>]).stream());
    return new Response('not found', { status: 404 });
  };
  const r1 = await pullGdeltDaily({ dataDir, fromMonth: '2016-01', fetchImpl, concurrency: 1 });
  assert.equal(r1.read, 1);
  assert.equal(r1.missing, 1, '20160102 answered 404');
  const jan = loadMonth(gdeltDailyDir(dataDir), '2016-01');
  assert.equal(jan.world, 2);
  assert.equal(jan.countries.TUR.protests, 1);
  const r2 = await pullGdeltDaily({ dataDir, fromMonth: '2016-01', fetchImpl, concurrency: 1 });
  assert.equal(r2.note, 'Up to date');
  assert.equal(loadMonth(gdeltDailyDir(dataDir), '2016-01').world, 2);
  const s = gdeltDailySeries(dataDir, 'TUR')!;
  assert.equal(s.points[0].sharePct, 50);
  assert.equal(s.points[0].dailyFiles, 1);
});

test('reading needs 24 complete months and ranks the latest against them', () => {
  const months: V1Month[] = Array.from({ length: 30 }, (_, i) => {
    const month = `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    const a = emptyEventAgg();
    a.n = 100;
    a.protests = i === 29 ? 30 : 5 + (i % 5);
    a.goldsteinSum = i === 29 ? -400 : 50;
    return { month, files: [`${month.replace('-', '')}.zip`], world: 10000, countries: { ARG: a } };
  });
  const r = v1Reading(v1Series('ARG', months))!;
  assert.equal(r.month, '2022-06');
  assert.equal(r.months, 29);
  assert.equal(r.protestPct, 30);
  assert.equal(r.protestPctile, 100);
  assert.equal(r.goldsteinPctile, 0, 'the most conflictual month on record');
  assert.equal(v1Reading(v1Series('ARG', months.slice(0, 20))), null);
});

test('agent figures name GDELT 1.0 and the history; a 90th-percentile month gets a sentence', () => {
  const r = { month: '2026-09', months: 100, from: '2018-05', protestPct: 30, violencePct: 2, goldsteinMean: 0.5, protestPctile: 99, violencePctile: 40, goldsteinPctile: 50, pulledAt: '2026-11-06T00:00:00Z' };
  const out = v1Figures(r);
  assert.ok(out.figures.every((f) => f.source.startsWith('GDELT 1.0 event files, pulled 2026-11-06; 100 months from 2018-05')));
  assert.match(out.figures[0].value, /30% \(99th percentile\)/);
  assert.equal(out.sentences.length, 1);
  assert.equal(out.weight, 0.5);
});
