// Script-tag build (dist/analytics.js): data-* configuration, command queue, global API.
import { describe, expect, it, vi } from 'vitest'

import { CONSENT_REQUIRED_GEO, FULL_TRACKING_GEO, mockApi, settle, TEST_API } from './helpers'

function scriptTag(attributes: Record<string, string>) {
  const script = document.createElement('script')
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value)
  return script
}

describe('readScriptConfig', () => {
  it('reads settings from data-* attributes', async () => {
    const { readScriptConfig } = await import('../src/script')

    expect(
      readScriptConfig(
        scriptTag({
          'data-api-base-url': TEST_API,
          'data-site-key': 'my-site',
          'data-cookie-domain': 'example.com',
          'data-website-base-url': 'https://example.com/',
          'data-debug': 'true',
          'data-banner': 'false',
          'data-route-changes': 'manual',
        }),
      ),
    ).toEqual({
      apiBaseUrl: TEST_API,
      siteKey: 'my-site',
      cookieDomain: 'example.com',
      websiteBaseUrl: 'https://example.com/',
      debug: true,
      banner: false,
      routeChanges: 'manual',
    })
  })
})

describe('autoInit', () => {
  it('starts from the script tag, merged with window.ciAnalyticsConfig (attributes win)', async () => {
    const api = mockApi({ geo: CONSENT_REQUIRED_GEO })
    window.ciAnalyticsConfig = {
      siteKey: 'from-global',
      banner: { acceptLabel: 'OK, accept' },
    }
    const { autoInit } = await import('../src/script')

    const analytics = autoInit(
      scriptTag({ 'data-api-base-url': TEST_API, 'data-site-key': 'from-tag' }),
    )
    await settle(40)

    expect(analytics).not.toBeNull()
    expect(api.requests.find(r => r.path === '/v1/context')!.url).toContain('siteKey=from-tag')
    expect(document.getElementById('ci-consent-accept')!.textContent).toBe('OK, accept')
  })

  it('runs commands queued before the script loaded, and later pushes immediately', async () => {
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    window.ciAnalyticsQueue = [['trackEvent', 'early_event', { a: 1 }], ['consent.accept']]
    const { autoInit } = await import('../src/script')

    const analytics = autoInit(scriptTag({ 'data-api-base-url': TEST_API, 'data-site-key': 's' }))!
    ;(window.ciAnalyticsQueue as unknown as { push: (c: unknown[]) => void }).push([
      'trackEvent',
      'late_event',
    ])
    await settle(40)
    await analytics.flush()

    expect(await api.eventNames()).toEqual(expect.arrayContaining(['early_event', 'late_event']))
    expect(api.consentRecords()).toEqual([
      expect.objectContaining({ decision: 'granted', source: 'api' }),
    ])
  })

  it('warns about unknown commands', async () => {
    mockApi({ geo: FULL_TRACKING_GEO })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.ciAnalyticsQueue = [['doesNotExist']]
    const { autoInit } = await import('../src/script')

    const analytics = autoInit(scriptTag({ 'data-api-base-url': TEST_API, 'data-site-key': 's' }))!
    await analytics.ready() // queued commands run once the consent policy is known
    await settle()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('doesNotExist'))
  })

  it('needs an API URL and site key, and can be turned off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { autoInit } = await import('../src/script')

    expect(autoInit(scriptTag({ 'data-site-key': 's' }))).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('data-api-base-url'))
    expect(
      autoInit(
        scriptTag({
          'data-api-base-url': TEST_API,
          'data-site-key': 's',
          'data-auto-init': 'false',
        }),
      ),
    ).toBeNull()
  })
})

describe('window.ClearIdeasAnalytics', () => {
  it('offers init() and get()', async () => {
    mockApi({ geo: FULL_TRACKING_GEO })
    const { installGlobal } = await import('../src/script')
    installGlobal()

    expect(window.ClearIdeasAnalytics!.get()).toBeNull()
    const analytics = window.ClearIdeasAnalytics!.init({ apiBaseUrl: TEST_API, siteKey: 's' })
    expect(window.ClearIdeasAnalytics!.get()).toBe(analytics)
    await analytics.ready() // finish start-up inside this test (its timers must not leak)
  })
})
