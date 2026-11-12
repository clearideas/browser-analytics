// Both storage implementations must behave the same (the collector relies on it).
import { describe, expect, it } from 'vitest'

import { MemoryStore } from '../src/memory-store.ts'
import { SqliteStore } from '../src/sqlite-store.ts'
import type { EventStore, StoreChange, StoredConsent, StoredEvent } from '../src/store.ts'

const event = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
  siteKey: 'site-a',
  eventId: 'event-00000001',
  name: 'page_view',
  occurredAt: '2026-11-10T12:00:00.000Z',
  sentAt: '2026-11-10T12:00:01.000Z',
  receivedAt: '2026-11-10T12:00:02.000Z',
  sessionId: 'session-0000001',
  pageViewId: null,
  trackingCategory: 'full',
  consentRequired: false,
  consentGranted: false,
  props: { path: '/', nested: { a: [1, 2] } },
  origin: 'https://www.example.com',
  ...overrides,
})

const consent = (overrides: Partial<StoredConsent> = {}): StoredConsent => ({
  recordId: 'record-1',
  siteKey: 'site-a',
  consentId: 'consent-0000001',
  decision: 'granted',
  categories: { preferences: true, statistics: true, marketing: true },
  policyVersion: '1',
  decidedAt: '2026-11-10T12:00:00.000Z',
  recordedAt: '2026-11-10T12:00:01.000Z',
  source: 'banner',
  origin: 'https://www.example.com',
  ...overrides,
})

describe.each([
  ['SqliteStore', () => new SqliteStore(':memory:') as EventStore],
  ['MemoryStore', () => new MemoryStore() as EventStore],
])('%s', (_name, create) => {
  it('round-trips events exactly, in insertion order, filtered by site', () => {
    const store = create()
    const a = event()
    const b = event({ eventId: 'event-00000002', siteKey: 'site-b', pageViewId: 'pv-0000001' })
    store.insertEvent(a)
    store.insertEvent(b)

    expect(store.listEvents()).toEqual([a, b])
    expect(store.listEvents('site-b')).toEqual([b])
    expect(store.listEvents(undefined, 1)).toEqual([a])
  })

  it('insertEvent is idempotent per (siteKey, eventId)', () => {
    const store = create()
    expect(store.insertEvent(event())).toBe(true)
    expect(store.insertEvent(event({ name: 'changed' }))).toBe(false)
    expect(store.insertEvent(event({ siteKey: 'site-b' }))).toBe(true)
    expect(store.listEvents().map(e => [e.siteKey, e.name])).toEqual([
      ['site-a', 'page_view'],
      ['site-b', 'page_view'],
    ])
  })

  it('appends consent records and emits changes', () => {
    const store = create()
    const changes: StoreChange['type'][] = []
    store.changes.on('change', (change: StoreChange) => changes.push(change.type))

    store.insertConsent(consent())
    store.insertConsent(consent({ recordId: 'record-2', decision: 'denied' }))
    store.insertEvent(event())
    store.insertEvent(event()) // duplicate: no change event
    store.reset()

    expect(changes).toEqual(['consent', 'consent', 'event', 'reset'])
    expect(store.listConsents()).toEqual([])
    expect(store.listEvents()).toEqual([])
  })

  it('returns copies, not live references', () => {
    const store = create()
    store.insertEvent(event())
    store.listEvents()[0]!.props.path = '/mutated'
    expect(store.listEvents()[0]!.props.path).toBe('/')
  })
})

describe('SqliteStore migrations', () => {
  it('adds columns introduced later to an existing database', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const path = `${process.env.TMPDIR ?? '/tmp'}/store-migration-${process.pid}-${Date.now()}.db`
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE consent_records (
      record_id TEXT PRIMARY KEY, site_key TEXT NOT NULL, consent_id TEXT NOT NULL,
      decision TEXT NOT NULL, policy_version TEXT NOT NULL, decided_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL, source TEXT NOT NULL, origin TEXT, seq INTEGER NOT NULL)`)
    old.exec(
      `INSERT INTO consent_records VALUES ('r0','site-a','c0','granted','1','t','t','banner',NULL,1)`,
    )
    old.close()

    const store = new SqliteStore(path)
    store.insertConsent(consent({ recordId: 'r1' }))

    expect(store.listConsents().map(c => [c.recordId, c.categories])).toEqual([
      ['r0', null],
      ['r1', { preferences: true, statistics: true, marketing: true }],
    ])
    store.close()
  })
})
