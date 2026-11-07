import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { loadSpecs } from '../src/utils/backtestRun';
import type { ForecastSpec } from '../src/utils/forecastEval';
import { FORECAST_MODELS } from '../src/utils/forecasts';
import { NOWCAST_PARAMS, PUBLICATION_LAG_DAYS } from '../src/utils/nowcast';
import { runForecastEvaluations } from '../src/utils/forecastEvalRun';
import { FAN_SEED } from '../src/utils/debtFan';
import { DSA_HORIZON } from '../src/utils/debtSustainability';

const DIR = path.join(process.cwd(), 'docs', 'validation', 'forecasts');

test('every registered nowcast/forecast evaluation matches its hash in manifest.json', () => {
  const specs = loadSpecs(DIR);
  assert.equal(specs.length, 10);
  for (const s of specs) assert.equal(s.problem, undefined, `${s.file}: ${s.problem}`);
});

test('the registered rules are the ones the app runs (no silent drift between spec and code)', () => {
  // The newest version of each evaluation is the one the app must match.
  const byId: Record<string, ForecastSpec> = {};
  for (const s of loadSpecs(DIR)) {
    const sp = s.spec as unknown as ForecastSpec;
    if (!byId[sp.id] || sp.version > byId[sp.id].version) byId[sp.id] = sp;
  }
  const same = (id: string, m: (typeof FORECAST_MODELS)[keyof typeof FORECAST_MODELS]) => {
    const p = byId[id].params;
    assert.equal(p.maxLag, m.maxLag, `${id} maxLag`);
    assert.equal(p.d, m.d, `${id} d`);
    assert.equal(p.intercept !== 0, m.intercept, `${id} intercept`);
    assert.equal(p.window, m.window, `${id} window`);
  };
  same('gdp_forecast', FORECAST_MODELS.gdp_qoq);
  same('cpi_forecast', FORECAST_MODELS.cpi_yoy);
  same('cpi_nowcast', FORECAST_MODELS.cpi_yoy);
  same('policy_rate_forecast', FORECAST_MODELS.policy_rate);
  same('debt_forecast', FORECAST_MODELS.debt_gdp);
  assert.equal(byId.cpi_nowcast.params.window, NOWCAST_PARAMS.cpiWindow, 'cpi nowcast window');
  const n = byId.gdp_nowcast.params;
  assert.equal(n.gdpLagDays, PUBLICATION_LAG_DAYS.gdp);
  assert.equal(n.activityLagDays, PUBLICATION_LAG_DAYS.activity);
  assert.equal(n.cliLagDays, PUBLICATION_LAG_DAYS.cli);
  assert.equal(n.targetLags, NOWCAST_PARAMS.targetLags);
  assert.equal(n.monthlyMaxLag, NOWCAST_PARAMS.monthlyMaxLag);
  assert.equal(n.minQuarters, NOWCAST_PARAMS.minQuarters);
  // The fan coverage test rebuilds the panel's fan: same seed, at most the panel's horizon.
  const fan = byId.debt_fan_coverage.params;
  assert.equal(fan.seed, FAN_SEED, 'fan coverage seed');
  assert.ok(fan.horizons <= DSA_HORIZON, 'fan coverage horizons');
});

test('a changed spec file is refused, and a run with no data answers says so instead of passing anything', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
  fs.copyFileSync(path.join(DIR, 'manifest.json'), path.join(dir, 'manifest.json'));
  const txt = fs.readFileSync(path.join(DIR, 'gdp_forecast.json'), 'utf8').replace('"maxLag": 4', '"maxLag": 5');
  fs.writeFileSync(path.join(dir, 'gdp_forecast.json'), txt);
  fs.copyFileSync(path.join(DIR, 'debt_forecast.json'), path.join(dir, 'debt_forecast.json'));
  const out = await runForecastEvaluations({ specDir: dir, resultFile: path.join(dir, 'out', 'forecasts.json'), fetcher: async () => { throw new Error('offline'); } });
  assert.ok(out.problems.some((p) => /gdp_forecast\.json: the file changed after it was registered/.test(p)));
  assert.equal(out.results.gdp_forecast, undefined);
  assert.equal(out.results.debt_forecast.status, 'too_few_cases');
  assert.ok(out.problems.some((p) => /IMF debt did not answer/.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});
