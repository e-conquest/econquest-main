import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { colName, sheetName, tableWorkbook, toXlsx } from '../src/utils/xlsxExport.ts';

test('column letters and sheet names follow Excel rules', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(701), 'ZZ');
  assert.equal(colName(702), 'AAA');
  assert.equal(sheetName('Brazil: rates/yields [10Y]'), 'Brazil  rates yields  10Y');
  assert.equal(sheetName('x'.repeat(40)).length, 31);
  assert.equal(sheetName(''), 'Sheet');
});

test('workbook: a valid zip with the parts Excel needs; numbers stay numbers, text never runs as a formula', () => {
  const bytes = tableWorkbook('MEX-figures', ['iso3', 'value', 'note'], [['MEX', 4.58, '=HYPERLINK("x")'], ['MEX', null, 'Missing: feed did not answer <&>']], new Date('2026-11-05T00:00:00Z'));
  const files = unzipSync(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(files[part], part);
  }
  const data = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(data, /<c r="B2"><v>4\.58<\/v><\/c>/);
  assert.match(data, /<c r="C2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\)<\/t><\/is><\/c>/);
  assert.ok(!data.includes('<f>'));
  assert.ok(!data.includes('r="B3"'), 'a missing number is left empty, not zero');
  assert.match(data, /Missing: feed did not answer &lt;&amp;&gt;/);
  assert.match(data, /state="frozen"/);
  assert.match(data, /<autoFilter ref="A1:C3"\/>/);
  const wb = strFromU8(files['xl/workbook.xml']);
  assert.match(wb, /name="Data"/);
  assert.match(wb, /name="About"/);
  const about = strFromU8(files['xl/worksheets/sheet2.xml']);
  assert.match(about, /MEX-figures/);
  assert.match(about, /2026-11-05T00:00:00\.000Z/);
});

test('duplicate sheet names are made unique', () => {
  const files = unzipSync(toXlsx([{ name: 'Data', header: ['a'], rows: [] }, { name: 'Data', header: ['a'], rows: [] }]));
  const wb = strFromU8(files['xl/workbook.xml']);
  assert.match(wb, /name="Data"/);
  assert.match(wb, /name="Data 2"/);
});
