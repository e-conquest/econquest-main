import { GDELT_COLUMNS, GDELT_CONTRACT, type GdeltEvent, type GdeltRun } from '../../src/services/gdeltApi';

export function gdeltEvent(): GdeltEvent {
  const attributes = Object.fromEntries(GDELT_COLUMNS.map(k => [k, '']));
  Object.assign(attributes, { GLOBALEVENTID: '123', SQLDATE: '20251020', MonthYear: '202510', Year: '2025',
    EventCode: '010', EventBaseCode: '010', EventRootCode: '01', QuadClass: '1', IsRootEvent: '0',
    Actor1CountryCode: 'USA', Actor1Name: 'SYNTHETIC ACTOR', ActionGeo_CountryCode: 'RS', ActionGeo_Type: '1',
    GoldsteinScale: '0', AvgTone: '-2.5', NumMentions: '0', NumSources: '1', NumArticles: '2',
    DATEADDED: '20261020000000', SOURCEURL: 'https://example.com/synthetic-not-evidence' });
  return { eventId: '123', eventDate: '2025-10-20', interval: '20261020000000', dateAdded: '2026-10-20T00:00:00+00:00',
    country: 'RS', actor1Country: 'USA', actor2Country: null, eventCode: '010', eventRootCode: '01', quadClass: 1,
    goldstein: 0, tone: -2.5, mentions: 0, sources: 1, articles: 2, latitude: null, longitude: null,
    sourceUrl: attributes.SOURCEURL, sourceUrlSafe: true, publishedAt: null, sourceHash: 'a'.repeat(64), attributes };
}
export function gdeltRun(complete = false): GdeltRun {
  const expectedIntervals = Array.from({ length: 96 }, (_, i) => `20261020${String(Math.floor(i / 4)).padStart(2, '0')}${String(i % 4 * 15).padStart(2, '0')}00`);
  return {
    id: 'gdelt-synthetic-not-empirical', createdAt: '2026-10-21T00:00:00Z', status: complete ? 'staged' : 'interrupted', active: false,
    progress: {}, report: { contractVersion: GDELT_CONTRACT, day: '2026-10-20', errors: complete ? [] : ['Synthetic missing interval'],
      transportComplete: complete, rowCount: 1, completedIntervals: complete ? 96 : 1, expectedIntervals,
      countries: [{ code: 'RS', count: 1 }], limitation: 'Synthetic test fixture; not empirical event evidence.' },
    sources: expectedIntervals.slice(0, complete ? 96 : 1).map((interval, i) => ({ ordinal: i + 1,
      path: `https://data.gdeltproject.org/gdeltv2/${interval}.export.CSV.zip`, sha256: 'a'.repeat(64), httpStatus: 200,
      bytes: 10, retrievedAt: '2026-10-21T00:00:00Z' })),
    chunks: expectedIntervals.slice(0, complete ? 96 : 1).map((interval, i) => ({ interval, rowCount: i === 0 ? 1 : 0 })),
  };
}
