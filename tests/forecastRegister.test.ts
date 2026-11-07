import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastRegisterStatus, forecastVerdicts, worstSeries, type ForecastVerdict } from '../src/utils/forecastRegister';

const v = (id: string, status: ForecastVerdict['status']): ForecastVerdict => ({ id, status, verdict: `${id} ${status}`, specVersion: 1, specHash: 'h', ranAt: '2026-11-06T12:00:00Z' });

test('the GDP nowcast entry shows its own evaluation', () => {
  assert.equal(forecastRegisterStatus('gdp_nowcast', { gdp_nowcast: v('gdp_nowcast', 'passed') }), 'passed');
  assert.equal(forecastRegisterStatus('gdp_nowcast', {}), undefined);
});

test('the forecasts entry fails when any of its evaluations failed and passes only when all passed', () => {
  const all = { cpi_nowcast: v('cpi_nowcast', 'passed'), gdp_forecast: v('gdp_forecast', 'passed'), cpi_forecast: v('cpi_forecast', 'passed'), policy_rate_forecast: v('policy_rate_forecast', 'passed'), debt_forecast: v('debt_forecast', 'passed') };
  assert.equal(forecastRegisterStatus('app_forecasts', all), 'passed');
  assert.equal(forecastRegisterStatus('app_forecasts', { ...all, debt_forecast: v('debt_forecast', 'failed') }), 'failed');
  const { debt_forecast: _, ...four } = all;
  assert.equal(forecastRegisterStatus('app_forecasts', four), undefined);
  assert.equal(forecastVerdicts('app_forecasts', four).length, 4);
  assert.equal(forecastRegisterStatus('taylor_gap', all), undefined);
});

test('worstSeries lists the highest relative RMSE first', () => {
  assert.deepEqual(worstSeries([{ where: 'A', relRmse: 0.8 }, { where: 'B', relRmse: 9 }, { where: 'C', relRmse: 1.2 }], 2).map((x) => x.where), ['B', 'C']);
});
