// Phase 1 regressions: event delivery and auto-tracking lifecycle.
import { describe, expect, it, vi } from 'vitest'

import {
  boot,
  CONSENT_REQUIRED_GEO,
  makeAdapter,
  makeConfig,
  mockApi,
  seedConsent,
  seedGeo,
  setPageHidden,
  settle,
} from './helpers'

describe('exit events are delivered when the page is hidden or unloaded', () => {
  it('sends page_exit synchronously when the page becomes hidden', async () => {
    const { api } = await boot({ beacon: 'available' })
    const before = api.requests.length

    setPageHidden(true)

    // No await: the browser may discard the page right after this handler returns.
    expect(api.requests.length).toBeGreaterThan(before)
    expect(await api.eventNames()).toContain('page_exit')
  })

  it('sends page_exit on pagehide and does not duplicate it after visibilitychange', async () => {
    const { api } = await boot({ beacon: 'available' })

    setPageHidden(true)
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect((await api.eventNames()).filter(n => n === 'page_exit')).toHaveLength(1)
  })

  it('pre-consent (limited) exit events are delivered too', async () => {
    const { api } = await boot({ geo: CONSENT_REQUIRED_GEO, beacon: 'available' })

    setPageHidden(true)

    expect(await api.eventNames()).toContain('page_exit')
  })
})

describe('auto-tracking lifecycle', () => {
  async function setup() {
    const api = mockApi({ beacon: 'unavailable' })
    seedGeo(false)
    seedConsent(true)
    const lib = await import('../src/index')
    const harness = makeAdapter()
    const analytics = lib.createAnalytics(makeConfig(), harness.adapter)
    return { api, analytics, ...harness }
  }

  it('startAutoTracking is idempotent', async () => {
    const { api, analytics, navigate, routeListeners } = await setup()

    analytics.startAutoTracking()
    analytics.startAutoTracking()
    await settle()
    navigate('/next')
    await settle()

    expect(routeListeners).toHaveLength(1)
    expect((await api.eventNames()).filter(n => n === 'page_view')).toHaveLength(2)
  })

  it('stopAutoTracking removes route tracking and listeners', async () => {
    const { api, analytics, navigate, routeListeners } = await setup()
    analytics.startAutoTracking()
    await settle()

    analytics.stopAutoTracking()
    navigate('/after-stop')
    setPageHidden(true)
    await settle()

    expect(routeListeners).toHaveLength(0)
    const names = await api.eventNames()
    expect(names.filter(n => n === 'page_view')).toHaveLength(1)
    expect(names).not.toContain('page_exit')
  })

  it('can be restarted after stopping', async () => {
    const { api, analytics, navigate } = await setup()
    analytics.startAutoTracking()
    await settle()
    analytics.stopAutoTracking()

    analytics.startAutoTracking()
    await settle()
    navigate('/again')
    await settle()

    expect((await api.eventNames()).filter(n => n === 'page_view')).toHaveLength(3)
  })
})

describe('event content', () => {
  it('pre-consent error events keep their (truncated) message', async () => {
    const api = mockApi({ beacon: 'unavailable', geo: CONSENT_REQUIRED_GEO })
    seedGeo(true)
    seedConsent(null)
    const lib = await import('../src/index')
    const analytics = lib.createAnalytics(makeConfig(), makeAdapter().adapter)

    await analytics.trackError('TypeError: boom', { stack: 'at secret (https://x/?t=1)' })
    await analytics.trackError('E'.repeat(2000))
    await settle()

    const errors = (await api.events()).filter(e => e.name === 'error')
    expect(errors[0]!.trackingCategory).toBe('limited')
    expect(errors[0]!.props.message).toBe('TypeError: boom')
    expect(errors[0]!.props.stack).toBeUndefined()
    expect(errors[1]!.props.message).toHaveLength(500)
  })

  it('attaches country and continent from the geo response', async () => {
    const { api } = await boot()

    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.props).toMatchObject({ country: 'US', continent: 'NA' })
  })
})

describe('delivery', () => {
  async function tracking() {
    seedGeo(false)
    return import('../src/tracking')
  }
  const consented = { consented: true, version: '1' }

  it('concurrent sends deliver each event exactly once', async () => {
    const api = mockApi({ beacon: 'unavailable' })
    const { trackEvent } = await tracking()
    const config = makeConfig({ batchSize: 1 })

    await Promise.all(
      [1, 2, 3, 4].map(i => trackEvent(config, `custom_${i}`, {}, undefined, consented)),
    )
    await settle()

    expect((await api.eventNames()).sort()).toEqual([
      'custom_1',
      'custom_2',
      'custom_3',
      'custom_4',
    ])
  })

  it('failed batches are retried up to maxRetries, then dropped', async () => {
    const api = mockApi({ beacon: 'unavailable', status: { '/v1/events': 500 } })
    const { trackEvent, flushEvents } = await tracking()
    const config = makeConfig({ batchSize: 1, maxRetries: 2 })
    const posts = () => api.requests.filter(r => r.path === '/v1/events').length

    await trackEvent(config, 'custom', {}, undefined, consented)
    expect(posts()).toBe(1)
    await flushEvents(config)
    expect(posts()).toBe(2)
    await flushEvents(config)
    expect(posts()).toBe(2)
  })

  it('falls back to fetch when sendBeacon refuses the payload', async () => {
    const api = mockApi({ beacon: 'rejects' })
    const { trackEvent } = await tracking()

    await trackEvent(makeConfig({ batchSize: 1 }), 'custom', {}, undefined, consented)

    expect(api.requests.map(r => r.transport)).toEqual(['fetch'])
    expect(await api.eventNames()).toEqual(['custom'])
  })
})

describe('page lifecycle details', () => {
  it('page_exit on route change describes the page being left, not the next one', async () => {
    window.history.replaceState(null, '', '/first')
    const { api, navigate, analytics } = await boot()

    navigate('/second')
    await settle()
    await analytics.flush()

    const exit = (await api.events()).find(e => e.name === 'page_exit')!
    expect(exit.props.path).toBe('/first')
    expect(exit.props.url).toBe('https://www.example.test/first')
  })

  it('time_spent is delivered when the page is hidden after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { api } = await boot({ beacon: 'available', config: { autoTrackTimeSpent: true } })

    vi.setSystemTime(Date.now() + 31_000)
    setPageHidden(true)

    const timeSpent = (await api.events()).find(e => e.name === 'time_spent')!
    expect(timeSpent.props.timeSpent).toBeGreaterThanOrEqual(31)
  })

  it('owner opt-out also applies to events sent on page hide', async () => {
    const { api } = await boot({ beacon: 'available' })
    const { setDontTrackOwner } = await import('../src/storage')
    setDontTrackOwner(true)

    setPageHidden(true)

    expect(await api.eventNames()).not.toContain('page_exit')
  })
})

describe('route change de-duplication', () => {
  it('a URL change that only removes attribution parameters is not a new page', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google&gclid=abc')
    const { api, analytics, routeListeners } = await boot({ geo: CONSENT_REQUIRED_GEO })

    // Accepting cleans the URL (history.replaceState); a history-watching integration
    // reports that as a route change.
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    expect(window.location.search).toBe('')
    for (const listener of routeListeners) listener(window.location.pathname)
    await settle()
    await analytics.flush()

    expect((await api.events()).filter(e => e.name === 'page_view')).toHaveLength(1)
  })
})
