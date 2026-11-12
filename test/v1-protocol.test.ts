// The client's side of the v1 contract (spec/openapi.yaml): request shapes, transport,
// context caching, consent records, retries, batching and limits.
import { describe, expect, it, vi } from 'vitest'

import { createValidator } from '../sample-host/src/spec.ts'
import {
  boot,
  CONSENT_REQUIRED_GEO,
  FULL_TRACKING_GEO,
  installGtag,
  makeAdapter,
  makeConfig,
  mockApi,
  seedConsent,
  seedGeo,
  setPageHidden,
  settle,
} from './helpers'

const validator = createValidator()

describe('requests match the spec', () => {
  it('every batch, event and consent record sent during a session is valid', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google&gclid=abc123')
    const { api, analytics, navigate } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      beacon: 'available',
    })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    navigate('/pricing')
    await analytics.trackEvent('Sign Up', { plan: 'pro', when: new Date(0), fn: () => 1 })
    await analytics.trackError('boom')
    await analytics.flush()
    setPageHidden(true)
    await settle()

    const batches = await api.batches()
    const events = await api.events()
    const records = api.consentRecords()
    expect(batches.length).toBeGreaterThan(0)
    expect(events.map(e => e.name)).toEqual(
      expect.arrayContaining(['page_view', 'sign_up', 'error', 'page_exit']),
    )
    expect(records).toHaveLength(1)
    for (const batch of batches) {
      expect(validator.validate('EventBatch', batch)).toEqual([])
      for (const event of batch.events) {
        expect(validator.validate('Event', event), event.name).toEqual([])
      }
    }
    for (const record of records)
      expect(validator.validate('ConsentRecordRequest', record)).toEqual([])
  })

  it('uses siteKey, falling back to the deprecated eventSiteName', async () => {
    const { api } = await boot({ config: { siteKey: undefined, eventSiteName: 'legacy-name' } })

    expect(api.requests.find(r => r.path === '/v1/context')!.url).toContain('siteKey=legacy-name')
    expect((await api.batches())[0]!.siteKey).toBe('legacy-name')
  })
})

describe('transport', () => {
  it('sendBeacon bodies are text/plain (no CORS preflight needed)', async () => {
    const { api } = await boot({ beacon: 'available' })

    const beacon = api.requests.find(r => r.transport === 'beacon')!
    expect(beacon.path).toBe('/v1/events')
    expect(beacon.contentType).toBe('text/plain;charset=utf-8')
  })

  it('fetch requests are text/plain and never carry cookies', async () => {
    const { api } = await boot({ geo: CONSENT_REQUIRED_GEO, beacon: 'unavailable' })
    document.getElementById('ci-consent-accept')!.click()
    await settle()

    const fetches = api.requests.filter(r => r.transport === 'fetch')
    expect(fetches.map(r => r.path)).toEqual(
      expect.arrayContaining(['/v1/context', '/v1/events', '/v1/consent']),
    )
    for (const request of fetches) expect(request.credentials).toBe('omit')
    for (const request of fetches.filter(r => r.method === 'POST')) {
      expect(request.contentType).toBe('text/plain;charset=UTF-8')
    }
  })

  it('makes no legacy requests and removes the legacy stored user ID', async () => {
    localStorage.setItem('ci_session_status', JSON.stringify({ timestamp: 1, userId: 'user-123' }))

    const { api } = await boot()

    expect(api.requests.every(r => r.path.startsWith('/v1/'))).toBe(true)
    expect(localStorage.getItem('ci_session_status')).toBeNull()
  })

  it('sets no cookies by default, even after consent', async () => {
    const { api } = await boot({ geo: CONSENT_REQUIRED_GEO })
    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(api.consentRecords()).toHaveLength(1)
    expect(document.cookie).toBe('')
  })

  it('discards events queued by pre-v1 versions', async () => {
    sessionStorage.setItem(
      'ci_events_queue',
      JSON.stringify([{ name: 'old', sessionId: 's', attributes: { event: 'page_view' } }]),
    )

    const { api } = await boot()

    expect(await api.eventNames()).toEqual(['page_view'])
  })
})

describe('context (GET /v1/context)', () => {
  it('is cached for the browser session', async () => {
    await boot()
    const second = await boot()

    expect(second.api.requests.filter(r => r.path === '/v1/context')).toHaveLength(0)
  })

  it('is not fetched when supplied with the page (initialContext)', async () => {
    const { api } = await boot({
      geo: FULL_TRACKING_GEO,
      config: { initialContext: { consentRequired: true, policyVersion: '7', country: 'FR' } },
    })

    expect(api.requests.some(r => r.path === '/v1/context')).toBe(false)
    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })

  it('requires consent when the context response is malformed (fail closed)', async () => {
    for (const contextBody of [{}, { policy: {} }, { policy: { consentRequired: 'no' } }, 'oops']) {
      document.body.innerHTML = ''
      sessionStorage.clear()

      await boot({ contextBody })

      expect(
        document.getElementById('ci-consent-banner'),
        JSON.stringify(contextBody),
      ).not.toBeNull()
    }
  })

  it('requires consent when the context cannot be fetched (fail closed)', async () => {
    const { api } = await boot({ geo: null })

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
    const pageView = (await api.events()).find(e => e.name === 'page_view')!
    expect(pageView.trackingCategory).toBe('limited')
    expect(pageView.consent).toEqual({ required: true, granted: false })
  })
})

describe('consent (POST /v1/consent)', () => {
  it('stores the decision in the browser and sends a record with a stable consentId', async () => {
    const { api, analytics } = await boot({ geo: CONSENT_REQUIRED_GEO, policyVersion: '2026-11' })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    analytics.showConsentBanner()
    document.getElementById('ci-consent-reject')!.click()
    await settle()

    const [granted, denied] = api.consentRecords()
    expect(granted).toMatchObject({
      decision: 'granted',
      policyVersion: '2026-11',
      source: 'banner',
    })
    expect(denied).toMatchObject({ decision: 'denied', consentId: granted!.consentId })
    expect(JSON.parse(localStorage.getItem('ci_consent_status')!)).toMatchObject({
      consented: false,
      version: '2026-11',
      consentId: granted!.consentId,
    })
  })

  it('the decision applies even if the record cannot be delivered, and is re-sent later', async () => {
    const first = await boot({ geo: CONSENT_REQUIRED_GEO, status: { '/v1/consent': 503 } })
    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(JSON.parse(localStorage.getItem('ci_consent_status')!).consented).toBe(true)
    expect(JSON.parse(localStorage.getItem('ci_consent_pending')!)).toHaveLength(1)
    await first.analytics.trackEvent('sign_up', {})
    await first.analytics.flush()
    expect((await first.api.events()).find(e => e.name === 'sign_up')!.trackingCategory).toBe(
      'full',
    )

    const second = await boot({ geo: CONSENT_REQUIRED_GEO })

    expect(second.api.consentRecords()).toEqual([expect.objectContaining({ decision: 'granted' })])
    expect(localStorage.getItem('ci_consent_pending')).toBeNull()
  })

  it('third-party tags learn the decision before any event is sent under it', async () => {
    const gtag = installGtag()
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { gaMeasurementId: 'G-TEST' },
    })
    // Hold the consent record request open: events fired meanwhile must not reach
    // Google before its consent state is updated.
    let release = () => {}
    const original = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/v1/consent')) await new Promise<void>(r => (release = r))
        return original(url, init)
      }),
    )
    gtag.length = 0

    document.getElementById('ci-consent-accept')!.click()
    await analytics.trackEvent('sign_up', {})
    // Plugins load asynchronously; wait until Google has received an event while the
    // consent request is still held open.
    await vi.waitFor(() => expect(gtag.some(call => call[0] === 'event')).toBe(true))

    const firstEvent = gtag.findIndex(call => call[0] === 'event')
    const granted = gtag.findIndex(
      call => call[0] === 'consent' && (call[2] as any)?.ad_storage === 'granted',
    )
    expect(firstEvent).toBeGreaterThanOrEqual(0)
    expect(granted).toBeGreaterThanOrEqual(0)
    expect(granted).toBeLessThan(firstEvent)
    release()
    await settle()
  })

  it('does not keep retrying a record the collector rejected (4xx)', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO, status: { '/v1/consent': 400 } })
    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(localStorage.getItem('ci_consent_pending')).toBeNull()
  })

  it('asks again when the policy version changes', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO, policyVersion: '1' })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    document.body.innerHTML = ''
    sessionStorage.clear() // new browser session: context is fetched again

    await boot({ geo: CONSENT_REQUIRED_GEO, policyVersion: '2' })

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })

  it('does not ask again when the policy version is unchanged', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO, policyVersion: '1' })
    document.getElementById('ci-consent-accept')!.click()
    await settle()
    document.body.innerHTML = ''
    sessionStorage.clear()

    await boot({ geo: CONSENT_REQUIRED_GEO, policyVersion: '1' })

    expect(document.getElementById('ci-consent-banner')).toBeNull()
  })
})

describe('event delivery (POST /v1/events)', () => {
  const consented = { consented: true, version: '1' }

  async function tracking(status?: Record<string, number>) {
    const api = mockApi({ beacon: 'unavailable', status })
    seedGeo(false)
    const lib = await import('../src/tracking')
    return { api, ...lib }
  }

  it('does not retry batches the collector rejected as invalid (4xx)', async () => {
    const { api, trackEvent, flushEvents } = await tracking({ '/v1/events': 400 })
    const config = makeConfig({ batchSize: 1, maxRetries: 3 })

    await trackEvent(config, 'custom', {}, undefined, consented)
    await flushEvents(config)

    expect(api.requests.filter(r => r.path === '/v1/events')).toHaveLength(1)
  })

  it('retries batches after 429 and 5xx responses', async () => {
    for (const status of [429, 503]) {
      const { api, trackEvent, flushEvents } = await tracking({ '/v1/events': status })
      const config = makeConfig({ batchSize: 1, maxRetries: 3 })

      await trackEvent(config, 'custom', {}, undefined, consented)
      await flushEvents(config)
      await flushEvents(config)

      expect(
        api.requests.filter(r => r.path === '/v1/events'),
        String(status),
      ).toHaveLength(3)
    }
  })

  it('splits large queues into batches of at most 50 events and 60 KB', async () => {
    const { api, trackEvent, flushEvents } = await tracking()
    const config = makeConfig({ batchSize: 1000 })

    for (let i = 0; i < 120; i++) {
      await trackEvent(config, 'custom', { i, pad: 'x'.repeat(1500) }, undefined, consented)
    }
    await flushEvents(config)

    const posts = api.requests.filter(r => r.path === '/v1/events')
    const sizes = posts.map(r => new TextEncoder().encode(JSON.stringify(r.body)).length)
    const counts = posts.map(r => (r.body as any).events.length)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(120)
    expect(Math.max(...counts)).toBeLessThanOrEqual(50)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(60_000)
  })

  it('each event has a unique eventId (the collector de-duplicates retries by it)', async () => {
    const { api, trackEvent, flushEvents } = await tracking()
    const config = makeConfig({ batchSize: 1000 })

    for (let i = 0; i < 20; i++) await trackEvent(config, 'custom', {}, undefined, consented)
    await flushEvents(config)

    const ids = (await api.events()).map(e => e.eventId)
    expect(new Set(ids).size).toBe(20)
  })
})

describe('events fit the contract limits', () => {
  it('normalizes event names', async () => {
    const { normalizeEventName } = await import('../src/core')

    expect(normalizeEventName('Sign Up')).toBe('sign_up')
    expect(normalizeEventName('checkout.completed')).toBe('checkout_completed')
    expect(normalizeEventName('404 seen')).toBe('event_404_seen')
    expect(normalizeEventName('***')).toBe('event')
    expect(normalizeEventName('x'.repeat(100))).toHaveLength(64)
  })

  it('fits props: long strings, too many keys, non-JSON values, dates', async () => {
    const { fitPropsToContract } = await import('../src/core')
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]))

    const fitted = fitPropsToContract({
      ...many,
      long: 'x'.repeat(3000),
    })
    expect(Object.keys(fitted)).toHaveLength(100)

    const other = fitPropsToContract({
      long: 'x'.repeat(3000),
      fn: () => 1,
      missing: undefined,
      nan: Number.NaN,
      when: new Date('2026-01-01T00:00:00.000Z'),
      list: Array.from({ length: 80 }, (_, i) => i),
      nested: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    })
    expect(other.long).toHaveLength(2048)
    expect(other).not.toHaveProperty('fn')
    expect(other).not.toHaveProperty('missing')
    expect(other.nan).toBeNull()
    expect(other.when).toBe('2026-01-01T00:00:00.000Z')
    expect(other.list).toHaveLength(50)
    expect(
      validator.validate('Event', {
        eventId: 'abcdefgh12345678',
        name: 'x',
        occurredAt: '2026-01-01T00:00:00.000Z',
        sessionId: 'abcdefgh12345678',
        trackingCategory: 'full',
        consent: { required: false, granted: false },
        props: other,
      }),
    ).toEqual([])
  })

  it('an oversized event is sent without its props rather than rejected', async () => {
    const api = mockApi({ beacon: 'unavailable' })
    seedGeo(false)
    seedConsent(true)
    const lib = await import('../src/index')
    const analytics = lib.createAnalytics(makeConfig({ batchSize: 1 }), makeAdapter().adapter)
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x'.repeat(2000)]),
    )

    await analytics.trackEvent('big_event', big)
    await settle()

    const event = (await api.events()).find(e => e.name === 'big_event')!
    expect(event.props).toEqual({ propsTruncated: true })
  })
})
