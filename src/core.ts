// Core analytics utilities shared between frameworks
import type { AnalyticsConfig, GeoContext } from './types'
import { STORAGE_KEYS } from './types'

// Generate unique ObjectId-style identifier
export function generateObjectId(): string {
  // Ensure timestamp is always 8 hex characters (4 bytes)
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0')

  // Generate 16 random hex characters (8 bytes)
  let rand: string
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    rand = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } else {
    // Fallback to Math.random for older browsers/environments
    rand = Array.from({ length: 16 })
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join('')
  }

  // Total: 8 + 16 = 24 characters (valid ObjectId format)
  return ts + rand
}

// Default configuration values (shared between frameworks)
export const DEFAULT_CONFIG = {
  apiBaseUrl: '/api/',
  eventSiteName: 'app',
  chatWidgetUrl: 'https://updates.clearideas.com/chat.js',
  chatWidgetCssUrl: 'https://updates.clearideas.com/chat.css',
  chatEnabled: true,
  flushInterval: 60000, // 1 minute
  consentCheckInterval: 24 * 60 * 60 * 1000, // 24 hours
  sessionCheckInterval: 30 * 60 * 1000, // 30 minutes
  batchSize: 10,
  maxRetries: 2,
  autoTrackScrollDepth: true,
  autoTrackTimeSpent: true,
  autoTrackOutboundLinks: true,
} as const

/** The settings an integration must provide; everything else has a default. */
export type AnalyticsOptions = Partial<AnalyticsConfig> & { apiBaseUrl: string; siteKey: string }

/** Complete a partial configuration with the library defaults. */
export function withDefaults(options: AnalyticsOptions): AnalyticsConfig {
  return {
    flushInterval: DEFAULT_CONFIG.flushInterval,
    batchSize: DEFAULT_CONFIG.batchSize,
    maxRetries: DEFAULT_CONFIG.maxRetries,
    autoTrackScrollDepth: DEFAULT_CONFIG.autoTrackScrollDepth,
    autoTrackTimeSpent: DEFAULT_CONFIG.autoTrackTimeSpent,
    autoTrackOutboundLinks: DEFAULT_CONFIG.autoTrackOutboundLinks,
    ...options,
  }
}

// Query parameters that may remain in page URLs sent to analytics. Everything else
// (reset/magic-link tokens, emails, session IDs, click IDs, search terms) is removed,
// and fragments are always removed. Sites can allow more via `urlQueryAllowlist`.
export const DEFAULT_URL_QUERY_ALLOWLIST: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ci_source',
  'ci_medium',
  'ci_campaign',
  'ci_term',
  'ci_content',
]

/**
 * Reduce a URL to what analytics may see: origin + path + allowed query parameters.
 * Fragments and embedded credentials are always removed. Relative or unparseable
 * input never returns anything after `?` or `#`; non-http(s) URLs return ''.
 */
export function sanitizeUrl(
  url: string,
  options: { allowQueryParams?: readonly string[] } = {},
): string {
  if (typeof url !== 'string' || !url) return ''
  const allow = options.allowQueryParams ?? DEFAULT_URL_QUERY_ALLOWLIST

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url.split(/[?#]/, 1)[0] ?? ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''

  const kept = new URLSearchParams()
  for (const [key, value] of parsed.searchParams) {
    if (allow.includes(key)) kept.append(key, value)
  }
  const query = kept.toString()
  return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}`
}

/**
 * Apply the URL policy to the well-known URL fields of an event's properties, in place:
 * `url` keeps allowed query parameters; `referrer` is reduced to origin + path.
 */
export function sanitizeEventUrls<T extends Record<string, any>>(
  props: T,
  extraAllowedQueryParams: readonly string[] = [],
): T {
  const record = props as Record<string, any>
  if (typeof record.url === 'string') {
    record.url = sanitizeUrl(record.url, {
      allowQueryParams: [...DEFAULT_URL_QUERY_ALLOWLIST, ...extraAllowedQueryParams],
    })
  }
  if (typeof record.referrer === 'string') {
    record.referrer = sanitizeUrl(record.referrer, { allowQueryParams: [] })
  }
  return props
}

/**
 * Event names must match ^[a-z][a-z0-9_]{0,63}$ (spec/openapi.yaml). Other names are
 * normalized, e.g. "Sign Up" -> "sign_up", "404 seen" -> "event_404_seen".
 */
export function normalizeEventName(name: string): string {
  let normalized = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return 'event'
  if (!/^[a-z]/.test(normalized)) normalized = `event_${normalized}`
  return normalized.slice(0, 64)
}

// Property limits from spec/openapi.yaml (Event.props / PropValue)
const MAX_PROP_STRING = 2048
const MAX_TOP_LEVEL_PROPS = 100
const MAX_NESTED_PROPS = 50
const MAX_ARRAY_ITEMS = 50
const MAX_PROP_DEPTH = 6

function fitPropValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.slice(0, MAX_PROP_STRING)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (depth >= MAX_PROP_DEPTH) return undefined
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => fitPropValue(item, depth + 1) ?? null)
  }
  if (typeof value === 'object') return fitPropObject(value as object, MAX_NESTED_PROPS, depth + 1)
  return undefined // functions, symbols, bigint, undefined
}

function fitPropObject(value: object, maxKeys: number, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let count = 0
  for (const [key, item] of Object.entries(value)) {
    if (count >= maxKeys) break
    const fitted = fitPropValue(item, depth)
    if (fitted !== undefined) {
      result[key] = fitted
      count++
    }
  }
  return result
}

/**
 * Make event props satisfy the contract's limits: at most 100 top-level and 50 nested
 * keys, 50 array items, strings up to 2048 characters, JSON-compatible values only.
 */
export function fitPropsToContract(props: Record<string, any>): Record<string, any> {
  return fitPropObject(props ?? {}, MAX_TOP_LEVEL_PROPS, 0)
}

// Extract UTM parameters from URL
export function extractUtmParameters(url?: string): Record<string, string> {
  const targetUrl = url || (typeof window !== 'undefined' ? window.location.href : '')
  if (!targetUrl) return {}

  try {
    const urlParams = new URLSearchParams(new URL(targetUrl).search)
    const utmParams: Record<string, string> = {}

    const explicitKeys = ['gclid', 'msclkid', 'fbclid']
    explicitKeys.forEach(key => {
      const value = urlParams.get(key)
      if (value) utmParams[key] = value
    })
    for (const [key, value] of urlParams.entries()) {
      if (!value) continue
      if (key.startsWith('utm_') || key.startsWith('ci_')) {
        utmParams[key] = value
      }
    }

    return utmParams
  } catch {
    return {}
  }
}

// Determine if event should trigger Google Ads conversion
export function isGoogleAdsAttribution(eventProps: Record<string, any> = {}): boolean {
  try {
    // Prefer explicit props passed to trackEvent; fallback to current URL
    const utm: Record<string, any> = {
      utm_source: eventProps.utm_source,
      utm_medium: eventProps.utm_medium,
      utm_campaign: eventProps.utm_campaign,
      utm_term: eventProps.utm_term,
      utm_content: eventProps.utm_content,
      ci_source: eventProps.ci_source,
      ci_medium: eventProps.ci_medium,
      ci_campaign: eventProps.ci_campaign,
      ci_term: eventProps.ci_term,
      ci_content: eventProps.ci_content,
      gclid: eventProps.gclid,
    }

    // Fill any missing with URL extraction
    const urlUtm = extractUtmParameters()
    for (const k of Object.keys(urlUtm)) {
      if (!utm[k]) utm[k] = (urlUtm as any)[k]
    }

    const source = String(utm.utm_source || utm.ci_source || '').toLowerCase()
    const medium = String(utm.utm_medium || utm.ci_medium || '').toLowerCase()
    const hasGclid = typeof utm.gclid === 'string' && utm.gclid.length > 0

    const googleSources = new Set(['google', 'googleads', 'google-ads', 'adwords'])
    const paidMediums = new Set(['cpc', 'ppc', 'paid', 'paid_search', 'sem'])

    if (hasGclid) return true
    if (googleSources.has(source) && paidMediums.has(medium)) return true
    return false
  } catch {
    return false
  }
}

// Get safe location context (non-PII)
export function getSafeLocationContext(): Record<string, any> {
  const context: Record<string, any> = {}

  // Always safe: timezone (functional necessity)
  try {
    if (typeof Intl !== 'undefined') {
      context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  } catch {
    // Ignore timezone errors
  }

  // Always safe: language preference
  if (typeof navigator !== 'undefined' && navigator.language) {
    context.language = navigator.language
  }

  // Safe: broad geographic context (non-PII)
  if (typeof window !== 'undefined') {
    try {
      // Written by setGeoContext (storage.ts) to sessionStorage.
      const stored = sessionStorage.getItem(STORAGE_KEYS.GEO_CONTEXT)
      if (stored) {
        const geoData: GeoContext = JSON.parse(stored)
        const age = Date.now() - (geoData.timestamp || 0)
        // Use cached geo data if less than 24 hours old
        if (age < 24 * 60 * 60 * 1000) {
          context.country = geoData.country
          context.continent = geoData.continent
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  return context
}

// Sanitize URL for anonymous tracking
export function sanitizeUrlForAnonymous(url: string): string {
  return sanitizeUrl(url, { allowQueryParams: [] })
}

export function getViewportBucket(width: number): string {
  if (width < 640) return 'xs'
  if (width < 768) return 'sm'
  if (width < 1024) return 'md'
  if (width < 1280) return 'lg'
  return 'xl'
}

export function getDeviceBucket(userAgent = '', width?: number): string {
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet'
  if (/Mobile|Android|iPhone/i.test(userAgent)) return 'mobile'
  if (typeof width === 'number' && width < 768) return 'mobile'
  if (typeof width === 'number' && width < 1024) return 'tablet'
  return 'desktop'
}

export function sanitizeAnalyticsText(
  value: string | null | undefined,
  maxLength = 120,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

export function normalizeOutboundLink(
  href: string,
  currentOrigin: string,
): {
  outboundUrl: string
  outboundHost: string
  outboundPath: string
} | null {
  try {
    const url = new URL(href, currentOrigin)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.origin === currentOrigin) return null

    return {
      outboundUrl: `${url.origin}${url.pathname}`,
      outboundHost: url.hostname.replace(/^www\./i, ''),
      outboundPath: url.pathname || '/',
    }
  } catch {
    return null
  }
}

export function getConnectionType(): string | undefined {
  if (typeof navigator === 'undefined' || !('connection' in navigator)) {
    return undefined
  }

  const connection = (navigator as any).connection
  if (!connection) return undefined
  return connection.effectiveType || connection.type || undefined
}

// Check if tracking is essential (doesn't require consent)
export function isEssentialEvent(eventName: string): boolean {
  const essentialEvents = ['error', 'page_view']
  return essentialEvents.includes(eventName)
}

// Check if event can be tracked anonymously
export function isAnonymousTrackable(eventName: string): boolean {
  const anonymousEvents = ['page_view', 'auto_metrics', 'page_exit', 'web_vital']
  return anonymousEvents.includes(eventName)
}

// Get allowed anonymous fields
export function getAllowedAnonymousFields(): string[] {
  return [
    'path',
    'url',
    'title',
    'pageTitle',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'ci_source',
    'ci_medium',
    'ci_campaign',
    'ci_term',
    'ci_content',
    'gclid',
    'msclkid',
    'fbclid',
    'timeSpent',
    'timeSpentTotal',
    'scrollDepth',
    'pageLoadTime',
    'maxScrollDepth',
    'clicks',
    'keypresses',
    'outboundUrl',
    'outboundHost',
    'outboundPath',
    'viewportBucket',
    'deviceBucket',
    'connectionType',
    'outboundLink',
    'message', // Error message (truncated in createAnonymousEventData)
    'name', // Web vital metric name
    'value', // Web vital metric value
    'timezone',
    'language',
    'country',
    'continent',
  ]
}

const ANONYMOUS_MESSAGE_MAX_LENGTH = 500

// Create anonymous event data
export function createAnonymousEventData(eventData: Record<string, any>): Record<string, any> {
  const cleanData = { ...eventData }

  // Remove any PII or identifiable information
  delete cleanData.email
  delete cleanData.name
  delete cleanData.userId
  delete cleanData.user_id

  const allowedFields = getAllowedAnonymousFields()
  const anonymousData: Record<string, any> = {}

  allowedFields.forEach(field => {
    if (cleanData[field] !== undefined) {
      anonymousData[field] = cleanData[field]
    }
  })

  // Add safe location context for anonymous users
  const safeLocationContext = getSafeLocationContext()
  Object.assign(anonymousData, safeLocationContext)

  // No user agent string here: it is high-entropy, and a collector that needs it for bot
  // filtering receives it in the request's User-Agent header.

  // Sanitize URL
  if (typeof anonymousData.url === 'string') {
    anonymousData.url = sanitizeUrlForAnonymous(anonymousData.url)
  }

  // Error messages are kept (errors are essential events) but bounded.
  if ('message' in anonymousData) {
    const message = sanitizeAnalyticsText(anonymousData.message, ANONYMOUS_MESSAGE_MAX_LENGTH)
    if (message) anonymousData.message = message
    else delete anonymousData.message
  }

  return anonymousData
}
