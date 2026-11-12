// End-to-end tests: a real browser drives the playground (sample-host/playground)
// against the sample collector. Requires the library build (`npm run build`).
import { defineConfig } from '@playwright/test'

const API_PORT = 18787
const SITE_PORT = 15173

// Optional: use a specific Chromium binary (e.g. where Playwright's download is not
// possible). Never pass flags such as --disable-web-security: they remove the Origin
// header and CORS, which these tests exist to exercise.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined

export default defineConfig({
  testDir: 'e2e',
  // The example apps have their own config (playwright.examples.config.ts).
  testIgnore: 'examples.spec.ts',
  // Tests share one collector (reset per test), so run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning sample-host/src/server.ts',
    url: `http://localhost:${API_PORT}/v1/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(API_PORT),
      PLAYGROUND_PORT: String(SITE_PORT),
      DEV_MODE: '1',
      DATABASE_PATH: ':memory:',
    },
  },
})

export const E2E_API = `http://localhost:${API_PORT}`
