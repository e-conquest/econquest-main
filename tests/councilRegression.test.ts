import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRegressionCase, parseRegressionSet } from '../src/utils/councilRegression.ts';

const set = parseRegressionSet(JSON.parse(readFileSync(new URL('../docs/validation/council-regression/cases.json', import.meta.url), 'utf8')));
const byId = (id: string) => set.cases.find((c) => c.id === id)!;

test('the case file reads, with unique ids and an expected reading for each case', () => {
  assert.ok(set.version >= 1);
  assert.ok(set.cases.length >= 4);
  assert.equal(new Set(set.cases.map((c) => c.id)).size, set.cases.length);
  for (const c of set.cases) assert.ok(Object.keys(c.expect).length, c.id);
});

test('a good reading passes; a wrong headline, a forbidden claim or invented numbers fail with the reason', () => {
  const brief = (headline: string, points: string[] = [], gaps: string[] = []) => ({ brief: { headline, points, disagreements: [], gaps }, removed: [] as string[] });
  assert.equal(checkRegressionCase(byId('brazil-tight'), brief('Yes: Brazil runs tight policy, with the policy rate far above inflation.')).pass, true);
  const loose = checkRegressionCase(byId('brazil-tight'), brief('Brazil policy looks loose.'));
  assert.equal(loose.pass, false);
  assert.ok(loose.failures.some((f) => /must not/.test(f)));
  const egyptGood = checkRegressionCase(byId('egypt-missing'), brief('There is not enough data to judge Egypt’s debt: the debt figures are missing.', [], ['Government debt is missing: the IMF feed did not answer.']));
  assert.equal(egyptGood.pass, true, egyptGood.failures.join('; '));
  const egyptBad = checkRegressionCase(byId('egypt-missing'), brief('Egypt’s debt is sustainable.'));
  assert.equal(egyptBad.pass, false);
  const invented = checkRegressionCase(byId('turkey-behind'), { ...brief('Turkey is behind the curve.'), removed: ['a', 'b'] });
  assert.ok(invented.failures.some((f) => /removed by the checks/.test(f)));
  assert.match(checkRegressionCase(byId('turkey-behind'), { brief: null, removed: [], reason: 'No AI model answered' }).failures[0], /No answer/);
});
