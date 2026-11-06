import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const htmlOutput = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || process.env.PLAYWRIGHT_HTML_REPORT;
const temporaryOutput = htmlOutput ? dirname(resolve(htmlOutput)) : mkdtempSync(join(tmpdir(), 'latticefolk-playwright-'));
const htmlOutputDirectory = htmlOutput ? resolve(htmlOutput) : join(temporaryOutput, 'playwright-report');
process.env.PLAYWRIGHT_HTML_OUTPUT_DIR = htmlOutputDirectory;

export default defineConfig({
  testDir: './e2e',
  outputDir: join(temporaryOutput, 'test-results'),
  // The playable scenarios share one server-side SQLite world. Separate files must not
  // reset or write that world concurrently; isolate storage before increasing workers.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: htmlOutputDirectory }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
    }
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      JEV_PROVIDER: 'fallback',
      // The tests reset their world: never point them at a player's regular save.
      WORLD_DB_PATH: fileURLToPath(new URL('./data/latticefolk.e2e.sqlite',import.meta.url))
    }
  }
});
