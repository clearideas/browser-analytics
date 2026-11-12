// Phase 1 regressions for the Nuxt plugin (window.analytics must not be set).
import { describe, expect, it, vi } from 'vitest'

import { FULL_TRACKING_GEO, mockApi, settle, TEST_API } from './helpers'

const runtimeConfig = { public: { apiBaseUrl: TEST_API, eventSiteName: 'nuxt-test' } }

vi.mock('nuxt/app', () => ({ useRuntimeConfig: () => runtimeConfig }))

function fakeNuxtApp() {
  const hooks: Record<string, Array<() => void>> = {}
  const provided: Record<string, unknown> = {}
  return {
    provided,
    hook(name: string, fn: () => void) {
      ;(hooks[name] ??= []).push(fn)
      return () => hooks[name]!.splice(hooks[name]!.indexOf(fn), 1)
    },
    provide(name: string, value: unknown) {
      provided[name] = value
    },
    async callHook(name: string) {
      for (const fn of hooks[name] ?? []) await fn()
    },
  }
}

describe('Nuxt plugin', () => {
  it('provides $analytics, tracks the first page view and leaves window.analytics alone', async () => {
    const segment = { segment: true }
    ;(window as any).analytics = segment
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const nuxtApp = fakeNuxtApp()
    const plugin = (await import('../src/nuxt')).default

    await plugin(nuxtApp)
    await nuxtApp.callHook('app:mounted')
    await settle()

    expect(typeof (nuxtApp.provided.analytics as any)?.trackEvent).toBe('function')
    expect(await api.eventNames()).toContain('page_view')
    expect((window as any).analytics).toBe(segment)
  })
})

describe('Nuxt runtime config mapping', () => {
  it('maps v1, privacy and plugin settings, accepting JSON strings from env', async () => {
    const { nuxtAnalyticsConfig } = await import('../src/nuxt')

    const config = nuxtAnalyticsConfig({
      apiBaseUrl: 'https://collector.example/',
      analyticsSiteKey: 'site-key',
      analyticsIntegrations: '{"googleAnalytics":{"measurementId":"G-1"}}',
      analyticsBanner: { acceptLabel: 'OK', manageButton: false },
      analyticsRespectGpc: false,
      analyticsCookieDomain: 'example.com',
      analyticsUrlQueryAllowlist: 'q, page',
      analyticsExposeGlobals: true,
      analyticsBatchSize: '25',
      chatWidth: '400',
    })

    expect(config).toMatchObject({
      apiBaseUrl: 'https://collector.example/',
      siteKey: 'site-key',
      integrations: { googleAnalytics: { measurementId: 'G-1' } },
      banner: { acceptLabel: 'OK', manageButton: false },
      respectGlobalPrivacyControl: false,
      cookieDomain: 'example.com',
      urlQueryAllowlist: ['q', 'page'],
      exposeGlobals: true,
      batchSize: 25,
      chatWidth: 400,
    })
  })

  it('defaults: GPC honored, banner on, no integrations, no globals', async () => {
    const { nuxtAnalyticsConfig } = await import('../src/nuxt')

    const config = nuxtAnalyticsConfig({})

    expect(config).toMatchObject({
      respectGlobalPrivacyControl: true,
      exposeGlobals: false,
      eventSiteName: 'nuxt-app',
    })
    expect(config.banner).toBeUndefined()
    expect(config.integrations).toBeUndefined()
  })

  it('banner: false disables the built-in banner; invalid JSON is ignored with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { nuxtAnalyticsConfig } = await import('../src/nuxt')

    const config = nuxtAnalyticsConfig({
      analyticsBanner: false,
      analyticsIntegrations: '{not json',
    })

    expect(config.banner).toBe(false)
    expect(config.integrations).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('maps consent options and gated-script settings', async () => {
    const { nuxtAnalyticsConfig } = await import('../src/nuxt')

    expect(
      nuxtAnalyticsConfig({
        analyticsConsent: '{"choices":"categories","reloadOnWithdrawal":false}',
        analyticsGatedScripts: { nonce: 'abc' },
      }),
    ).toMatchObject({
      consent: { choices: 'categories', reloadOnWithdrawal: false },
      gatedScripts: { nonce: 'abc' },
    })
    expect(nuxtAnalyticsConfig({ analyticsGatedScripts: false }).gatedScripts).toBe(false)
    expect(nuxtAnalyticsConfig({}).gatedScripts).toBeUndefined()
  })
})
