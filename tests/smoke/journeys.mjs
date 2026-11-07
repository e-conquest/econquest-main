/**
 * UI journeys: a few things people do end to end, in a real browser against the built app with
 * every data feed down (tests/helpers/offline-fetch.mjs). Each step fails with a plain line.
 *
 * 1. Keyboard: the first Tab reaches "Skip to content", which moves focus to the page.
 * 2. Council chat: ask a question; the question and an answer block appear, with no crash.
 * 3. One country: each of the four sections opens; History & data holds the forecast panel.
 * 4. Settings > Free data keys: save a key, see it masked, check it is not in the keys reply or
 *    the audit log, then remove it.
 * 5. Sign-in: create the first admin account; the app then asks everyone to sign in; a wrong
 *    password is refused; the right one opens the app.
 *
 * Run after `npm run build`:  npm run test:journeys
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!existsSync(path.join(root, 'dist/index.html'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}
const port = 4800 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-journeys-'));
let log = '';
const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server.ts')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/offline-fetch.mjs')}`,
    NODE_ENV: 'production',
    PORT: String(port),
    DATA_DIR: dataDir,
    GEMINI_API_KEY: '',
    ECONQUEST_SECRET_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const failures = [];
const passed = [];
let browser;
let where = 'start';
const watch = (page) => {
  page.on('pageerror', (e) => failures.push(`${where}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('[panel-error]')) failures.push(`${where}: ${m.text().split('\n')[0]}`);
  });
};
const noCrash = async (page) => {
  const crashed = await page.$$eval('[data-panel-error]', (els) => els.map((e) => e.getAttribute('data-panel-error')));
  for (const name of crashed) failures.push(`${where}: "${name}" showed its crash note`);
  const text = await page.innerText('body');
  const bad = text.match(/[^\n]{0,40}\b(NaN|undefined|Infinity)\b[^\n]{0,40}/);
  if (bad) failures.push(`${where}: shows "${bad[0].trim()}"`);
};
const step = async (name, fn) => {
  where = name;
  const before = failures.length;
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${String(err?.message || err).split('\n')[0]}`);
  }
  if (failures.length === before) passed.push(name);
};

try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/api/ai/runtime-defaults`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(base, { waitUntil: 'networkidle', timeout: 90_000 });

  await step('keyboard: skip link', async () => {
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (first !== 'Skip to content') throw new Error(`the first Tab reached "${first}", not "Skip to content"`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'main-content', null, { timeout: 5000 });
  });

  await step('council chat: ask a question', async () => {
    await page.locator('#council-question').fill("Is Turkey's central bank behind the curve?");
    await page.locator('#council-question').press('Enter');
    await page.waitForSelector('[data-chat-user]', { timeout: 15_000 });
    await page.waitForSelector('[data-council-result="true"]', { timeout: 90_000 });
    await noCrash(page);
  });

  await step('one country: four sections', async () => {
    await page.getByRole('button', { name: 'Research', exact: true }).first().click();
    await page.locator('[data-research-scope] button[data-scope="country"]').click();
    await page.waitForSelector('[data-country-page]', { timeout: 15_000 }).catch(async (e) => {
      throw new Error(`${e.message.split('\n')[0]}; the page says: ${(await page.innerText('main')).replace(/\s+/g, ' ').slice(0, 300)}`);
    });
    for (const name of ['Summary', 'Markets & signals', 'History & data', 'Sources']) {
      where = `one country: ${name}`;
      await page.locator('[data-country-page] button.ui-tab', { hasText: name }).first().click();
      await page.waitForTimeout(500);
      await noCrash(page);
    }
    where = 'one country: History & data';
    await page.locator('[data-country-page] button.ui-tab', { hasText: 'History & data' }).first().click();
    await page.waitForSelector('#tool-forecast', { state: 'attached', timeout: 15_000 });
    const tabs = await page.locator('[data-country-page] button.ui-tab').count();
    if (tabs !== 4) throw new Error(`the country page has ${tabs} section tabs, expected 4`);
  });

  const fakeKey = 'abcdef0123456789abcdef0123456789';
  await step('settings: save, mask and remove a key', async () => {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Settings/ }).first().click();
    await page.locator('[data-settings-tab="keys"]').click();
    const row = page.locator('[data-settings-key="FRED_API_KEY"]');
    await row.waitFor({ timeout: 15_000 });
    await row.locator('input').fill(fakeKey);
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('[data-settings-key="FRED_API_KEY"][data-source="app"]', { timeout: 15_000 }).catch(async (e) => {
      throw new Error(`${e.message.split('\n')[0]}; the row says: ${(await row.innerText()).replace(/\s+/g, ' ').slice(-300)}`);
    });
    if ((await row.innerText()).includes(fakeKey)) throw new Error('the saved key is shown in full');
    if ((await row.locator('input').inputValue()) !== '') throw new Error('the key box was not cleared after saving');
    const keys = await (await page.request.get(`${base}/api/settings/keys`)).text();
    if (keys.includes(fakeKey)) throw new Error('the keys reply holds the key in full');
    const audit = await (await page.request.get(`${base}/api/audit`)).text();
    if (audit.includes(fakeKey)) throw new Error('the audit log holds the key');
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.waitForSelector('[data-settings-key="FRED_API_KEY"][data-source="none"]', { timeout: 15_000 });
    await page.keyboard.press('Escape');
  });

  await step('sign-in: first account, then everyone signs in', async () => {
    const password = 'a long journey test passphrase';
    const made = await page.request.post(`${base}/api/auth/setup`, { data: { username: 'tester', displayName: 'Journey Test', password } });
    if (!made.ok()) throw new Error(`could not create the first account: HTTP ${made.status()} ${await made.text()}`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    watch(p);
    await p.goto(base, { waitUntil: 'networkidle', timeout: 60_000 });
    await p.getByRole('heading', { name: 'Sign in to EconQuest' }).waitFor({ timeout: 15_000 });
    await p.locator('#signin-username').fill('tester');
    await p.locator('#signin-password').fill('not the password at all');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.getByRole('alert').waitFor({ timeout: 10_000 });
    await p.locator('#signin-password').fill(password);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.getByRole('button', { name: 'Menu', exact: true }).waitFor({ timeout: 30_000 });
    await ctx.close();
  });
} catch (err) {
  failures.push(`journeys failed to run: ${err?.stack || err}`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`UI journeys: ${failures.length} problem(s)\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exit(1);
}
console.log(`UI journeys: ${passed.length} passed (${passed.join('; ')}).`);
