// Consent categories ("categories" mode) and the per-region policy for tracking without
// consent. Simple mode remains the default.
import { describe, expect, it, vi } from 'vitest'

import { boot, CONSENT_REQUIRED_GEO, FULL_TRACKING_GEO, installGtag, settle } from './helpers'

const CATEGORIES = { consent: { choices: 'categories' as const } }
const banner = () => document.getElementById('ci-consent-banner')
const box = (category: string) =>
  document.getElementById(`ci-consent-category-${category}`) as HTMLInputElement

describe('simple mode (default)', () => {
  it('one choice: no Customize; accepting allows every category', async () => {
    const { analytics, api } = await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(document.getElementById('ci-consent-customize')).toBeNull()

    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(analytics.consent.get().categories).toEqual({
      preferences: true,
      statistics: true,
      marketing: true,
    })
    expect(api.consentRecords()[0]).toMatchObject({
      decision: 'granted',
      categories: { preferences: true, statistics: true, marketing: true },
    })
  })

  it('a decision stored before categories existed applies to every category', async () => {
    localStorage.setItem(
      'ci_consent_status',
      JSON.stringify({
        consented: true,
        version: '1',
        timestamp: Date.now(),
        consentId: 'old-consent-id',
      }),
    )
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO })

    expect(banner()).toBeNull()
    expect(analytics.consent.get()).toMatchObject({
      granted: true,
      categories: { preferences: true, statistics: true, marketing: true },
    })
  })
})

describe('categories mode', () => {
  it('statistics only: full analytics and attribution; marketing tags off; partial record', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google&gclid=g1')
    const gtag = installGtag()
    const marketing = { name: 'adVendor', category: 'marketing' as const, track: vi.fn() }
    const { analytics, api } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: {
        ...CATEGORIES,
        plugins: [marketing],
        integrations: { googleAnalytics: { measurementId: 'G-1', loadScript: false } },
      },
    })

    document.getElementById('ci-consent-customize')!.click()
    box('statistics').click()
    document.getElementById('ci-consent-save')!.click()
    await analytics.trackEvent('sign_up', {})
    await analytics.flush()

    expect(api.consentRecords()[0]).toMatchObject({
      decision: 'partial',
      categories: { preferences: false, statistics: true, marketing: false },
    })
    const signUp = (await api.events()).find(e => e.name === 'sign_up')!
    expect(signUp).toMatchObject({
      trackingCategory: 'full',
      consent: { required: true, granted: true },
    })
    expect(JSON.parse(localStorage.getItem('ci_click')!)).toMatchObject({ gclid: 'g1' })
    await vi.waitFor(() =>
      expect(gtag.some(c => c[0] === 'event' && c[1] === 'sign_up')).toBe(true),
    )
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
    expect(marketing.track).not.toHaveBeenCalled()
    expect(analytics.consent.get().granted).toBe(false) // not everything was accepted
  })

  it('marketing only: marketing tags run, first-party analytics stays limited, no attribution stored', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google')
    const marketing = { name: 'adVendor', category: 'marketing' as const, track: vi.fn() }
    const { analytics, api } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { ...CATEGORIES, plugins: [marketing] },
    })

    await analytics.consent.set({ marketing: true })
    await analytics.trackEvent('sign_up', {})
    await analytics.flush()

    await vi.waitFor(() => expect(marketing.track).toHaveBeenCalled())
    expect(await api.eventNames()).not.toContain('sign_up') // non-essential, limited
    expect(localStorage.getItem('ci_click')).toBeNull()
  })

  it('"Cookie settings" reopens the choices, expanded, showing the current selection', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO, config: CATEGORIES })
    document.getElementById('ci-consent-customize')!.click()
    box('statistics').click()
    document.getElementById('ci-consent-save')!.click()
    await settle()

    document.getElementById('ci-consent-manage')!.click()

    expect(document.getElementById('ci-consent-categories')!.hidden).toBe(false)
    expect(box('statistics').checked).toBe(true)
    expect(box('marketing').checked).toBe(false)
    expect(document.activeElement).toBe(box('preferences'))
  })

  it('offers only the configured categories', async () => {
    await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { consent: { choices: 'categories', categories: ['statistics'] } },
    })
    expect(box('statistics')).not.toBeNull()
    expect(box('marketing')).toBeNull()
    expect(box('preferences')).toBeNull()
  })

  it('withdrawing marketing deletes Google Ads cookies but keeps Analytics cookies', async () => {
    installGtag()
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: {
        ...CATEGORIES,
        integrations: { googleAnalytics: { measurementId: 'G-1', loadScript: false } },
      },
    })
    await analytics.consent.accept()
    await vi.waitFor(() => expect((window as any).gtag).toBeDefined())
    await settle()
    document.cookie = '_ga=GA1.1.1; Path=/'
    document.cookie = '_gcl_au=1.1.1; Path=/'

    await analytics.consent.set({ statistics: true })

    expect(document.cookie).toBe('_ga=GA1.1.1')
  })
})

describe('tracking without consent (per-region policy)', () => {
  it("policy 'none': nothing is sent before a decision, not even page views", async () => {
    const { api, analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      trackingWithoutConsent: 'none',
    })
    await analytics.trackError('boom')
    await analytics.flush()

    expect(banner()).not.toBeNull()
    expect(await api.events()).toEqual([])
    expect(sessionStorage.getItem('ci_anon_session')).toBeNull()
  })

  it("policy 'none': nothing after a refusal either; everything after acceptance", async () => {
    const rejected = await boot({ geo: CONSENT_REQUIRED_GEO, trackingWithoutConsent: 'none' })
    document.getElementById('ci-consent-reject')!.click()
    await rejected.analytics.trackError('boom')
    await rejected.analytics.flush()
    expect(await rejected.api.events()).toEqual([])
    document.body.innerHTML = ''
    localStorage.clear()

    const accepted = await boot({ geo: CONSENT_REQUIRED_GEO, trackingWithoutConsent: 'none' })
    document.getElementById('ci-consent-accept')!.click()
    await accepted.analytics.trackEvent('sign_up', {})
    await accepted.analytics.flush()
    expect(await accepted.api.eventNames()).toContain('sign_up')
  })

  it("policy 'limited' (default): anonymous page views before a decision", async () => {
    const { api } = await boot({ geo: CONSENT_REQUIRED_GEO })
    expect((await api.events()).map(e => [e.name, e.trackingCategory])).toContainEqual([
      'page_view',
      'limited',
    ])
  })

  it("the site setting applies when the collector does not say; the collector's policy wins", async () => {
    const fromSite = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { consent: { trackingWithoutConsent: 'none' } },
    })
    expect(await fromSite.api.events()).toEqual([])
    sessionStorage.clear()

    const collectorWins = await boot({
      geo: CONSENT_REQUIRED_GEO,
      trackingWithoutConsent: 'limited',
      config: { consent: { trackingWithoutConsent: 'none' } },
    })
    expect(await collectorWins.api.eventNames()).toContain('page_view')
  })

  it('does not apply where consent is not required', async () => {
    const { api } = await boot({ geo: FULL_TRACKING_GEO, trackingWithoutConsent: 'none' })
    expect(await api.eventNames()).toContain('page_view')
  })
})
