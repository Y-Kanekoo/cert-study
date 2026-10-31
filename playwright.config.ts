import { defineConfig, devices } from '@playwright/test';
import { isProd } from './e2e/targets';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'e2e-results/test-output',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-results/report', open: 'never' }],
    ['json', { outputFile: 'e2e-results/results.json' }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: isProd
    ? undefined
    : (['fe', 'ap', 'jstqb'] as const).map((exam) => ({
        command: `node --import tsx e2e/server.ts ${exam}`,
        url: `http://127.0.0.1:${{ fe: 8781, ap: 8782, jstqb: 8783 }[exam]}/api/health`,
        reuseExistingServer: false,
        timeout: 30_000,
      })),
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'mobile-webkit', grep: /@smoke/, use: { ...devices['iPhone 14'], bypassCSP: true } },
  ],
});
