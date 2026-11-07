import { defineConfig, devices } from '@playwright/test'

const PORT = 4321
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * Which browser drives the tests.
 *
 * Locally: the Chrome that is already installed, so running the suite never
 * means a 150 MB download first. In CI: Playwright's own Chromium, installed by
 * the workflow. `PW_CHANNEL=chromium` forces the bundled one locally (after
 * `npx playwright install chromium`); any other value names a channel.
 */
const requested = process.env.PW_CHANNEL ?? (process.env.CI ? 'chromium' : 'chrome')
const channel = requested === 'chromium' ? undefined : requested

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: ORIGIN,
    channel,
    trace: 'retain-on-failure',
  },

  // Serves `dist/` with the response headers from `dist/_headers`, so the tests
  // meet the same Content-Security-Policy production does. `vite preview` would
  // serve the same files with no policy at all.
  webServer: {
    command: `node tests/e2e/serve.mjs ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: ['**/menu.spec.ts', '**/shots.spec.ts'],
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: ['**/shots.spec.ts'],
      use: { ...devices['Pixel 7'], channel },
    },
    {
      // Not assertions: pictures for a person (or Claude) to look at. `npm run shots`.
      name: 'shots',
      testMatch: '**/shots.spec.ts',
      use: { ...devices['Desktop Chrome'], channel },
    },
  ],
})
