// Core analytics utilities shared between frameworks
import type { GeoContext } from './types'
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

// Generate consent banner HTML (shared between frameworks)
export function getConsentBannerHTML(websiteBaseUrl: string): string {
  return `
    <div class="v-sheet v-sheet--elevation-3" style="border-radius: 0; padding: 16px; background-color: rgb(var(--v-theme-surface));">
      <div class="d-flex align-center justify-space-between flex-column flex-md-row" style="gap: 12px; max-width: 1600px; margin: 0 auto;">
        <div class="flex-grow-1 flex-shrink-1 text-body-2">
          <p class="font-weight-semibold mb-1">Help us improve your experience</p>
          <p>We use cookies and similar technologies to keep our site secure, operate essential features, analyze traffic, and improve content and advertising. Select "Accept All" to allow every cookie, or choose "Reject non-essential" to permit only those required for the site to function. Learn more in our
          <a href="${websiteBaseUrl}privacy" class="text-decoration-none font-weight-medium" style="color: rgb(var(--v-theme-primary));">Privacy Policy</a>.</p>
        </div>
        <div class="flex-grow-0 flex-shrink-0 d-flex gap-2 align-center justify-center justify-md-end">
          <button id="ci-consent-reject" class="v-btn v-btn--density-default v-btn--size-default v-btn--variant-outlined v-btn--rounded text-primary text-capitalize">
            <span class="v-btn__content">Reject non-essential</span>
          </button>
          <button id="ci-consent-accept" class="v-btn v-btn--density-default v-btn--size-default v-btn--variant-flat v-btn--rounded bg-primary text-on-primary text-capitalize">
            <span class="v-btn__content">Accept All</span>
          </button>
        </div>
      </div>
    </div>
  `
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
      const stored = localStorage.getItem(STORAGE_KEYS.GEO_CONTEXT)
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
  try {
    const urlObj = new URL(url)
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`
  } catch {
    return url
  }
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
    'name', // Web vital metric name
    'value', // Web vital metric value
    'timezone',
    'language',
    'country',
    'continent',
    'userAgent',
  ]
}

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

  // Add userAgent for bot detection
  if (typeof navigator !== 'undefined') {
    anonymousData.userAgent = navigator.userAgent
  }

  // Sanitize URL
  if (anonymousData.url) {
    anonymousData.url = sanitizeUrlForAnonymous(anonymousData.url)
  }

  return anonymousData
}
