import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_GROUPS, READY_BY_ID, READY_TOOLS, TOOL_CATEGORIES } from '../src/data/toolsCatalog.ts';

test('tools page: every hidden desk says what it needs, and every "use instead" link resolves', () => {
  const desks = HIDDEN_GROUPS.flatMap((g) => g.desks);
  assert.equal(desks.length, 41, 'all 41 older desks are listed');
  assert.equal(new Set(desks.map((d) => d.id)).size, desks.length, 'no desk is listed twice');
  for (const d of desks) {
    assert.ok(d.needs.length > 10, `${d.id} says what it needs`);
    if (d.coveredBy) assert.ok(READY_BY_ID[d.coveredBy], `${d.id} links to a ready tool`);
  }
  assert.equal(new Set(READY_TOOLS.map((t) => t.id)).size, READY_TOOLS.length);
  assert.ok(READY_TOOLS.every((t) => t.sources && t.what));
});

test('tools page: every ready tool sits in one group, and no group is empty', () => {
  const ids = new Set(TOOL_CATEGORIES.map((c) => c.id));
  assert.equal(ids.size, TOOL_CATEGORIES.length);
  for (const t of READY_TOOLS) assert.ok(ids.has(t.category), `${t.id} has a known group`);
  for (const c of TOOL_CATEGORIES) {
    assert.ok(READY_TOOLS.some((t) => t.category === c.id), `${c.id} has at least one tool`);
    assert.ok(c.purpose.length > 10, `${c.id} says what it is for`);
  }
});
