// In-memory storage (tests, throwaway demos). Same behavior as SqliteStore.
import { EventEmitter } from 'node:events'

import type { EventStore, StoreChange, StoredConsent, StoredEvent } from './store.ts'

export class MemoryStore implements EventStore {
  readonly changes = new EventEmitter()
  private events: StoredEvent[] = []
  private consents: StoredConsent[] = []
  private eventKeys = new Set<string>()

  insertEvent(event: StoredEvent): boolean {
    const key = `${event.siteKey}\u0000${event.eventId}`
    if (this.eventKeys.has(key)) return false
    this.eventKeys.add(key)
    this.events.push(structuredClone(event))
    this.changes.emit('change', { type: 'event', data: event } satisfies StoreChange)
    return true
  }

  insertConsent(record: StoredConsent): void {
    this.consents.push(structuredClone(record))
    this.changes.emit('change', { type: 'consent', data: record } satisfies StoreChange)
  }

  listEvents(siteKey?: string, limit = 500): StoredEvent[] {
    return this.events
      .filter(e => !siteKey || e.siteKey === siteKey)
      .slice(0, limit)
      .map(e => structuredClone(e))
  }

  listConsents(siteKey?: string, limit = 500): StoredConsent[] {
    return this.consents
      .filter(c => !siteKey || c.siteKey === siteKey)
      .slice(0, limit)
      .map(c => structuredClone(c))
  }

  reset(): void {
    this.events = []
    this.consents = []
    this.eventKeys.clear()
    this.changes.emit('change', { type: 'reset' } satisfies StoreChange)
  }

  close(): void {}
}
