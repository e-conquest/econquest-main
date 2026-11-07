import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_CREDITS, creditsForSources, creditText } from '../src/data/requiredCredits';
import { DATA_LICENCES } from '../src/data/dataLicences';

test('each required credit matches the attribution its register row quotes', () => {
  for (const c of REQUIRED_CREDITS) {
    const row = DATA_LICENCES.find((r) => r.id === c.id);
    assert.ok(row, c.id);
    assert.ok(row!.attribution.includes(c.text.replace(/^Source: /, '')) || row!.attribution.includes(c.text), `${c.id}: ${row!.attribution}`);
  }
  assert.match(creditText(REQUIRED_CREDITS.find((c) => c.id === 'fred')!), /not endorsed or certified by the Federal Reserve Bank of St\. Louis/);
});

test('credits come only for the sources a page actually used', () => {
  assert.deepEqual(creditsForSources(['ExchangeRate-API Spot FX (Live)', 'IMF DataMapper WEO v1']).map((c) => c.id), ['erapi']);
  assert.deepEqual(creditsForSources(['ECB Frankfurter Spot FX (Live)']).map((c) => c.id), []);
  assert.deepEqual(
    creditsForSources(['GDELT news tone and headlines', 'FRED / OECD 10Y government yield (monthly average)', 'ExchangeRate-API Spot FX (Live)']).map((c) => c.id),
    ['erapi', 'gdelt', 'fred']
  );
  assert.deepEqual(creditsForSources([]), []);
});
