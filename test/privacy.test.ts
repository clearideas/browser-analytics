// Phase 1 regressions: data that must never leave the page (S1) and global
// namespace hygiene (S6).
import { describe, expect, it, vi } from 'vitest'

import {
  boot,
  CONSENT_REQUIRED_GEO,
  everythingSent,
  installGtag,
  makeAdapter,
  makeConfig,
  mockApi,
  seedConsent,
  seedGeo,
  setReferrer,
  settle,
} from './helpers'

const SECRETS = ['SECRET123', 'a%40b.com', 'a@b.com', 'XYZ-FRAGMENT-TOKEN', 'sess-abc']

describe('S1: URLs are sanitized before leaving the page', () => {
  it('full tracking: query strings and fragments are not sent to the backend or Google', async () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password?token=SECRET123&email=a%40b.com#access_token=XYZ-FRAGMENT-TOKEN',
    )
    const gtag = installGtag()

    const { api } = await boot({ config: { gaMeasurementId: 'G-TEST' } })
    // Google must actually be receiving events, or "no secrets sent to Google" is vacuous.
    await vi.waitFor(() =>
      expect(gtag.some(c => c[0] === 'event' && c[1] === 'page_view')).toBe(true),
    )

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props.url).toBe('https://www.example.test/reset-password')
    const sent = await everythingSent(api, gtag)
    for (const secret of SECRETS) expect(sent).not.toContain(secret)
  })

  it('limited (pre-consent) tracking: query strings and fragments are not sent', async () => {
    window.history.replaceState(null, '', '/verify?token=SECRET123#access_token=XYZ-FRAGMENT-TOKEN')

    const { api } = await boot({ geo: CONSENT_REQUIRED_GEO })

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props.url).toBe('https://www.example.test/verify')
    const sent = await everythingSent(api)
    for (const secret of SECRETS) expect(sent).not.toContain(secret)
  })

  it('campaign parameters remain in page URLs; other parameters are removed', async () => {
    window.history.replaceState(null, '', '/pricing?utm_source=newsletter&token=SECRET123')

    const { api } = await boot({ config: { cleanAttributionUrl: false } })

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props.url).toBe('https://www.example.test/pricing?utm_source=newsletter')
  })

  it('site-specific query parameters can be allowed via urlQueryAllowlist', async () => {
    window.history.replaceState(null, '', '/search?q=shoes&token=SECRET123')

    const { api } = await boot({ config: { urlQueryAllowlist: ['q'] } })

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props.url).toBe('https://www.example.test/search?q=shoes')
  })

  it('referrers are reduced to origin + path', async () => {
    setReferrer('https://www.example.test/account?session=sess-abc#XYZ-FRAGMENT-TOKEN')

    const { api } = await boot()

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props.referrer).toBe('https://www.example.test/account')
    const sent = await everythingSent(api)
    for (const secret of SECRETS) expect(sent).not.toContain(secret)
  })

  it('stored attribution referrer is reduced to origin + path', async () => {
    setReferrer('https://search.example/results?query=SECRET123')
    window.history.replaceState(null, '', '/landing?utm_source=google')

    await boot()

    const stored = JSON.parse(localStorage.getItem('ci_click')!)
    expect(stored.referrer).toBe('https://search.example/results')
  })

  it('custom event props containing URLs are sanitized too', async () => {
    const { api, analytics } = await boot()

    await analytics.trackEvent('download', {
      url: 'https://files.example/report.pdf?signature=SECRET123',
      referrer: 'https://www.example.test/a?session=sess-abc',
    })
    await analytics.flush()
    await settle()
    expect(await api.eventNames()).toContain('download') // guard against a vacuous pass

    const sent = await everythingSent(api)
    for (const secret of SECRETS) expect(sent).not.toContain(secret)
  })
})

describe('S1: Google receives only the event parameters, not internal enrichment', () => {
  it('does not forward attribution, click IDs or library control keys to gtag', async () => {
    window.history.replaceState(null, '', '/landing?gclid=CLICK-ID-1&utm_source=google')
    const gtag = installGtag()
    const { analytics } = await boot({
      config: { gaMeasurementId: 'G-TEST', googleAdsConversions: { sign_up: 'AW-1/abc' } },
    })
    gtag.length = 0

    await analytics.trackEvent('sign_up', { plan: 'pro', force_ads_conversion: true })
    await vi.waitFor(() =>
      expect(gtag.some(c => c[0] === 'event' && c[1] === 'sign_up')).toBe(true),
    )

    const eventCall = gtag.find(c => c[0] === 'event' && c[1] === 'sign_up')!
    expect(eventCall[2]).toEqual({ plan: 'pro' })
    // The conversion itself still fires, with attribution evaluated internally.
    expect(gtag).toContainEqual([
      'event',
      'conversion',
      { send_to: 'AW-1/abc', transport_type: 'beacon' },
    ])
  })

  it('does not mutate the props object passed by the caller', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google')
    const { analytics } = await boot()
    const props = { plan: 'pro' }

    await analytics.trackEvent('sign_up', props)

    expect(props).toEqual({ plan: 'pro' })
  })
})

describe('S6: global namespace', () => {
  const LEGACY_GLOBALS = [
    'disableOwnerTracking',
    'enableOwnerTracking',
    'ownerTrackingStatus',
    'showCookieBanner',
    'getAttributionContext',
    'enableDebug',
    'disableDebug',
    'debugStatus',
  ]

  it('adds nothing to window by default and never touches window.analytics', async () => {
    const segment = { segment: true }
    ;(window as any).analytics = segment

    await boot()

    expect((window as any).analytics).toBe(segment)
    expect((window as any).ciAnalytics).toBeUndefined()
    for (const name of LEGACY_GLOBALS) expect(name in window).toBe(false)
  })

  it('exposes a single window.ciAnalytics namespace when exposeGlobals is enabled', async () => {
    const segment = { segment: true }
    ;(window as any).analytics = segment

    const { analytics } = await boot({ config: { exposeGlobals: true } })

    const ns = (window as any).ciAnalytics
    expect(ns.instance).toBe(analytics)
    expect(ns.disableOwnerTracking().enabled).toBe(true)
    expect(ns.enableOwnerTracking().enabled).toBe(false)
    for (const fn of ['ownerTrackingStatus', 'showCookieBanner', 'getAttributionContext'])
      expect(typeof ns[fn]).toBe('function')
    expect((window as any).analytics).toBe(segment)
    for (const name of LEGACY_GLOBALS) expect(name in window).toBe(false)
  })

  it('debug mode also exposes the namespace', async () => {
    await boot({ config: { debug: true } })

    expect(typeof (window as any).ciAnalytics?.enableDebug).toBe('function')
  })

  it('createAnalytics alone exposes nothing', async () => {
    mockApi()
    seedGeo(false)
    seedConsent(true)
    const lib = await import('../src/index')
    lib.createAnalytics(makeConfig({ exposeGlobals: true }), makeAdapter().adapter)

    expect((window as any).ciAnalytics).toBeUndefined()
  })
})
