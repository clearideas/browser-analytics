// SQLite storage (node:sqlite, no native dependencies).
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { EventStore, StoreChange, StoredConsent, StoredEvent } from './store.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    site_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    session_id TEXT NOT NULL,
    page_view_id TEXT,
    tracking_category TEXT NOT NULL,
    consent_required INTEGER NOT NULL,
    consent_granted INTEGER NOT NULL,
    props TEXT NOT NULL,
    origin TEXT,
    seq INTEGER NOT NULL,
    PRIMARY KEY (site_key, event_id)
  );
  CREATE INDEX IF NOT EXISTS events_by_seq ON events (site_key, seq);
  CREATE TABLE IF NOT EXISTS consent_records (
    record_id TEXT PRIMARY KEY,
    site_key TEXT NOT NULL,
    consent_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL,
    origin TEXT,
    seq INTEGER NOT NULL
  );
`

// Columns added after the first release, for databases created earlier.
const MIGRATIONS = [{ table: 'consent_records', column: 'categories', type: 'TEXT' }]

export class SqliteStore implements EventStore {
  readonly changes = new EventEmitter()
  private db: DatabaseSync
  private seq = 0

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
    for (const { table, column, type } of MIGRATIONS) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string
      }>
      if (!columns.some(c => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      }
    }
    const row = this.db
      .prepare(
        'SELECT MAX(s) AS s FROM (SELECT MAX(seq) AS s FROM events UNION ALL SELECT MAX(seq) FROM consent_records)',
      )
      .get() as { s: number | null }
    this.seq = row.s ?? 0
  }

  /** Returns false if (siteKey, eventId) was already stored. */
  insertEvent(event: StoredEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (site_key, event_id, name, occurred_at, sent_at, received_at,
          session_id, page_view_id, tracking_category, consent_required, consent_granted, props, origin, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.siteKey,
        event.eventId,
        event.name,
        event.occurredAt,
        event.sentAt,
        event.receivedAt,
        event.sessionId,
        event.pageViewId,
        event.trackingCategory,
        event.consentRequired ? 1 : 0,
        event.consentGranted ? 1 : 0,
        JSON.stringify(event.props),
        event.origin,
        ++this.seq,
      )
    const inserted = Number(result.changes) > 0
    if (inserted) this.changes.emit('change', { type: 'event', data: event } satisfies StoreChange)
    return inserted
  }

  insertConsent(record: StoredConsent): void {
    this.db
      .prepare(
        `INSERT INTO consent_records (record_id, site_key, consent_id, decision, categories,
          policy_version, decided_at, recorded_at, source, origin, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.recordId,
        record.siteKey,
        record.consentId,
        record.decision,
        record.categories ? JSON.stringify(record.categories) : null,
        record.policyVersion,
        record.decidedAt,
        record.recordedAt,
        record.source,
        record.origin,
        ++this.seq,
      )
    this.changes.emit('change', { type: 'consent', data: record } satisfies StoreChange)
  }

  listEvents(siteKey?: string, limit = 500): StoredEvent[] {
    const rows = (
      siteKey
        ? this.db
            .prepare('SELECT * FROM events WHERE site_key = ? ORDER BY seq LIMIT ?')
            .all(siteKey, limit)
        : this.db.prepare('SELECT * FROM events ORDER BY seq LIMIT ?').all(limit)
    ) as any[]
    return rows.map(row => ({
      siteKey: row.site_key,
      eventId: row.event_id,
      name: row.name,
      occurredAt: row.occurred_at,
      sentAt: row.sent_at,
      receivedAt: row.received_at,
      sessionId: row.session_id,
      pageViewId: row.page_view_id,
      trackingCategory: row.tracking_category,
      consentRequired: row.consent_required === 1,
      consentGranted: row.consent_granted === 1,
      props: JSON.parse(row.props),
      origin: row.origin,
    }))
  }

  listConsents(siteKey?: string, limit = 500): StoredConsent[] {
    const rows = (
      siteKey
        ? this.db
            .prepare('SELECT * FROM consent_records WHERE site_key = ? ORDER BY seq LIMIT ?')
            .all(siteKey, limit)
        : this.db.prepare('SELECT * FROM consent_records ORDER BY seq LIMIT ?').all(limit)
    ) as any[]
    return rows.map(row => ({
      recordId: row.record_id,
      siteKey: row.site_key,
      consentId: row.consent_id,
      decision: row.decision,
      categories: row.categories ? JSON.parse(row.categories) : null,
      policyVersion: row.policy_version,
      decidedAt: row.decided_at,
      recordedAt: row.recorded_at,
      source: row.source,
      origin: row.origin,
    }))
  }

  reset(): void {
    this.db.exec('DELETE FROM events; DELETE FROM consent_records;')
    this.changes.emit('change', { type: 'reset' } satisfies StoreChange)
  }

  close(): void {
    this.db.close()
  }
}
