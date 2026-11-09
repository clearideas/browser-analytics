// Nuxt wrapper for the shared analytics core
import { DEFAULT_CONFIG, getConsentBannerHTML } from './core'
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

// Note: This plugin should be imported as a client-only plugin in consuming projects
// Export as a client-only plugin with graceful error handling for missing Nuxt dependency
export default async (nuxtApp: any) => {
  try {
    // Dynamically import Nuxt composables to handle missing dependency
    const { useRuntimeConfig } = await import('nuxt/app' as any)

    // Get runtime config directly using Nuxt composables
    const config = useRuntimeConfig().public

    const analyticsConfig: AnalyticsConfig = {
      apiBaseUrl: (config.apiBaseUrl as string) || DEFAULT_CONFIG.apiBaseUrl,
      eventSiteName: (config.eventSiteName as string) || 'nuxt-app',
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
        config.chatFabHide === true || config.chatFabHide === false
          ? config.chatFabHide
          : undefined,
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
      debug: config.analyticsDebug === true,
      nodeEnv: config.nodeEnv as string | undefined,
      websiteBaseUrl: config.websiteBaseUrl as string | undefined,
    }

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
      showConsentBanner: (onAccept: () => void, onReject: () => void) => {
        debugLog(analyticsConfig, 'showConsentBanner called')

        // Consent banner implementation - only run on client-side
        if (typeof window === 'undefined' || typeof document === 'undefined') {
          debugLog(analyticsConfig, 'Cannot show banner: window or document not available')
          return
        }

        // Check if body exists
        if (!document.body) {
          debugLog(analyticsConfig, 'Cannot show banner: document.body not available')
          return
        }

        if (document.getElementById('ci-consent-banner')) {
          debugLog(analyticsConfig, 'Banner already exists, skipping')
          return
        }

        try {
          debugLog(analyticsConfig, 'Creating consent banner')

          const banner = document.createElement('div')
          banner.id = 'ci-consent-banner'
          banner.style.position = 'fixed'
          banner.style.bottom = '0'
          banner.style.left = '0'
          banner.style.right = '0'
          banner.style.zIndex = '1000'
          banner.style.padding = '0'
          banner.innerHTML = getConsentBannerHTML(config.websiteBaseUrl as string)

          document.body.appendChild(banner)
          debugLog(analyticsConfig, 'Consent banner added to DOM')

          const acceptBtn = document.getElementById('ci-consent-accept')
          const rejectBtn = document.getElementById('ci-consent-reject')

          if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
              debugLog(analyticsConfig, 'Consent accepted')
              document.body.removeChild(banner)
              onAccept()
            })
          } else {
            console.warn(`🔍 [Analytics] Accept button not found`)
          }

          if (rejectBtn) {
            rejectBtn.addEventListener('click', () => {
              debugLog(analyticsConfig, 'Consent rejected')
              document.body.removeChild(banner)
              onReject()
            })
          } else {
            console.warn(`🔍 [Analytics] Reject button not found`)
          }

          debugLog(analyticsConfig, 'Consent banner setup complete')
        } catch (error) {
          console.error(`🔍 [Analytics] Error creating consent banner:`, error)
        }
      },
      getRouter: () => null,
    }

    const analytics = initAnalytics(analyticsConfig, adapter)

    // Provide analytics instance to Nuxt
    nuxtApp.provide('analytics', analytics)

    debugLog(analyticsConfig, 'Analytics instance created and provided to Nuxt')

    // DEBUG: Consent banner testing is now available via window.showCookieBanner()
    // Removed forced banner display to prevent interfering with geo-based consent logic

    // Expose globally for development
    if (typeof window !== 'undefined') {
      ;(window as any).analytics = analytics
    }
  } catch {
    console.warn('🔍 [Analytics] Nuxt not available - analytics disabled')
    // Plugin failed to load due to missing Nuxt dependency
  }
}
