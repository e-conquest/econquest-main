import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { csvNoticeLine, EXPORT_NOTICE, hasNotice, RESEARCH_NOTICE, withNotice } from '../src/utils/disclaimer.ts';
import { notebookMarkdown } from '../src/utils/notebookExport.ts';
import { buildBackup } from '../src/utils/backup.ts';
import { EMPTY_LIBRARY } from '../src/utils/researchLibrary.ts';
import { tableWorkbook } from '../src/utils/xlsxExport.ts';
import { strFromU8, unzipSync } from 'fflate';

test('the notice says research, not validated advice, and points to the licence register', () => {
  assert.ok(EXPORT_NOTICE.startsWith(RESEARCH_NOTICE));
  assert.match(EXPORT_NOTICE, /Models & validation/);
  assert.match(EXPORT_NOTICE, /DATA_LICENCES\.md/);
});

test('withNotice adds the notice once, at the end', () => {
  const once = withNotice('# Title\n\nBody.\n');
  assert.ok(once.trimEnd().endsWith(`_${EXPORT_NOTICE}_`));
  assert.equal(withNotice(once), once);
  assert.ok(hasNotice(once));
  assert.ok(!hasNotice('# Title'));
});

test('the CSV notice is one comment line', () => {
  const line = csvNoticeLine();
  assert.ok(!line.includes('\n'));
  assert.match(line, /^"?# Research, not validated advice\./);
});

test('a notebook export ends with the notice even with no briefs', () => {
  const md = notebookMarkdown({ id: 'n', title: 'T', createdAt: '', updatedAt: '', briefIds: [], docIds: [], notes: '' }, [], [], new Date('2026-11-06T00:00:00Z'));
  assert.ok(md.trimEnd().endsWith(`_${EXPORT_NOTICE}_`));
});

test('a backup file carries the notice for anyone who opens it outside the app', () => {
  const b = buildBackup({ research: EMPTY_LIBRARY, watchRules: [], workspace: {} });
  assert.equal(b.notice, EXPORT_NOTICE);
});

test('the Excel download names the notice on its About sheet', () => {
  const files = unzipSync(tableWorkbook('t', ['a'], [['1']]));
  const all = Object.values(files).map((f) => strFromU8(f)).join('');
  assert.ok(all.includes(RESEARCH_NOTICE));
});

test('every export path in the app uses the shared notice', () => {
  const uses = (file: string, what: RegExp) => assert.match(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), what, file);
  uses('src/utils/briefExport.ts', /DISCLAIMER = EXPORT_NOTICE/);
  uses('src/utils/agentDocument.ts', /return withNotice\(/);
  uses('src/utils/memoPdf.ts', /write\(EXPORT_NOTICE/);
  uses('src/components/PolicyReviews.tsx', /withNotice\(memo\.markdown\)/);
  uses('src/components/IcMemoBuilder.tsx', /new Blob\(\[withNotice\(memo\)\]/);
  uses('src/components/CouncilChart.tsx', /csvNoticeLine\(\)/);
  uses('src/components/ModelRegisterDialog.tsx', /\[EXPORT_NOTICE\]/);
  uses('src/utils/episodeHandout.ts', /return withNotice\(/);
});
