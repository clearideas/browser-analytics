// Storage interface for the collector. Implementations: SqliteStore (default, file or
// :memory:) and MemoryStore (tests). Implement EventStore to use another database.
import type { EventEmitter } from 'node:events'

export interface StoredEvent {
  siteKey: string
  eventId: string
  name: string
  occurredAt: string
  sentAt: string
  receivedAt: string
  sessionId: string
  pageViewId: string | null
  trackingCategory: 'full' | 'limited'
  consentRequired: boolean
  consentGranted: boolean
  props: Record<string, unknown>
  origin: string | null
}

export interface StoredConsent {
  recordId: string
  siteKey: string
  consentId: string
  decision: 'granted' | 'denied' | 'partial'
  categories: { preferences: boolean; statistics: boolean; marketing: boolean } | null
  policyVersion: string
  decidedAt: string
  recordedAt: string
  source: 'banner' | 'api'
  origin: string | null
}

export type StoreChange =
  | { type: 'event'; data: StoredEvent }
  | { type: 'consent'; data: StoredConsent }
  | { type: 'reset' }

/** Storage used by the collector. Emits StoreChange on `changes` ('change' event). */
export interface EventStore {
  readonly changes: EventEmitter
  /** Returns false if (siteKey, eventId) was already stored (idempotent insert). */
  insertEvent(event: StoredEvent): boolean
  insertConsent(record: StoredConsent): void
  listEvents(siteKey?: string, limit?: number): StoredEvent[]
  listConsents(siteKey?: string, limit?: number): StoredConsent[]
  reset(): void
  close(): void
}
