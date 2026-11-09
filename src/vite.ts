// Vite SPA wrapper for the shared analytics core
import { DEFAULT_CONFIG, getConsentBannerHTML } from './core'
import { initAnalytics } from './index'
import type { Analytics, AnalyticsConfig, FrameworkAdapter } from './types'
import { debugLog } from './types'

// Vite environment variable types
declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string
    readonly VITE_WEBSITE_BASE_URL?: string
    readonly VITE_EVENT_SITE_NAME?: string
    readonly VITE_GA_MEASUREMENT_ID?: string
    readonly VITE_GOOGLE_ADS_CONVERSIONS?: string
    readonly VITE_OPENAI_ADS_PIXEL_ID?: string
    readonly VITE_OPENAI_ADS_EVENTS?: string
    readonly VITE_OPENAI_ADS_DEBUG?: string
    readonly VITE_MICROSOFT_ADS_TAG_ID?: string
    readonly VITE_MICROSOFT_ADS_GOALS?: string
    readonly VITE_CHAT_ACCESS_KEY?: string
    readonly VITE_CHAT_API_BASE_URL?: string
    readonly VITE_CHAT_OPEN_ON_LOAD?: string
    readonly VITE_CHAT_POSITION?: string
    readonly VITE_CHAT_WIDTH?: string
    readonly VITE_CHAT_HEIGHT?: string
    readonly VITE_CHAT_TOP?: string
    readonly VITE_CHAT_RIGHT?: string
    readonly VITE_CHAT_BOTTOM?: string
    readonly VITE_CHAT_LEFT?: string
    readonly VITE_CHAT_DARK_MODE?: string
    readonly VITE_CHAT_FAB_SIZE?: string
    readonly VITE_CHAT_FAB_HIDE?: string
    readonly VITE_CHAT_ENABLED?: string
    readonly VITE_CHAT_WIDGET_URL?: string
    readonly VITE_CHAT_WIDGET_CSS_URL?: string
    readonly VITE_CHAT_USER_NAME?: string
    readonly VITE_CHAT_USER_EMAIL?: string
    readonly VITE_CHAT_USER_ID?: string
    readonly VITE_CHAT_CONTAINER?: string
    readonly VITE_CHAT_CONSENT_REQUIRED?: string
    readonly VITE_CHAT_CONSENT_GRANTED?: string
    readonly VITE_ANALYTICS_FLUSH_INTERVAL?: string
    readonly VITE_ANALYTICS_CONSENT_CHECK_INTERVAL?: string
    readonly VITE_ANALYTICS_SESSION_CHECK_INTERVAL?: string
    readonly VITE_ANALYTICS_BATCH_SIZE?: string
    readonly VITE_ANALYTICS_MAX_RETRIES?: string
    readonly VITE_ANALYTICS_TRACK_SCROLL_DEPTH?: string
    readonly VITE_ANALYTICS_TRACK_TIME_SPENT?: string
    readonly VITE_ANALYTICS_TRACK_OUTBOUND_LINKS?: string
    readonly VITE_ANALYTICS_DEBUG?: string
    readonly NODE_ENV?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

// Helper function to safely parse numeric environment variables
function parseNumberEnv(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined
  const num = Number(value)
  return !isNaN(num) ? num : undefined
}

// Vite SPA adapter for Vue Router
export function createViteAdapter(router?: any): FrameworkAdapter {
  return {
    getConfig(): AnalyticsConfig {
      // Use environment variables for Vite
      const debugEnabled = import.meta.env.VITE_ANALYTICS_DEBUG === 'true'

      // Parse Google Ads conversions JSON with debugging
      let googleAdsConversions: Record<string, string> | undefined
      if (import.meta.env.VITE_GOOGLE_ADS_CONVERSIONS) {
        try {
          googleAdsConversions = JSON.parse(import.meta.env.VITE_GOOGLE_ADS_CONVERSIONS)
          if (debugEnabled) {
            debugLog({ debug: debugEnabled }, 'Google Ads conversions loaded from JSON', {
              rawJson: import.meta.env.VITE_GOOGLE_ADS_CONVERSIONS,
              parsed: googleAdsConversions,
              conversionCount: googleAdsConversions ? Object.keys(googleAdsConversions).length : 0,
            })
          }
        } catch (error) {
          console.warn('🔍 [Analytics] Failed to parse VITE_GOOGLE_ADS_CONVERSIONS JSON:', error)
          googleAdsConversions = undefined
        }
      } else if (debugEnabled) {
        debugLog({ debug: debugEnabled }, 'No Google Ads conversions configured')
      }

      // Parse OpenAI Ads event mappings JSON with debugging
      let openAIAdsEvents: Record<string, any> | undefined
      if (import.meta.env.VITE_OPENAI_ADS_EVENTS) {
        try {
          openAIAdsEvents = JSON.parse(import.meta.env.VITE_OPENAI_ADS_EVENTS)
          if (debugEnabled) {
            debugLog({ debug: debugEnabled }, 'OpenAI Ads events loaded from JSON', {
              rawJson: import.meta.env.VITE_OPENAI_ADS_EVENTS,
              parsed: openAIAdsEvents,
              eventCount: openAIAdsEvents ? Object.keys(openAIAdsEvents).length : 0,
            })
          }
        } catch (error) {
          console.warn('🔍 [Analytics] Failed to parse VITE_OPENAI_ADS_EVENTS JSON:', error)
          openAIAdsEvents = undefined
        }
      } else if (debugEnabled) {
        debugLog({ debug: debugEnabled }, 'No OpenAI Ads events configured')
      }

      // Parse Microsoft Ads goals JSON with debugging
      let microsoftAdsGoals: Record<string, string> = {}
      if (import.meta.env.VITE_MICROSOFT_ADS_GOALS) {
        try {
          microsoftAdsGoals = JSON.parse(import.meta.env.VITE_MICROSOFT_ADS_GOALS)
          if (debugEnabled) {
            debugLog({ debug: debugEnabled }, 'Microsoft Ads goals loaded from JSON', {
              rawJson: import.meta.env.VITE_MICROSOFT_ADS_GOALS,
              parsed: microsoftAdsGoals,
              goalCount: Object.keys(microsoftAdsGoals).length,
            })
          }
        } catch (error) {
          console.warn('🔍 [Analytics] Failed to parse VITE_MICROSOFT_ADS_GOALS JSON:', error)
          microsoftAdsGoals = {}
        }
      } else if (debugEnabled) {
        debugLog({ debug: debugEnabled }, 'No Microsoft Ads goals configured')
      }

      return {
        apiBaseUrl: import.meta.env.VITE_API_BASE_URL || DEFAULT_CONFIG.apiBaseUrl,
        eventSiteName: import.meta.env.VITE_EVENT_SITE_NAME || 'vite-app',
        gaMeasurementId: import.meta.env.VITE_GA_MEASUREMENT_ID,
        googleAdsConversions,
        openAIAdsPixelId: import.meta.env.VITE_OPENAI_ADS_PIXEL_ID,
        openAIAdsEvents,
        openAIAdsDebug: import.meta.env.VITE_OPENAI_ADS_DEBUG === 'true',
        microsoftAdsTagId: import.meta.env.VITE_MICROSOFT_ADS_TAG_ID,
        chatAccessKey: import.meta.env.VITE_CHAT_ACCESS_KEY,
        chatApiBaseUrl: import.meta.env.VITE_CHAT_API_BASE_URL,
        chatOpenOnLoad:
          import.meta.env.VITE_CHAT_OPEN_ON_LOAD === 'true' ||
          import.meta.env.VITE_CHAT_OPEN_ON_LOAD === 'false'
            ? import.meta.env.VITE_CHAT_OPEN_ON_LOAD === 'true'
            : undefined,
        chatPosition: import.meta.env.VITE_CHAT_POSITION as
          'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | undefined,
        chatWidth: parseNumberEnv(import.meta.env.VITE_CHAT_WIDTH),
        chatHeight: parseNumberEnv(import.meta.env.VITE_CHAT_HEIGHT),
        chatTop: parseNumberEnv(import.meta.env.VITE_CHAT_TOP),
        chatRight: parseNumberEnv(import.meta.env.VITE_CHAT_RIGHT),
        chatBottom: parseNumberEnv(import.meta.env.VITE_CHAT_BOTTOM),
        chatLeft: parseNumberEnv(import.meta.env.VITE_CHAT_LEFT),
        chatDarkMode:
          import.meta.env.VITE_CHAT_DARK_MODE === 'true' ||
          import.meta.env.VITE_CHAT_DARK_MODE === 'false'
            ? import.meta.env.VITE_CHAT_DARK_MODE === 'true'
            : undefined,
        chatFabSize: parseNumberEnv(import.meta.env.VITE_CHAT_FAB_SIZE),
        chatFabHide:
          import.meta.env.VITE_CHAT_FAB_HIDE === 'true' ||
          import.meta.env.VITE_CHAT_FAB_HIDE === 'false'
            ? import.meta.env.VITE_CHAT_FAB_HIDE === 'true'
            : undefined,
        chatEnabled: import.meta.env.VITE_CHAT_ENABLED !== 'false',
        chatWidgetUrl: import.meta.env.VITE_CHAT_WIDGET_URL,
        chatWidgetCssUrl: import.meta.env.VITE_CHAT_WIDGET_CSS_URL,
        chatUserName: import.meta.env.VITE_CHAT_USER_NAME,
        chatUserEmail: import.meta.env.VITE_CHAT_USER_EMAIL,
        chatUserId: import.meta.env.VITE_CHAT_USER_ID,
        chatContainer: import.meta.env.VITE_CHAT_CONTAINER,
        chatConsentRequired:
          import.meta.env.VITE_CHAT_CONSENT_REQUIRED === 'true' ||
          import.meta.env.VITE_CHAT_CONSENT_REQUIRED === 'false'
            ? import.meta.env.VITE_CHAT_CONSENT_REQUIRED === 'true'
            : undefined,
        chatConsentGranted:
          import.meta.env.VITE_CHAT_CONSENT_GRANTED === 'true' ||
          import.meta.env.VITE_CHAT_CONSENT_GRANTED === 'false'
            ? import.meta.env.VITE_CHAT_CONSENT_GRANTED === 'true'
            : undefined,
        microsoftAdsGoals,
        flushInterval:
          Number(import.meta.env.VITE_ANALYTICS_FLUSH_INTERVAL) || DEFAULT_CONFIG.flushInterval,
        consentCheckInterval:
          Number(import.meta.env.VITE_ANALYTICS_CONSENT_CHECK_INTERVAL) ||
          DEFAULT_CONFIG.consentCheckInterval,
        sessionCheckInterval:
          Number(import.meta.env.VITE_ANALYTICS_SESSION_CHECK_INTERVAL) ||
          DEFAULT_CONFIG.sessionCheckInterval,
        batchSize: Number(import.meta.env.VITE_ANALYTICS_BATCH_SIZE) || DEFAULT_CONFIG.batchSize,
        maxRetries: Number(import.meta.env.VITE_ANALYTICS_MAX_RETRIES) || DEFAULT_CONFIG.maxRetries,
        autoTrackScrollDepth: import.meta.env.VITE_ANALYTICS_TRACK_SCROLL_DEPTH !== 'false',
        autoTrackTimeSpent: import.meta.env.VITE_ANALYTICS_TRACK_TIME_SPENT !== 'false',
        autoTrackOutboundLinks: import.meta.env.VITE_ANALYTICS_TRACK_OUTBOUND_LINKS !== 'false',
        debug: debugEnabled,
        nodeEnv: import.meta.env.NODE_ENV,
      }
    },

    getCurrentPath(): string {
      if (typeof window === 'undefined') return '/'
      return window.location.pathname
    },

    getCurrentUrl(): string {
      if (typeof window === 'undefined') return ''
      return window.location.href
    },

    getReferrer(): string {
      if (typeof document === 'undefined') return ''
      return document.referrer
    },

    onRouteChange(callback: (path: string) => void) {
      if (!router) {
        // Fallback: listen to popstate events
        const handler = () => callback(window.location.pathname)
        window.addEventListener('popstate', handler)
        return () => window.removeEventListener('popstate', handler)
      }

      // Vue Router afterEach
      const unsubscribe = router.afterEach((to: any) => {
        callback(to.path)
      })

      return unsubscribe
    },

    onAppReady(callback: () => void) {
      // For SPA, call immediately when DOM is ready
      if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', callback)
        } else {
          // DOM already loaded
          setTimeout(callback, 0)
        }
      }
    },

    onAppDestroy(callback: () => void) {
      // For SPA, listen to beforeunload
      if (typeof window !== 'undefined') {
        const handler = () => callback()
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
      }
      return () => {}
    },

    showConsentBanner(onAccept: () => void, onReject: () => void) {
      if (typeof document === 'undefined') return

      // Check if banner already exists
      if (document.getElementById('ci-consent-banner')) {
        return
      }

      const banner = document.createElement('div')
      banner.id = 'ci-consent-banner'
      banner.innerHTML = getConsentBannerHTML(import.meta.env.VITE_WEBSITE_BASE_URL || '')

      document.body.appendChild(banner)

      // Add event listeners
      document.getElementById('ci-consent-accept')?.addEventListener('click', () => {
        document.body.removeChild(banner)
        onAccept()
      })

      document.getElementById('ci-consent-reject')?.addEventListener('click', () => {
        document.body.removeChild(banner)
        onReject()
      })
    },

    getRouter() {
      return router
    },
  }
}

// Initialize analytics for Vite SPA
export function initViteAnalytics(router?: any): Analytics {
  const adapter = createViteAdapter(router)
  const config = adapter.getConfig()

  debugLog(config, 'Vite analytics initializing')

  debugLog(config, 'Vite analytics configuration loaded', {
    apiBaseUrl: config.apiBaseUrl,
    eventSiteName: config.eventSiteName,
    debug: config.debug,
    gaMeasurementId: !!config.gaMeasurementId,
    openAIAdsPixelId: !!config.openAIAdsPixelId,
    microsoftAdsTagId: !!config.microsoftAdsTagId,
    chatAccessKey: !!config.chatAccessKey,
    chatRight: config.chatRight,
    chatBottom: config.chatBottom,
    chatTop: config.chatTop,
    chatLeft: config.chatLeft,
    hasRouter: !!router,
  })

  const analytics = initAnalytics(config, adapter)

  // Set up route change tracking (initAnalytics handles initial page view)
  const unsubscribeRouteChange = adapter.onRouteChange((path: string) => {
    analytics.trackEvent('page_view', {
      path,
      url: adapter.getCurrentUrl(),
      referrer: adapter.getReferrer(),
    })
  })

  // Clean up on app destroy
  adapter.onAppDestroy(() => {
    unsubscribeRouteChange()
    analytics.flush()
  })

  // Expose globally for development
  if (typeof window !== 'undefined') {
    ;(window as any).analytics = analytics
  }

  debugLog(config, 'Vite analytics initialization complete')
  return analytics
}

// Vue composable for using analytics in components
export function useAnalytics(): Analytics {
  if (typeof window === 'undefined' || !(window as any).analytics) {
    throw new Error('Analytics not initialized. Call initViteAnalytics() first.')
  }
  return (window as any).analytics
}
