import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA_LICENCES, licencesMarkdown, openLicenceQuestions } from '../src/data/dataLicences.ts';

test('docs/DATA_LICENCES.md is the generated register (run npm run docs:licences after editing the register)', () => {
  const doc = readFileSync(new URL('../docs/DATA_LICENCES.md', import.meta.url), 'utf8');
  assert.equal(doc, licencesMarkdown());
});

test('every row links the terms it was read from and quotes them unless marked not confirmed', () => {
  const ids = new Set<string>();
  for (const r of DATA_LICENCES) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(r.terms.length && r.terms.every((t) => t.url.startsWith('https://')), `${r.id}: terms link`);
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/);
    if (r.status !== 'not_verified' && r.id !== 'own') assert.ok(r.quotes.length > 0, `${r.id}: a confirmed status needs a quote`);
    if (r.status === 'not_verified' || r.status === 'permission') assert.ok(r.flag, `${r.id}: needs an open question`);
  }
});

test('the sources the app reads each have a row', () => {
  const ids = new Set(DATA_LICENCES.map((r) => r.id));
  for (const id of ['worldbank', 'pinksheet', 'imf', 'comtrade', 'wits', 'bis', 'ecb', 'erapi', 'nyfed', 'fred', 'oecd', 'eurostat', 'cftc', 'tic', 'eia', 'gdelt', 'ucdp', 'polymarket', 'kalshi', 'bcb', 'tesouro', 'evds', 'bcrp', 'own']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});

test('open questions list the restricted and unconfirmed rows', () => {
  const open = openLicenceQuestions().map((r) => r.id);
  assert.ok(open.includes('kalshi') && open.includes('oecd') && open.includes('erapi'));
  assert.ok(!open.includes('gdelt'));
});

test('every row says whether free, non-commercial sharing is allowed, with a reason', () => {
  for (const r of DATA_LICENCES) {
    assert.ok(['allowed', 'restricted', 'unclear'].includes(r.share), r.id);
    assert.ok(r.shareNote.length > 5, r.id);
    if (r.status === 'not_verified' && r.share === 'allowed') assert.fail(`${r.id}: unconfirmed terms cannot be marked allowed`);
  }
  const by = Object.fromEntries(DATA_LICENCES.map((r) => [r.id, r.share]));
  assert.equal(by.kalshi, 'restricted');
  assert.equal(by.erapi, 'restricted');
  assert.equal(by.gdelt, 'allowed');
});
