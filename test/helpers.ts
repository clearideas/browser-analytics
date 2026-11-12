// Shared test helpers. Everything here runs against the happy-dom environment.
import { vi } from 'vitest'

import type { CategoryChoices, CategoryState, ConsentCategory } from '../src/categories'
import type { ConsentState, PluginConsentState } from '../src/plugins/types'
import { allowedCategories, isCategoryAllowed } from '../src/plugins/types'
import type {
  AnalyticsConfig,
  AnalyticsEvent,
  ConsentRecord,
  EventBatch,
  FrameworkAdapter,
} from '../src/types'

export const TEST_API = 'https://api.example.test/'

/** A complete, valid config with auto-tracking off. Override per test. */
export function makeConfig(overrides: Partial<AnalyticsConfig> = {}): AnalyticsConfig {
  return {
    apiBaseUrl: TEST_API,
    siteKey: 'test-site',
    flushInterval: 60_000,
    batchSize: 10,
    maxRetries: 2,
    autoTrackScrollDepth: false,
    autoTrackTimeSpent: false,
    autoTrackOutboundLinks: false,
    ...overrides,
  }
}

export interface RecordedRequest {
  transport: 'fetch' | 'beacon'
  method: string
  path: string
  url: string
  body: unknown
  credentials?: RequestCredentials
  contentType?: string
}

export interface MockApiOptions {
  /** Visitor region/policy answered by GET /v1/context. null = context request fails. */
  geo?: { country?: string; continent?: string; requiresConsent: boolean } | null
  policyVersion?: string
  /** policy.trackingWithoutConsent in the context response. */
  trackingWithoutConsent?: 'limited' | 'none'
  /** Replace the GET /v1/context response body (e.g. to simulate a malformed answer). */
  contextBody?: unknown
  /** HTTP status per path (e.g. { '/v1/consent': 500 }). */
  status?: Record<string, number>
  /** Make navigator.sendBeacon unavailable so the fetch path is used. */
  beacon?: 'available' | 'unavailable' | 'rejects'
}

/**
 * Fake collector implementing the v1 contract (spec/openapi.yaml) with canned answers.
 * Records every request made via fetch or sendBeacon. For the real reference
 * implementation, see hostApi().
 */
export function mockApi(options: MockApiOptions = {}) {
  const state = {
    geo:
      options.geo === undefined
        ? { country: 'DE', continent: 'EU', requiresConsent: true }
        : options.geo,
    policyVersion: options.policyVersion ?? '1',
    status: options.status ?? {},
  }
  const requests: RecordedRequest[] = []
  const pending: Promise<unknown>[] = []

  const pathOf = (url: string) => {
    const base = new URL(TEST_API)
    const u = new URL(url, base)
    return '/' + u.pathname.slice(base.pathname.length).replace(/^\/+/, '')
  }

  const parse = (raw: unknown) => {
    if (typeof raw !== 'string') return raw
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  const respond = (path: string) => {
    const contextFails = path === '/v1/context' && state.geo === null
    const status = contextFails
      ? 503
      : (state.status[path] ?? (path === '/v1/consent' ? 201 : path === '/v1/events' ? 202 : 200))
    const geo = state.geo
    const bodies: Record<string, unknown> = {
      '/v1/context': geo && {
        v: 1,
        siteKey: 'test-site',
        policy: {
          consentRequired: geo.requiresConsent,
          policyVersion: state.policyVersion,
          ...(options.trackingWithoutConsent
            ? { trackingWithoutConsent: options.trackingWithoutConsent }
            : {}),
          reason: 'region',
        },
        ...(geo.country ? { geo: { country: geo.country, continent: geo.continent } } : {}),
        ttlSeconds: 3600,
      },
      '/v1/consent': { recordId: 'r1', consentId: 'c1', recordedAt: new Date().toISOString() },
      '/v1/events': { accepted: 1, duplicates: 0, rejected: [] },
    }
    if (options.contextBody !== undefined) bodies['/v1/context'] = options.contextBody
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => bodies[path] ?? {},
    } as Response
  }

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = pathOf(url)
    requests.push({
      transport: 'fetch',
      method: init.method ?? 'GET',
      path,
      url,
      body: parse(init.body),
      credentials: init.credentials,
      contentType: new Headers(init.headers).get('Content-Type') ?? undefined,
    })
    return respond(path)
  })
  vi.stubGlobal('fetch', fetchMock)

  const beaconMode = options.beacon ?? 'unavailable'
  if (beaconMode === 'unavailable') {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true })
  } else {
    const beacon = vi.fn((url: string, data?: BodyInit | null) => {
      if (beaconMode === 'rejects') return false
      const record: RecordedRequest = {
        transport: 'beacon',
        method: 'POST',
        path: pathOf(url),
        url,
        body: undefined,
        contentType: data instanceof Blob ? data.type : undefined,
      }
      requests.push(record)
      if (data instanceof Blob) {
        pending.push(data.text().then(text => (record.body = parse(text))))
      } else {
        record.body = parse(data)
      }
      return true
    })
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
  }

  return {
    state,
    requests,
    fetch: fetchMock,
    /** EventBatch bodies received at POST /v1/events. */
    async batches(): Promise<EventBatch[]> {
      await Promise.all(pending)
      return requests
        .filter(r => r.path === '/v1/events' && r.method === 'POST')
        .map(r => r.body as EventBatch)
    },
    /** All events received at POST /v1/events, flattened across batches. */
    async events(): Promise<AnalyticsEvent[]> {
      return (await this.batches()).flatMap(batch =>
        Array.isArray(batch?.events) ? batch.events : [],
      )
    },
    async eventNames(): Promise<string[]> {
      return (await this.events()).map(e => e.name)
    },
    /** Consent records received at POST /v1/consent. */
    consentRecords(): ConsentRecord[] {
      return requests.filter(r => r.path === '/v1/consent').map(r => r.body as ConsentRecord)
    },
  }
}

/** Minimal framework adapter that records route listeners so tests can navigate. */
export function makeAdapter(config: AnalyticsConfig = makeConfig()) {
  const routeListeners: Array<(path: string) => void> = []
  const adapter: FrameworkAdapter = {
    getConfig: () => config,
    getCurrentPath: () => window.location.pathname,
    getCurrentUrl: () => window.location.href,
    getReferrer: () => document.referrer,
    onRouteChange: callback => {
      routeListeners.push(callback)
      return () => {
        const i = routeListeners.indexOf(callback)
        if (i >= 0) routeListeners.splice(i, 1)
      }
    },
    onAppReady: callback => callback(),
    onAppDestroy: () => {},
    showConsentBanner: () => {},
    getRouter: () => null,
  }
  return {
    adapter,
    routeListeners,
    navigate(path: string) {
      window.history.pushState(null, '', path)
      for (const listener of [...routeListeners]) listener(path)
    },
  }
}

/** Seed a fresh geo decision in storage, as fetchGeoContext would. */
export function seedGeo(requiresConsent: boolean, extra: Record<string, unknown> = {}) {
  sessionStorage.setItem(
    'ci_geo_context',
    JSON.stringify({ requiresConsent, timestamp: Date.now(), ...extra }),
  )
}

/** Seed a cached consent decision in storage. */
export function seedConsent(consented: boolean | null, ageMs = 0) {
  localStorage.setItem(
    'ci_consent_status',
    JSON.stringify({ consented, version: '1', timestamp: Date.now() - ageMs }),
  )
}

/** Let queued promises and zero-delay timers run. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Record raw `document.cookie = ...` writes (including attributes such as Domain/Secure,
 * which are not visible when reading document.cookie). Writes still reach the cookie jar.
 */
export function recordCookieWrites(): { writes: () => string[] } {
  const spy = vi.spyOn(document, 'cookie', 'set')
  return { writes: () => spy.mock.calls.map(call => String(call[0])) }
}

/** Simulate the page becoming hidden (tab switch/close) and fire visibilitychange. */
export function setPageHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  })
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Override document.referrer for the current test. */
export function setReferrer(referrer: string): void {
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
}

/** Capture gtag() calls. */
export function installGtag(): unknown[][] {
  const calls: unknown[][] = []
  ;(window as any).gtag = (...args: unknown[]) => calls.push(args)
  return calls
}

export const FULL_TRACKING_GEO = { country: 'US', continent: 'NA', requiresConsent: false }
export const CONSENT_REQUIRED_GEO = { country: 'DE', continent: 'EU', requiresConsent: true }

/**
 * Boot the library the way an application does (initAnalytics + adapter), with a
 * fresh module graph, a fake backend and a chosen geo/consent scenario.
 */
export async function boot(
  options: {
    geo?: MockApiOptions['geo']
    policyVersion?: string
    config?: Partial<AnalyticsConfig>
    beacon?: MockApiOptions['beacon']
    status?: MockApiOptions['status']
    contextBody?: unknown
    trackingWithoutConsent?: MockApiOptions['trackingWithoutConsent']
  } = {},
) {
  const api = mockApi({
    geo: options.geo === undefined ? FULL_TRACKING_GEO : options.geo,
    policyVersion: options.policyVersion,
    contextBody: options.contextBody,
    trackingWithoutConsent: options.trackingWithoutConsent,
    beacon: options.beacon,
    status: options.status,
  })
  const lib = await import('../src/index')
  const config = makeConfig(options.config)
  const harness = makeAdapter(config)
  const analytics = lib.initAnalytics(config, harness.adapter)
  await settle()
  return { api, lib, config, analytics, ...harness }
}

/** Serialize everything that left the page (backend requests + gtag calls) for leak checks. */
export async function everythingSent(
  api: ReturnType<typeof mockApi>,
  gtagCalls: unknown[][] = [],
): Promise<string> {
  await api.events() // wait for sendBeacon bodies to be decoded
  return JSON.stringify({ requests: api.requests, gtag: gtagCalls })
}

/**
 * Route the client's fetch and sendBeacon into the real reference collector
 * (sample-host), running in-process with an in-memory database. The page origin
 * (https://www.example.test) is sent as Origin, as a browser would.
 */
export async function hostApi(
  options: {
    country?: string
    consentMode?: 'geo' | 'always' | 'never'
    policyVersion?: string
  } = {},
) {
  const { createApp } = await import('../sample-host/src/app.ts')
  const { DEFAULT_CONSENT_COUNTRIES } = await import('../sample-host/src/config.ts')
  const { MemoryStore } = await import('../sample-host/src/memory-store.ts')
  const origin = window.location.origin
  const site = {
    siteKey: 'test-site',
    allowedOrigins: [origin],
    policyVersion: options.policyVersion ?? '1',
    consentMode: options.consentMode ?? ('geo' as const),
  }
  const { app, store } = createApp({
    config: {
      port: 0,
      playgroundPort: 0,
      devMode: false,
      databasePath: ':memory:',
      trustedGeoHeaders: [],
      defaultCountry: options.country,
      consentCountries: new Set(DEFAULT_CONSENT_COUNTRIES),
      contextTtlSeconds: 3600,
      sites: [site],
    },
    store: new MemoryStore(),
  })

  const responses: Array<{ method: string; path: string; status: number; body: any }> = []
  const pending: Promise<unknown>[] = []

  const send = async (url: string, init: RequestInit = {}) => {
    const target = new URL(url)
    const request = new Request(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body as string | undefined,
    })
    // Scripts cannot set Origin (the DOM's Request drops it); the browser adds it to
    // cross-origin requests on the wire. Reproduce that for the collector.
    const wireHeaders = new Headers(request.headers)
    wireHeaders.set('Origin', origin)
    if (typeof init.body === 'string') {
      // Browsers send Content-Length for string bodies.
      wireHeaders.set('Content-Length', String(new TextEncoder().encode(init.body).length))
    }
    Object.defineProperty(request, 'headers', { value: wireHeaders })
    const response = await app.fetch(request)
    const text = await response.clone().text()
    responses.push({
      method: init.method ?? 'GET',
      path: target.pathname,
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    })
    return response
  }

  vi.stubGlobal('fetch', vi.fn(send))
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn((url: string, data?: BodyInit | null) => {
      const body = data instanceof Blob ? data.text() : Promise.resolve(String(data ?? ''))
      const type = data instanceof Blob ? data.type : 'text/plain;charset=UTF-8'
      pending.push(
        body.then(text =>
          send(url, { method: 'POST', headers: { 'Content-Type': type }, body: text }),
        ),
      )
      return true
    }),
  })

  return {
    store,
    site,
    responses,
    /** Wait until every beacon has been processed by the host. */
    async settled() {
      await settle()
      await Promise.all(pending)
    },
  }
}

/** Simulate a browser sending the Global Privacy Control signal. */
export function setGlobalPrivacyControl(enabled: boolean): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: enabled, configurable: true })
}

/**
 * A ConsentState for plugin/host tests. `decision`: null (undecided), true/false (simple
 * mode), or per-category choices.
 */
export function consentState({
  required = true,
  decision = null,
  gpc = false,
}: {
  required?: boolean
  decision?: boolean | null | Partial<CategoryChoices>
  gpc?: boolean
} = {}): ConsentState {
  const categories: CategoryState =
    decision === null
      ? { preferences: null, statistics: null, marketing: null }
      : typeof decision === 'boolean'
        ? { preferences: decision, statistics: decision, marketing: decision }
        : {
            preferences: decision.preferences === true,
            statistics: decision.statistics === true,
            marketing: decision.marketing === true,
          }
  const values = Object.values(categories)
  const granted = values.some(value => value === null) ? null : values.every(Boolean)
  return { required, granted, categories, gpc }
}

/** What a plugin of `category` is told, derived with the real permission rules. */
export function pluginState(
  state: ConsentState,
  category: ConsentCategory = 'marketing',
): PluginConsentState {
  return {
    ...state,
    allowed: isCategoryAllowed(category, state),
    allowedCategories: allowedCategories(state),
  }
}

/** A fake PluginContext for plugin unit tests; `state` can be changed by the test. */
export function pluginContext(state: PluginConsentState) {
  const ctx = {
    state,
    config: makeConfig(),
    consent: () => ctx.state,
    debug: () => {},
    loadScript: vi.fn(async (_src: string, _options?: { integrity?: string }) => {}),
    loadStylesheet: vi.fn(async (_href: string, _options?: { integrity?: string }) => {}),
  }
  return ctx
}

/** Consent states as a plugin of `category` sees them. */
export function pluginStates(category: ConsentCategory = 'marketing') {
  return {
    allowed: pluginState(consentState({ decision: true }), category),
    denied: pluginState(consentState({ decision: false }), category),
  }
}
