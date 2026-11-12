import { describe, expect, it } from 'vitest'

import { getLocalConsentStatus, setLocalConsentStatus } from './storage'
import { STORAGE_KEYS } from './types'

describe('getLocalConsentStatus', () => {
  it('returns null consent when nothing is stored', () => {
    const status = getLocalConsentStatus()

    expect(status.consented).toBeNull()
    expect(status.version).toBeNull()
  })

  it('returns the parsed stored consent status', () => {
    localStorage.setItem(
      STORAGE_KEYS.CONSENT_STATUS,
      JSON.stringify({ consented: true, version: '1.0.0', timestamp: Date.now() }),
    )

    const status = getLocalConsentStatus()

    expect(status.consented).toBe(true)
    expect(status.version).toBe('1.0.0')
  })
})

describe('setLocalConsentStatus', () => {
  it('stores consent status with a timestamp', () => {
    const before = Date.now()

    setLocalConsentStatus(true, '1.0.0')

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONSENT_STATUS)!)
    expect(stored).toMatchObject({ consented: true, version: '1.0.0' })
    expect(stored.timestamp).toBeGreaterThanOrEqual(before)
  })
})
