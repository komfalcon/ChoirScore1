import { defineConfig } from '@playwright/test';

const launchOptions = process.env.CHROMIUM_PATH
  ? {
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    }
  : undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: '../../node_modules/.cache/choirscore-playwright-results',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    headless: true,
    launchOptions,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
