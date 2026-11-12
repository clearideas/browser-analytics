// The browser client against the real reference collector (sample-host), in-process.
// Proves the two sides of the contract agree: nothing the client sends is rejected.
import { describe, expect, it } from 'vitest'

import { hostApi, makeAdapter, makeConfig, setPageHidden, settle } from './helpers'

async function start(options: Parameters<typeof hostApi>[0] = {}, config = {}) {
  const host = await hostApi(options)
  const lib = await import('../src/index')
  const harness = makeAdapter()
  const analytics = lib.initAnalytics(makeConfig({ batchSize: 1, ...config }), harness.adapter)
  await host.settled()
  return { host, analytics, ...harness }
}

function rejections(host: Awaited<ReturnType<typeof hostApi>>) {
  return host.responses.filter(
    r => r.status >= 400 || (r.path === '/v1/events' && r.body?.rejected?.length),
  )
}

describe('client ⇄ reference collector', () => {
  it('visitor outside the consent region: full tracking, nothing rejected', async () => {
    window.history.replaceState(null, '', '/pricing?utm_source=news&token=SECRET')
    const { host, analytics, navigate } = await start({ country: 'US' })

    navigate('/docs')
    await analytics.trackEvent('Sign Up', { plan: 'pro' })
    await analytics.trackError('boom')
    await analytics.flush()
    setPageHidden(true)
    await host.settled()

    expect(rejections(host)).toEqual([])
    const events = host.store.listEvents('test-site')
    expect(events.map(e => e.name)).toEqual(
      expect.arrayContaining(['page_view', 'page_exit', 'sign_up', 'error']),
    )
    expect(events.every(e => e.trackingCategory === 'full')).toBe(true)
    expect(events.every(e => e.origin === 'https://www.example.test')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('SECRET')
    expect(host.store.listConsents()).toEqual([])
  })

  it('visitor in the consent region: limited until accepted, then full, with a consent record', async () => {
    const { host, analytics } = await start({ country: 'DE' })
    const before = host.store.listEvents()
    expect(before.length).toBeGreaterThan(0)
    expect(before.every(e => e.trackingCategory === 'limited')).toBe(true)

    document.getElementById('ci-consent-accept')!.click()
    await host.settled()
    await analytics.trackEvent('sign_up', {})
    await analytics.flush()
    await host.settled()

    expect(rejections(host)).toEqual([])
    const [record] = host.store.listConsents()
    const local = JSON.parse(localStorage.getItem('ci_consent_status')!)
    expect(record).toMatchObject({
      decision: 'granted',
      policyVersion: '1',
      consentId: local.consentId,
      source: 'banner',
      origin: 'https://www.example.test',
    })
    const signUp = host.store.listEvents().find(e => e.name === 'sign_up')!
    expect(signUp).toMatchObject({
      trackingCategory: 'full',
      consentRequired: true,
      consentGranted: true,
    })
  })

  it('unknown region: consent is required', async () => {
    await start({})

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })

  it('site configured to always require consent', async () => {
    await start({ country: 'US', consentMode: 'always' })

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })

  it('a new policy version on the server asks the visitor again', async () => {
    await start({ country: 'DE', policyVersion: '2026-01' })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    document.body.innerHTML = ''
    sessionStorage.clear()

    await start({ country: 'DE', policyVersion: '2026-06' })

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })

  it('the exit event sent by sendBeacon when the page is hidden reaches the collector', async () => {
    const { host } = await start({ country: 'US' }, { batchSize: 50 })

    setPageHidden(true)
    await host.settled()

    expect(host.store.listEvents().map(e => e.name)).toContain('page_exit')
    expect(rejections(host)).toEqual([])
  })
})
