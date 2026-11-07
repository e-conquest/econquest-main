import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISO3_COUNTRIES, isCountryIso3 } from '../src/data/iso3166';

test('countries pass and regional groups do not', () => {
  assert.equal(ISO3_COUNTRIES.size, 251);
  for (const c of ['USA', 'IRQ', 'MTQ', 'LBN', 'ARG', 'UVK']) assert.ok(isCountryIso3(c), c);
  for (const g of ['WHQ', 'NMQ', 'MAE', 'EUQ', 'APQ', 'SSQ', 'EUU', 'OEMDC']) assert.equal(isCountryIso3(g), false, g);
});
