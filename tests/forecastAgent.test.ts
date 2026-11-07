import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksForecast, forecastAnswer } from '../src/utils/forecastAgent';
import { seriesInQuestion } from '../src/utils/councilChart';

test('forecast questions bring the Nowcast & Forecast agent; others do not', () => {
  assert.ok(asksForecast('What is the outlook for Brazil growth?'));
  assert.ok(asksForecast('Where will inflation be next year in Mexico?'));
  assert.ok(asksForecast('Give me a nowcast for Poland GDP'));
  assert.ok(!asksForecast('Is the Brazilian real cheap?'));
});

test('figures are labelled app estimates with their evaluation status; IMF projections are labelled the IMF\'s; Missing keeps the reason', () => {
  const band = (lo: number, hi: number) => [{ level: 70 as const, lo, hi }];
  const a = forecastAnswer([
    {
      iso3: 'BRA',
      countryName: 'Brazil',
      nowcast: {
        gdp: { ok: true, target: 'gdp_qoq', label: '', unit: '%', asOf: '2026-11-06', lastPublished: { period: '2026-Q2', value: 0.4 }, points: [{ period: '2026-Q3', mean: 0.3, sd: 0.5, bands: band(-0.2, 0.8), how: 'Bridge equation on BCB IBC-Br: 2 of 3 months out, 1 forecast.', indicators: [] }], method: '', fit: { from: '', to: '', n: 1, sigma: 1 }, inputs: [], caveats: [] },
        cpi: { ok: false, target: 'cpi_yoy', reason: 'No monthly inflation series for this country.' },
      },
      forecast: {
        forecasts: [
          { ok: true, id: 'debt_gdp', label: 'Government debt forecast', unit: '% of GDP', freq: 'annual', lastObserved: { period: '2025', value: 87 }, history: [], path: [{ period: '2026', mean: 89, sd: 2, bands: band(87, 91) }], method: 'AR(1) on x. Bands: y', fit: { from: '', to: '', n: 1, p: 1, d: 1, sigma: 1 }, inputs: [], caveats: [], imf: { label: 'IMF WEO, projection', points: [{ period: '2026', value: 90 }], app: [], note: '' } },
        ],
        validation: { debt_forecast: { status: 'failed' } },
      },
    },
  ]);
  assert.equal(a.id, 'forecast');
  const f = a.findings[0].figures;
  assert.match(f[0].source, /^app nowcast, not validated advice \(not validated, evaluation not run yet\)/);
  assert.equal(f[0].tag, 'model');
  assert.match(f[1].source, /evaluation FAILED/);
  // A failed model is named in its label and in the reading, not only in the source line.
  assert.match(f[1].label, /^App forecast \(failed its out-of-sample test\), government debt/);
  assert.doesNotMatch(f[0].label, /failed/);
  assert.match(a.findings[0].reading, /Failed their pre-registered out-of-sample test: government debt; treat those figures as illustration/);
  assert.equal(f[2].tag, 'official');
  assert.match(f[2].source, /the IMF's forecast, not the app's/);
  assert.match(a.missing[0], /Brazil: inflation nowcast missing \(No monthly inflation series/);
});

test('the Chart Agent reads quarterly GDP and the activity index by name', () => {
  const ids = (q: string) => seriesInQuestion(q).map((s: { id: string }) => s.id);
  assert.ok(ids('chart quarterly GDP for Brazil').includes('gdp_qoq'));
  assert.ok(ids('plot the activity index against the leading indicator').includes('activity_monthly'));
});
