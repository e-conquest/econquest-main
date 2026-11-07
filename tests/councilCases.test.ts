import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync('docs/validation/council-regression/cases.json', 'utf8')).cases as Array<{ id: string; expect: { forbid?: string } }>;

test('the "debt is sustainable" ban catches a claim, not the question restated', () => {
  for (const id of ['egypt-missing', 'supreme-egypt-missing', 'options-egypt-missing']) {
    const forbid = new RegExp(cases.find((c) => c.id === id)!.expect.forbid!, 'i');
    // qwen2.5:32b's recorded Egypt answer (2026-11-06): it says the debt cannot be judged.
    assert.equal(forbid.test("it is challenging to determine whether Egypt's government debt is sustainable, as these figures are crucial"), false, id);
    assert.equal(forbid.test('It is unclear if debt is sustainable.'), false, id);
    assert.equal(forbid.test("Egypt's debt is sustainable."), true, id);
    assert.equal(forbid.test('Debt looks sustainable given reserves.'), true, id);
  }
});
