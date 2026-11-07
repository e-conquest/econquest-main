import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSnapshotSync } from '../src/utils/syncMessages.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import type { OpenDataSnapshot } from '../src/types/council.ts';

const snap = (sources: string[] | null, extra: Partial<OpenDataSnapshot> = {}): OpenDataSnapshot => {
  const s = { ...buildBaselineOpenData('MEX'), ...extra };
  if (sources === null) delete (s as Partial<OpenDataSnapshot>).dataStatus;
  else s.dataStatus = { verifiedLiveSources: sources, checkedAt: '2026-11-04T12:00:00Z' };
  return s;
};

test('nothing answered: a warning, never a green tick', () => {
  const m = describeSnapshotSync(snap([]), 'Mexico');
  assert.equal(m.type, 'warning');
  assert.match(m.message, /no data source answered/);
  assert.match(m.message, /read Missing/);
  assert.doesNotMatch(m.message, /sample values/);
});

test('old snapshot without sources is flagged', () => {
  const m = describeSnapshotSync(snap(null), 'Mexico');
  assert.equal(m.type, 'warning');
  assert.match(m.message, /unverified/);
});

test('one feed is not "live data": partial, with the sample parts named', () => {
  const m = describeSnapshotSync(snap(['Frankfurter Spot FX']), 'Mexico');
  assert.equal(m.type, 'info');
  assert.equal(m.message, 'Mexico updated. Live: exchange rate. Still missing: debt and reserves, CDS, 10Y yield, policy rate and rating.');
});

test('full public data with an official yield and AI prices', () => {
  const m = describeSnapshotSync(
    snap(['IMF DataMapper WEO', 'World Bank Open Data v2', 'FRED / OECD 10Y government yield (monthly average)', 'Gemini web search'], {
      official10YYield: { valuePct: 9.35, period: '2026-09', source: 'OECD via FRED', seriesId: 'S', url: 'u' },
    }),
    'Mexico'
  );
  assert.equal(m.type, 'success');
  assert.equal(
    m.message,
    'Mexico updated. Live: IMF, World Bank and 10Y yield (official, Sep 2026 avg). AI estimates (not market prices): CDS, policy rate and rating.'
  );
});

test('Brazil Treasury yield is not mistaken for the US Treasury feed', () => {
  const m = describeSnapshotSync(
    snap(['Tesouro Direto (Brazil) NTN-F daily rate'], {
      official10YYield: { valuePct: 15.29, period: '2026-10-30', source: 'Brazil Treasury, Tesouro Direto', seriesId: 'NTN-F 2037', url: 'u', frequency: 'daily' },
    }),
    'Brazil'
  );
  assert.equal(m.message, 'Brazil updated. Live: 10Y yield (official, 30 Oct 2026). Still missing: debt and reserves, CDS, policy rate and rating.');
});
