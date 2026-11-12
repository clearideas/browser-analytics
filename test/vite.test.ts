// Phase 1 regressions for the Vite SPA adapter.
import { describe, expect, it, vi } from 'vitest'

import { FULL_TRACKING_GEO, mockApi, settle, TEST_API } from './helpers'

function fakeRouter() {
  const hooks: Array<(to: { path: string }) => void> = []
  return {
    hooks,
    afterEach(hook: (to: { path: string }) => void) {
      hooks.push(hook)
      return () => hooks.splice(hooks.indexOf(hook), 1)
    },
    navigate(path: string) {
      window.history.pushState(null, '', path)
      for (const hook of [...hooks]) hook({ path })
    },
  }
}

async function startVite() {
  vi.stubEnv('VITE_API_BASE_URL', TEST_API)
  vi.stubEnv('VITE_EVENT_SITE_NAME', 'vite-test')
  const api = mockApi({ geo: FULL_TRACKING_GEO })
  const router = fakeRouter()
  const vite = await import('../src/vite')
  const analytics = vite.initViteAnalytics(router)
  await settle(40)
  return { api, router, vite, analytics }
}

const pageViews = async (api: ReturnType<typeof mockApi>) =>
  (await api.events()).filter(e => e.name === 'page_view')

describe('Vite adapter', () => {
  it('uses explicit collector settings over legacy environment site names', async () => {
    vi.stubEnv('VITE_API_BASE_URL', TEST_API)
    vi.stubEnv('VITE_EVENT_SITE_NAME', 'old-site')
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const { initViteAnalytics } = await import('../src/vite')
    initViteAnalytics(fakeRouter(), { siteKey: 'ci-app', banner: false })
    await settle(40)
    expect(api.requests.find(request => request.path === '/v1/context')?.url).toContain(
      'siteKey=ci-app',
    )
  })
  it('records exactly one page_view per route change', async () => {
    const { api, router } = await startVite()
    expect(await pageViews(api)).toHaveLength(1)

    router.navigate('/pricing')
    await settle()

    const views = await pageViews(api)
    expect(views).toHaveLength(2)
    expect(views[1]!.props.path).toBe('/pricing')
  })

  it('ignores a router notification for the URL that is already tracked', async () => {
    const { api, router } = await startVite()

    // e.g. the router's initial navigation resolving after analytics started
    for (const hook of router.hooks) hook({ path: window.location.pathname })
    await settle()

    expect(await pageViews(api)).toHaveLength(1)
  })

  it('useAnalytics() returns the instance without using window.analytics', async () => {
    const segment = { segment: true }
    ;(window as any).analytics = segment
    const { vite, analytics } = await startVite()

    expect(vite.useAnalytics()).toBe(analytics)
    expect((window as any).analytics).toBe(segment)
  })

  it('useAnalytics() throws a helpful error before initialization', async () => {
    const vite = await import('../src/vite')

    expect(() => vite.useAnalytics()).toThrow(/initViteAnalytics/)
  })
})

describe('Vite environment mapping', () => {
  it('maps v1, privacy and plugin settings from VITE_ variables', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://collector.example/')
    vi.stubEnv('VITE_ANALYTICS_SITE_KEY', 'site-key')
    vi.stubEnv('VITE_ANALYTICS_INTEGRATIONS', '{"clearIdeasChat":{"accessKey":"k"}}')
    vi.stubEnv('VITE_ANALYTICS_BANNER', '{"position":"top"}')
    vi.stubEnv('VITE_ANALYTICS_RESPECT_GPC', 'false')
    vi.stubEnv('VITE_ANALYTICS_URL_QUERY_ALLOWLIST', 'q,page')
    vi.stubEnv('VITE_ANALYTICS_COOKIE_DOMAIN', 'example.com')
    vi.stubEnv('VITE_ANALYTICS_BATCH_SIZE', '5')
    vi.stubEnv('VITE_CHAT_WIDTH', '400')
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSIONS', '{"sign_up":"AW-1/x"}')
    const { createViteAdapter } = await import('../src/vite')

    expect(createViteAdapter().getConfig()).toMatchObject({
      apiBaseUrl: 'https://collector.example/',
      siteKey: 'site-key',
      integrations: { clearIdeasChat: { accessKey: 'k' } },
      banner: { position: 'top' },
      respectGlobalPrivacyControl: false,
      urlQueryAllowlist: ['q', 'page'],
      cookieDomain: 'example.com',
      batchSize: 5,
      chatWidth: 400,
      googleAdsConversions: { sign_up: 'AW-1/x' },
    })
  })

  it('maps consent options and gated-script settings', async () => {
    vi.stubEnv('VITE_ANALYTICS_CONSENT', '{"choices":"categories","trackingWithoutConsent":"none"}')
    vi.stubEnv('VITE_ANALYTICS_GATED_SCRIPTS', 'false')
    const { createViteAdapter } = await import('../src/vite')

    expect(createViteAdapter().getConfig()).toMatchObject({
      consent: { choices: 'categories', trackingWithoutConsent: 'none' },
      gatedScripts: false,
    })
  })

  it('VITE_ANALYTICS_BANNER=false disables the banner; invalid JSON is ignored with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_ANALYTICS_BANNER', 'false')
    vi.stubEnv('VITE_ANALYTICS_INTEGRATIONS', '[1,2]')
    vi.stubEnv('VITE_MICROSOFT_ADS_GOALS', '{broken')
    const { createViteAdapter } = await import('../src/vite')

    const config = createViteAdapter().getConfig()

    expect(config.banner).toBe(false)
    expect(config.integrations).toBeUndefined()
    expect(config.microsoftAdsGoals).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('without a router, route changes are detected from popstate', async () => {
    const { createViteAdapter } = await import('../src/vite')
    const adapter = createViteAdapter()
    const seen: string[] = []
    const unsubscribe = adapter.onRouteChange(path => seen.push(path))

    window.history.pushState(null, '', '/via-back-button')
    window.dispatchEvent(new PopStateEvent('popstate'))
    unsubscribe()
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(seen).toEqual(['/via-back-button'])
  })
})
