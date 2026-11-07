import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dataDirProblem, installJsonConsole, ollamaBaseUrlDefault, readiness, shutdownTimeoutMs } from '../src/utils/serverRuntime';

test('Ollama URL: OLLAMA_BASE_URL wins, trailing slash dropped', () => {
  assert.equal(ollamaBaseUrlDefault({ OLLAMA_BASE_URL: 'http://gpu-box:11434/' }), 'http://gpu-box:11434');
  assert.equal(ollamaBaseUrlDefault({ OLLAMA_BASE_URL: ' http://ollama:11434 ', SELF_HOSTED_DOCKER: 'true' }), 'http://ollama:11434');
});

test('Ollama URL: without a setting, Docker looks at the host, never its own localhost', () => {
  assert.equal(ollamaBaseUrlDefault({ SELF_HOSTED_DOCKER: 'true' }), 'http://host.docker.internal:11434');
  assert.equal(ollamaBaseUrlDefault({}), 'http://localhost:11434');
  assert.equal(ollamaBaseUrlDefault({ OLLAMA_BASE_URL: '   ' }), 'http://localhost:11434');
});

test('data folder check: writable folder passes and leaves no file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-data-'));
  assert.equal(dataDirProblem(dir), null);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'local')), []);
});

test('data folder check: a folder that cannot be created says what to fix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-data-'));
  const file = path.join(dir, 'not-a-folder');
  fs.writeFileSync(file, 'x');
  const problem = dataDirProblem(file);
  assert.ok(problem && problem.includes('Cannot write to the data folder'), String(problem));
});

test('data folder check: a read-only state folder from an older version is caught at start', { skip: process.getuid?.() === 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-data-'));
  fs.mkdirSync(path.join(dir, 'live'));
  fs.chmodSync(path.join(dir, 'live'), 0o555);
  const problem = dataDirProblem(dir);
  fs.chmodSync(path.join(dir, 'live'), 0o755);
  assert.ok(problem && problem.includes(path.join(dir, 'live')), String(problem));
});

test('JSON logs: off unless LOG_FORMAT=json', () => {
  assert.equal(installJsonConsole({}), false);
  assert.equal(installJsonConsole({ LOG_FORMAT: 'text' }), false);
});

test('JSON logs: one line per message, info to stdout, warnings and errors to stderr', () => {
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  const out: string[] = [];
  const err: string[] = [];
  try {
    const on = installJsonConsole({ LOG_FORMAT: 'JSON' }, { write: (s) => out.push(s) }, { write: (s) => err.push(s) }, () => new Date('2026-11-06T05:00:00Z'));
    assert.equal(on, true);
    console.log('listening on', 3000, { host: '0.0.0.0' });
    console.warn('feed slow');
    console.error(new Error('boom'));
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0]), { time: '2026-11-06T05:00:00.000Z', level: 'info', msg: 'listening on 3000 {"host":"0.0.0.0"}' });
  assert.equal(JSON.parse(err[0]).level, 'warn');
  const e = JSON.parse(err[1]);
  assert.equal(e.level, 'error');
  assert.ok(e.msg.startsWith('Error: boom'));
  assert.ok(out[0].endsWith('\n') && !out[0].slice(0, -1).includes('\n'));
});

test('readiness: not ready while starting, stopping, or unable to write data', () => {
  assert.equal(readiness({ listening: false, shuttingDown: false, dataProblem: null }).status, 503);
  assert.equal(readiness({ listening: true, shuttingDown: true, dataProblem: null }).status, 503);
  const bad = readiness({ listening: true, shuttingDown: false, dataProblem: 'Cannot write' });
  assert.deepEqual(bad, { status: 503, body: { ready: false, reason: 'Cannot write' } });
  assert.deepEqual(readiness({ listening: true, shuttingDown: false, dataProblem: null }), { status: 200, body: { ready: true } });
});

test('shutdown wait: 8 s by default, capped at 2 minutes', () => {
  assert.equal(shutdownTimeoutMs({}), 8000);
  assert.equal(shutdownTimeoutMs({ SHUTDOWN_TIMEOUT_MS: '2500' }), 2500);
  assert.equal(shutdownTimeoutMs({ SHUTDOWN_TIMEOUT_MS: 'soon' }), 8000);
  assert.equal(shutdownTimeoutMs({ SHUTDOWN_TIMEOUT_MS: '999999' }), 120000);
});
