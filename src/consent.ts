// Consent management utilities
import { isAnonymousTrackable, isEssentialEvent } from './core'
import { getGeoContext, getLocalConsentStatus, setLocalConsentStatus } from './storage'
import type { AnalyticsConfig } from './types'
import { debugLog } from './types'

// Track ongoing consent API calls to prevent duplicates
let ongoingConsentCall: Promise<{
  consented: boolean | null
  version: string | null
}> | null = null

// Get consent status from server
export async function getServerConsentStatus(
  config: AnalyticsConfig,
): Promise<{ consented: boolean | null; version: string | null }> {
  const CONSENT_API_URL = `${config.apiBaseUrl.replace(/\/$/, '')}/event/consent`
  const apiUrl = `${CONSENT_API_URL}/status`

  // If there's already an ongoing call, return it to prevent duplicate requests
  if (ongoingConsentCall) {
    debugLog(config, 'Reusing ongoing API call to:', { apiUrl })
    return ongoingConsentCall
  }

  debugLog(config, 'Making new API call to:', { apiUrl })
  ongoingConsentCall = (async () => {
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
      })

      debugLog(config, 'API response status:', { status: response.status })

      if (!response.ok) {
        debugLog(config, 'API call failed with status:', {
          status: response.status,
        })
        throw new Error('Consent API failed')
      }

      const data = await response.json()
      debugLog(config, 'API response data:', data)
      return {
        consented: data.consented,
        version: data.version,
      }
    } catch (error) {
      debugLog(config, 'API call error:', { error })
      return { consented: null, version: null }
    } finally {
      // Clear the ongoing call flag
      ongoingConsentCall = null
    }
  })()

  return ongoingConsentCall
}

// Get consent status with caching
export async function getConsentStatus(
  config: AnalyticsConfig,
): Promise<{ consented: boolean | null; version: string | null }> {
  const localStatus = getLocalConsentStatus()
  const now = Date.now()
  const lastCheck = localStatus.timestamp || 0
  const cacheAge = now - lastCheck

  // Calculate effective cache interval based on consent status
  const nullConsentCacheInterval = Math.min(config.consentCheckInterval / 6, 10 * 60 * 1000)
  const effectiveCacheInterval =
    localStatus.consented === null ? nullConsentCacheInterval : config.consentCheckInterval
  const gracePeriod = Math.min(effectiveCacheInterval / 4, 2 * 60 * 1000)

  debugLog(config, '🔍 [Consent] Checking consent status', {
    localStatus,
    cacheAge,
    checkInterval: config.consentCheckInterval,
    effectiveCacheInterval,
    gracePeriod,
    willUseCache:
      cacheAge < effectiveCacheInterval || cacheAge < effectiveCacheInterval + gracePeriod,
  })

  // Cache consent status regardless of whether it's null, true, or false
  // For null consent (undecided users), use a shorter cache interval to avoid spam
  // (effectiveCacheInterval and gracePeriod already calculated above)

  // If we have cached data and it's not time to recheck yet, use the cached value
  if (cacheAge < effectiveCacheInterval) {
    debugLog(config, '✅ [Consent] Using cached consent status', {
      localStatus,
      effectiveCacheInterval,
      cacheAge,
    })
    return {
      consented: localStatus.consented,
      version: localStatus.version,
    }
  }

  // If cache is expired but we have a cached value, still use it for a grace period
  // This prevents excessive network calls during scroll events
  // (gracePeriod already calculated above)
  if (cacheAge < effectiveCacheInterval + gracePeriod) {
    debugLog(config, '✅ [Consent] Using cached consent status (grace period)', {
      localStatus,
      cacheAge,
      effectiveCacheInterval,
      gracePeriod,
    })
    return {
      consented: localStatus.consented,
      version: localStatus.version,
    }
  }

  debugLog(config, '🔄 [Consent] Fetching fresh consent status from server', {
    reason:
      cacheAge >= effectiveCacheInterval + gracePeriod
        ? 'cache expired'
        : cacheAge === 0
          ? 'no cached data (first visit)'
          : 'cache expired',
    cacheAge,
    effectiveCacheInterval,
    gracePeriod,
  })

  // Otherwise, check with the server
  const serverStatus = await getServerConsentStatus(config)
  debugLog(config, '📡 [Consent] Server consent response', { serverStatus })

  // Always update local storage with the server response
  setLocalConsentStatus(serverStatus.consented, serverStatus.version)

  return serverStatus
}

// Set consent via server
export async function setConsent(config: AnalyticsConfig, value: boolean): Promise<void> {
  const CONSENT_API_URL = `${config.apiBaseUrl.replace(/\/$/, '')}/event/consent`

  try {
    const response = await fetch(`${CONSENT_API_URL}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: config.eventSiteName,
        consented: value,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        hostname: typeof window !== 'undefined' ? window.location.hostname : '',
      }),
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to set consent')
    }

    const data = await response.json()
    setLocalConsentStatus(value, data.version || null)

    // Set a client-side cookie to remember we've shown the banner
    if (typeof document !== 'undefined') {
      document.cookie = `ci_consent_shown=true; max-age=31536000; path=/; domain=${
        typeof window !== 'undefined' ? window.location.hostname : ''
      }`
    }
  } catch (error) {
    console.warn('Failed to set consent:', error)
  }
}

// Check if consent is required based on user's geo location
export function isConsentRequired(config?: AnalyticsConfig): boolean {
  if (typeof window === 'undefined') {
    debugLog(config || { debug: false }, 'Server-side: defaulting to require consent')
    return true
  }

  try {
    const geoData = getGeoContext()
    debugLog(config || { debug: false }, 'Geo context check', { geoData })

    if (geoData) {
      const age = Date.now() - (geoData.timestamp || 0)
      // Use cached geo data if less than 24 hours old
      if (age < 24 * 60 * 60 * 1000) {
        const requiresConsent = geoData.requiresConsent === true
        debugLog(config || { debug: false }, 'Consent requirement determined by geo', {
          requiresConsent,
          geoAge: age,
        })
        return requiresConsent
      } else {
        debugLog(config || { debug: false }, 'Geo data too old, defaulting to require consent', {
          age,
        })
      }
    } else {
      debugLog(config || { debug: false }, 'No geo data available, defaulting to require consent')
    }
  } catch (error) {
    debugLog(config || { debug: false }, 'Error checking geo context', {
      error,
    })
  }

  return true // Default to requiring consent if unknown
}

// Get consent status as boolean
export async function getConsent(config: AnalyticsConfig): Promise<boolean | null> {
  const status = await getConsentStatus(config)
  return status.consented
}

// Determine tracking behavior based on consent and geo requirements
export function getTrackingCategory(
  hasExplicitConsent: boolean,
  consentRequired: boolean,
): 'full' | 'limited' | 'none' {
  // 1. Explicit consent = full tracking
  if (hasExplicitConsent) return 'full'

  // 2. No consent but consent not required (e.g., US users) = full tracking
  if (!consentRequired) return 'full'

  // 3. No consent and consent required (e.g., EU users) = limited tracking
  return 'limited'
}

// Check if event should be tracked
export function shouldTrackEvent(
  eventName: string,
  trackingCategory: 'full' | 'limited' | 'none',
  config?: AnalyticsConfig,
): boolean {
  debugLog(config || { debug: false }, 'Checking if event should be tracked', {
    eventName,
    trackingCategory,
  })

  if (trackingCategory === 'none') {
    debugLog(config || { debug: false }, "Event blocked: tracking category is 'none'", {
      eventName,
    })
    return false
  }

  if (trackingCategory === 'full') {
    debugLog(config || { debug: false }, 'Event allowed: full tracking', {
      eventName,
    })
    return true
  }

  // Limited tracking: only essential or anonymous events
  const isEssential = isEssentialEvent(eventName)
  const isAnonymous = isAnonymousTrackable(eventName)
  const shouldTrack = isEssential || isAnonymous

  debugLog(config || { debug: false }, 'Limited tracking decision', {
    eventName,
    isEssential,
    isAnonymous,
    shouldTrack,
  })

  return shouldTrack
}
