import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDisplayCase } from '../src/utils/displayCase.ts';

test('data codes become sentence case, keeping acronyms', () => {
  assert.equal(toDisplayCase('HY_SPECULATIVE'), 'HY speculative');
  assert.equal(toDisplayCase('HOLD_AND_MONITOR'), 'Hold and monitor');
  assert.equal(toDisplayCase('CRITICAL'), 'Critical');
  assert.equal(toDisplayCase('LONG_RISK'), 'Long risk');
  assert.equal(toDisplayCase('IG_PRIME'), 'IG prime');
  assert.equal(toDisplayCase('CDS SPREAD 300 BPS'), 'CDS spread 300 bps');
});

test('mixed-case text and empty values are left alone', () => {
  assert.equal(toDisplayCase('Elevated risk'), 'Elevated risk');
  assert.equal(toDisplayCase(''), '');
  assert.equal(toDisplayCase(undefined), '');
});
