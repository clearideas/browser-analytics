// As documented in the library README: client-only plugin + public runtime config.
export default defineNuxtConfig({
  ssr: false,
  telemetry: false,
  plugins: ['@clearideas/consent-analytics/nuxt.client'],
  runtimeConfig: {
    public: {
      apiBaseUrl: 'http://localhost:18787/',
      analyticsSiteKey: 'demo-site',
    },
  },
  compatibilityDate: '2026-11-01',
})
