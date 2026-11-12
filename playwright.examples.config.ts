// End-to-end tests of the example apps (examples/): real Next.js, React Router, Vue,
// Nuxt, SvelteKit, Angular and Astro builds using the packed library, against the sample
// collector. Build them first: npm run examples:build. Select some with EXAMPLES=next,vue.
import { defineConfig } from '@playwright/test'

import { APPS } from './examples/apps.mjs'

const selected = process.env.EXAMPLES?.split(',')
const apps = APPS.filter(app => !selected || selected.includes(app.name))

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'examples.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/examples' }]] : 'list',
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --disable-warning=ExperimentalWarning sample-host/src/server.ts',
      url: 'http://localhost:18787/v1/health',
      reuseExistingServer: false,
      env: {
        PORT: '18787',
        PLAYGROUND_PORT: '15999',
        DEV_MODE: '1',
        DATABASE_PATH: ':memory:',
        SITES_FILE: 'e2e/examples.sites.json',
      },
    },
    {
      command: `node examples/serve.mjs ${apps.map(app => app.name).join(' ')}`,
      // Ready when the last selected app is being served (they start in order).
      port: apps[apps.length - 1]!.port,
      reuseExistingServer: false,
    },
  ],
})
