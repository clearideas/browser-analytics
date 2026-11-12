// Storage utilities for analytics data
import type { CategoryChoices } from './categories'
import { resolveCookieDomain } from './cookie-domain'
import { generateObjectId } from './core'
import type { AttributionData, ConsentStatus, GeoContext } from './types'
import { debugLog, STORAGE_KEYS } from './types'

// Local storage helpers with error handling
export function getStorageItem<T>(key: string): T | null {
  if (typeof window === 'undefined') return null

  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : null
  } catch {
    return null
  }
}

export function setStorageItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors
  }
}

function removeStorageItem(key: string): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore storage errors
  }
}

// Session storage helpers with error handling
function getSessionStorageItem<T>(key: string): T | null {
  if (typeof window === 'undefined') return null

  try {
    const item = sessionStorage.getItem(key)
    return item ? JSON.parse(item) : null
  } catch {
    return null
  }
}

function setSessionStorageItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors
  }
}

function removeSessionStorageItem(key: string): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.removeItem(key)
  } catch {
    // Ignore storage errors
  }
}

// Consent status management
export function getLocalConsentStatus(): ConsentStatus {
  const stored = getStorageItem<ConsentStatus & { timestamp: number }>(STORAGE_KEYS.CONSENT_STATUS)
  return stored || { consented: null, version: null, timestamp: 0 }
}

export function setLocalConsentStatus(
  consented: boolean | null,
  version: string | null,
  consentId?: string,
  categories?: CategoryChoices,
): void {
  const data: ConsentStatus = {
    consented,
    version,
    timestamp: Date.now(),
    ...(consentId ? { consentId } : {}),
    ...(categories ? { categories } : {}),
  }
  setStorageItem(STORAGE_KEYS.CONSENT_STATUS, data)
}

// Session management
export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'server-session'

  const existing = getSessionStorageItem<string>(STORAGE_KEYS.USER_SESSION)
  if (existing) return existing

  const id = generateObjectId()
  setSessionStorageItem(STORAGE_KEYS.USER_SESSION, id)
  return id
}

export function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') return 'anon-server-session'

  const existing = getSessionStorageItem<string>(STORAGE_KEYS.ANON_SESSION)
  if (existing) return existing

  const id = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  setSessionStorageItem(STORAGE_KEYS.ANON_SESSION, id)
  return id
}

// Owner tracking management
export function isDontTrackOwnerEnabled(): boolean {
  const stored = getStorageItem<string>(STORAGE_KEYS.DONT_TRACK_OWNER)
  return stored === 'true'
}

export function setDontTrackOwner(enabled: boolean): void {
  if (enabled) {
    setStorageItem(STORAGE_KEYS.DONT_TRACK_OWNER, 'true')
  } else {
    removeStorageItem(STORAGE_KEYS.DONT_TRACK_OWNER)
  }
}

// Geo context management
export function getGeoContext(): GeoContext | null {
  return getSessionStorageItem<GeoContext>(STORAGE_KEYS.GEO_CONTEXT)
}

export function setGeoContext(geoData: Omit<GeoContext, 'timestamp'>): void {
  const data: GeoContext = {
    ...geoData,
    timestamp: Date.now(),
  }
  setSessionStorageItem(STORAGE_KEYS.GEO_CONTEXT, data)
}

// Event queue management
export function loadEventQueue(): any[] {
  const stored = getSessionStorageItem<any[]>(STORAGE_KEYS.QUEUE)
  return Array.isArray(stored) ? stored : []
}

export function saveEventQueue(queue: any[]): void {
  if (queue.length > 0) {
    setSessionStorageItem(STORAGE_KEYS.QUEUE, queue)
  } else {
    removeSessionStorageItem(STORAGE_KEYS.QUEUE)
  }
}

// Attribution data management
export function getAttributionData(): AttributionData | null {
  return getStorageItem<AttributionData>(STORAGE_KEYS.ATTRIBUTION_CONTEXT)
}

export function setAttributionData(attributionData: AttributionData): void {
  setStorageItem(STORAGE_KEYS.ATTRIBUTION_CONTEXT, attributionData)
}

// GDPR: Clear attribution data when consent is withdrawn (Art. 7(3), 17(1)(b)). Pass the
// configured cookieDomain so a cross-subdomain attribution cookie is removed too.
export function clearAttributionDataForGDPR(cookieDomain?: string): void {
  debugLog({ debug: false }, 'GDPR: Clearing attribution data due to consent withdrawal')
  removeStorageItem(STORAGE_KEYS.ATTRIBUTION_CONTEXT)

  if (typeof document !== 'undefined') {
    try {
      const clearCookie = (domain?: string | null) => {
        const attributes = [
          `${STORAGE_KEYS.ATTRIBUTION_CONTEXT}=`,
          'Max-Age=0',
          'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          'Path=/',
        ]
        if (domain) {
          attributes.push(`Domain=${domain}`)
        }
        document.cookie = attributes.join('; ')
      }

      clearCookie()

      const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined
      const domain = resolveCookieDomain(hostname, cookieDomain)
      if (domain) {
        clearCookie(domain)
      }
    } catch (error) {
      debugLog({ debug: false }, 'Failed to clear attribution cookie', error)
    }
  }
}

// Clear all analytics storage (e.g. for a GDPR Art. 17 erasure request)
export function clearAnalyticsStorage(): void {
  const keys = Object.values(STORAGE_KEYS)
  keys.forEach(key => {
    removeStorageItem(key)
    removeSessionStorageItem(key)
  })
}
