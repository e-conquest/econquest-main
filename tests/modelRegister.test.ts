import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { MODEL_REGISTER, REGISTER_HEADER, registerForPanel, registerRows, STATUS_LABEL } from '../src/data/modelRegister';
import { EDGE_AGENTS } from '../src/utils/marketsMacro';

test('every register entry is complete, with a unique id and code that exists', () => {
  const ids = new Set<string>();
  for (const e of MODEL_REGISTER) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    for (const k of ['name', 'says', 'method', 'inputs', 'where', 'testPlan', 'limits', 'code'] as const) assert.ok(e[k].trim(), `${e.id} has no ${k}`);
    assert.ok(e.status in STATUS_LABEL);
    for (const file of e.code.split(',').map((x) => x.trim().split(' ')[0])) assert.ok(fs.existsSync(file), `${e.id}: ${file} does not exist`);
  }
});

test('no rule is marked passed or failed by hand: those statuses come only from a pre-registered backtest', () => {
  for (const e of MODEL_REGISTER) assert.ok(!['passed', 'failed', 'too_few_cases'].includes(e.status), `${e.id} is ${e.status} without a backtest`);
});

test('the MarketEdge agent panels carry their rule’s badge', () => {
  assert.equal(registerForPanel(`${EDGE_AGENTS.cb} Agent`)?.id, 'taylor_gap');
  assert.equal(registerForPanel(`${EDGE_AGENTS.rv} Agent`)?.id, 'reer_gap');
  assert.equal(registerForPanel(`${EDGE_AGENTS.fx} Agent`)?.id, 'reer_gap');
  assert.equal(registerForPanel('Shock early warning')?.id, 'shock_warning');
  assert.equal(registerForPanel('OECD inflation (monthly)'), undefined);
});

test('register rows line up with the CSV header', () => {
  for (const r of registerRows()) assert.equal(r.length, REGISTER_HEADER.length);
});
