// Attribution tracking utilities
import { resolveCookieDomain } from './cookie-domain'
import { sanitizeUrl } from './core'
import { getStorageItem, setStorageItem } from './storage'
import type { AnalyticsConfig, AttributionData } from './types'
import { debugLog, STORAGE_KEYS } from './types'

// Attribution parameter keys to capture. Only these keys are ever read from URLs,
// storage or cookies; anything else is ignored.
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

/** Longest accepted attribution parameter value; longer values are dropped, not truncated. */
export const MAX_ATTRIBUTION_VALUE_LENGTH = 256
const MAX_LANDING_PATH_LENGTH = 512
const TIMESTAMP_FIELDS = ['landedAt', 'firstSeen', 'lastSeen'] as const
const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function cleanAttributionValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(CONTROL_CHARS, '').trim()
  if (!cleaned || cleaned.length > MAX_ATTRIBUTION_VALUE_LENGTH) return undefined
  return cleaned
}

function cleanLandingPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = (value.split(/[?#]/, 1)[0] ?? '').replace(CONTROL_CHARS, '')
  if (!path.startsWith('/') || path.length > MAX_LANDING_PATH_LENGTH) return undefined
  return path
}

function cleanTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) {
    return undefined
  }
  return value
}

function cleanReferrer(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return sanitizeUrl(value, { allowQueryParams: [] }) || undefined
}

/**
 * Rebuild attribution data from untrusted input (URL, localStorage, cookie) using only
 * known keys with bounded string values. Returns null if nothing usable remains.
 */
export function normalizeAttribution(input: unknown): AttributionData | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const source = input as Record<string, unknown>
  const own = (key: string) =>
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined
  const result: AttributionData = {}

  for (const key of ATTRIBUTION_PARAMS) {
    const value = cleanAttributionValue(own(key))
    if (value) result[key] = value
  }

  const referrer = cleanReferrer(own('referrer'))
  if (referrer) result.referrer = referrer
  const landingPath = cleanLandingPath(own('landingPath'))
  if (landingPath) result.landingPath = landingPath
  for (const key of TIMESTAMP_FIELDS) {
    const value = cleanTimestamp(own(key))
    if (value) result[key] = value
  }

  return Object.keys(result).length > 0 ? result : null
}

function sameAttribution(a: AttributionData | null, b: AttributionData | null): boolean {
  if (!a || !b) return a === b
  const entries = (x: AttributionData) => JSON.stringify(Object.entries(x).sort())
  return entries(a) === entries(b)
}

/**
 * Extract known attribution parameters from a URL (defaults to the current URL).
 */
export function extractAttributionFromUrl(url?: string): Partial<AttributionData> {
  const targetUrl = url || (typeof window !== 'undefined' ? window.location.href : '')
  if (!targetUrl) return {}

  try {
    const params = new URL(targetUrl).searchParams
    const attribution: Partial<AttributionData> = {}

    for (const key of ATTRIBUTION_PARAMS) {
      const value = cleanAttributionValue(params.get(key))
      if (value) attribution[key] = value
    }

    return attribution
  } catch {
    return {}
  }
}

/**
 * Read attribution for the current page view from the URL and referrer WITHOUT storing
 * it. Safe to call before consent; the result can be held in memory and persisted with
 * captureInitialAttribution() once storage is allowed.
 */
export function readLandingAttribution(): AttributionData | null {
  if (typeof window === 'undefined') return null

  const urlAttribution = extractAttributionFromUrl()

  // Debug parameters stand in for click IDs when the real ones are absent.
  if (urlAttribution.bat_debug && !urlAttribution.msclkid) {
    urlAttribution.msclkid = urlAttribution.bat_debug
  }
  if (urlAttribution.gtm_debug && !urlAttribution.gclid) {
    urlAttribution.gclid = urlAttribution.gtm_debug
  }

  if (Object.keys(urlAttribution).length === 0) return null

  return {
    ...urlAttribution,
    referrer: cleanReferrer(typeof document !== 'undefined' ? document.referrer : ''),
    landingPath: cleanLandingPath(window.location.pathname),
    landedAt: new Date().toISOString(),
  }
}

/**
 * Persist first-touch attribution. Existing stored attribution is preserved; otherwise
 * `landing` (by default, the current URL) is stored. Call only when storage is allowed.
 */
export function captureInitialAttribution(
  config: AnalyticsConfig,
  landing: AttributionData | null = readLandingAttribution(),
): AttributionData | null {
  if (typeof window === 'undefined') return null

  try {
    const storedExisting = getStoredAttributionData()
    const existing = getAttributionContext(config)

    if (existing) {
      debugLog(
        config,
        landing
          ? 'Attribution data already exists; preserving initial attribution'
          : 'No attribution parameters found in URL; using stored attribution',
        existing,
      )
      if (!sameAttribution(storedExisting, existing)) {
        storeAttributionData(existing)
      }
      return existing
    }

    if (!landing) {
      debugLog(config, 'No attribution parameters found in URL')
      return null
    }

    const now = new Date().toISOString()
    const attributionData = normalizeAttribution({
      ...landing,
      landedAt: landing.landedAt ?? now,
      firstSeen: landing.landedAt ?? now,
      lastSeen: now,
    })
    if (!attributionData) return null

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
 * Get stored attribution data from localStorage (validated).
 */
export function getStoredAttributionData(): AttributionData | null {
  return normalizeAttribution(getStorageItem<unknown>(STORAGE_KEYS.ATTRIBUTION_CONTEXT))
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
 * Get the raw attribution cookie value, if present.
 */
export function getAttributionCookieValue(): string | null {
  if (typeof document === 'undefined') return null

  const prefix = `${STORAGE_KEYS.ATTRIBUTION_CONTEXT}=`
  const cookie = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))

  return cookie ? cookie.slice(prefix.length) || null : null
}

/**
 * Share attribution across subdomains via a cookie on `cookieDomain` (e.g. `example.com`).
 * Writes nothing unless the current host is that domain or one of its subdomains.
 */
export function setAttributionCookie(data: AttributionData, cookieDomain?: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  try {
    const domain = resolveCookieDomain(window.location.hostname, cookieDomain)
    const normalized = normalizeAttribution(data)
    if (!domain || !normalized) return

    const attributes = [
      `${STORAGE_KEYS.ATTRIBUTION_CONTEXT}=${encodeURIComponent(JSON.stringify(normalized))}`,
      `Max-Age=${ATTRIBUTION_COOKIE_MAX_AGE_SECONDS}`,
      'Path=/',
      `Domain=${domain}`,
      'SameSite=Lax',
    ]
    if (window.location.protocol === 'https:') attributes.push('Secure')

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
 * Get validated attribution context for the current visitor.
 *
 * The cross-subdomain cookie is only read when `cookieDomain` is configured and matches
 * the current host; otherwise a `ci_click` cookie (e.g. planted by a sibling subdomain)
 * is ignored. Falls back to localStorage.
 */
export function getAttributionContext(
  config?: Pick<AnalyticsConfig, 'cookieDomain'>,
): AttributionData | null {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : null
  if (resolveCookieDomain(hostname, config?.cookieDomain)) {
    const cookieValue = getAttributionCookieValue()
    if (cookieValue) {
      try {
        const fromCookie = normalizeAttribution(JSON.parse(decodeURIComponent(cookieValue)))
        if (fromCookie) return fromCookie
      } catch {
        // Invalid cookie data, fall back to localStorage
      }
    }
  }

  return getStoredAttributionData()
}
