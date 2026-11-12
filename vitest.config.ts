/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Each test file gets a fresh module graph; tests that need fresh module
    // state within a file use vi.resetModules() + dynamic import.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          // Browser-like DOM (window, document, localStorage, sessionStorage, cookies, history)
          environment: 'happy-dom',
          environmentOptions: {
            happyDOM: {
              url: 'https://www.example.test/',
              settings: {
                // Never download vendor scripts/styles (chat widget, ad pixels) in tests.
                // Treat them as loaded so load handlers run deterministically.
                disableJavaScriptFileLoading: true,
                disableCSSFileLoading: true,
                handleDisabledFileLoadingAsSuccess: true,
                // Clicking links must not navigate the test page away.
                navigation: { disableMainFrameNavigation: true, disableFallbackToSetURL: true },
              },
            },
          },
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'sample-host',
          environment: 'node',
          // node:sqlite prints an ExperimentalWarning on Node 22/24
          execArgv: ['--disable-warning=ExperimentalWarning'],
          include: ['sample-host/test/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // Ratchet: these floors only ever go up. Baselines: Phase 0 ~9.5% lines,
      // Phase 1 ~63.8%, Phase 2 ~65.9% (v1 client), Phase 3 ~88.7% (plugins, banner), frameworks ~89.2%, categories ~90.3%.
      // They sit just below the measured values. The sample host is verified by its
      // contract tests and the end-to-end suite instead.
      thresholds: {
        lines: 91,
        statements: 87,
        functions: 88,
        branches: 79,
      },
    },
  },
  oxc: {
    target: 'node22',
  },
})
