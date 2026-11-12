// Phase 3: headless consent API, banner behavior, Global Privacy Control, integrations
// as plugins, and reduced fingerprinting data.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  boot,
  CONSENT_REQUIRED_GEO,
  FULL_TRACKING_GEO,
  installGtag,
  seedConsent,
  setGlobalPrivacyControl,
  settle,
} from './helpers'

const banner = () => document.getElementById('ci-consent-banner')
const manageButton = () => document.getElementById('ci-consent-manage')
afterEach(async () => {
  const { setChatWidgetLoader } = await import('../src/plugins/clearideas-chat')
  setChatWidgetLoader(null)
})

describe('headless consent API (analytics.consent)', () => {
  it('reports the state, records decisions and notifies listeners', async () => {
    const { analytics, api } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      policyVersion: '7',
    })
    const seen: unknown[] = []
    const unsubscribe = analytics.consent.onChange(state => seen.push(state))

    const undecided = { preferences: null, statistics: null, marketing: null }
    const all = { preferences: true, statistics: true, marketing: true }
    expect(analytics.consent.get()).toEqual({
      required: true,
      granted: null,
      categories: undecided,
      gpc: false,
      policyVersion: '7',
    })

    await analytics.consent.accept()
    expect(analytics.consent.get().granted).toBe(true)
    expect(banner()).toBeNull()
    unsubscribe()
    await analytics.consent.reject()

    expect(seen).toEqual([
      {
        required: true,
        granted: true,
        categories: all,
        gpc: false,
        policyVersion: '7',
      },
    ])
    expect(api.consentRecords().map(r => [r.decision, r.source])).toEqual([
      ['granted', 'api'],
      ['denied', 'api'],
    ])
  })

  it('banner: false shows no built-in UI but the API still works', async () => {
    const { analytics, api } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { banner: false },
    })

    expect(banner()).toBeNull()
    analytics.consent.showBanner()
    expect(banner()).toBeNull()
    await analytics.consent.accept()
    expect(api.consentRecords()).toHaveLength(1)
    expect(manageButton()).toBeNull()
  })
})

describe('"Cookie settings" button', () => {
  it('appears after a decision where consent is required, and reopens the banner', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(manageButton()).toBeNull()

    document.getElementById('ci-consent-accept')!.click()
    await settle()
    expect(manageButton()!.hidden).toBe(false)

    manageButton()!.click()
    expect(banner()).not.toBeNull()
    expect(manageButton()!.hidden).toBe(true)
    expect(document.activeElement!.id).toBe('ci-consent-reject')
  })

  it('is shown on later visits once decided', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    document.body.innerHTML = ''

    await boot({ geo: CONSENT_REQUIRED_GEO })

    expect(banner()).toBeNull()
    expect(manageButton()).not.toBeNull()
  })

  it('is not shown where consent is not required, unless configured', async () => {
    await boot({ geo: FULL_TRACKING_GEO })
    expect(manageButton()).toBeNull()
    document.body.innerHTML = ''

    await boot({
      geo: FULL_TRACKING_GEO,
      config: { banner: { manageButton: true } },
    })
    expect(manageButton()).not.toBeNull()
  })

  it('can be disabled', async () => {
    await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { banner: { manageButton: false } },
    })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    expect(manageButton()).toBeNull()
  })
})

describe('Global Privacy Control (an opt-out of sale/sharing: withholds marketing)', () => {
  const ga = {
    integrations: {
      googleAnalytics: { measurementId: 'G-X', loadScript: false },
    },
  }

  it('where consent is not required: marketing plugins do not run; analytics runs without ad signals', async () => {
    setGlobalPrivacyControl(true)
    const gtag = installGtag()
    const marketing = {
      name: 'adVendor',
      category: 'marketing' as const,
      track: vi.fn(),
    }

    const { api, analytics } = await boot({
      geo: FULL_TRACKING_GEO,
      config: { ...ga, plugins: [marketing] },
    })
    await analytics.trackEvent('sign_up', {})

    // Google Analytics (statistics) runs, so the marketing plugin has had every chance to.
    await vi.waitFor(() =>
      expect(gtag.some(call => call[0] === 'event' && call[1] === 'sign_up')).toBe(true),
    )
    expect(marketing.track).not.toHaveBeenCalled()
    expect(gtag).toContainEqual([
      'consent',
      'update',
      {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ])
    expect(analytics.consent.get()).toMatchObject({
      required: false,
      granted: null,
      gpc: true,
    })
    expect((await api.events()).find(e => e.name === 'page_view')!.trackingCategory).toBe('full')
  })

  it('an explicit acceptance still enables marketing', async () => {
    setGlobalPrivacyControl(true)
    const marketing = {
      name: 'adVendor',
      category: 'marketing' as const,
      track: vi.fn(),
    }
    const { analytics } = await boot({
      geo: FULL_TRACKING_GEO,
      config: { plugins: [marketing] },
    })

    await analytics.consent.accept()
    await analytics.trackEvent('sign_up', {})

    await vi.waitFor(() => expect(marketing.track).toHaveBeenCalled())
  })

  it('can be turned off by the site', async () => {
    setGlobalPrivacyControl(true)
    const marketing = {
      name: 'adVendor',
      category: 'marketing' as const,
      track: vi.fn(),
    }
    const { analytics } = await boot({
      geo: FULL_TRACKING_GEO,
      config: { plugins: [marketing], respectGlobalPrivacyControl: false },
    })

    await analytics.trackEvent('sign_up', {})

    await vi.waitFor(() => expect(marketing.track).toHaveBeenCalled())
  })
})

describe('integrations configured by name', () => {
  it('Google Analytics: gtag.js is loaded only after consent, with consent set first', async () => {
    await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { googleAnalytics: { measurementId: 'G-X' } } },
    })
    await settle()
    const gtagScript = () =>
      document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')
    expect(gtagScript()).toBeNull()
    expect(window.dataLayer).toBeUndefined()

    document.getElementById('ci-consent-accept')!.click()

    await vi.waitFor(() => expect(gtagScript()).not.toBeNull())
    const first = Array.from(window.dataLayer![0] as ArrayLike<unknown>)
    expect(first.slice(0, 2)).toEqual(['consent', 'default'])
    const pageView = window
      .dataLayer!.map(args => Array.from(args as ArrayLike<unknown>))
      .find(call => call[0] === 'event' && call[1] === 'page_view')
    expect(pageView).toBeDefined() // the page where the visitor accepted is recorded
  })

  it('withdrawing consent deletes the vendor cookies', async () => {
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { googleAnalytics: { measurementId: 'G-X' } } },
    })
    await analytics.consent.accept()
    await vi.waitFor(() => expect(window.dataLayer).toBeDefined()) // GA plugin loaded
    document.cookie = '_ga=GA1.1.123; Path=/'
    document.cookie = '_ga_X=GS1.1; Path=/; Domain=.example.test'
    document.cookie = 'app_session=keep; Path=/'

    await analytics.consent.reject()

    expect(document.cookie).toBe('app_session=keep')
  })

  it('Clear Ideas Chat runs without analytics consent and follows consent changes', async () => {
    const calls: unknown[][] = []
    const init = vi.fn(() => ({
      setConsentRequired: (v: boolean) => calls.push(['required', v]),
      setConsentGranted: (v: boolean) => calls.push(['granted', v]),
    }))
    window.ClearIdeasWidget = { init } as any

    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { clearIdeasChat: { accessKey: 'widget_key' } } },
    })
    await vi.waitFor(() =>
      expect(init).toHaveBeenCalledWith(
        expect.objectContaining({
          accessKey: 'widget_key',
          consentRequired: true,
          consentGranted: false,
        }),
      ),
    )

    await analytics.consent.accept()
    expect(calls).toContainEqual(['granted', true])
  })

  it('honors an explicit preference refusal even where opt-in is not required', async () => {
    seedConsent(false)
    const calls: unknown[][] = []
    const init = vi.fn(() => ({
      setConsentRequired: (v: boolean) => calls.push(['required', v]),
      setConsentGranted: (v: boolean) => calls.push(['granted', v]),
    }))
    window.ClearIdeasWidget = { init } as any
    const { analytics } = await boot({
      geo: FULL_TRACKING_GEO,
      config: { integrations: { clearIdeasChat: { accessKey: 'widget_key' } } },
    })
    await vi.waitFor(() =>
      expect(init).toHaveBeenCalledWith(
        expect.objectContaining({
          consentRequired: true,
          consentGranted: false,
        }),
      ),
    )
    await analytics.consent.accept()
    expect(calls).toContainEqual(['granted', true])
    await analytics.consent.reject()
    expect(calls.slice(-2)).toEqual([
      ['required', true],
      ['granted', false],
    ])
  })

  it('loads the bundled chat lazily without injecting CDN assets', async () => {
    const { setChatWidgetLoader } = await import('../src/plugins/clearideas-chat')
    const init = vi.fn(() => ({
      setConsentRequired() {},
      setConsentGranted() {},
    }))
    const loader = vi.fn(async () => ({ init }))
    setChatWidgetLoader(loader as any)
    await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { clearIdeasChat: { accessKey: 'widget_key' } } },
    })
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    expect(loader).toHaveBeenCalledOnce()
    expect(
      document.querySelector('[src*="updates.clearideas.com"], [href*="updates.clearideas.com"]'),
    ).toBeNull()
  })

  it('does not import the bundled widget when chat is not configured', async () => {
    const { setChatWidgetLoader } = await import('../src/plugins/clearideas-chat')
    const loader = vi.fn()
    setChatWidgetLoader(loader)
    await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(loader).not.toHaveBeenCalled()
  })
})

describe('fingerprinting surface', () => {
  it('auto_metrics carries no exact screen, heap or network fingerprint data', async () => {
    const { api, analytics } = await boot({ geo: FULL_TRACKING_GEO })
    await analytics.flush()

    const metrics = (await api.events()).find(e => e.name === 'auto_metrics')!
    for (const key of [
      'screenWidth',
      'screenHeight',
      'colorDepth',
      'pixelRatio',
      'viewportWidth',
      'viewportHeight',
      'jsHeapSizeLimit',
      'usedJSHeapSize',
      'downlink',
      'rtt',
    ]) {
      expect(metrics.props, key).not.toHaveProperty(key)
    }
    expect(metrics.props).toHaveProperty('viewportBucket')
  })

  it('full events carry buckets, not exact sizes; limited events carry no user agent', async () => {
    const full = await boot({ geo: FULL_TRACKING_GEO })
    const fullView = (await full.api.events()).find(e => e.name === 'page_view')!
    expect(fullView.props).not.toHaveProperty('screenResolution')
    expect(fullView.props).not.toHaveProperty('viewport')
    expect(fullView.props).toHaveProperty('deviceBucket')
    document.body.innerHTML = ''
    sessionStorage.clear()

    const limited = await boot({ geo: CONSENT_REQUIRED_GEO })
    const limitedView = (await limited.api.events()).find(e => e.name === 'page_view')!
    expect(limitedView.trackingCategory).toBe('limited')
    expect(limitedView.props).not.toHaveProperty('userAgent')
  })
})

describe('page-installed vendor tags', () => {
  it('are told "denied" until consent allows them, then "granted"', async () => {
    const gtag = installGtag()
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: {
        integrations: {
          googleAnalytics: { measurementId: 'G-X', loadScript: false },
        },
      },
    })
    const consentUpdates = () =>
      gtag.filter(call => call[0] === 'consent').map(call => (call[2] as any).ad_storage)

    await vi.waitFor(() => expect(consentUpdates()).toEqual(['denied']))
    expect(gtag.filter(call => call[0] === 'event')).toEqual([])

    await analytics.consent.accept()
    expect(consentUpdates()).toEqual(['denied', 'granted'])
  })
})

describe('banner.autoShow', () => {
  it('false: no automatic banner, but consent.showBanner() still shows it', async () => {
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { banner: { autoShow: false } },
    })

    expect(banner()).toBeNull()
    analytics.consent.showBanner()
    expect(banner()).not.toBeNull()
  })
})

describe('analytics.ready()', () => {
  it('consent.accept() right after start waits for the policy and records its version', async () => {
    const { makeAdapter, makeConfig, mockApi } = await import('./helpers')
    const api = mockApi({ geo: CONSENT_REQUIRED_GEO, policyVersion: '9' })
    const lib = await import('../src/index')

    const analytics = lib.initAnalytics(makeConfig(), makeAdapter().adapter)
    await analytics.consent.accept() // called before the context has arrived

    expect(api.consentRecords()).toEqual([
      expect.objectContaining({ decision: 'granted', policyVersion: '9' }),
    ])
    expect(analytics.consent.get()).toMatchObject({
      granted: true,
      policyVersion: '9',
    })
    expect(banner()).toBeNull()
  })

  it('resolves once the consent policy is known', async () => {
    const { makeAdapter, makeConfig, mockApi } = await import('./helpers')
    mockApi({ geo: FULL_TRACKING_GEO })
    const lib = await import('../src/index')

    const analytics = lib.initAnalytics(makeConfig(), makeAdapter().adapter)
    expect(analytics.consent.get().required).toBe(true) // unknown yet: fail closed
    await analytics.ready()

    expect(analytics.consent.get().required).toBe(false)
  })
})

describe('consent UI survives page-body replacement (e.g. Astro view transitions)', () => {
  it('restores the unanswered banner after a navigation that replaced the body', async () => {
    const { navigate } = await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(banner()).not.toBeNull()

    document.body.innerHTML = '<main>new page</main>' // the framework swaps the body
    navigate('/pricing')

    expect(banner()).not.toBeNull()
  })

  it('restores the "Cookie settings" button, but not a banner that was answered', async () => {
    const { navigate } = await boot({ geo: CONSENT_REQUIRED_GEO })
    document.getElementById('ci-consent-accept')!.click()
    await settle()

    document.body.innerHTML = '<main>new page</main>'
    navigate('/pricing')

    expect(banner()).toBeNull()
    expect(manageButton()).not.toBeNull()
  })
})
