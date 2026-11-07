import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  aggregateEvents,
  aggregateGkg,
  buildSeries,
  parseFileList,
  slotOf,
  slotsBetween,
  themeGroup,
  weekStart,
} from '../src/utils/gdeltRaw.ts';
import { filesLeft, gdeltRawConfig, gdeltRawDir, loadDay, pullGdeltRaw, readCountrySeries, type FetchLike } from '../src/utils/gdeltRawStore.ts';

/** An events row (61 columns) with the fields the app reads. */
function eventRow(o: { a1?: string; a2?: string; place?: string; code: string; quad: number; gold: number; tone: number; arts?: number }): string {
  const c = new Array(61).fill('');
  c[0] = '1';
  c[7] = o.a1 || '';
  c[17] = o.a2 || '';
  c[26] = o.code;
  c[27] = o.code.slice(0, 3);
  c[28] = o.code.slice(0, 2);
  c[29] = String(o.quad);
  c[30] = String(o.gold);
  c[33] = String(o.arts ?? 1);
  c[34] = String(o.tone);
  c[53] = o.place || '';
  c[60] = 'https://example.org/a';
  return c.join('\t');
}
/** A GKG 2.1 row (27 columns). */
function gkgRow(o: { themes: string[]; fips: string[]; tone: number; persons?: string[]; orgs?: string[] }): string {
  const c = new Array(27).fill('');
  c[0] = 'x';
  c[7] = o.themes.join(';');
  c[9] = o.fips.map((f) => `1#Place#${f}#${f}#0#0#X`).join(';');
  c[11] = (o.persons || []).join(';');
  c[13] = (o.orgs || []).join(';');
  c[15] = `${o.tone},1,2,3,4,5,600`;
  return c.join('\t');
}

const EVENTS = [
  eventRow({ place: 'BR', code: '141', quad: 3, gold: -6.5, tone: -4, arts: 10 }), // protest in Brazil
  eventRow({ a1: 'USA', a2: 'BRA', place: 'US', code: '163', quad: 4, gold: -8, tone: -6, arts: 4 }), // US sanctions on Brazil
  eventRow({ place: 'CI', code: '042', quad: 1, gold: 1.9, tone: 2 }), // Chile (FIPS CI, not ISO CL)
  eventRow({ place: 'SF', code: '190', quad: 4, gold: -10, tone: -8 }), // South Africa (FIPS SF)
  'too\tshort',
].join('\n');

const GKG = [
  gkgRow({ themes: ['ECON_INFLATION', 'TAX_FNCACT_MINISTER'], fips: ['BR'], tone: -3, persons: ['fernando haddad'], orgs: ['central bank of brazil'] }),
  gkgRow({ themes: ['ECON_CENTRALBANK', 'ECON_INTEREST_RATES'], fips: ['BR', 'US'], tone: -1, persons: ['fernando haddad', 'jerome powell'] }),
  gkgRow({ themes: ['SPORTS'], fips: ['BR'], tone: 5, persons: ['neymar'] }),
  gkgRow({ themes: ['ECON_CURRENCY_EXCHANGE_RATE'], fips: ['TU'], tone: -2 }),
].join('\n');

test('file list: size, md5, url, slot and table; bad lines skipped', () => {
  const list = parseFileList(
    [
      '150383 297a16b493de7cf6ca809a7cc31d0b93 http://data.gdeltproject.org/gdeltv2/20261105180000.export.CSV.zip',
      '318084 bb27f78ba45f69a17ea6ed7755e9f8ff http://data.gdeltproject.org/gdeltv2/20261105180000.mentions.CSV.zip',
      '10768507 ea8dde0beb0ba98810a92db068c0ce99 http://data.gdeltproject.org/gdeltv2/20261105180000.gkg.csv.zip',
      'garbage',
    ].join('\n'),
  );
  assert.deepEqual(list.map((f) => [f.table, f.slot, f.size]), [
    ['events', '20261105180000', 150383],
    ['mentions', '20261105180000', 318084],
    ['gkg', '20261105180000', 10768507],
  ]);
});

test('slots: every 15 minutes, GKG thinned on whole hours from midnight', () => {
  const to = '20261105030000';
  const from = Date.parse('2026-11-05T00:00:00Z');
  assert.equal(slotsBetween(from, to).length, 13);
  assert.deepEqual(slotsBetween(from, to, 180), ['20261105000000', '20261105030000']);
  assert.equal(slotOf(Date.parse('2026-11-05T18:14:59Z')), '20261105180000');
});

test('events: counted for the place (FIPS) and for each actor, once per country', () => {
  const { byCountry, rows, skipped } = aggregateEvents(EVENTS);
  assert.equal(rows, 4);
  assert.equal(skipped, 1);
  const bra = byCountry.BRA;
  assert.equal(bra.n, 2);
  assert.equal(bra.protests, 1);
  assert.equal(bra.sanctions, 1);
  assert.deepEqual(bra.quad, [0, 0, 1, 1]);
  assert.equal(bra.articles, 14);
  assert.equal(byCountry.USA.n, 1);
  assert.equal(byCountry.CHL.n, 1, 'Chile is CI in GDELT places');
  assert.equal(byCountry.ZAF.violence, 1, 'South Africa is SF');
});

test('GKG: articles per country by theme group, names only from economic articles', () => {
  assert.equal(themeGroup('ECON_INTEREST_RATES'), 'centralBank');
  assert.equal(themeGroup('ECON_CURRENCY_EXCHANGE_RATE'), 'currency');
  assert.equal(themeGroup('TAX_FNCACT_MINISTER'), undefined, 'functional-actor tags are not fiscal themes');
  const { byCountry } = aggregateGkg(GKG);
  const bra = byCountry.BRA;
  assert.equal(bra.docs, 3);
  assert.equal(bra.econDocs, 2);
  assert.deepEqual(bra.themes.inflation, { n: 1, toneSum: -3 });
  assert.deepEqual(bra.themes.centralBank, { n: 1, toneSum: -1 });
  assert.equal(bra.persons['fernando haddad'], 2);
  assert.equal(bra.persons.neymar, undefined, 'sports article is not economic');
  assert.equal(byCountry.TUR.themes.currency.n, 1);
});

test('weekly series: shares of articles, means, coverage, top names', () => {
  const ev = aggregateEvents(EVENTS).byCountry;
  const gk = aggregateGkg(GKG).byCountry;
  const day = { day: '2026-11-04', events: { done: ['1800'], missing: ['1815'] }, gkg: { done: ['1800'], missing: [] }, countries: { BRA: { ev: ev.BRA, gkg: gk.BRA } } };
  const s = buildSeries('BRA', [day]);
  assert.equal(weekStart('2026-11-04'), '2026-11-02');
  assert.equal(s.weeks.length, 1);
  const w = s.weeks[0];
  assert.equal(w.weekStart, '2026-11-02');
  assert.equal(w.events?.count, 2);
  assert.equal(w.events?.goldsteinMean, -7.25);
  assert.equal(w.gkg?.articles, 3);
  assert.equal(w.gkg?.themes.inflation.sharePct, 33.3);
  assert.equal(w.gkg?.themes.debt.toneMean, null, 'no articles = no tone, not zero');
  assert.deepEqual(w.coverage, { eventsFiles: 1, eventsMissing: 1, gkgFiles: 1, gkgMissing: 0, expectedFiles: 672 });
  assert.equal(s.topPersons[0].name, 'fernando haddad');
  assert.equal(s.latestFileAt, '2026-11-04T18:00:00.000Z');
  assert.equal(s.gkgSampleShare, 0.01);
  // A country with no rows in the files read still gets the week (zero counts are real counts).
  assert.equal(buildSeries('POL', [day]).weeks[0].events?.count, 0);
});

test('config: defaults 8 weeks and one GKG file every 3 hours; bad values ignored', () => {
  assert.deepEqual(gdeltRawConfig({}), { weeks: 8, gkgEveryMinutes: 180 });
  assert.deepEqual(gdeltRawConfig({ GDELT_RAW_WEEKS: '26', GDELT_GKG_EVERY_HOURS: '0.25' }), { weeks: 26, gkgEveryMinutes: 15 });
  assert.deepEqual(gdeltRawConfig({ GDELT_RAW_WEEKS: 'x', GDELT_GKG_EVERY_HOURS: '-1' }), { weeks: 8, gkgEveryMinutes: 180 });
});

/** A fake data.gdeltproject.org: latest slot 2026-11-05 01:00, one file missing, one failing. */
function fakeGdelt(opts: { latest?: string; missing?: string[]; fail?: string[]; status429?: boolean } = {}) {
  const latest = opts.latest || '20261105010000';
  const calls: string[] = [];
  const evZip = zipSync({ 'x.export.CSV': strToU8(EVENTS) });
  const gkgZip = zipSync({ 'x.gkg.csv': strToU8(GKG) });
  const reply = (status: number, body: Uint8Array | string) => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => (typeof body === 'string' ? strToU8(body) : body).slice().buffer as ArrayBuffer,
    text: async () => (typeof body === 'string' ? body : ''),
  });
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url.endsWith('lastupdate.txt')) {
      if (opts.status429) return reply(429, '');
      return reply(200, `${evZip.length} aa http://data.gdeltproject.org/gdeltv2/${latest}.export.CSV.zip\n${gkgZip.length} bb http://data.gdeltproject.org/gdeltv2/${latest}.gkg.csv.zip\n`);
    }
    const slot = url.match(/(\d{14})/)![1];
    if (opts.missing?.includes(slot)) return reply(404, '');
    if (opts.fail?.includes(slot)) return reply(500, '');
    return reply(200, url.includes('.gkg.') ? gkgZip : evZip);
  };
  return { fetchImpl, calls };
}

test('pull: reads files into day files, notes gaps, retries failures, carries on next time', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gdelt-raw-'));
  try {
    // One week back from 01:00 is 673 events files and 56 GKG files.
    const cfg = { weeks: 1, gkgEveryMinutes: 180 };
    const fake = fakeGdelt({ missing: ['20261105003000'], fail: ['20261105004500'] });
    const now = () => Date.parse('2026-11-05T01:10:00Z');
    // Stop after the first 6 files to check resuming.
    let n = 0;
    const first = await pullGdeltRaw({ dataDir, cfg, fetchImpl: fake.fetchImpl, now, concurrency: 1, shouldStop: () => n >= 6, onProgress: () => n++ });
    assert.equal(first.stopped, true);
    assert.equal(first.read.events + first.read.gkg + first.missing.events + first.failed.events, 6);
    const dir = gdeltRawDir(dataDir);
    const day = loadDay(dir, '2026-11-05');
    assert.ok(day.events.missing.includes('0030'));
    assert.ok(day.gkg.done.includes('0000'), 'newest files first: the midnight GKG file is read early');
    assert.ok(!day.events.done.includes('0045') && !day.events.missing.includes('0045'), 'a failed file is not marked, so it is tried again');

    const second = await pullGdeltRaw({ dataDir, cfg, fetchImpl: fake.fetchImpl, now, concurrency: 3 });
    assert.equal(second.stopped, false);
    assert.equal(second.left.events, 1, 'only the failing file is left');
    assert.match(second.note, /did not download \(tried again next time\)/);

    const s = readCountrySeries(dataDir, 'BRA')!;
    assert.ok(s.pulledAt);
    assert.ok(s.weeks.at(-1)!.events!.count > 0);
    assert.equal(s.weeks.at(-1)!.weekStart, '2026-11-02');

    // A third pull with nothing new asks only for the failing file.
    const before = fake.calls.length;
    await pullGdeltRaw({ dataDir, cfg, fetchImpl: fake.fetchImpl, now });
    assert.deepEqual(fake.calls.slice(before).map((u) => u.split('/').pop()), ['lastupdate.txt', '20261105004500.export.CSV.zip']);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pull: HTTP 429 pauses 15 minutes and asks nothing in between; old days pruned', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gdelt-raw-'));
  try {
    const dir = gdeltRawDir(dataDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '2025-01-01.json'), JSON.stringify({ day: '2025-01-01', events: { done: [], missing: [] }, gkg: { done: [], missing: [] }, countries: {} }));
    let t = Date.parse('2026-11-05T01:10:00Z');
    const now = () => t;
    const cfg = { weeks: 1, gkgEveryMinutes: 180 };
    const busy = fakeGdelt({ status429: true });
    const r1 = await pullGdeltRaw({ dataDir, cfg, fetchImpl: busy.fetchImpl, now });
    assert.ok(r1.pausedUntil);
    const r2 = await pullGdeltRaw({ dataDir, cfg, fetchImpl: busy.fetchImpl, now });
    assert.match(r2.note, /trying again in 15 minutes/);
    assert.equal(busy.calls.length, 1);
    t += 16 * 60 * 1000;
    const ok = fakeGdelt();
    const left = filesLeft(dir, '20261105010000', cfg);
    assert.ok(left.events.length > 600);
    const r3 = await pullGdeltRaw({ dataDir, cfg, fetchImpl: ok.fetchImpl, now, concurrency: 8 });
    assert.equal(r3.pausedUntil, undefined);
    assert.ok(!readdirSync(dir).includes('2025-01-01.json'), 'days older than the look-back are deleted');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

import { gdeltRawReading, isEventSurge, type GdeltRawSeries, type GdeltRawWeek } from '../src/utils/gdeltRaw.ts';
import { politicsFromSnapshot, rawGdeltFigures } from '../src/utils/politicsEvents.ts';
import { councilInputs } from '../src/utils/councilInputs.ts';

function week(weekStart: string, count: number, protests: number, inflationShare: number): GdeltRawWeek {
  return {
    weekStart,
    coverage: { eventsFiles: 672, eventsMissing: 0, gkgFiles: 56, gkgMissing: 0, expectedFiles: 672 },
    events: { count, byQuad: {}, topRoots: [], protests, sanctions: 0, violence: 1, goldsteinMean: -1, toneMean: -2, articles: count * 3 },
    gkg: { articles: 1000, toneMean: -2.5, themes: { inflation: { label: 'Inflation and prices', articles: inflationShare * 10, sharePct: inflationShare, toneMean: -3 }, debt: { label: 'Debt, default and bankruptcy', articles: 0, sharePct: 0, toneMean: null } } },
  };
}
const SERIES: GdeltRawSeries = {
  iso3: 'BRA',
  latestFileAt: '2026-11-05T18:00:00.000Z',
  pulledAt: '2026-11-05T18:10:00.000Z',
  weeks: [week('2026-10-05', 100, 4, 5), week('2026-10-12', 110, 5, 5), week('2026-10-19', 90, 3, 5), week('2026-10-26', 200, 12, 12), week('2026-11-02', 40, 1, 6)],
  topPersons: [{ name: 'fernando haddad', articles: 40 }],
  topOrgs: [{ name: 'central bank of brazil', articles: 30 }],
  gkgSampleShare: 0.125,
};

test('reading: latest complete week against the weeks before; the week in progress is not used', () => {
  const r = gdeltRawReading(SERIES)!;
  assert.equal(r.weekStart, '2026-10-26');
  assert.equal(r.complete, true);
  assert.equal(r.baselineWeeks, 3);
  assert.equal(r.events?.baseline?.count, 100);
  assert.equal(r.events?.changePct, 100);
  assert.ok(isEventSurge(r));
  assert.deepEqual(r.gkg?.themes.map((t) => t.id), ['inflation'], 'themes with no articles are left out');
  assert.equal(r.gkg?.themes[0].baselineSharePct, 5);
  // Only a week in progress on disk: shown as in progress, no comparison, no surge.
  const partial = gdeltRawReading({ ...SERIES, weeks: [week('2026-11-02', 40, 1, 6)] })!;
  assert.equal(partial.complete, false);
  assert.equal(partial.events?.baseline, undefined);
  assert.equal(isEventSurge(partial), false);
  assert.equal(gdeltRawReading(null), null);
});

test('Politics & Events Agent: event counts, surge rule and themes, each with its source', () => {
  const r = gdeltRawReading(SERIES)!;
  const { figures, sentences, surge } = rawGdeltFigures(r);
  assert.equal(surge, true);
  assert.match(figures[0].value, /^200 events: 12 protests, 0 sanctions or embargoes, 1 violent vs 100 a week on average over the 3 weeks before \(\+100%\)/);
  assert.match(figures[0].source, /GDELT 2\.0 events files, pulled 2026-11-05/);
  assert.ok(figures.some((f) => f.label === 'Event reading' && f.tag === 'model'));
  const themes = figures.find((f) => f.label.startsWith('Economic themes'))!;
  assert.match(themes.value, /Inflation and prices 12% \(before 5%\)/);
  assert.match(themes.source, /12\.5% of GKG files read/);
  assert.ok(sentences.some((s) => /Protests rose to 12, against 4 a week before/.test(s)));
  assert.ok(sentences.some((s) => /inflation and prices/.test(s)));
});

test('council inputs: GDELT raw lines when pulled, MISSING otherwise', () => {
  const base = { iso3: 'BRA', countryName: 'Brazil', currencyCode: 'BRL', liveFields: {}, imfIndicators: {}, worldBankIndicators: {}, monetaryAndMarket: {}, gdeltMetrics: { averageTone: 0, conflictIntensityIndex: 0, articleCount24h: 0, topHeadlines: [] } } as any;
  const without = councilInputs(base).lines;
  assert.ok(without.includes('- GDELT weekly events: MISSING (GDELT raw files not pulled yet)'));
  const withRaw = councilInputs({ ...base, gdeltRaw: gdeltRawReading(SERIES) }).lines;
  assert.ok(withRaw.some((l) => /^- GDELT events, week of 2026-10-26: 200 events, 12 protests/.test(l)));
  assert.ok(withRaw.some((l) => /^- GDELT economic themes, share of 1000 articles .*Inflation and prices 12% \(before 5%\)/.test(l)));
  assert.equal(politicsFromSnapshot({ ...base, gdeltRaw: gdeltRawReading(SERIES) })?.raw?.weekStart, '2026-10-26');
});
