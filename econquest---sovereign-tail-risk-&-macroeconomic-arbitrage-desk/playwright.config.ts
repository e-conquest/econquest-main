import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = process.env.ECONQUEST_E2E_DIRECTORY || (process.argv.includes('--list')
  ? join(tmpdir(), 'econquest-e2e-discovery')
  : mkdtempSync(join(tmpdir(), 'econquest-e2e-')));
process.env.ECONQUEST_E2E_DIRECTORY = directory;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  globalTeardown: './tests/cleanup.ts',
  metadata: { e2eDirectory: directory },
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4179', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${process.env.ECONQUEST_TEST_PYTHON || '.backend-venv/bin/python'} -m uvicorn backend.app:app --host 127.0.0.1 --port 8766`,
      url: 'http://127.0.0.1:8766/api/session',
      env: {
        ECONQUEST_DB_PATH: join(directory, 'test.sqlite3'),
        ECONQUEST_ALLOWED_ORIGINS: 'http://127.0.0.1:4179'
      },
      reuseExistingServer: false
    },
    {
      command: 'npm run dev -- --port 4179 --strictPort',
      url: 'http://127.0.0.1:4179',
      env: { ECONQUEST_BACKEND_URL: 'http://127.0.0.1:8766' },
      reuseExistingServer: false
    }
  ]
});
