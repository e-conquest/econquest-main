import { test } from 'node:test';
import assert from 'node:assert/strict';
import { councilInputs } from '../src/utils/councilInputs.ts';
import { buildBaselineOpenData } from '../src/data/presetsAndBaselines.ts';
import { FEED_PATHS, markLive } from './helpers/live.ts';

test('the council is told only real figures; built-in ones are named MISSING', () => {
  const none = councilInputs(buildBaselineOpenData('BRA'));
  assert.equal(none.live.length, 0);
  assert.ok(none.lines.filter((l) => !l.startsWith('- Polymarket')).every((l) => /: MISSING \(/.test(l)), none.lines.join('\n'));
  assert.equal(none.deskEnginesLive, false, 'model desk outputs are left out when their inputs are missing');

  const s = buildBaselineOpenData('BRA');
  markLive(s, FEED_PATHS);
  const live = councilInputs(s);
  assert.ok(live.lines.some((l) => l.startsWith('- IMF gross debt / GDP: ') && !l.includes('MISSING')));
  // The policy rate has no real source yet, so it stays missing.
  assert.ok(live.lines.some((l) => /Central bank policy rate: MISSING/.test(l)));
  assert.equal(live.deskEnginesLive, true);
});
