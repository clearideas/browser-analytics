// The example apps: where each is built to, and the port it is served on in the tests.
export const APPS = [
  { name: 'next', port: 15201, output: 'next/out', integration: '@clearideas/consent-analytics/next' },
  { name: 'react-router', port: 15202, output: 'react-router/dist', integration: '@clearideas/consent-analytics/react' },
  { name: 'vue', port: 15203, output: 'vue/dist', integration: '@clearideas/consent-analytics/vite' },
  {
    name: 'nuxt',
    port: 15204,
    output: 'nuxt/.output/public',
    integration: '@clearideas/consent-analytics/nuxt',
    // A Nuxt CLI dependency (@bomb.sh/tab) declares optional peers that conflict with
    // versions other packages need; npm 10's `npm ci` rejects such a lockfile although
    // `npm install` wrote it. Legacy peer handling keeps install and ci consistent.
    npmFlags: ['--legacy-peer-deps'],
  },
  { name: 'sveltekit', port: 15205, output: 'sveltekit/build', integration: '@clearideas/consent-analytics/browser' },
  { name: 'angular', port: 15206, output: 'angular/dist/angular-example/browser', integration: '@clearideas/consent-analytics/browser' },
  { name: 'astro', port: 15207, output: 'astro/dist', integration: '@clearideas/consent-analytics/browser' },
]

/** Collector used by the examples (the sample host started by the tests). */
export const COLLECTOR = 'http://localhost:18787/'
export const SITE_KEY = 'demo-site'
