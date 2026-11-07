import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIGURES_HEADER } from '../src/utils/csvExport';
import { buildDiagnosis, DIAGNOSIS_FIELDS, figureText } from '../src/utils/reviewDiagnosis';

const row = (field: string, figure: string, value: number | null, unit: string, period = '', source = '', reason = '') => {
  const r: (string | number | null)[] = FIGURES_HEADER.map(() => '');
  const set = (k: string, v: string | number | null) => (r[FIGURES_HEADER.indexOf(k)] = v);
  set('field', field);
  set('figure', figure);
  set('value', value);
  set('unit', unit);
  set('status', value === null ? 'Missing' : 'Live');
  set('period', period);
  set('source', source);
  set('reason_if_missing', reason);
  return r;
};
const meta = { iso3: 'BRA', asOf: '2026-11-01', pullDate: '2026-10-30', pulledAt: '2026-10-30T08:00:00.000Z', incomplete: false };

test('every standard indicator is listed in order with a reference; missing ones keep their reason', () => {
  const d = buildDiagnosis([row('imf.cpiInflationPct', 'Inflation (IMF WEO)', 4.4, '%', '2026', 'IMF WEO'), row('market.policyRatePct', 'Policy rate', null, '%', '', '', 'BIS feed did not answer')], meta);
  assert.equal(d.figures.length, DIAGNOSIS_FIELDS.length);
  assert.deepEqual(d.figures.map((x) => x.ref), DIAGNOSIS_FIELDS.map((_, i) => i + 1));
  assert.equal(figureText(d.figures[0]), '4.4% [1] (IMF WEO, 2026)');
  assert.equal(d.figures[1].reason, 'BIS feed did not answer');
  assert.equal(d.figures[2].reason, 'not in this pull');
  assert.match(d.coverage, /^1 of 13 indicators live, 12 missing/);
});

test('real rate and r minus g are worked out only from live inputs, saying how and noting mixed periods', () => {
  const d = buildDiagnosis(
    [
      row('imf.cpiInflationPct', 'Inflation (IMF WEO)', 4.4, '%', '2026', 'IMF WEO'),
      row('market.policyRatePct', 'Policy rate', 13.75, '%', '2026-10-29', 'BIS'),
      row('imf.realGdpGrowthPct', 'Real GDP growth', 2.1, '%', '2026', 'IMF WEO'),
    ],
    meta
  );
  const real = d.readings.find((r) => r.id === 'real_policy_rate')!;
  assert.equal(real.value, 9.35);
  assert.match(real.method, /\[2\] minus inflation \[1\]/);
  assert.match(real.caveat, /different periods/);
  const rg = d.readings.find((r) => r.id === 'r_minus_g')!;
  assert.equal(rg.value, null);
  assert.match(rg.reason, /10Y government bond yield|sovereign10Y/);
});

test('the same pull gives the same diagnosis', () => {
  const rows = [row('imf.cpiInflationPct', 'Inflation', 4.4, '%', '2026', 'IMF WEO')];
  assert.deepEqual(buildDiagnosis(rows, meta), buildDiagnosis(rows, meta));
});
