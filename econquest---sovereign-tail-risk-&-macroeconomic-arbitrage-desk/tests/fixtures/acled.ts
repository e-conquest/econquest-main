import { ACLED_CONTRACT, AcledEvent, AcledRun } from '../../src/services/acledApi';

export function acledEvent(): AcledEvent {
  return { eventId: 'FIX1', eventDate: '2026-10-20', country: 'Synthetic country', eventType: 'Protests',
    subEventType: 'Peaceful protest', disorderType: 'Demonstrations', timePrecision: 2, geoPrecision: 3, isoNumeric: 268,
    fatalities: 0, latitude: 0, longitude: 0, updatedAt: '2026-10-20T00:00:00Z', publishedAt: null, sourceHash: 'a'.repeat(64),
    attributes: { event_id_cnty: 'FIX1', event_date: '2026-10-20', country: 'Synthetic country', event_type: 'Protests',
      sub_event_type: 'Peaceful protest', disorder_type: 'Demonstrations', year: '2026', time_precision: '2',
      geo_precision: '3', iso: '268', fatalities: '0', latitude: '0', longitude: '0', timestamp: '1792454400',
      actor1: 'Synthetic actor', actor2: '', source: 'Synthetic source', source_scale: 'National',
      notes: '<script>synthetic text, never execute</script>', location: 'Synthetic location' } };
}
export function acledRun(complete = false): AcledRun {
  const params = new URLSearchParams({ event_date: '2026-09-21|2026-10-20', event_date_where: 'BETWEEN',
    limit: '5000', page: '1', _format: 'json', export_type: 'dyadic', with_total: 'true' });
  return { id: 'acled-synthetic-not-empirical', createdAt: '2026-10-21T00:00:00Z', status: complete ? 'staged' : 'interrupted',
    active: false, progress: {}, report: { contractVersion: ACLED_CONTRACT, startDate: '2026-09-21', endDate: '2026-10-20',
      errors: complete ? [] : ['Synthetic unverified page'], rowCount: 1, expectedRows: 1, transportComplete: complete,
      consistencyVerified: complete, countries: [{ name: 'Synthetic country', count: 1 }], eventTypes: ['Protests'],
      limitation: 'Synthetic test fixture; not empirical conflict evidence.' },
    sources: Array.from({ length: complete ? 2 : 1 }, (_, i) => ({ ordinal: i + 1,
      path: `https://acleddata.com/api/acled/read?${params}`, httpStatus: 200, sha256: 'a'.repeat(64), bytes: 10,
      retrievedAt: '2026-10-21T00:00:00Z' })), chunks: [{ page: 1, rowCount: 1 }] };
}
