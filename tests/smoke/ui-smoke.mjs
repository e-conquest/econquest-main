/**
 * UI smoke test: opens every page of the built app in a real browser with every data feed down
 * (tests/helpers/offline-fetch.mjs, the same stand-in the server tests use) and fails on any page
 * error or any panel that shows its crash note. This is the check that would have caught the
 * blank screen fixed in #54.
 *
 * Run after `npm run build`:  npm run test:smoke
 * Needs Playwright's Chromium (`npx playwright install chromium`); set PW_CHROMIUM_PATH to use
 * another Chromium binary.
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
const port = 4400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
// A fresh, empty data folder: this is a first run on a new machine.
const dataDir = mkdtempSync(path.join(tmpdir(), 'econquest-smoke-'));
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
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const failures = [];
let browser;
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

  // One pass: the old "Show all tools" switch and its desks were removed (#299).
  for (const allTools of [false]) {
    const mode = 'app';
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let where = `${mode}: start`;
    page.on('pageerror', (e) => failures.push(`${where}: page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().startsWith('[panel-error]')) failures.push(`${where}: ${m.text().split('\n')[0]}`);
    });

    const settle = async (label) => {
      where = `${mode}: ${label}`;
      await page.waitForTimeout(600);
      const crashed = await page.$$eval('[data-panel-error]', (els) => els.map((e) => e.getAttribute('data-panel-error')));
      for (const name of crashed) failures.push(`${where}: "${name}" showed its crash note`);
      const text = (await page.innerText('body')).trim();
      if (text.length < 40) failures.push(`${where}: page is blank`);
      // A missing figure reads Missing or a dash, never "NaN" or "undefined".
      const bad = text.match(/[^\n]{0,40}\b(NaN|undefined|Infinity)\b[^\n]{0,40}/);
      if (bad) failures.push(`${where}: shows "${bad[0].trim()}"`);
    };

    await page.goto(base, { waitUntil: 'networkidle', timeout: 90_000 });
    await settle('Workspace');

    // Research is one header entry with three scopes: one country, compare countries, my holdings.
    const stops = [
      ['Workspace'],
      ['Research', 'country'],
      ['Research', 'compare'],
      ['Research', 'portfolio'],
      ['Reports'],
      ['Tools'],
    ];
    for (const [navName, scope] of stops) {
      // Tools sits inside the Settings window (Menu > Tools), unless the full desk library is on.
      if (navName === 'Tools' && !allTools) {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Tools/ }).first().click();
        await page.waitForSelector('[data-settings-tools] [data-ready-tools]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Menu > Tools did not open Tools in Settings`));
        await settle('Settings > Tools');
        await page.keyboard.press('Escape');
        // Menu > Settings > Backup says what is saved here.
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Settings/ }).first().click();
        await page.locator('[data-settings-tab="backup"]').click().catch(() => failures.push(`${mode}: no Backup page in Settings`));
        await page.waitForSelector('[data-backup-current]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Menu > Backup did not open Settings > Backup`));
        await page.waitForFunction(() => /On this computer now:/.test(document.querySelector('[data-backup-current]')?.textContent || ''), null, { timeout: 15_000 }).catch(() => failures.push(`${mode}: Backup did not say what is saved`));
        await settle('Settings > Backup');
        // Settings > Morning brief draws its time, watchlist and questions.
        await page.locator('[data-settings-tab="morning"]').click().catch(() => failures.push(`${mode}: no Morning brief page in Settings`));
        await page.waitForSelector('[data-morning-next]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Morning brief did not draw`));
        await settle('Settings > Morning brief');
        await page.keyboard.press('Escape');
        // Menu > Audit log opens and says what checking the log found.
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Audit log/ }).first().click();
        await page.waitForSelector('[data-testid="audit-check"]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Menu > Audit log did not show the log check`));
        await settle('Audit log');
        await page.keyboard.press('Escape');
        // Menu > Models & validation lists every rule with its status.
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Models & validation/ }).first().click();
        await page.waitForSelector('[data-register-counts]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Menu > Models & validation did not open`));
        await settle('Models & validation');
        await page.keyboard.press('Escape');
        // Menu > About & data licences shows the research notice and the licence register.
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^About & data licences/ }).first().click();
        await page.waitForSelector('[data-licence-counts]', { timeout: 15_000 }).catch(() => failures.push(`${mode}: Menu > About & data licences did not open`));
        await settle('About & data licences');
        if ((await page.locator('[data-about-credits] [data-source-credits]').count()) !== 4) failures.push(`${mode}: About does not list the four required source credits (ExchangeRate-API, GDELT, FRED, ACLED)`);
        await page.keyboard.press('Escape');
        continue;
      }
      const nav = page.getByRole('button', { name: navName, exact: true }).first();
      if (!(await nav.count())) continue;
      await nav.click();
      if (scope) {
        await page.waitForTimeout(200);
        const pick = page.locator(`[data-research-scope] button[data-scope="${scope}"]`);
        if (!(await pick.count())) {
          failures.push(`${mode}: Research has no "${scope}" scope button`);
          continue;
        }
        await pick.click();
      }
      const area = scope ? `Research (${scope})` : navName;
      await settle(area);
      // Every section tab, and every tool tab inside it.
      const tabCount = await page.locator('button.ui-tab').count();
      for (let i = 0; i < tabCount; i++) {
        const tab = page.locator('button.ui-tab').nth(i);
        if (!(await tab.isVisible().catch(() => false))) continue;
        const label = (await tab.innerText()).trim().slice(0, 40);
        await tab.click().catch(() => {});
        await settle(`${area} > ${label}`);
        const toolCount = await page.locator('[role="tab"]').count();
        for (let k = 0; k < toolCount; k++) {
          const tool = page.locator('[role="tab"]').nth(k);
          if (!(await tool.isVisible().catch(() => false))) continue;
          const toolLabel = (await tool.innerText()).trim().slice(0, 40);
          await tool.click().catch(() => {});
          await settle(`${area} > ${label} > ${toolLabel}`);
        }
      }
    }
    await page.close();
  }

  // The popped-out watchlist.
  const pop = await browser.newPage();
  pop.on('pageerror', (e) => failures.push(`pop-out watchlist: page error: ${e.message}`));
  await pop.goto(`${base}/?view=watchlist`, { waitUntil: 'networkidle', timeout: 60_000 });
  await pop.waitForTimeout(700);
  if ((await pop.$$('[data-panel-error]')).length) failures.push('pop-out watchlist: crash note shown');
} catch (err) {
  failures.push(`smoke run failed: ${err?.stack || err}`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`UI smoke test: ${failures.length} problem(s)\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exit(1);
}
console.log('UI smoke test: every page drew with all feeds down, no page errors, no crash notes.');
