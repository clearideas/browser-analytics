// Phase 1 regressions: attribution validation (S3), cookie scope (S5), attribution
// capture after consent, and URL cleaning side effects.
import { describe, expect, it, vi } from 'vitest'

import { boot, CONSENT_REQUIRED_GEO, installGtag, recordCookieWrites, settle } from './helpers'

const attributionCookieWrites = (writes: string[]) =>
  writes.filter(w => w.startsWith('ci_click=') && !/max-age=0/i.test(w))

describe('S3: attribution accepts only known, bounded values', () => {
  it('ignores unknown utm_*/ci_* keys from inbound links', async () => {
    window.history.replaceState(null, '', '/?utm_source=x&utm_evil=1&ci_anything=2&utm_zz=3')

    await boot()

    const stored = JSON.parse(localStorage.getItem('ci_click')!)
    expect(stored.utm_source).toBe('x')
    expect(Object.keys(stored).filter(k => k.startsWith('utm_') || k.startsWith('ci_'))).toEqual([
      'utm_source',
    ])
  })

  it('drops oversized values instead of persisting them', async () => {
    const huge = 'A'.repeat(3000)
    window.history.replaceState(null, '', `/?utm_source=ok&utm_campaign=${huge}`)

    await boot()

    const raw = localStorage.getItem('ci_click')!
    expect(JSON.parse(raw).utm_campaign).toBeUndefined()
    expect(raw.length).toBeLessThan(1000)
  })

  it('does not send unknown keys found in tampered storage', async () => {
    localStorage.setItem(
      'ci_click',
      JSON.stringify({ utm_source: 'ok', utm_injected: 'bad', gclid: { nested: true } }),
    )
    const { api, analytics } = await boot()

    await analytics.trackEvent('sign_up', {})
    await analytics.flush()
    await settle()

    const signUp = (await api.events()).find(e => e.name === 'sign_up')!
    expect(signUp.props.utm_source).toBe('ok')
    expect(signUp.props.utm_injected).toBeUndefined()
    expect(signUp.props.attribution).toMatchObject({ utm_source: 'ok' })
    expect(signUp.props.attribution).not.toHaveProperty('utm_injected')
    expect(signUp.props.attribution).not.toHaveProperty('gclid')
    expect(signUp.props.gclid).toBeUndefined()
  })
})

describe('S3/S5: the attribution cookie is opt-in and validated', () => {
  it('writes no attribution cookie unless cookieDomain is configured', async () => {
    const cookies = recordCookieWrites()
    window.history.replaceState(null, '', '/?utm_source=google')

    await boot()

    expect(attributionCookieWrites(cookies.writes())).toEqual([])
    expect(localStorage.getItem('ci_click')).not.toBeNull()
  })

  it('ignores a forged ci_click cookie when cookieDomain is not configured', async () => {
    document.cookie =
      'ci_click=' +
      encodeURIComponent(JSON.stringify({ gclid: 'forged', utm_x: 'injected' })) +
      '; Path=/'
    const gtag = installGtag()
    const { api, analytics } = await boot({
      config: { gaMeasurementId: 'G', googleAdsConversions: { sign_up: 'AW-1/abc' } },
    })

    await analytics.trackEvent('sign_up', {})
    await analytics.flush()
    // Google must have received the event, or "no conversion" proves nothing.
    await vi.waitFor(() =>
      expect(gtag.some(c => c[0] === 'event' && c[1] === 'sign_up')).toBe(true),
    )

    expect(gtag.some(c => c[1] === 'conversion')).toBe(false)
    const signUp = (await api.events()).find(e => e.name === 'sign_up')!
    expect(signUp.props.gclid).toBeUndefined()
    expect(signUp.props.attribution).toBeUndefined()
  })

  it('with cookieDomain: writes a Secure, SameSite=Lax cookie scoped to that domain', async () => {
    const cookies = recordCookieWrites()
    window.history.replaceState(null, '', '/?utm_source=google')

    await boot({ config: { cookieDomain: 'example.test' } })

    const [write] = attributionCookieWrites(cookies.writes())
    expect(write).toMatch(/;\s*Domain=\.?example\.test/i)
    expect(write).toMatch(/;\s*Secure/i)
    expect(write).toMatch(/;\s*SameSite=Lax/i)
  })

  it('with cookieDomain that does not match the current host: writes no cookie', async () => {
    const cookies = recordCookieWrites()
    window.history.replaceState(null, '', '/?utm_source=google')

    await boot({ config: { cookieDomain: 'other.test' } })

    expect(attributionCookieWrites(cookies.writes())).toEqual([])
  })

  it('with cookieDomain: reads a sibling-subdomain cookie but strips unknown keys', async () => {
    document.cookie =
      'ci_click=' +
      encodeURIComponent(JSON.stringify({ utm_source: 'sibling', utm_x: 'injected' })) +
      '; Path=/'
    const { api, analytics } = await boot({ config: { cookieDomain: 'example.test' } })

    await analytics.trackEvent('sign_up', {})
    await analytics.flush()
    await settle()

    const signUp = (await api.events()).find(e => e.name === 'sign_up')!
    expect(signUp.props.utm_source).toBe('sibling')
    expect(signUp.props.utm_x).toBeUndefined()
  })
})

describe('attribution capture when consent is required', () => {
  it('captures landing attribution when the visitor accepts the banner', async () => {
    window.history.replaceState(null, '', '/landing?gclid=abc123&utm_source=google&utm_medium=cpc')
    await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(localStorage.getItem('ci_click')).toBeNull() // nothing stored before consent

    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(JSON.parse(localStorage.getItem('ci_click')!)).toMatchObject({
      gclid: 'abc123',
      utm_source: 'google',
      utm_medium: 'cpc',
      landingPath: '/landing',
    })
    expect(window.location.search).toBe('')
  })

  it('still captures landing attribution if the visitor navigated before accepting', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google&utm_medium=cpc')
    const { navigate } = await boot({ geo: CONSENT_REQUIRED_GEO })
    navigate('/pricing')
    await settle()

    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(JSON.parse(localStorage.getItem('ci_click')!)).toMatchObject({
      utm_source: 'google',
      landingPath: '/landing',
    })
  })

  it('stores nothing when the visitor rejects', async () => {
    window.history.replaceState(null, '', '/landing?gclid=abc123&utm_source=google')
    await boot({ geo: CONSENT_REQUIRED_GEO })

    document.getElementById('ci-consent-reject')!.click()
    await settle()

    expect(localStorage.getItem('ci_click')).toBeNull()
  })
})

describe('URL cleaning', () => {
  it('preserves the router history.state when removing attribution parameters', async () => {
    const routerState = { back: '/previous', current: '/landing', position: 7 }
    window.history.replaceState(routerState, '', '/landing?utm_source=google')

    await boot()

    expect(window.location.search).toBe('')
    expect(window.history.state).toEqual(routerState)
  })
})

describe('withdrawing consent', () => {
  it('reject after accept clears stored attribution and the shared cookie', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google')
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { cookieDomain: 'example.test' },
    })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    expect(document.cookie).toContain('ci_click=')
    expect(localStorage.getItem('ci_click')).not.toBeNull()

    analytics.showConsentBanner()
    document.getElementById('ci-consent-reject')!.click()
    await settle()

    expect(document.cookie).not.toContain('ci_click=')
    expect(localStorage.getItem('ci_click')).toBeNull()
  })
})
