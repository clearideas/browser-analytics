// Nuxt wrapper for the shared analytics core
import { DEFAULT_CONFIG } from './core'
import { initAnalytics } from './index'
import type { AnalyticsConfig } from './types'
import { debugLog } from './types'

// Re-export types for convenience
export type { Analytics, AnalyticsConfig } from './types'

// Helper function to safely parse numeric config values (handles both number and string types)
function parseNumberConfig(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return isNaN(value) ? undefined : value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const num = Number(trimmed)
    return !isNaN(num) ? num : undefined
  }
  return undefined
}

// Accept an object or a JSON string (env-friendly) for object options
function parseObjectConfig(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
    } catch {
      console.warn('[Analytics] Ignoring invalid JSON in Nuxt analytics config')
    }
  }
  return undefined
}

// Accept either an array or a comma-separated string (env-friendly) for list options
function parseListConfig(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.map(item => String(item).trim())
    : typeof value === 'string'
      ? value.split(',').map(item => item.trim())
      : []
  const filtered = items.filter(Boolean)
  return filtered.length > 0 ? filtered : undefined
}

/** Map Nuxt public runtime config (runtimeConfig.public) to the analytics config. */
export function nuxtAnalyticsConfig(config: Record<string, any>): AnalyticsConfig {
  return {
    apiBaseUrl: (config.apiBaseUrl as string) || DEFAULT_CONFIG.apiBaseUrl,
    siteKey: (config.analyticsSiteKey as string | undefined) || undefined,
    eventSiteName: (config.eventSiteName as string) || 'nuxt-app', // fallback site key
    gaMeasurementId: config.gaMeasurementId as string | undefined,
    googleAdsConversions: config.googleAdsConversions as Record<string, string> | undefined,
    openAIAdsPixelId: config.openAIAdsPixelId as string | undefined,
    openAIAdsEvents: config.openAIAdsEvents as Record<string, any> | undefined,
    openAIAdsDebug: config.openAIAdsDebug === true,
    microsoftAdsTagId: config.microsoftAdsTagId as string | undefined,
    chatAccessKey: config.chatAccessKey as string | undefined,
    chatApiBaseUrl: config.chatApiBaseUrl as string | undefined,
    chatOpenOnLoad:
      config.chatOpenOnLoad === true || config.chatOpenOnLoad === false
        ? config.chatOpenOnLoad
        : undefined,
    chatPosition: config.chatPosition as
      'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | undefined,
    chatWidth: parseNumberConfig(config.chatWidth as number | string | undefined),
    chatHeight: parseNumberConfig(config.chatHeight as number | string | undefined),
    chatTop: parseNumberConfig(config.chatTop as number | string | undefined),
    chatRight: parseNumberConfig(config.chatRight as number | string | undefined),
    chatBottom: parseNumberConfig(config.chatBottom as number | string | undefined),
    chatLeft: parseNumberConfig(config.chatLeft as number | string | undefined),
    chatDarkMode:
      config.chatDarkMode === true || config.chatDarkMode === false
        ? config.chatDarkMode
        : undefined,
    chatFabSize: parseNumberConfig(config.chatFabSize as number | string | undefined),
    chatFabHide:
      config.chatFabHide === true || config.chatFabHide === false ? config.chatFabHide : undefined,
    chatEnabled: config.chatEnabled !== false,
    chatWidgetUrl: config.chatWidgetUrl as string | undefined,
    chatWidgetCssUrl: config.chatWidgetCssUrl as string | undefined,
    chatUserName: config.chatUserName as string | undefined,
    chatUserEmail: config.chatUserEmail as string | undefined,
    chatUserId: config.chatUserId as string | undefined,
    chatContainer: config.chatContainer as string | undefined,
    chatConsentRequired:
      config.chatConsentRequired === true || config.chatConsentRequired === false
        ? config.chatConsentRequired
        : undefined,
    chatConsentGranted:
      config.chatConsentGranted === true || config.chatConsentGranted === false
        ? config.chatConsentGranted
        : undefined,
    microsoftAdsGoals: (config.microsoftAdsGoals as Record<string, string>) || {},
    flushInterval: Number(config.analyticsFlushInterval) || DEFAULT_CONFIG.flushInterval,
    consentCheckInterval:
      Number(config.analyticsConsentCheckInterval) || DEFAULT_CONFIG.consentCheckInterval,
    sessionCheckInterval:
      Number(config.analyticsSessionCheckInterval) || DEFAULT_CONFIG.sessionCheckInterval,
    batchSize: Number(config.analyticsBatchSize) || DEFAULT_CONFIG.batchSize,
    maxRetries: Number(config.analyticsMaxRetries) || DEFAULT_CONFIG.maxRetries,
    autoTrackScrollDepth: config.analyticsTrackScrollDepth !== false,
    autoTrackTimeSpent: config.analyticsTrackTimeSpent !== false,
    autoTrackOutboundLinks: config.analyticsTrackOutboundLinks !== false,
    cleanAttributionUrl: config.analyticsCleanAttributionUrl !== false,
    cookieDomain: (config.analyticsCookieDomain as string | undefined) || undefined,
    urlQueryAllowlist: parseListConfig(config.analyticsUrlQueryAllowlist),
    exposeGlobals: config.analyticsExposeGlobals === true,
    integrations: parseObjectConfig(
      config.analyticsIntegrations,
    ) as AnalyticsConfig['integrations'],
    banner:
      config.analyticsBanner === false
        ? false
        : (parseObjectConfig(config.analyticsBanner) as AnalyticsConfig['banner']),
    respectGlobalPrivacyControl: config.analyticsRespectGpc !== false,
    // How consent is asked (choices, categories, trackingWithoutConsent, reloadOnWithdrawal).
    consent: parseObjectConfig(config.analyticsConsent) as AnalyticsConfig['consent'],
    // Consent-gated <script> tags: false to turn off, or options (nonce, allowedOrigins).
    gatedScripts:
      config.analyticsGatedScripts === false
        ? false
        : (parseObjectConfig(config.analyticsGatedScripts) as AnalyticsConfig['gatedScripts']),
    debug: config.analyticsDebug === true,
    nodeEnv: config.nodeEnv as string | undefined,
    websiteBaseUrl: config.websiteBaseUrl as string | undefined,
  }
}

// Note: This plugin should be imported as a client-only plugin in consuming projects
// Export as a client-only plugin with graceful error handling for missing Nuxt dependency
export default async (nuxtApp: any) => {
  try {
    // Dynamically import Nuxt composables to handle missing dependency
    const { useRuntimeConfig } = await import('nuxt/app' as any)

    // Get runtime config directly using Nuxt composables
    const config = useRuntimeConfig().public

    const analyticsConfig = nuxtAnalyticsConfig(config)

    // Debug logging for configuration loading
    if (analyticsConfig.debug) {
      if (analyticsConfig.googleAdsConversions) {
        debugLog(analyticsConfig, 'Google Ads conversions loaded from Nuxt config', {
          conversions: analyticsConfig.googleAdsConversions,
          conversionCount: Object.keys(analyticsConfig.googleAdsConversions).length,
        })
      } else {
        debugLog(analyticsConfig, 'No Google Ads conversions configured in Nuxt')
      }

      if (
        analyticsConfig.microsoftAdsGoals &&
        Object.keys(analyticsConfig.microsoftAdsGoals).length > 0
      ) {
        debugLog(analyticsConfig, 'Microsoft Ads goals loaded from Nuxt config', {
          goals: analyticsConfig.microsoftAdsGoals,
          goalCount: Object.keys(analyticsConfig.microsoftAdsGoals).length,
        })
      } else {
        debugLog(analyticsConfig, 'No Microsoft Ads goals configured in Nuxt')
      }

      if (analyticsConfig.openAIAdsPixelId) {
        debugLog(analyticsConfig, 'OpenAI Ads pixel loaded from Nuxt config', {
          hasPixelId: true,
          eventCount: analyticsConfig.openAIAdsEvents
            ? Object.keys(analyticsConfig.openAIAdsEvents).length
            : 0,
        })
      } else {
        debugLog(analyticsConfig, 'No OpenAI Ads pixel configured in Nuxt')
      }
    }

    debugLog(analyticsConfig, 'Nuxt analytics plugin initializing')
    debugLog(analyticsConfig, 'Configuration loaded', {
      apiBaseUrl: analyticsConfig.apiBaseUrl,
      eventSiteName: analyticsConfig.eventSiteName,
      debug: analyticsConfig.debug,
      openAIAdsPixelId: !!analyticsConfig.openAIAdsPixelId,
      chatRight: analyticsConfig.chatRight,
      chatBottom: analyticsConfig.chatBottom,
      chatTop: analyticsConfig.chatTop,
      chatLeft: analyticsConfig.chatLeft,
    })

    // Helper function to get current path (handles i18n and non-i18n cases)
    const getCurrentPath = () => {
      // In Nuxt, we can check if useLocalePath is available
      // If i18n module is installed, useLocalePath will be available
      try {
        // Try to access useLocalePath from globalThis (Nuxt makes composables available globally)
        const useLocalePath = (globalThis as any).useLocalePath
        if (typeof useLocalePath === 'function') {
          return useLocalePath()()
        }
      } catch {
        // useLocalePath not available, fall back to pathname
      }
      // Fallback to current pathname if i18n not available or on server
      if (typeof window === 'undefined') return '/'
      return window.location.pathname
    }

    // Create analytics with direct framework integration
    const adapter = {
      getConfig: () => analyticsConfig,
      getCurrentPath: getCurrentPath,
      getCurrentUrl: () => {
        if (typeof window === 'undefined') return ''
        return window.location.href
      },
      getReferrer: () => {
        if (typeof document === 'undefined') return ''
        return document.referrer
      },
      onRouteChange: (callback: (path: string) => void) => {
        const unsubscribe = nuxtApp.hook('page:start', () => {
          callback(getCurrentPath())
        })
        return () => unsubscribe()
      },
      onAppReady: (callback: () => void) => {
        nuxtApp.hook('app:mounted', callback)
      },
      onAppDestroy: () => () => {},
      getRouter: () => null,
    }

    const analytics = initAnalytics(analyticsConfig, adapter)

    // Provide analytics instance to Nuxt
    nuxtApp.provide('analytics', analytics)

    debugLog(analyticsConfig, 'Analytics instance created and provided to Nuxt')

    // Console helpers (window.ciAnalytics) are opt-in via analyticsExposeGlobals/analyticsDebug.
    // window.analytics is intentionally not set (it belongs to other tools, e.g. Segment).
  } catch {
    console.warn('🔍 [Analytics] Nuxt not available - analytics disabled')
    // Plugin failed to load due to missing Nuxt dependency
  }
}
