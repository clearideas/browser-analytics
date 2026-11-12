// Reference implementation of spec/openapi.yaml (v1).
import { randomUUID } from 'node:crypto'

import type { Context as HonoContext } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'

import type { ConsentMode, HostConfig, SiteConfig } from './config.ts'
import type { Geo } from './geo.ts'
import { policyFor, resolveGeo } from './geo.ts'
import type { FieldError, SpecValidator } from './spec.ts'
import { createValidator } from './spec.ts'
import type { EventStore, StoreChange } from './store.ts'

export const EVENTS_MAX_BYTES = 65_536
export const CONSENT_MAX_BYTES = 4_096
const SITE_KEY = /^[A-Za-z0-9._-]{3,64}$/
const ACCEPTED_MEDIA_TYPES = new Set(['application/json', 'text/plain'])

export interface AppOptions {
  config: HostConfig
  store: EventStore
  validator?: SpecValidator
  now?: () => Date
}

export function createApp(options: AppOptions) {
  const { config, store } = options
  const validator = options.validator ?? createValidator()
  const now = options.now ?? (() => new Date())
  const sites = new Map(config.sites.map(site => [site.siteKey, { ...site }]))
  let geoOverride: Geo | null = null

  const anySiteAllows = (origin: string | undefined) =>
    !!origin && [...sites.values()].some(site => site.allowedOrigins.includes(origin))

  const problem = (
    c: HonoContext,
    status: 400 | 403 | 404 | 413 | 415 | 429,
    title: string,
    detail?: string,
    errors?: FieldError[],
  ) =>
    c.body(
      JSON.stringify({
        type: 'about:blank',
        title,
        status,
        ...(detail ? { detail } : {}),
        ...(errors?.length ? { errors } : {}),
      }),
      status,
      { 'Content-Type': 'application/problem+json' },
    )

  const app = new Hono()

  // CORS: echo allowed origins on every response (errors included) so browsers can read
  // them. Never allow credentials. Preflights are answered for any site's origins.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (c.req.method === 'OPTIONS') {
      if (!anySiteAllows(origin)) return problem(c, 403, 'Origin not allowed')
      return c.body(null, 204, {
        'Access-Control-Allow-Origin': origin!,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      })
    }
    await next()
    c.res.headers.append('Vary', 'Origin')
    if (anySiteAllows(origin)) c.res.headers.set('Access-Control-Allow-Origin', origin!)
    return undefined
  })

  // Shared POST handling: media type, JSON, site, origin, schema.
  const readPost = async (
    c: HonoContext,
    schema: 'EventBatch' | 'ConsentRecordRequest',
  ): Promise<{ body: any; site: SiteConfig; origin: string } | Response> => {
    const mediaType = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!ACCEPTED_MEDIA_TYPES.has(mediaType)) {
      return problem(c, 415, 'Unsupported media type', 'Send application/json or text/plain.')
    }

    let body: any
    try {
      body = JSON.parse(await c.req.text())
    } catch {
      return problem(c, 400, 'Malformed JSON')
    }

    const siteKey = body?.siteKey
    if (typeof siteKey !== 'string' || !SITE_KEY.test(siteKey)) {
      return problem(c, 400, 'Invalid request', undefined, [
        { path: '/siteKey', message: 'must be a valid site key' },
      ])
    }
    const site = sites.get(siteKey)
    if (!site) return problem(c, 404, 'Unknown site key')

    const origin = c.req.header('Origin')
    if (!origin || !site.allowedOrigins.includes(origin)) {
      return problem(
        c,
        403,
        'Origin not allowed',
        `Origin ${origin ?? '(none)'} is not allowed for this site.`,
      )
    }

    const errors = validator.validate(schema, body)
    if (errors.length) return problem(c, 400, 'Invalid request', undefined, errors)

    return { body, site, origin }
  }

  const tooLarge = (c: HonoContext) => problem(c, 413, 'Payload too large')

  app.get('/v1/health', c => c.json({ status: 'ok' }))

  app.get('/v1/context', c => {
    const siteKey = c.req.query('siteKey')
    if (!siteKey || !SITE_KEY.test(siteKey)) {
      return problem(c, 400, 'Invalid request', undefined, [
        { path: 'siteKey', message: 'query parameter must be a valid site key' },
      ])
    }
    const site = sites.get(siteKey)
    if (!site) return problem(c, 404, 'Unknown site key')

    const origin = c.req.header('Origin')
    if (origin && !site.allowedOrigins.includes(origin)) {
      return problem(c, 403, 'Origin not allowed')
    }

    const geo = resolveGeo(c.req.raw.headers, config, geoOverride)
    const policy = policyFor(site, geo, config)
    c.header('Cache-Control', 'private, no-store')
    return c.json({
      v: 1,
      siteKey,
      policy,
      ...(geo.country ? { geo } : {}),
      ttlSeconds: config.contextTtlSeconds,
    })
  })

  app.post('/v1/events', bodyLimit({ maxSize: EVENTS_MAX_BYTES, onError: tooLarge }), async c => {
    const request = await readPost(c, 'EventBatch')
    if (request instanceof Response) return request
    const { body, site, origin } = request

    const receivedAt = now().toISOString()
    let accepted = 0
    let duplicates = 0
    const rejected: Array<{ index: number; eventId?: string; errors: FieldError[] }> = []

    body.events.forEach((event: any, index: number) => {
      const errors = validator.validate('Event', event)
      if (errors.length) {
        rejected.push({
          index,
          ...(typeof event?.eventId === 'string' ? { eventId: event.eventId.slice(0, 64) } : {}),
          errors,
        })
        return
      }
      const inserted = store.insertEvent({
        siteKey: site.siteKey,
        eventId: event.eventId,
        name: event.name,
        occurredAt: event.occurredAt,
        sentAt: body.sentAt,
        receivedAt,
        sessionId: event.sessionId,
        pageViewId: event.pageViewId ?? null,
        trackingCategory: event.trackingCategory,
        consentRequired: event.consent.required,
        consentGranted: event.consent.granted,
        props: event.props,
        origin,
      })
      if (inserted) accepted++
      else duplicates++
    })

    return c.json({ accepted, duplicates, rejected }, 202)
  })

  app.post('/v1/consent', bodyLimit({ maxSize: CONSENT_MAX_BYTES, onError: tooLarge }), async c => {
    const request = await readPost(c, 'ConsentRecordRequest')
    if (request instanceof Response) return request
    const { body, site, origin } = request

    const record = {
      recordId: randomUUID(),
      siteKey: site.siteKey,
      consentId: body.consentId,
      decision: body.decision,
      categories: body.categories ?? null,
      policyVersion: body.policyVersion,
      decidedAt: body.decidedAt,
      recordedAt: now().toISOString(),
      source: body.source,
      origin,
    }
    store.insertConsent(record)
    return c.json(
      { recordId: record.recordId, consentId: record.consentId, recordedAt: record.recordedAt },
      201,
    )
  })

  if (config.devMode) {
    // Development-only endpoints for the playground and end-to-end tests.
    // Not part of the contract. Never enable DEV_MODE in production.
    app.get('/_dev/events', c =>
      c.json(store.listEvents(c.req.query('siteKey'), Number(c.req.query('limit') ?? 500))),
    )
    app.get('/_dev/consents', c => c.json(store.listConsents(c.req.query('siteKey'))))
    app.get('/_dev/state', c =>
      c.json({
        geoOverride,
        sites: [...sites.values()].map(
          ({ siteKey, policyVersion, consentMode, trackingWithoutConsent }) => ({
            siteKey,
            policyVersion,
            consentMode,
            trackingWithoutConsent,
          }),
        ),
      }),
    )
    app.post('/_dev/geo', async c => {
      const body = (await c.req.json().catch(() => ({}))) as Geo
      geoOverride = body.country
        ? { country: body.country.toUpperCase(), continent: body.continent }
        : null
      return c.json({ geoOverride })
    })
    app.post('/_dev/policy', async c => {
      const body = (await c.req.json().catch(() => ({}))) as {
        siteKey?: string
        policyVersion?: string
        consentMode?: ConsentMode
        trackingWithoutConsent?: 'limited' | 'none'
      }
      const site = sites.get(body.siteKey ?? '')
      if (!site) return problem(c, 404, 'Unknown site key')
      if (body.policyVersion) site.policyVersion = String(body.policyVersion)
      if (body.consentMode && ['geo', 'always', 'never'].includes(body.consentMode)) {
        site.consentMode = body.consentMode
      }
      if (body.trackingWithoutConsent === 'limited' || body.trackingWithoutConsent === 'none') {
        site.trackingWithoutConsent = body.trackingWithoutConsent
      }
      return c.json({
        siteKey: site.siteKey,
        policyVersion: site.policyVersion,
        consentMode: site.consentMode,
      })
    })
    app.post('/_dev/reset', c => {
      store.reset()
      geoOverride = null
      for (const original of config.sites) sites.set(original.siteKey, { ...original })
      return c.json({ ok: true })
    })
    app.get('/_dev/stream', c =>
      streamSSE(c, async stream => {
        const onChange = (change: StoreChange) => {
          void stream.writeSSE({
            event: change.type,
            data: JSON.stringify('data' in change ? change.data : {}),
          })
        }
        store.changes.on('change', onChange)
        stream.onAbort(() => {
          store.changes.off('change', onChange)
        })
        await stream.writeSSE({ event: 'ready', data: '{}' })
        while (!stream.aborted) {
          await stream.sleep(15_000)
          if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' })
        }
      }),
    )
  }

  app.notFound(c => problem(c, 404, 'Not found'))

  return { app, store }
}
