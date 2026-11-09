// Core analytics types shared between Nuxt and Vite SPA implementations

export interface AnalyticsConfig {
  apiBaseUrl: string
  eventSiteName: string
  gaMeasurementId?: string // Google Analytics 4 measurement ID
  googleAdsConversions?: Record<string, string> // event -> Google Ads conversion ID
  openAIAdsPixelId?: string // OpenAI Ads Measurement Pixel ID
  openAIAdsEvents?: Record<string, OpenAIAdsEventConfig | string> // event -> OpenAI Ads event config
  openAIAdsDebug?: boolean // Enable OpenAI Ads pixel debug logging
  microsoftAdsTagId?: string // Microsoft Ads UET tag ID
  chatAccessKey?: string // Clear Ideas Chat access key (required for chat)
  chatApiBaseUrl?: string // Clear Ideas Chat API base URL (optional, defaults to https://api.clearideas.com)
  chatOpenOnLoad?: boolean // Open chat widget when page loads
  chatPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' // Widget position
  chatWidth?: number // Widget width in pixels
  chatHeight?: number // Widget height in pixels
  chatTop?: number // Absolute positioning: distance from top
  chatRight?: number // Absolute positioning: distance from right
  chatBottom?: number // Absolute positioning: distance from bottom
  chatLeft?: number // Absolute positioning: distance from left
  chatDarkMode?: boolean // Dark mode state
  chatFabSize?: number // Floating action button size in pixels
  chatFabHide?: boolean // Hide floating action button initially
  chatEnabled?: boolean // Enable/disable chat widget (default: true)
  chatWidgetUrl?: string // CDN URL for chat.js
  chatWidgetCssUrl?: string // CDN URL for chat.css
  chatUserName?: string // User name for chat
  chatUserEmail?: string // User email for chat
  chatUserId?: string // User ID for chat
  chatContainer?: string // Container selector or HTMLElement
  chatConsentRequired?: boolean // If true, consent is required before using cookies/localStorage. When true and consentGranted is false, widget uses sessionStorage only.
  chatConsentGranted?: boolean // If true, consent has been granted. Only relevant when consentRequired is true. When changed from false to true, widget migrates from sessionStorage to localStorage.
  microsoftAdsGoals?: Record<string, string> // event -> Microsoft Ads goal ID
  flushInterval: number
  consentCheckInterval: number
  sessionCheckInterval: number
  batchSize: number
  maxRetries: number
  autoTrackScrollDepth: boolean
  autoTrackTimeSpent: boolean
  autoTrackOutboundLinks: boolean
  cleanAttributionUrl?: boolean // Remove attribution params from visible URL after capture (default: true)
  nodeEnv?: string
  debug?: boolean
  websiteBaseUrl?: string
}

export type OpenAIAdsEventName =
  | 'page_viewed'
  | 'contents_viewed'
  | 'items_added'
  | 'checkout_started'
  | 'order_created'
  | 'lead_created'
  | 'registration_completed'
  | 'appointment_scheduled'
  | 'subscription_created'
  | 'trial_started'
  | 'custom'

export type OpenAIAdsEventDataType = 'contents' | 'customer_action' | 'plan_enrollment' | 'custom'

export interface OpenAIAdsEventConfig {
  eventName: OpenAIAdsEventName
  type?: OpenAIAdsEventDataType
  customEventName?: string
  data?: Record<string, any>
  options?: Record<string, any>
}

export interface AnalyticsEvent {
  name: string
  sessionId: string
  timestamp: string
  attributes: {
    event: string
    eventData: Record<string, any>
    hasConsent: boolean
    consentRequired: boolean
    trackingCategory: 'full' | 'limited'
    pageViewId?: string
    isAnonymous?: boolean
  }
}

export interface ConsentStatus {
  consented: boolean | null
  version: string | null
  timestamp?: number
}

export interface GeoContext {
  country?: string
  continent?: string
  timezone?: string
  requiresConsent: boolean
  timestamp: number
  cached?: boolean
}

export interface TrackingContext {
  sessionId: string
  anonymousSessionId?: string
  pageViewId?: string
  userAgent?: string
  referrer?: string
  screenResolution?: string
  viewport?: string
  viewportBucket?: string
  deviceBucket?: string
  pageTitle?: string
  connectionType?: string
  locationContext?: Record<string, any>
  attributionContext?: AttributionData
}

// Attribution data captured from URL parameters and referrer
export interface AttributionData {
  // Click IDs from ad platforms
  gclid?: string
  gbraid?: string
  wbraid?: string
  gtm_debug?: string
  msclkid?: string
  bat_debug?: string
  fbclid?: string

  // UTM parameters
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string

  // Internal campaign parameters (for on-site attribution)
  ci_source?: string
  ci_medium?: string
  ci_campaign?: string
  ci_term?: string
  ci_content?: string

  // Session metadata
  referrer?: string
  landingPath?: string
  landedAt?: string
  firstSeen?: string
  lastSeen?: string
}

export interface Analytics {
  trackEvent: (name: string, props?: Record<string, any>) => void
  trackError: (message: string, props?: Record<string, any>) => void
  trackUETEvent: (
    eventAction: string,
    eventLabel?: string,
    eventValue?: number,
    customParameters?: Record<string, any>,
  ) => void
  trackUETConversion: (goalId?: string, revenue?: number, currency?: string) => void
  flush: () => void
  getConsentStatus: () => Promise<boolean | null>
  showConsentBanner: () => void
  startAutoTracking: () => void
  stopAutoTracking: () => void
}

// Framework-specific interfaces
export interface FrameworkAdapter {
  getConfig: () => AnalyticsConfig
  getCurrentPath: () => string
  getCurrentUrl: () => string
  getReferrer: () => string
  onRouteChange: (callback: (path: string) => void) => () => void
  onAppReady: (callback: () => void) => void
  onAppDestroy: (callback: () => void) => void
  showConsentBanner: (onAccept: () => void, onReject: () => void) => void
  getRouter: () => any // Framework-specific router instance
}

// Storage keys
export const STORAGE_KEYS = {
  CONSENT_STATUS: 'ci_consent_status',
  SESSION_STATUS: 'ci_session_status',
  QUEUE: 'ci_events_queue',
  USER_SESSION: 'ci_user_session',
  ANON_SESSION: 'ci_anon_session',
  GEO_CONTEXT: 'ci_geo_context',
  DONT_TRACK_OWNER: 'ci_dont_track_owner',
  ATTRIBUTION_CONTEXT: 'ci_click',
} as const

// Global debug override for console-based toggling
let globalDebugOverride: boolean | null = null

// Debug logger
export function debugLog(
  config: Partial<AnalyticsConfig> | { debug: boolean },
  message: string,
  data?: any,
): void {
  // Check global override first, then fall back to config.debug
  const shouldDebug = globalDebugOverride !== null ? globalDebugOverride : config.debug
  if (shouldDebug) {
    console.log(`🔍 [Analytics] ${message}`, data || '')
  }
}

// Functions for console-based debug toggling
export function enableConsoleDebug(): void {
  globalDebugOverride = true
  console.log('🔍 Debug logging enabled via console override')
}

export function disableConsoleDebug(): void {
  globalDebugOverride = false
  console.log('🔍 Debug logging disabled via console override')
}

export function getConsoleDebugStatus(): { enabled: boolean; source: string } {
  const enabled = globalDebugOverride !== null ? globalDebugOverride : false
  const source = globalDebugOverride !== null ? 'console override' : 'config setting'
  return { enabled, source }
}
