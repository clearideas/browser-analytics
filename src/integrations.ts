// Third-party analytics integrations
import { isAttributionFromGoogleAds, isAttributionFromMicrosoftAds } from './attribution'
import { DEFAULT_CONFIG } from './core'
import { getLocalConsentStatus } from './storage'
import { getGeoContext } from './storage'
import type { AnalyticsConfig, OpenAIAdsEventConfig, OpenAIAdsEventName } from './types'
import { debugLog } from './types'

// Global declarations for third-party libraries
declare global {
  interface Window {
    gtag?: (...args: any[]) => void
    dataLayer?: any[]
    uetq?: any[]
    oaiq?: (...args: any[]) => void
    ClearIdeasWidget?: {
      init: (config: {
        accessKey: string
        apiBaseUrl?: string
        openOnLoad?: boolean
        position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
        width?: number
        height?: number
        top?: number
        right?: number
        bottom?: number
        left?: number
        darkMode?: boolean
        fabSize?: number
        fabHide?: boolean
        hasConsent?: boolean | (() => boolean) | string
        consentRequired?: boolean
        consentGranted?: boolean
        userName?: string
        userEmail?: string
        userId?: string
        container?: string | HTMLElement
      }) => {
        open: () => void
        close: () => void
        toggle: () => void
        sendMessage: (message: string) => Promise<void>
        hide: () => void
        show: () => void
        destroy: () => void
        setConsentRequired: (required: boolean) => void
        setConsentGranted: (granted: boolean) => void
        setDarkMode: (darkMode: boolean) => void
        setPosition: (position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left') => void
        setWidth: (width: number) => void
        setHeight: (height: number) => void
        setTop: (top?: number) => void
        setRight: (right?: number) => void
        setBottom: (bottom?: number) => void
        setLeft: (left?: number) => void
        setFabSize: (size: number) => void
        setUserName: (name: string) => void
        setUserEmail: (email: string) => void
        setUserId: (id: string) => void
      }
    }
  }
}

const OPENAI_ADS_SCRIPT_URL = 'https://bzrcdn.openai.com/sdk/oaiq.min.js'

const DEFAULT_OPENAI_ADS_EVENTS: Record<string, OpenAIAdsEventConfig> = {
  sign_up: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  sign_up_start: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  signup_start: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  signup_complete: {
    eventName: 'registration_completed',
    type: 'customer_action',
  },
  sign_up_complete: {
    eventName: 'registration_completed',
    type: 'customer_action',
  },
  trial_started: {
    eventName: 'trial_started',
    type: 'plan_enrollment',
    data: {
      plan_id: 'free_trial',
    },
  },
  submit_contact_form: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  newsletter_signup: {
    eventName: 'custom',
    type: 'custom',
    customEventName: 'newsletter_signup',
  },
  intent_pricing_view: {
    eventName: 'page_viewed',
    type: 'contents',
    data: {
      contents: [
        {
          id: 'pricing',
          name: 'Pricing page',
          content_type: 'page',
        },
      ],
    },
  },
}

function getOpenAIAdsEventConfig(
  config: AnalyticsConfig,
  eventName: string,
  eventProps: Record<string, any>,
): OpenAIAdsEventConfig | null {
  const manualEventName = eventProps.openai_event_name
  const configuredEvent =
    config.openAIAdsEvents?.[eventName] ?? DEFAULT_OPENAI_ADS_EVENTS[eventName]

  if (!manualEventName && !configuredEvent) return null

  const baseConfig: OpenAIAdsEventConfig =
    typeof configuredEvent === 'string'
      ? { eventName: configuredEvent as OpenAIAdsEventName }
      : configuredEvent || { eventName: manualEventName as OpenAIAdsEventName }

  return {
    ...baseConfig,
    eventName: (manualEventName || baseConfig.eventName) as OpenAIAdsEventName,
    customEventName: eventProps.openai_custom_event_name || baseConfig.customEventName,
    data: {
      ...(baseConfig.data || {}),
      ...(eventProps.openai_event_data || {}),
    },
    options: {
      ...(baseConfig.options || {}),
      ...(eventProps.openai_event_options || {}),
    },
  }
}

function getDefaultOpenAIAdsDataType(eventName: OpenAIAdsEventName): string {
  if (
    eventName === 'page_viewed' ||
    eventName === 'contents_viewed' ||
    eventName === 'items_added' ||
    eventName === 'checkout_started' ||
    eventName === 'order_created'
  ) {
    return 'contents'
  }

  if (
    eventName === 'lead_created' ||
    eventName === 'registration_completed' ||
    eventName === 'appointment_scheduled'
  ) {
    return 'customer_action'
  }

  if (eventName === 'subscription_created' || eventName === 'trial_started') {
    return 'plan_enrollment'
  }

  return 'custom'
}

function buildOpenAIAdsData(
  eventConfig: OpenAIAdsEventConfig,
  eventProps: Record<string, any>,
): Record<string, any> {
  const data = { ...(eventConfig.data || {}) }
  data.type = data.type || eventConfig.type || getDefaultOpenAIAdsDataType(eventConfig.eventName)

  if (data.type === 'contents' && !data.contents && eventProps.path) {
    data.contents = [
      {
        id: String(eventProps.path),
        name: eventProps.pageTitle || eventProps.title || String(eventProps.path),
        content_type: 'page',
      },
    ]
  }

  if (data.type === 'plan_enrollment' && !data.plan_id) {
    data.plan_id = eventProps.plan_id || eventProps.subscription_type || 'default'
  }

  if (typeof eventProps.amount === 'number' && data.amount === undefined) {
    data.amount = Math.round(eventProps.amount)
  }

  if (typeof eventProps.currency === 'string' && data.currency === undefined) {
    data.currency = eventProps.currency
  }

  return data
}

function buildOpenAIAdsOptions(eventConfig: OpenAIAdsEventConfig): Record<string, any> {
  const options = { ...(eventConfig.options || {}) }

  if (eventConfig.eventName === 'custom' && eventConfig.customEventName) {
    options.custom_event_name = eventConfig.customEventName
  }

  return options
}

// OpenAI Ads Measurement Pixel integration
export function initializeOpenAIAdsPixel(config: AnalyticsConfig, consented: boolean): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!config.openAIAdsPixelId || !consented) return

  if (typeof window.oaiq !== 'function') {
    const queue = function (...args: any[]) {
      ;(queue as any).q.push(args)
    }
    ;(queue as any).q = []
    window.oaiq = queue
  }

  if (!document.querySelector(`script[src="${OPENAI_ADS_SCRIPT_URL}"]`)) {
    const script = document.createElement('script')
    script.async = true
    script.src = OPENAI_ADS_SCRIPT_URL
    document.head.appendChild(script)
  }

  window.oaiq('init', {
    pixelId: config.openAIAdsPixelId,
    debug: config.openAIAdsDebug === true,
  })

  debugLog(config, 'OpenAI Ads pixel initialized', {
    pixelId: config.openAIAdsPixelId,
    debug: config.openAIAdsDebug === true,
  })
}

export function trackOpenAIAdsEvent(
  config: AnalyticsConfig,
  eventName: string,
  eventProps: Record<string, any>,
  hasConsent: boolean,
): void {
  if (typeof window === 'undefined' || !config.openAIAdsPixelId) return
  if (!hasConsent) {
    debugLog(config, 'OpenAI Ads event not sent - no consent', { eventName })
    return
  }

  initializeOpenAIAdsPixel(config, hasConsent)

  const eventConfig = getOpenAIAdsEventConfig(config, eventName, eventProps)
  if (!eventConfig) {
    debugLog(config, 'No OpenAI Ads event configured', { eventName })
    return
  }

  const data = buildOpenAIAdsData(eventConfig, eventProps)
  const options = buildOpenAIAdsOptions(eventConfig)

  if (eventConfig.eventName === 'custom' && !options.custom_event_name) {
    debugLog(config, 'OpenAI Ads custom event skipped - custom_event_name is required', {
      eventName,
    })
    return
  }

  try {
    if (Object.keys(options).length > 0) {
      window.oaiq?.('measure', eventConfig.eventName, data, options)
    } else {
      window.oaiq?.('measure', eventConfig.eventName, data)
    }

    debugLog(config, 'OpenAI Ads event sent', {
      sourceEventName: eventName,
      openAIEventName: eventConfig.eventName,
      data,
      options,
    })
  } catch (error) {
    console.warn('🔍 [Analytics] OpenAI Ads event failed to send', {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    })
    debugLog(config, 'OpenAI Ads event failed to send', {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Google Analytics 4 integration
export function initializeGTag(config: AnalyticsConfig, consented: boolean): void {
  if (typeof window === 'undefined' || !config.gaMeasurementId) return
  if (typeof window.gtag !== 'function') {
    console.warn('[Analytics] gtag missing — check Nuxt inline order/CSP')
    return
  }

  // Update Google Analytics consent state
  const state = consented ? 'granted' : 'denied'
  window.gtag('consent', 'update', {
    analytics_storage: state,
    ad_user_data: state,
    ad_personalization: state,
    ad_storage: state,
  })

  // If Ads wasn't configured inline, you may (safely) idempotently config it:
  const firstConv = config.googleAdsConversions && Object.values(config.googleAdsConversions)[0]
  const adsId = typeof firstConv === 'string' ? firstConv.split('/')[0] : undefined
  if (adsId?.startsWith('AW-')) window.gtag('config', adsId)
}

// Microsoft UET (Bing Ads) integration
let uetInitialFired = false

export function initializeUET(config: AnalyticsConfig, consented: boolean): void {
  if (typeof window === 'undefined' || !config.microsoftAdsTagId) return
  if (!window.uetq) {
    console.warn('[Analytics] UET missing — check Nuxt inline order/CSP')
    return
  }

  // Update UET consent state
  const consentState = consented ? 'granted' : 'denied'
  window.uetq.push('consent', 'update', {
    ad_storage: consentState,
  })

  // Send pageLoad if consented and not already fired
  if (consented && !uetInitialFired) {
    window.uetq.push('pageLoad')
    uetInitialFired = true
  }
}

// Clear Ideas Chat integration
export async function initializeClearIdeasChat(config: AnalyticsConfig): Promise<void> {
  if (!config.chatAccessKey) return
  if (config.chatEnabled === false) {
    debugLog(config, 'Clear Ideas Chat disabled via config')
    return
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  // Only skip when the actual widget instance already exists.
  if (getChatWidgetInstance()) {
    debugLog(config, 'Clear Ideas Chat widget instance already initialized, skipping')
    return
  }

  try {
    // Load CSS from CDN if not already loaded
    const cssUrl = config.chatWidgetCssUrl || DEFAULT_CONFIG.chatWidgetCssUrl
    if (!document.querySelector(`link[href="${cssUrl}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = cssUrl
      document.head.appendChild(link)
      debugLog(config, 'Clear Ideas Chat CSS loaded', { cssUrl })
    }

    // Load JavaScript from CDN if not already loaded
    const jsUrl = config.chatWidgetUrl || DEFAULT_CONFIG.chatWidgetUrl

    const waitForWidgetScript = async (
      existingScript?: HTMLScriptElement | null,
    ): Promise<void> => {
      if (window.ClearIdeasWidget) {
        return
      }

      if (existingScript) {
        const existingStatus = existingScript.dataset.clearIdeasStatus

        if (existingStatus === 'loaded' && window.ClearIdeasWidget) {
          return
        }

        if (existingStatus === 'error' || (!existingStatus && !window.ClearIdeasWidget)) {
          existingScript.remove()
          await waitForWidgetScript()
          return
        }
      }

      await new Promise<void>((resolve, reject) => {
        const script = existingScript || document.createElement('script')

        const cleanup = () => {
          script.removeEventListener('load', onLoad)
          script.removeEventListener('error', onError)
        }

        const onLoad = () => {
          cleanup()
          script.dataset.clearIdeasStatus = 'loaded'
          debugLog(config, 'Clear Ideas Chat script loaded successfully', {
            jsUrl,
          })
          resolve()
        }

        const onError = () => {
          cleanup()
          script.dataset.clearIdeasStatus = 'error'
          reject(new Error(`Failed to load Clear Ideas Chat script: ${jsUrl}`))
        }

        script.addEventListener('load', onLoad, { once: true })
        script.addEventListener('error', onError, { once: true })

        if (!existingScript) {
          script.async = true
          script.src = jsUrl
          script.dataset.clearIdeasStatus = 'loading'
          document.head.appendChild(script)
        }
      })
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${jsUrl}"]`)

    await waitForWidgetScript(existingScript)

    // Initialize widget after the script is actually available.
    initializeWidget(config)
  } catch (error) {
    console.warn('🔍 [Analytics] Clear Ideas Chat unavailable - integration disabled')
    debugLog(config, 'Clear Ideas Chat initialization failed', error)
  }
}

// Helper function to get consent state from analytics system
function getConsentState(): {
  consentRequired: boolean
  consentGranted: boolean
} {
  // Check if consent is required based on geo location
  let consentRequired = true // Default to requiring consent
  try {
    const geoData = getGeoContext()
    if (geoData) {
      const age = Date.now() - (geoData.timestamp || 0)
      // Use cached geo data if less than 24 hours old
      if (age < 24 * 60 * 60 * 1000) {
        consentRequired = geoData.requiresConsent === true
      }
    }
  } catch {
    // Ignore storage errors, default to requiring consent
  }

  // Get current consent status
  const consentStatus = getLocalConsentStatus()
  const consentGranted = consentStatus.consented === true

  return { consentRequired, consentGranted }
}

// Get the chat widget instance if it has been initialized
export function getChatWidgetInstance(): ReturnType<
  NonNullable<typeof window.ClearIdeasWidget>['init']
> | null {
  if (typeof window === 'undefined') return null
  const widget = (window as any).clearIdeasWidget
  if (!widget || typeof widget.setConsentRequired !== 'function') {
    return null
  }
  return widget
}

// Update chat widget consent when analytics consent changes
export function updateChatConsent(config: AnalyticsConfig): void {
  if (typeof window === 'undefined') return

  const widget = getChatWidgetInstance()
  if (!widget) {
    debugLog(config, 'Chat widget not available for consent update')
    return
  }

  try {
    const { consentRequired, consentGranted } = getConsentState()

    // Update consent state using widget setter methods
    widget.setConsentRequired(consentRequired)
    widget.setConsentGranted(consentGranted)

    debugLog(config, 'Chat widget consent updated', {
      consentRequired,
      consentGranted,
    })
  } catch (error) {
    console.warn('🔍 [Analytics] Failed to update chat widget consent')
    debugLog(config, 'Chat widget consent update error', error)
  }
}

// Helper function to initialize the widget
function getCurrentDocumentDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }

  const root = document.documentElement
  const body = document.body
  const documentTheme = root.getAttribute('data-theme')

  if (documentTheme === 'dark' || documentTheme === 'light') {
    return documentTheme === 'dark'
  }

  return (
    root.classList.contains('dark') ||
    root.classList.contains('theme-dark') ||
    root.classList.contains('v-theme--dark') ||
    body?.classList.contains('dark') ||
    body?.classList.contains('theme-dark') ||
    body?.classList.contains('v-theme--dark') ||
    document.querySelector('.v-theme--dark') !== null ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  )
}

function initializeWidget(config: AnalyticsConfig): void {
  if (!window.ClearIdeasWidget || !config.chatAccessKey) {
    debugLog(config, 'Clear Ideas Chat widget not available or no access key')
    return
  }

  if (getChatWidgetInstance()) {
    debugLog(config, 'Clear Ideas Chat widget instance already initialized')
    return
  }

  try {
    // Build widget config from analytics config
    const widgetConfig: any = {
      accessKey: config.chatAccessKey,
    }

    // Map optional config options
    if (config.chatApiBaseUrl) widgetConfig.apiBaseUrl = config.chatApiBaseUrl
    if (config.chatOpenOnLoad !== undefined) widgetConfig.openOnLoad = config.chatOpenOnLoad
    if (config.chatPosition) widgetConfig.position = config.chatPosition
    if (config.chatWidth) widgetConfig.width = config.chatWidth
    if (config.chatHeight) widgetConfig.height = config.chatHeight
    if (config.chatTop !== undefined) widgetConfig.top = config.chatTop
    if (config.chatRight !== undefined) widgetConfig.right = config.chatRight
    if (config.chatBottom !== undefined) widgetConfig.bottom = config.chatBottom
    if (config.chatLeft !== undefined) widgetConfig.left = config.chatLeft
    widgetConfig.darkMode =
      config.chatDarkMode !== undefined ? config.chatDarkMode : getCurrentDocumentDarkMode()
    if (config.chatFabSize) widgetConfig.fabSize = config.chatFabSize
    if (config.chatFabHide !== undefined) widgetConfig.fabHide = config.chatFabHide
    if (config.chatUserName) widgetConfig.userName = config.chatUserName
    if (config.chatUserEmail) widgetConfig.userEmail = config.chatUserEmail
    if (config.chatUserId) widgetConfig.userId = config.chatUserId
    if (config.chatContainer) widgetConfig.container = config.chatContainer

    // Get consent state from analytics system
    const { consentRequired, consentGranted } = getConsentState()

    // Use analytics consent state, but allow manual override from config
    widgetConfig.consentRequired =
      config.chatConsentRequired !== undefined ? config.chatConsentRequired : consentRequired
    widgetConfig.consentGranted =
      config.chatConsentGranted !== undefined ? config.chatConsentGranted : consentGranted

    // Chat is a functional service (customer support) and doesn't require analytics consent
    // The chat widget itself handles its own consent for storing user data via consentRequired/consentGranted
    // Set hasConsent to true so chat is always available, regardless of analytics consent
    widgetConfig.hasConsent = true

    // Initialize the widget
    const widget = window.ClearIdeasWidget.init(widgetConfig)
    debugLog(config, 'Clear Ideas Chat widget initialized successfully', {
      accessKey: config.chatAccessKey,
      consentRequired: widgetConfig.consentRequired,
      consentGranted: widgetConfig.consentGranted,
      position: widgetConfig.position,
      top: widgetConfig.top,
      right: widgetConfig.right,
      bottom: widgetConfig.bottom,
      left: widgetConfig.left,
      darkMode: widgetConfig.darkMode,
      width: widgetConfig.width,
      height: widgetConfig.height,
    })

    // Store widget instance globally for potential future use
    ;(window as any).clearIdeasWidget = widget
  } catch (error) {
    console.warn('🔍 [Analytics] Clear Ideas Chat widget initialization failed')
    debugLog(config, 'Clear Ideas Chat widget initialization error', error)
  }
}

// UET-specific tracking functions
export function trackUETEvent(
  eventAction: string,
  eventLabel?: string,
  eventValue?: number,
  customParameters?: Record<string, any>,
): void {
  if (!window.uetq) return

  const eventData: any = {
    ec: 'Custom', // Event Category
    ea: eventAction, // Event Action
  }

  if (eventLabel) {
    eventData.el = eventLabel // Event Label
  }

  if (eventValue !== undefined) {
    eventData.ev = eventValue // Event Value
  }

  // Add custom parameters
  if (customParameters) {
    Object.assign(eventData, customParameters)
  }

  window.uetq.push('event', eventData)
}

export function trackUETConversion(
  goalId?: string,
  revenue?: number,
  currency: string = 'USD',
): void {
  if (!window.uetq) return

  const conversionData: any = {}

  if (goalId) {
    conversionData.gv = goalId // Goal Value (custom goal ID)
  }

  if (revenue !== undefined) {
    conversionData.rv = revenue // Revenue Value
    conversionData.rc = currency // Revenue Currency
  }

  window.uetq.push('event', 'conversion', conversionData)
}

// Track event with all integrated platforms
export function trackIntegratedEvent(
  config: AnalyticsConfig,
  eventName: string,
  eventProps: Record<string, any> = {},
  hasConsent: boolean = false,
): void {
  debugLog(config, 'trackIntegratedEvent called', {
    eventName,
    hasConsent,
    eventPropsKeys: Object.keys(eventProps),
    hasAttribution: !!eventProps.attribution,
  })

  // Only track with third parties if user has consented
  if (!hasConsent) {
    debugLog(config, 'Event not sent to third parties - no consent', {
      eventName,
    })
    return
  }

  // Get attribution context for conversion tracking
  const attributionContext = eventProps.attribution

  // Google Analytics
  if (!window.gtag) {
    debugLog(config, 'Google Analytics not available', { eventName })
  }
  const gtagFn = window.gtag
  if (gtagFn) {
    debugLog(config, 'Sending event to Google Analytics', {
      eventName,
      eventPropsCount: Object.keys(eventProps).length,
      gtagAvailable: true,
    })

    // Always send Google Analytics event (for analytics tracking)
    gtagFn('event', eventName, eventProps)
    debugLog(config, 'Google Analytics event sent', {
      eventName,
      sentToGA: true,
      dataLayerLength: window.dataLayer?.length || 0,
    })

    // Auto-fire Google Ads conversions based on config + attribution
    const autoConversionId = config.googleAdsConversions?.[eventName]
    const manualConversionId = eventProps.ads_send_to
    const conversionId = manualConversionId || autoConversionId

    // Allow forcing conversion regardless of attribution (useful for testing or server-side conversions)
    const forceConversion = eventProps.force_ads_conversion === true

    const isFromGoogleAds = isAttributionFromGoogleAds(attributionContext)
    debugLog(config, 'Checking for Google Ads conversion', {
      eventName,
      hasAutoConversion: !!autoConversionId,
      hasManualConversion: !!manualConversionId,
      conversionId: conversionId || 'none',
      isFromGoogleAds,
      forceConversion,
      attributionContext: attributionContext
        ? {
            gclid: attributionContext.gclid,
            gbraid: attributionContext.gbraid,
            wbraid: attributionContext.wbraid,
            gtm_debug: attributionContext.gtm_debug,
            utm_source: attributionContext.utm_source,
            utm_medium: attributionContext.utm_medium,
            utm_campaign: attributionContext.utm_campaign,
          }
        : null,
      googleAdsCheckDetails: attributionContext
        ? {
            hasGclid: !!attributionContext.gclid,
            hasGbraid: !!attributionContext.gbraid,
            hasWbraid: !!attributionContext.wbraid,
            hasGtmDebug: !!attributionContext.gtm_debug,
            hasGoogleSource: attributionContext.utm_source === 'google',
            hasCpcMedium: attributionContext.utm_medium === 'cpc',
            meetsGoogleAdsCriteria: isFromGoogleAds,
          }
        : null,
    })

    if (conversionId && (forceConversion || isAttributionFromGoogleAds(attributionContext))) {
      const transportType = eventProps.transport_type || 'beacon'
      debugLog(config, 'Sending Google Ads conversion', {
        eventName,
        conversionId,
        transportType,
        source: manualConversionId ? 'manual' : 'auto',
        attributionSource: attributionContext ? 'gclid/gbraid/wbraid' : 'unknown',
        gtagAvailable: !!window.gtag,
        dataLayerLengthBefore: window.dataLayer?.length || 0,
      })

      try {
        gtagFn('event', 'conversion', {
          send_to: conversionId,
          transport_type: transportType,
        })

        debugLog(config, 'Google Ads conversion fired successfully', {
          eventName,
          conversionId,
          transportType,
          source: manualConversionId ? 'manual' : 'auto',
          forced: forceConversion,
          dataLayerLengthAfter: window.dataLayer?.length || 0,
          sentVia: 'gtag',
        })

        debugLog(config, 'Google Ads conversion fired', {
          eventName,
          conversionId,
          forced: forceConversion,
          attribution: forceConversion ? 'forced' : 'verified',
        })
      } catch (error) {
        console.warn('🔍 [Analytics] Google Ads conversion failed to send', {
          eventName,
          conversionId,
          error: error instanceof Error ? error.message : String(error),
        })
        debugLog(config, 'Google Ads conversion failed to send', {
          eventName,
          conversionId,
          error: error instanceof Error ? error.message : String(error),
          gtagError: true,
        })
      }
    } else if (
      conversionId &&
      !forceConversion &&
      !isAttributionFromGoogleAds(attributionContext)
    ) {
      debugLog(config, 'Google Ads conversion not fired - traffic not from Google Ads', {
        eventName,
        conversionId,
        attributionCheck: 'failed',
      })
    } else {
      debugLog(config, 'No Google Ads conversion to fire', {
        eventName,
        reason: !conversionId ? 'no conversion configured' : 'not from Google Ads',
      })
    }
  } else {
    debugLog(config, 'Google Analytics not available - event not sent', {
      eventName,
      gtagAvailable: false,
    })
  }

  // OpenAI Ads Measurement Pixel
  trackOpenAIAdsEvent(config, eventName, eventProps, hasConsent)

  // Microsoft UET
  if (!window.uetq) {
    debugLog(config, 'Microsoft UET not available', { eventName })
    // you can still proceed with your app's own analytics if any
  } else if (config.microsoftAdsGoals) {
    const goalId = config.microsoftAdsGoals[eventName]
    const manualGoalId = eventProps.goal_id
    const finalGoalId = manualGoalId || goalId

    // Allow forcing conversion regardless of attribution (useful for testing or server-side conversions)
    const forceMsConversion = eventProps.force_ms_conversion === true

    const isFromMicrosoftAds = isAttributionFromMicrosoftAds(attributionContext)
    debugLog(config, 'Checking for Microsoft Ads conversion', {
      eventName,
      hasAutoGoal: !!goalId,
      hasManualGoal: !!manualGoalId,
      finalGoalId: finalGoalId || 'none',
      isFromMicrosoftAds,
      forceMsConversion,
      uetqAvailable: true,
      goalsConfigured: Object.keys(config.microsoftAdsGoals).length,
      attributionContext: attributionContext
        ? {
            msclkid: attributionContext.msclkid,
            bat_debug: attributionContext.bat_debug,
            utm_source: attributionContext.utm_source,
            utm_medium: attributionContext.utm_medium,
          }
        : null,
      microsoftAdsCheckDetails: attributionContext
        ? {
            hasMsclkid: !!attributionContext.msclkid,
            hasBatDebug: !!attributionContext.bat_debug,
            meetsMicrosoftAdsCriteria: isFromMicrosoftAds,
          }
        : null,
    })

    if (finalGoalId && (forceMsConversion || isAttributionFromMicrosoftAds(attributionContext))) {
      // Auto-fire Microsoft Ads conversion
      debugLog(config, 'Sending Microsoft Ads conversion', {
        eventName,
        goalId: finalGoalId,
        value: eventProps.value,
        currency: eventProps.currency,
        source: manualGoalId ? 'manual' : 'auto',
        attributionSource: attributionContext ? 'msclkid' : 'unknown',
        uetqAvailable: !!window.uetq,
        uetqLengthBefore: window.uetq?.length || 0,
      })

      try {
        trackUETConversion(finalGoalId, eventProps.value, eventProps.currency)
        debugLog(config, 'Microsoft Ads conversion fired successfully', {
          eventName,
          goalId: finalGoalId,
          value: eventProps.value,
          currency: eventProps.currency,
          source: manualGoalId ? 'manual' : 'auto',
          forced: forceMsConversion,
          uetqLengthAfter: window.uetq?.length || 0,
          sentVia: 'uetq',
        })

        debugLog(config, 'Microsoft Ads conversion fired', {
          eventName,
          goalId: finalGoalId,
          value: eventProps.value,
          forced: forceMsConversion,
          attribution: forceMsConversion ? 'forced' : 'verified',
        })
      } catch (error) {
        console.warn('🔍 [Analytics] Microsoft Ads conversion failed to send', {
          eventName,
          goalId: finalGoalId,
          error: error instanceof Error ? error.message : String(error),
        })
        debugLog(config, 'Microsoft Ads conversion failed to send', {
          eventName,
          goalId: finalGoalId,
          error: error instanceof Error ? error.message : String(error),
          uetqError: true,
        })
      }
    } else if (
      finalGoalId &&
      !forceMsConversion &&
      !isAttributionFromMicrosoftAds(attributionContext)
    ) {
      debugLog(config, 'Microsoft Ads conversion not fired - traffic not from Microsoft Ads', {
        eventName,
        goalId: finalGoalId,
        attributionCheck: 'failed',
      })
      // Still track as regular UET event even if not converting
      trackUETEvent(eventName, eventProps.category || 'general', eventProps.value)
      debugLog(config, 'Sent as regular UET event instead', {
        eventName,
        action: eventName,
        value: eventProps.value,
      })
    } else {
      // Track as regular UET event (not conversion)
      debugLog(config, 'Sending as regular UET event', {
        eventName,
        goalId: finalGoalId || 'none',
        reason: !finalGoalId ? 'no goal configured' : 'not from Microsoft Ads',
      })

      switch (eventName) {
        case 'sign_up':
          trackUETEvent('signup', eventProps.method || 'unknown', eventProps.value)
          debugLog(config, 'Microsoft UET signup event sent', {
            method: eventProps.method || 'unknown',
            value: eventProps.value,
          })
          break
        case 'lead':
          trackUETEvent('lead', eventProps.source || 'unknown', eventProps.value)
          debugLog(config, 'Microsoft UET lead event sent', {
            source: eventProps.source || 'unknown',
            value: eventProps.value,
          })
          break
        case 'contact':
          trackUETEvent('contact', eventProps.method || 'form', eventProps.value)
          debugLog(config, 'Microsoft UET contact event sent', {
            method: eventProps.method || 'form',
            value: eventProps.value,
          })
          break
        default:
          // Track as generic custom event
          trackUETEvent(eventName, eventProps.category || 'general', eventProps.value)
          debugLog(config, 'Microsoft UET custom event sent', {
            action: eventName,
            category: eventProps.category || 'general',
            value: eventProps.value,
          })
      }
    }
  } else {
    debugLog(config, 'Microsoft UET not available or not configured', {
      eventName,
      uetqAvailable: !!window.uetq,
      goalsConfigured: !!(
        config.microsoftAdsGoals && Object.keys(config.microsoftAdsGoals).length > 0
      ),
    })
  }
}

export function grantAnalyticsConsent(cfg: AnalyticsConfig) {
  initializeGTag(cfg, true)
  initializeUET(cfg, true)
  initializeOpenAIAdsPixel(cfg, true)
  // Update chat widget consent state
  updateChatConsent(cfg)
}

export function revokeAnalyticsConsent(cfg: AnalyticsConfig) {
  initializeGTag(cfg, false)
  initializeOpenAIAdsPixel(cfg, false)
  // No UET pageLoad on revoke; do nothing
  // Update chat widget consent state (revoked)
  updateChatConsent(cfg)
}
