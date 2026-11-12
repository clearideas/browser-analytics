// Contract tests: the reference host against spec/openapi.yaml.
// Every response is validated against the schema the spec declares for that
// operation and status code.
import { writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createApp, EVENTS_MAX_BYTES } from '../src/app.ts'
import type { HostConfig, SiteConfig } from '../src/config.ts'
import { DEFAULT_CONSENT_COUNTRIES, loadConfig } from '../src/config.ts'
import type { SchemaName } from '../src/spec.ts'
import { createValidator, loadSpec } from '../src/spec.ts'
import { SqliteStore } from '../src/sqlite-store.ts'

const spec = loadSpec()
const validator = createValidator(spec)

const ORIGIN = 'https://www.example.com'
const SITE: SiteConfig = {
  siteKey: 'example-site',
  allowedOrigins: [ORIGIN],
  policyVersion: '2026-11-01',
  consentMode: 'geo',
}

function hostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  return {
    port: 0,
    playgroundPort: 0,
    devMode: false,
    databasePath: ':memory:',
    trustedGeoHeaders: ['cf-ipcountry', 'cf-ipcontinent'],
    consentCountries: new Set(DEFAULT_CONSENT_COUNTRIES),
    contextTtlSeconds: 3600,
    sites: [SITE],
    ...overrides,
  }
}

function host(overrides: Partial<HostConfig> = {}) {
  const { app, store } = createApp({
    config: hostConfig(overrides),
    store: new SqliteStore(':memory:'),
    validator,
    now: () => new Date('2026-11-10T12:00:05.000Z'),
  })
  return { app, store }
}

/** Name of the schema the spec declares for this response. */
function responseSchema(path: string, method: string, status: number): SchemaName | 'inline' {
  const operation = spec.paths[path]?.[method]
  if (!operation) throw new Error(`No ${method} ${path} in spec`)
  let response = operation.responses[String(status)]
  if (!response) throw new Error(`Spec does not declare ${status} for ${method} ${path}`)
  if (response.$ref) response = spec.components.responses[response.$ref.split('/').pop()]
  const schema = (Object.values(response.content) as any[])[0].schema
  return schema.$ref ? (schema.$ref.split('/').pop() as SchemaName) : 'inline'
}

/** Send a request and assert the response matches the spec for its status. */
async function call(
  app: ReturnType<typeof host>['app'],
  method: 'get' | 'post',
  path: string,
  init: {
    body?: unknown
    raw?: string
    contentType?: string
    origin?: string | null
    headers?: Record<string, string>
  } = {},
) {
  const headers: Record<string, string> = { ...init.headers }
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN
  if (method === 'post') headers['Content-Type'] = init.contentType ?? 'text/plain;charset=UTF-8'
  const response = await app.request(path, {
    method: method.toUpperCase(),
    headers,
    body: method === 'post' ? (init.raw ?? JSON.stringify(init.body)) : undefined,
  })
  const specPath = path.split('?')[0]!
  const body = await response.json().catch(() => undefined)
  const schema = responseSchema(specPath, method, response.status)
  if (schema !== 'inline') {
    expect(
      validator.validate(schema, body),
      `${method} ${path} ${response.status} matches ${schema}`,
    ).toEqual([])
  }
  if (response.status >= 400)
    expect(response.headers.get('Content-Type')).toContain('application/problem+json')
  return { response, body }
}

let seq = 0
function event(overrides: Record<string, unknown> = {}) {
  seq++
  return {
    eventId: `evt${String(seq).padStart(21, '0')}`,
    name: 'page_view',
    occurredAt: '2026-11-10T12:00:00.000Z',
    sessionId: 'sess0000000000000000000001',
    pageViewId: 'pv000000000000000000000001',
    trackingCategory: 'full',
    consent: { required: false, granted: false },
    props: { url: 'https://www.example.com/pricing', path: '/pricing' },
    ...overrides,
  }
}

function batch(events: unknown[], overrides: Record<string, unknown> = {}) {
  return { v: 1, siteKey: SITE.siteKey, sentAt: '2026-11-10T12:00:01.000Z', events, ...overrides }
}

function consentRecord(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    siteKey: SITE.siteKey,
    consentId: 'consent00000000000000001',
    decision: 'granted',
    policyVersion: '2026-11-01',
    decidedAt: '2026-11-10T12:00:04.000Z',
    source: 'banner',
    ...overrides,
  }
}

describe('spec document', () => {
  it('every operation has an operationId and every response is declared with a schema', () => {
    for (const [path, item] of Object.entries<any>(spec.paths)) {
      for (const [method, operation] of Object.entries<any>(item)) {
        expect(operation.operationId, `${method} ${path}`).toBeTruthy()
        for (const status of Object.keys(operation.responses)) {
          expect(() => responseSchema(path, method, Number(status))).not.toThrow()
        }
      }
    }
  })

  it('request examples in the spec are valid against their schemas', () => {
    const examples: Array<[SchemaName, unknown]> = [
      ['EventBatch', spec.paths['/v1/events'].post.requestBody.content['application/json'].example],
      [
        'ConsentRecordRequest',
        spec.paths['/v1/consent'].post.requestBody.content['application/json'].example,
      ],
      [
        'Context',
        spec.paths['/v1/context'].get.responses['200'].content['application/json'].example,
      ],
    ]
    for (const [schema, example] of examples)
      expect(validator.validate(schema, example), schema).toEqual([])
    const exampleEvents = (examples[0]![1] as any).events
    for (const e of exampleEvents) expect(validator.validate('Event', e)).toEqual([])
  })
})

describe('GET /v1/health', () => {
  it('returns ok', async () => {
    const { app } = host()
    const { response, body } = await call(app, 'get', '/v1/health', { origin: null })
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })
})

describe('GET /v1/context', () => {
  it('returns the policy for a consent-required region with no-store caching', async () => {
    const { app } = host()
    const { response, body } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      headers: { 'cf-ipcountry': 'DE', 'cf-ipcontinent': 'EU' },
    })
    expect(response.status).toBe(200)
    expect(body).toEqual({
      v: 1,
      siteKey: 'example-site',
      policy: {
        consentRequired: true,
        policyVersion: '2026-11-01',
        trackingWithoutConsent: 'limited',
        reason: 'region',
      },
      geo: { country: 'DE', continent: 'EU' },
      ttlSeconds: 3600,
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('does not require consent outside the consent region', async () => {
    const { app } = host()
    const { body } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      headers: { 'cf-ipcountry': 'US' },
    })
    expect(body.policy).toMatchObject({ consentRequired: false, reason: 'region' })
  })

  it('requires consent when the region is unknown (fail closed)', async () => {
    const { app } = host()
    const cases: Array<Record<string, string>> = [
      {},
      { 'cf-ipcountry': 'XX' },
      { 'cf-ipcountry': 'T1' },
      { 'cf-ipcountry': 'not-a-country' },
    ]
    for (const headers of cases) {
      const { body } = await call(app, 'get', '/v1/context?siteKey=example-site', { headers })
      expect(body.policy).toMatchObject({ consentRequired: true, reason: 'unknown-region' })
      expect(body.geo).toBeUndefined()
    }
  })

  it('ignores geo headers that are not configured as trusted (clients could spoof them)', async () => {
    const { app } = host({ trustedGeoHeaders: [] })
    const { body } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      headers: { 'cf-ipcountry': 'US' },
    })
    expect(body.policy).toMatchObject({ consentRequired: true, reason: 'unknown-region' })
  })

  it('applies site-level consent modes regardless of region', async () => {
    const always = host({ sites: [{ ...SITE, consentMode: 'always' }] })
    const never = host({ sites: [{ ...SITE, consentMode: 'never' }] })
    const us = { headers: { 'cf-ipcountry': 'US' } }
    const de = { headers: { 'cf-ipcountry': 'DE' } }
    expect(
      (await call(always.app, 'get', '/v1/context?siteKey=example-site', us)).body.policy,
    ).toMatchObject({
      consentRequired: true,
      reason: 'site',
    })
    expect(
      (await call(never.app, 'get', '/v1/context?siteKey=example-site', de)).body.policy,
    ).toMatchObject({
      consentRequired: false,
      reason: 'site',
    })
  })

  it('accepts same-origin requests without an Origin header', async () => {
    const { app } = host()
    const { response } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      origin: null,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('echoes allowed origins for CORS and never allows credentials', async () => {
    const { app } = host()
    const { response } = await call(app, 'get', '/v1/context?siteKey=example-site')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Vary')).toContain('Origin')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('rejects bad site keys, unknown sites and foreign origins', async () => {
    const { app } = host()
    expect((await call(app, 'get', '/v1/context')).response.status).toBe(400)
    expect((await call(app, 'get', '/v1/context?siteKey=a%20b')).response.status).toBe(400)
    expect((await call(app, 'get', '/v1/context?siteKey=unknown-site')).response.status).toBe(404)
    const foreign = await call(app, 'get', '/v1/context?siteKey=example-site', {
      origin: 'https://evil.example',
    })
    expect(foreign.response.status).toBe(403)
    expect(foreign.response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('POST /v1/events', () => {
  it('accepts text/plain, text/plain;charset=UTF-8 and application/json bodies', async () => {
    const { app } = host()
    for (const contentType of ['text/plain', 'text/plain;charset=UTF-8', 'application/json']) {
      const { response, body } = await call(app, 'post', '/v1/events', {
        body: batch([event()]),
        contentType,
      })
      expect(response.status, contentType).toBe(202)
      expect(body).toEqual({ accepted: 1, duplicates: 0, rejected: [] })
    }
  })

  it('stores events with the server receive time and the origin', async () => {
    const { app, store } = host()
    const e = event({ trackingCategory: 'limited', consent: { required: true, granted: false } })
    await call(app, 'post', '/v1/events', { body: batch([e]) })
    expect(store.listEvents(SITE.siteKey)).toEqual([
      expect.objectContaining({
        eventId: e.eventId,
        name: 'page_view',
        occurredAt: '2026-11-10T12:00:00.000Z',
        sentAt: '2026-11-10T12:00:01.000Z',
        receivedAt: '2026-11-10T12:00:05.000Z',
        trackingCategory: 'limited',
        consentRequired: true,
        consentGranted: false,
        props: e.props,
        origin: ORIGIN,
      }),
    ])
  })

  it('is idempotent: a repeated eventId is a duplicate, not an error', async () => {
    const { app, store } = host()
    const e = event()
    await call(app, 'post', '/v1/events', { body: batch([e]) })
    const { response, body } = await call(app, 'post', '/v1/events', { body: batch([e, event()]) })
    expect(response.status).toBe(202)
    expect(body).toEqual({ accepted: 1, duplicates: 1, rejected: [] })
    expect(store.listEvents()).toHaveLength(2)
  })

  it('accepts the valid events of a batch and reports the invalid ones', async () => {
    const { app, store } = host()
    const good = event()
    const { response, body } = await call(app, 'post', '/v1/events', {
      body: batch([
        good,
        event({ name: 'Not Valid' }),
        { eventId: 'short' },
        event({ props: { s: 'x'.repeat(2049) } }),
      ]),
    })
    expect(response.status).toBe(202)
    expect(body.accepted).toBe(1)
    expect(body.rejected.map((r: any) => r.index)).toEqual([1, 2, 3])
    expect(body.rejected[0].errors[0].path).toBe('/name')
    expect(body.rejected[2].errors[0].path).toBe('/props/s')
    expect(store.listEvents().map(e => e.eventId)).toEqual([good.eventId])
  })

  it('rejects an invalid envelope as a whole', async () => {
    const { app } = host()
    const cases = [
      batch([event()], { v: 2 }),
      batch([]),
      batch(Array.from({ length: 51 }, () => event())),
      batch([event()], { sentAt: 'yesterday' }),
      batch([event()], { extra: true }),
    ]
    for (const body of cases) {
      expect((await call(app, 'post', '/v1/events', { body })).response.status).toBe(400)
    }
  })

  it('rejects malformed JSON (400), unknown sites (404) and other media types (415)', async () => {
    const { app } = host()
    expect((await call(app, 'post', '/v1/events', { raw: '{not json' })).response.status).toBe(400)
    expect(
      (
        await call(app, 'post', '/v1/events', {
          body: batch([event()], { siteKey: 'unknown-site' }),
        })
      ).response.status,
    ).toBe(404)
    expect(
      (
        await call(app, 'post', '/v1/events', {
          body: batch([event()]),
          contentType: 'application/x-www-form-urlencoded',
        })
      ).response.status,
    ).toBe(415)
  })

  it('requires an allowed Origin', async () => {
    const { app, store } = host()
    expect(
      (await call(app, 'post', '/v1/events', { body: batch([event()]), origin: null })).response
        .status,
    ).toBe(403)
    expect(
      (
        await call(app, 'post', '/v1/events', {
          body: batch([event()]),
          origin: 'https://evil.example',
        })
      ).response.status,
    ).toBe(403)
    expect(store.listEvents()).toHaveLength(0)
  })

  it('rejects bodies over 64 KiB with 413', async () => {
    const { app } = host()
    const raw = JSON.stringify(batch([event({ props: { pad: 'x'.repeat(EVENTS_MAX_BYTES) } })]))
    expect((await call(app, 'post', '/v1/events', { raw })).response.status).toBe(413)
  })
})

describe('POST /v1/consent', () => {
  it('stores an append-only record and returns its id', async () => {
    const { app, store } = host()
    const { response, body } = await call(app, 'post', '/v1/consent', { body: consentRecord() })
    await call(app, 'post', '/v1/consent', { body: consentRecord({ decision: 'denied' }) })

    expect(response.status).toBe(201)
    expect(body).toMatchObject({
      consentId: 'consent00000000000000001',
      recordedAt: '2026-11-10T12:00:05.000Z',
    })
    const records = store.listConsents(SITE.siteKey)
    expect(records.map(r => r.decision)).toEqual(['granted', 'denied'])
    expect(records[0]).not.toHaveProperty('ip')
  })

  it('validates the record', async () => {
    const { app } = host()
    for (const body of [
      consentRecord({ decision: 'maybe' }),
      consentRecord({ consentId: 'x' }),
      consentRecord({ policyVersion: '' }),
      consentRecord({ source: 'server' }),
    ]) {
      expect((await call(app, 'post', '/v1/consent', { body })).response.status).toBe(400)
    }
  })

  it('rejects bodies over 4 KiB with 413', async () => {
    const { app } = host()
    const raw = JSON.stringify(consentRecord()).replace(
      '"v":1',
      `"v":1,"pad":"${'x'.repeat(5000)}"`,
    )
    expect((await call(app, 'post', '/v1/consent', { raw })).response.status).toBe(413)
  })
})

describe('CORS preflight', () => {
  it('answers preflights for allowed origins without allowing credentials', async () => {
    const { app } = host()
    const response = await app.request('/v1/events', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('refuses preflights from other origins', async () => {
    const { app } = host()
    const response = await app.request('/v1/events', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })
})

describe('development endpoints', () => {
  it('do not exist unless DEV_MODE is enabled', async () => {
    const { app } = host({ devMode: false })
    for (const path of ['/_dev/events', '/_dev/consents', '/_dev/state']) {
      expect((await app.request(path)).status).toBe(404)
    }
    expect(
      (await app.request('/_dev/geo', { method: 'POST', body: '{"country":"US"}' })).status,
    ).toBe(404)
  })

  it('the geo override changes the policy in DEV_MODE', async () => {
    const { app } = host({ devMode: true })
    await app.request('/_dev/geo', { method: 'POST', body: JSON.stringify({ country: 'us' }) })
    const { body } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      headers: { 'cf-ipcountry': 'DE' },
    })
    expect(body.policy.consentRequired).toBe(false)
    expect(body.geo).toEqual({ country: 'US' })
  })
})

describe('configuration', () => {
  it('provides a working demo site by default', () => {
    const config = loadConfig({ PLAYGROUND_PORT: '5173' })
    expect(config.sites[0]).toMatchObject({
      siteKey: 'demo-site',
      allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    })
    expect(config.devMode).toBe(false)
    expect(config.trustedGeoHeaders).toEqual([])
  })

  it('loads the example sites file shipped with the host (used by docker-compose)', () => {
    const config = loadConfig({
      SITES_FILE: new URL('../sites.example.json', import.meta.url).pathname,
    })
    expect(config.sites[0]).toMatchObject({ siteKey: 'example-site', consentMode: 'geo' })
  })

  it('rejects sites whose allowed origins are not exact origins', () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/sites-${process.pid}.json`
    writeFileSync(
      file,
      JSON.stringify([{ siteKey: 'bad-site', allowedOrigins: ['https://example.com/path'] }]),
    )
    expect(() => loadConfig({ SITES_FILE: file })).toThrow(/exact origin/)
  })

  it('rejects invalid settings', () => {
    expect(() => loadConfig({ DEFAULT_COUNTRY: 'Germany' })).toThrow(/DEFAULT_COUNTRY/)
  })
})

describe('consent categories and tracking without consent', () => {
  it('records partial decisions with their categories', async () => {
    const { app, store } = host()
    const categories = { preferences: false, statistics: true, marketing: false }

    const { response } = await call(app, 'post', '/v1/consent', {
      body: consentRecord({ decision: 'partial', categories }),
    })

    expect(response.status).toBe(201)
    expect(store.listConsents()[0]).toMatchObject({ decision: 'partial', categories })
  })

  it('validates categories', async () => {
    const { app } = host()
    for (const categories of [
      { statistics: true },
      { preferences: 1, statistics: true, marketing: false },
    ]) {
      const { response } = await call(app, 'post', '/v1/consent', {
        body: consentRecord({ decision: 'partial', categories }),
      })
      expect(response.status).toBe(400)
    }
  })

  it('lets specific countries allow no tracking without consent', async () => {
    const { app } = host({ noTrackingWithoutConsentCountries: new Set(['DE']) })
    const policyFor = async (country: string) =>
      (
        await call(app, 'get', '/v1/context?siteKey=example-site', {
          headers: { 'cf-ipcountry': country },
        })
      ).body.policy

    expect(await policyFor('DE')).toMatchObject({
      consentRequired: true,
      trackingWithoutConsent: 'none',
    })
    expect(await policyFor('FR')).toMatchObject({
      consentRequired: true,
      trackingWithoutConsent: 'limited',
    })
  })

  it('or the whole site', async () => {
    const { app } = host({ sites: [{ ...SITE, trackingWithoutConsent: 'none' }] })
    const { body } = await call(app, 'get', '/v1/context?siteKey=example-site', {
      headers: { 'cf-ipcountry': 'FR' },
    })
    expect(body.policy.trackingWithoutConsent).toBe('none')
  })

  it('reads the settings from the environment and sites file', () => {
    expect([
      ...loadConfig({ NO_TRACKING_WITHOUT_CONSENT_COUNTRIES: 'de, at' })
        .noTrackingWithoutConsentCountries!,
    ]).toEqual(['DE', 'AT'])
    const file = `${process.env.TMPDIR ?? '/tmp'}/sites-twc-${process.pid}.json`
    writeFileSync(
      file,
      JSON.stringify([
        {
          siteKey: 'strict-site',
          allowedOrigins: ['https://a.example'],
          trackingWithoutConsent: 'sometimes',
        },
      ]),
    )
    expect(() => loadConfig({ SITES_FILE: file })).toThrow(/trackingWithoutConsent/)
  })
})
