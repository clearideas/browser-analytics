// Core analytics types shared between Nuxt and Vite SPA implementations
import type { BannerOptions } from './banner'
import type { CategoryChoices, OptionalCategory } from './categories'
import type { GatedScriptsOptions } from './gated-scripts'
import type { IntegrationsConfig } from './plugins/registry'
import type { AnalyticsPlugin, ConsentState } from './plugins/types'

export interface AnalyticsConfig {
  apiBaseUrl: string // Collector base URL; the library calls <apiBaseUrl>/v1/... (spec/openapi.yaml)
  siteKey?: string // Public site key registered with the collector (pattern ^[A-Za-z0-9._-]{3,64}$)
  /** @deprecated Use siteKey. Used as the site key when siteKey is not set. */
  eventSiteName?: string
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
  /** @deprecated Ignored since v1: the consent decision is stored in the browser. */
  consentCheckInterval?: number
  /** @deprecated Ignored since v1: there is no session endpoint. */
  sessionCheckInterval?: number
  batchSize: number
  maxRetries: number
  autoTrackScrollDepth: boolean
  autoTrackTimeSpent: boolean
  autoTrackOutboundLinks: boolean
  cleanAttributionUrl?: boolean // Remove attribution params from visible URL after capture (default: true)
  cookieDomain?: string // Share attribution across subdomains via a cookie on this domain (e.g. 'example.com'). Default: no cookie.
  urlQueryAllowlist?: string[] // Extra query parameters to keep in page URLs (campaign parameters are always kept)
  exposeGlobals?: boolean // Expose window.ciAnalytics helpers (also enabled by debug). Default: false
  nodeEnv?: string
  debug?: boolean
  websiteBaseUrl?: string
  /**
   * Consent policy supplied with the page (e.g. by server-side rendering or an edge
   * function), which skips the GET /v1/context request.
   */
  initialContext?: InitialContext
  /**
   * Built-in integrations by name, e.g. { googleAnalytics: { measurementId: 'G-...' } }.
   * Loaded only when configured and allowed by consent. The older flat settings
   * (gaMeasurementId, chatAccessKey, ...) still work and map onto these.
   */
  integrations?: IntegrationsConfig
  /** Custom plugins (see AnalyticsPlugin). */
  plugins?: AnalyticsPlugin[]
  /**
   * Consent-gated <script type="text/plain" data-ci-consent="…"> tags for tools without a
   * plugin (see docs/THIRD_PARTY.md). On by default; false turns it off.
   */
  gatedScripts?: GatedScriptsOptions | false
  /** Consent banner text and behavior. false: no built-in banner (use analytics.consent). */
  banner?: BannerOptions | false
  /** How consent is asked and what happens before a decision. */
  consent?: ConsentOptions
  /**
   * Honor the browser's Global Privacy Control signal (default true): where consent is not
   * required, third-party integrations that need consent do not run unless the visitor
   * explicitly accepts.
   */
  respectGlobalPrivacyControl?: boolean
}

export interface ConsentOptions {
  /**
   * 'simple' (default): one choice, "Accept all" or "Reject non-essential".
   * 'categories': visitors can also choose per category (preferences, statistics,
   * marketing) in a "Customize" view.
   */
  choices?: 'simple' | 'categories'
  /** Categories offered in 'categories' mode (default: all three). */
  categories?: OptionalCategory[]
  /**
   * Where consent is required and statistics consent is not given (undecided or refused):
   * 'limited' (default) sends anonymous, essential events only; 'none' sends nothing.
   * The collector can set this per region (GET /v1/context policy.trackingWithoutConsent),
   * which takes precedence.
   */
  trackingWithoutConsent?: 'limited' | 'none'
  /**
   * When a visitor withdraws consent for a third-party tool that is already running and
   * cannot be stopped in place (some vendors, and every consent-gated script), reload the
   * page after saving the decision so the tool's code is gone (default true). The reload
   * happens only in that case.
   */
  reloadOnWithdrawal?: boolean
}

export interface InitialContext {
  consentRequired: boolean
  policyVersion?: string
  trackingWithoutConsent?: 'limited' | 'none'
  country?: string
  continent?: string
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

/** One event, as sent to POST /v1/events (see Event in spec/openapi.yaml). */
export interface AnalyticsEvent {
  eventId: string
  name: string
  occurredAt: string
  sessionId: string
  pageViewId?: string
  trackingCategory: 'full' | 'limited'
  consent: { required: boolean; granted: boolean }
  props: Record<string, any>
}

/** Request body of POST /v1/events (EventBatch in spec/openapi.yaml). */
export interface EventBatch {
  v: 1
  siteKey: string
  sentAt: string
  events: AnalyticsEvent[]
}

/** Request body of POST /v1/consent (ConsentRecordRequest in spec/openapi.yaml). */
export interface ConsentRecord {
  v: 1
  siteKey: string
  consentId: string
  decision: 'granted' | 'denied' | 'partial'
  /** The choice per category ('granted'/'denied' records have them all equal). */
  categories: CategoryChoices
  policyVersion: string
  decidedAt: string
  source: 'banner' | 'api'
}

export interface ConsentStatus {
  /** true: everything accepted; false: decided, but not everything; null: undecided. */
  consented: boolean | null
  /** Policy version the decision was made under. */
  version: string | null
  timestamp?: number
  /** Stable identifier shared by all consent records from this browser. */
  consentId?: string
  /** Per-category choices (absent in records written before categories existed). */
  categories?: CategoryChoices
}

/** Cached answer of GET /v1/context. */
export interface GeoContext {
  country?: string
  continent?: string
  requiresConsent: boolean
  policyVersion?: string
  /** Whether anonymous "limited" events may be sent without statistics consent (default 'limited'). */
  trackingWithoutConsent?: 'limited' | 'none'
  timestamp: number
  /** Epoch ms after which the context must be fetched again. */
  expiresAt?: number
}

export interface TrackingContext {
  sessionId: string
  anonymousSessionId?: string
  pageViewId?: string
  userAgent?: string
  referrer?: string
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
  utm_context?: string

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
  /** Headless consent API, for sites that build their own consent UI. */
  consent: ConsentApi
  /**
   * Resolves once the consent policy for this visitor is known (initAnalytics fetched the
   * context). Events tracked earlier are treated as "consent required" (fail closed).
   */
  ready: () => Promise<void>
}

export interface ConsentSnapshot extends ConsentState {
  /** Current policy version from the collector, if known. */
  policyVersion?: string
}

export interface ConsentApi {
  /** Current consent situation. */
  get: () => ConsentSnapshot
  /** Record the visitor's acceptance (as if they clicked Accept). */
  accept: () => Promise<void>
  /** Record the visitor's refusal or withdrawal (as if they clicked Reject). */
  reject: () => Promise<void>
  /**
   * Record a choice per category, e.g. { statistics: true, marketing: false }. Categories
   * not mentioned are not allowed.
   */
  set: (choices: Partial<CategoryChoices>) => Promise<void>
  /** Called once the policy is known and after each decision. Returns an unsubscribe function. */
  onChange: (listener: (state: ConsentSnapshot) => void) => () => void
  /** Show the built-in banner (e.g. from a "Cookie settings" link). */
  showBanner: () => void
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
  /** @deprecated Unused: the library renders its own framework-neutral banner. */
  showConsentBanner?: (onAccept: () => void, onReject: () => void) => void
  getRouter: () => any // Framework-specific router instance
}

// Storage keys
export const STORAGE_KEYS = {
  CONSENT_STATUS: 'ci_consent_status',
  CONSENT_PENDING: 'ci_consent_pending', // consent records not yet delivered
  SESSION_STATUS: 'ci_session_status', // legacy (pre-v1); removed on startup
  QUEUE: 'ci_events_queue',
  USER_SESSION: 'ci_user_session',
  ANON_SESSION: 'ci_anon_session',
  GEO_CONTEXT: 'ci_geo_context',
  DONT_TRACK_OWNER: 'ci_dont_track_owner',
  ATTRIBUTION_CONTEXT: 'ci_click',
} as const

/** The site key sent to the collector (siteKey, falling back to the deprecated eventSiteName). */
export function getSiteKey(config: Pick<AnalyticsConfig, 'siteKey' | 'eventSiteName'>): string {
  return config.siteKey || config.eventSiteName || ''
}

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
