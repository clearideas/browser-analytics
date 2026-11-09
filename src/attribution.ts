// Attribution tracking utilities
import { resolveCookieDomain } from './cookie-domain'
import { getStorageItem, setStorageItem } from './storage'
import type { AnalyticsConfig, AttributionData } from './types'
import { debugLog, STORAGE_KEYS } from './types'

// Attribution parameter keys to capture
const ATTRIBUTION_PARAMS = [
  // Google Ads
  'gclid',
  'gbraid',
  'wbraid',
  'gtm_debug',
  // Microsoft Ads
  'msclkid',
  'bat_debug',
  // Facebook Ads
  'fbclid',
  // UTM parameters
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_context',
  // Internal campaign parameters
  'ci_source',
  'ci_medium',
  'ci_campaign',
  'ci_term',
  'ci_content',
] as const

/**
 * Extract attribution parameters from current URL
 */
export function extractAttributionFromUrl(url?: string): Partial<AttributionData> {
  const targetUrl = url || (typeof window !== 'undefined' ? window.location.href : '')
  if (!targetUrl) return {}

  try {
    const urlObj = new URL(targetUrl)
    const params = new URLSearchParams(urlObj.search)
    const attribution: Partial<AttributionData> = {}

    ATTRIBUTION_PARAMS.forEach(key => {
      const value = params.get(key)
      if (value) {
        ;(attribution as any)[key] = value
      }
    })

    for (const [key, value] of params.entries()) {
      if (!value) continue
      if (key.startsWith('utm_') || key.startsWith('ci_')) {
        ;(attribution as any)[key] = value
      }
    }

    return attribution
  } catch {
    return {}
  }
}

/**
 * Capture initial attribution data on first visit
 */
export function captureInitialAttribution(config: AnalyticsConfig): AttributionData | null {
  if (typeof window === 'undefined') return null

  try {
    const storedExisting = getStoredAttributionData()
    const existing = getAttributionContext()

    // Extract attribution from URL
    const urlAttribution = extractAttributionFromUrl()

    // If bat_debug is present but msclkid is not, copy bat_debug to msclkid
    if (urlAttribution.bat_debug && !urlAttribution.msclkid) {
      urlAttribution.msclkid = urlAttribution.bat_debug
    }

    // If gtm_debug is present but gclid is not, copy gtm_debug to gclid
    if (urlAttribution.gtm_debug && !urlAttribution.gclid) {
      urlAttribution.gclid = urlAttribution.gtm_debug
    }

    // Only capture if we have meaningful attribution data
    const hasAttributionData = Object.values(urlAttribution).some(
      value => typeof value === 'string' && value.length > 0,
    )

    if (existing) {
      if (hasAttributionData) {
        debugLog(config, 'Attribution data already exists; preserving initial attribution', {
          existing,
          ignoredUrlAttribution: urlAttribution,
        })
      } else {
        debugLog(
          config,
          'No attribution parameters found in URL; using stored attribution',
          existing,
        )
      }
      if (!storedExisting || JSON.stringify(storedExisting) !== JSON.stringify(existing)) {
        storeAttributionData(existing)
      }
      return existing
    }

    if (!hasAttributionData) {
      debugLog(config, 'No attribution parameters found in URL')
      return null
    }

    const now = new Date().toISOString()

    // Create complete attribution data
    const attributionData: AttributionData = {
      ...urlAttribution,
      referrer: document.referrer || undefined,
      landingPath: window.location.pathname,
      landedAt: now,
      firstSeen: now,
      lastSeen: now,
    }

    // Store attribution data
    storeAttributionData(attributionData)

    debugLog(config, 'Captured initial attribution data', attributionData)

    return attributionData
  } catch (error) {
    debugLog(config, 'Error capturing attribution data', error)
    return null
  }
}

/**
 * Update last seen timestamp for existing attribution data
 */
export function updateAttributionLastSeen(): void {
  if (typeof window === 'undefined') return

  try {
    const existing = getStoredAttributionData()
    if (existing) {
      existing.lastSeen = new Date().toISOString()
      storeAttributionData(existing)
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get stored attribution data from localStorage
 */
export function getStoredAttributionData(): AttributionData | null {
  return getStorageItem<AttributionData>(STORAGE_KEYS.ATTRIBUTION_CONTEXT)
}

/**
 * Store attribution data to localStorage
 */
export function storeAttributionData(data: AttributionData): void {
  setStorageItem(STORAGE_KEYS.ATTRIBUTION_CONTEXT, data)
}

/**
 * Clear stored attribution data
 */
export function clearAttributionData(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEYS.ATTRIBUTION_CONTEXT)
  } catch {
    // Ignore errors
  }
}

/**
 * Get attribution data as cookie value (for cross-subdomain access)
 */
export function getAttributionCookieValue(): string | null {
  if (typeof document === 'undefined') return null

  const cookies = document.cookie.split('; ')
  const clickCookie = cookies.find(cookie =>
    cookie.startsWith(`${STORAGE_KEYS.ATTRIBUTION_CONTEXT}=`),
  )

  if (!clickCookie) return null

  const value = clickCookie.split('=')[1]
  return value || null
}

/**
 * Set attribution data as cookie for cross-subdomain access
 */
export function setAttributionCookie(data: AttributionData, domain?: string): void {
  if (typeof document === 'undefined') return

  try {
    const value = encodeURIComponent(JSON.stringify(data))
    const maxAge = 60 * 60 * 24 * 90 // 90 days

    const domainValue = resolveCookieDomain(window.location.hostname, domain)

    const attributes = [
      `${STORAGE_KEYS.ATTRIBUTION_CONTEXT}=${value}`,
      `Max-Age=${maxAge}`,
      'Path=/',
      'SameSite=Lax',
    ]

    if (domainValue) {
      attributes.push(`Domain=${domainValue}`)
    }

    document.cookie = attributes.join('; ')
  } catch (error) {
    debugLog({ debug: true }, 'Error setting attribution cookie', error)
  }
}

/**
 * Clean URL by removing attribution parameters (for prettier URLs)
 */
export function cleanAttributionFromUrl(url?: string): string {
  const targetUrl = url || (typeof window !== 'undefined' ? window.location.href : '')
  if (!targetUrl) return targetUrl

  try {
    const urlObj = new URL(targetUrl)

    // Remove attribution parameters (including wildcard utm_* variants)
    ATTRIBUTION_PARAMS.forEach(param => {
      urlObj.searchParams.delete(param)
    })
    for (const key of Array.from(urlObj.searchParams.keys())) {
      if (key.startsWith('utm_') || key.startsWith('ci_')) {
        urlObj.searchParams.delete(key)
      }
    }

    return urlObj.toString()
  } catch {
    return targetUrl
  }
}

/**
 * Check if current attribution data should trigger Google Ads conversion
 *
 * Considers traffic as Google Ads if it has:
 * - gclid (Google Click ID)
 * - gbraid (Google Ads browser identifier)
 * - wbraid (Google Ads web identifier)
 * - gtm_debug (Google Tag Manager debug parameter)
 * - OR both utm_source="google" AND utm_medium="cpc"
 */
export function isAttributionFromGoogleAds(attribution?: AttributionData | null): boolean {
  if (!attribution) return false

  return Boolean(
    attribution.gclid ||
    attribution.gbraid ||
    attribution.wbraid ||
    attribution.gtm_debug ||
    (attribution.utm_source === 'google' && attribution.utm_medium === 'cpc'),
  )
}

/**
 * Check if current attribution data should trigger Microsoft Ads conversion
 *
 * Considers traffic as Microsoft Ads if it has:
 * - msclkid (Microsoft Click ID)
 * - bat_debug (Microsoft Ads debug parameter)
 */
export function isAttributionFromMicrosoftAds(attribution?: AttributionData | null): boolean {
  if (!attribution) return false

  return Boolean(attribution.msclkid || attribution.bat_debug)
}

/**
 * Get attribution context for current session
 */
export function getAttributionContext(): AttributionData | null {
  // Try cookie first (cross-subdomain), then localStorage
  const cookieValue = getAttributionCookieValue()
  if (cookieValue) {
    try {
      return JSON.parse(decodeURIComponent(cookieValue))
    } catch {
      // Invalid cookie data, fall back to localStorage
    }
  }

  return getStoredAttributionData()
}
