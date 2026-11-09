// Main analytics module - exports the core functionality
export * from './attribution'
export * from './consent'
export * from './core'
export * from './integrations'
export * from './storage'
export * from './tracking'
export * from './types'

// Factory function to create analytics instance
import {
  captureInitialAttribution,
  cleanAttributionFromUrl,
  getAttributionContext,
  setAttributionCookie,
  updateAttributionLastSeen,
} from './attribution'
import { getConsent, getConsentStatus, setConsent as setConsentUtil } from './consent'
import { resolveCookieDomain } from './cookie-domain'
import {
  getConnectionType,
  getDeviceBucket,
  getViewportBucket,
  normalizeOutboundLink,
  sanitizeAnalyticsText,
} from './core'
import {
  initializeClearIdeasChat,
  initializeGTag,
  initializeOpenAIAdsPixel,
  initializeUET,
  trackIntegratedEvent,
  trackUETConversion,
  trackUETEvent,
  updateChatConsent,
} from './integrations'
import {
  clearAttributionDataForGDPR,
  getGeoContext,
  getLocalConsentStatus,
  isDontTrackOwnerEnabled,
  setDontTrackOwner,
  setGeoContext,
} from './storage'
import { flushEvents, initializeEventQueue, stopFlushTimer, trackEvent } from './tracking'
import type { Analytics, AnalyticsConfig, FrameworkAdapter } from './types'
import { debugLog } from './types'
import { disableConsoleDebug, enableConsoleDebug, getConsoleDebugStatus } from './types'

// Session management with server API calls
async function manageSession(config: AnalyticsConfig): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const sessionData = localStorage.getItem('ci_session_status')
    const now = Date.now()
    let lastSessionCheck = 0

    if (sessionData) {
      try {
        lastSessionCheck = JSON.parse(sessionData).timestamp || 0
      } catch {
        // Error parsing session data
      }
    }

    // Only call session API if we haven't done so recently
    if (!sessionData || now - lastSessionCheck > config.sessionCheckInterval) {
      const SESSION_URL = `${config.apiBaseUrl.replace(/\/$/, '')}/event/session`

      // Add timeout to session API call
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

      try {
        const response = await fetch(SESSION_URL, {
          credentials: 'include',
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (response.ok) {
          const data = await response.json()
          // Update session timestamp and user info
          localStorage.setItem(
            'ci_session_status',
            JSON.stringify({
              timestamp: now,
              userId: data.userId,
            }),
          )
        } else {
          debugLog(config, 'Session API failed', { status: response.status })
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          debugLog(config, 'Session API timeout')
        } else {
          debugLog(config, 'Session API error', { error: fetchError.message })
        }
      }
    }
  } catch {
    debugLog(config, 'Error managing session')
  }
}

// Check if consent is required based on user's geo location
function isConsentRequired(): boolean {
  if (typeof window === 'undefined') return true // Default to requiring consent on server

  try {
    const geoData = getGeoContext()
    if (geoData) {
      const age = Date.now() - (geoData.timestamp || 0)
      // Use cached geo data if less than 24 hours old
      if (age < 24 * 60 * 60 * 1000) {
        return geoData.requiresConsent === true
      }
    }
  } catch {
    // Ignore storage errors
  }

  return true // Default to requiring consent if unknown
}

// Fetch geo context from server
async function fetchGeoContext(config: AnalyticsConfig): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const geoResponse = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/event/geo`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    if (!geoResponse.ok) {
      throw new Error('Geo API failed')
    }

    const geoData = await geoResponse.json()

    // Store non-PII location data for client-side analytics use
    if (geoData.country && geoData.continent) {
      try {
        setGeoContext({
          country: geoData.country,
          continent: geoData.continent,
          requiresConsent: geoData.requiresConsent,
          cached: geoData.cached,
        })
      } catch {
        // Ignore storage errors - geo data will be refetched as needed
      }
    }
  } catch {
    debugLog(config, 'Error fetching geo context')
    // Fallback: assume consent required for safety
  }
}

export function createAnalytics(config: AnalyticsConfig, adapter: FrameworkAdapter): Analytics {
  // Initialize event queue

  initializeEventQueue(config)

  // Track event wrapper
  const trackEventWrapper = async (name: string, props: Record<string, any> = {}) => {
    debugLog(config, 'trackEventWrapper called', { eventName: name, props })

    // Check if owner tracking is disabled
    if (isDontTrackOwnerEnabled()) {
      debugLog(config, 'Owner tracking disabled, skipping event', {
        eventName: name,
      })
      return
    }

    // Add attribution context to events (GDPR compliant)
    // Attribution data includes UTM parameters from initial landing page
    const attributionContext = getAttributionContext()
    if (attributionContext) {
      props.attribution = attributionContext
      // Include all UTM/internal campaign variants directly in event data for easy access
      for (const [key, value] of Object.entries(attributionContext)) {
        if (typeof value !== 'string' || !value) continue
        if (key.startsWith('utm_') || key.startsWith('ci_')) {
          props[key] = value
        }
      }
      if (attributionContext.gclid) props.gclid = attributionContext.gclid
      if (attributionContext.msclkid) props.msclkid = attributionContext.msclkid
    }

    debugLog(config, 'Sending event to main API', { eventName: name })

    // Get consent status once and reuse it to avoid duplicate network calls
    const consentStatus = await getConsentStatus(config)
    const consentRequired = isConsentRequired()
    const hasExplicitConsent = consentStatus.consented === true
    const allowThirdPartyTracking = !consentRequired || hasExplicitConsent

    debugLog(config, 'Consent status for tracking', {
      hasExplicitConsent,
      consentRequired,
      allowThirdPartyTracking,
      consentStatus,
    })

    // Track with our system - pass consent status to avoid another lookup
    await trackEvent(config, name, props, undefined, consentStatus)

    // Track with integrated platforms
    debugLog(config, 'Consent for integrated tracking', {
      consent: allowThirdPartyTracking,
      consentRequired,
      hasExplicitConsent,
    })
    trackIntegratedEvent(config, name, props, allowThirdPartyTracking)
  }

  // Error tracking wrapper
  const trackErrorWrapper = (message: string, props: Record<string, any> = {}) => {
    trackEventWrapper('error', { message, ...props })
  }

  // Complete consent banner implementation
  const showConsentBanner = () => {
    // Check if banner already exists (avoid duplicates)
    if (typeof document !== 'undefined' && document.getElementById('ci-consent-banner')) {
      return
    }

    // Create wrapper div for Vuetify components
    const banner = document.createElement('div')
    banner.id = 'ci-consent-banner'

    // Apply Vuetify-like styles
    banner.style.position = 'fixed'
    banner.style.bottom = '0'
    banner.style.left = '0'
    banner.style.right = '0'
    banner.style.zIndex = '1000'
    banner.style.padding = '0'

    let privacyPolicyUrl = '/privacy'
    if (typeof config.websiteBaseUrl === 'string' && config.websiteBaseUrl.trim().length > 0) {
      try {
        const parsedBase =
          typeof window !== 'undefined'
            ? new URL(config.websiteBaseUrl, window.location.origin)
            : new URL(config.websiteBaseUrl)
        if (parsedBase.protocol === 'http:' || parsedBase.protocol === 'https:') {
          const normalizedBase = parsedBase.href.endsWith('/')
            ? parsedBase.href
            : `${parsedBase.href}/`
          privacyPolicyUrl = new URL('privacy', normalizedBase).href
        }
      } catch {
        // Fall back to relative privacy URL for invalid or untrusted base URLs.
      }
    }

    // Set banner content with Vuetify classes
    banner.innerHTML = `
      <div class="v-sheet v-sheet--elevation-3" style="border-radius: 0; padding: 16px; background-color: rgb(var(--v-theme-surface));">
        <div class="d-flex align-center justify-space-between flex-column flex-md-row" style="gap: 12px; max-width: 1600px; margin: 0 auto;">
          <div class="flex-grow-1 flex-shrink-1 text-body-2">
            <p class="font-weight-semibold mb-1">Help us improve your experience</p>
            <p>We use cookies and similar technologies to keep our site secure, operate essential features, analyze traffic, and improve content and advertising. Select "Accept All" to allow every cookie, or choose "Reject non-essential" to permit only those required for the site to function. Learn more in our
            <a href="${privacyPolicyUrl}" class="text-decoration-none font-weight-medium" style="color: rgb(var(--v-theme-primary));">Privacy Policy</a>.</p>
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

    document.body.appendChild(banner)

    // Add event listeners
    const acceptBtn = document.getElementById('ci-consent-accept')
    const rejectBtn = document.getElementById('ci-consent-reject')

    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        debugLog(config, 'Consent accepted - setting consent to true')
        await setConsentUtil(config, true)
        document.body.removeChild(banner)
        // Initialize third-party tracking
        initializeGTag(config, true)
        initializeUET(config, true)
        initializeOpenAIAdsPixel(config, true)
        // Chat is initialized regardless of consent (functional service)
        await initializeClearIdeasChat(config)
        // Update chat widget consent state to reflect granted consent
        updateChatConsent(config)
      })
    }

    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        debugLog(config, 'Consent rejected - setting consent to false')
        await setConsentUtil(config, false)
        document.body.removeChild(banner)

        // GDPR: Clear attribution data when consent is withdrawn
        clearAttributionDataForGDPR()

        // Initialize third-party tracking without consent
        initializeGTag(config, false)
        initializeUET(config, false)
        initializeOpenAIAdsPixel(config, false)
        // Chat is still available (functional service, not tracking)
        await initializeClearIdeasChat(config)
        // Update chat widget consent state to reflect rejected consent
        updateChatConsent(config)
      })
    }
  }

  // Consent banner wrapper for backward compatibility
  const showConsentBannerWrapper = () => {
    showConsentBanner()
  }

  // Auto-tracking functionality
  const startAutoTracking = () => {
    debugLog(config, 'Starting auto-tracking')
    debugLog(config, 'Auto-tracking config', {
      autoTrackScrollDepth: config.autoTrackScrollDepth,
      autoTrackTimeSpent: config.autoTrackTimeSpent,
      autoTrackOutboundLinks: config.autoTrackOutboundLinks,
    })

    // GDPR: Only capture attribution if consent not required OR consent provided
    if (typeof window !== 'undefined') {
      const consentRequired = isConsentRequired()
      // Use cached local consent status (don't make network call during init)
      const localConsent = getLocalConsentStatus()
      const hasConsent = consentRequired ? localConsent.consented === true : true

      debugLog(config, 'GDPR attribution check', {
        consentRequired,
        hasConsent,
        localConsentStatus: localConsent.consented,
        willCaptureAttribution: !consentRequired || hasConsent,
      })

      if (!consentRequired || hasConsent) {
        const cleanUrl = cleanAttributionFromUrl()
        const hasAttributionInCurrentUrl = cleanUrl !== window.location.href

        // Consent given or not required - capture attribution
        const attributionData = captureInitialAttribution(config)
        if (attributionData) {
          // Set attribution cookie for cross-subdomain access
          const domainOverride = resolveCookieDomain(window.location.hostname)
          setAttributionCookie(attributionData, domainOverride ?? undefined)

          // Clean URL by removing attribution parameters
          if (config.cleanAttributionUrl !== false && hasAttributionInCurrentUrl) {
            window.history.replaceState({}, '', cleanUrl)
            debugLog(config, 'Cleaned attribution parameters from URL')
          }
        }

        // Update last seen timestamp for existing attribution
        updateAttributionLastSeen()
      } else {
        debugLog(config, 'GDPR: Skipping attribution capture - consent not provided')
      }
    }

    // Clear Ideas Chat initialization is handled in consent management (see consent banner)

    let pageStartTime = Date.now()
    let pageExitTracked = false
    let timeSpentTracked = false
    let maxScrollDepth = 0
    let clickCount = 0
    let keypressCount = 0

    const getPageContext = () => {
      const title =
        typeof document !== 'undefined' ? sanitizeAnalyticsText(document.title) : undefined
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : undefined
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''

      return {
        url: adapter.getCurrentUrl(),
        path: adapter.getCurrentPath(),
        referrer: adapter.getReferrer(),
        title,
        pageTitle: title,
        viewportBucket:
          typeof viewportWidth === 'number' ? getViewportBucket(viewportWidth) : undefined,
        deviceBucket: getDeviceBucket(userAgent, viewportWidth),
        connectionType: getConnectionType(),
      }
    }

    const resetPageState = () => {
      pageStartTime = Date.now()
      pageExitTracked = false
      timeSpentTracked = false
      maxScrollDepth = 0
      clickCount = 0
      keypressCount = 0
    }

    const trackPageExit = (
      pageContext = getPageContext(),
      timeSpentSeconds = Math.round((Date.now() - pageStartTime) / 1000),
      interactionState = {
        clicks: clickCount,
        keypresses: keypressCount,
        maxScrollDepth,
      },
    ) => {
      if (pageExitTracked) return
      pageExitTracked = true

      trackEventWrapper('page_exit', {
        ...pageContext,
        timeSpent: timeSpentSeconds,
        timeSpentTotal: timeSpentSeconds,
        clicks: interactionState.clicks,
        keypresses: interactionState.keypresses,
        maxScrollDepth: interactionState.maxScrollDepth,
      })
    }

    const trackCurrentPageExit = () => {
      trackPageExit()
    }

    // Track initial page view
    const pageViewData = getPageContext()

    debugLog(config, 'Sending initial page view', pageViewData)
    trackEventWrapper('page_view', pageViewData)

    // Set up route change tracking
    adapter.onRouteChange((path: string) => {
      debugLog(config, 'Route changed', { path })

      const exitingPageContext = getPageContext()
      const exitingTimeSpent = Math.round((Date.now() - pageStartTime) / 1000)
      const exitingInteractionState = {
        clicks: clickCount,
        keypresses: keypressCount,
        maxScrollDepth,
      }

      trackPageExit(exitingPageContext, exitingTimeSpent, exitingInteractionState)
      resetPageState()
      const nextPageContext = getPageContext()
      debugLog(config, 'Sending route page view', nextPageContext)
      trackEventWrapper('page_view', nextPageContext)
    })

    // Auto-track scroll depth if enabled
    if (config.autoTrackScrollDepth && typeof window !== 'undefined') {
      let throttleTimer: number | null = null
      const throttleDelay = 250 // Throttle scroll events to fire at most every 250ms

      const trackScrollDepth = () => {
        // Cancel previous timer to prevent multiple queued calls
        if (throttleTimer !== null) {
          window.clearTimeout(throttleTimer)
        }

        // Set timer to throttle execution
        throttleTimer = window.setTimeout(() => {
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop
          const windowHeight = window.innerHeight
          const documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
          )

          const scrollDepth = Math.round(((scrollTop + windowHeight) / documentHeight) * 100)

          if (scrollDepth > maxScrollDepth && scrollDepth >= 25) {
            maxScrollDepth = scrollDepth
            trackEventWrapper('scroll_depth', {
              depth: scrollDepth,
              path: adapter.getCurrentPath(),
            })
          }

          throttleTimer = null
        }, throttleDelay)
      }

      window.addEventListener('scroll', trackScrollDepth, { passive: true })
    }

    // Auto-track time spent if enabled
    if (config.autoTrackTimeSpent && typeof window !== 'undefined') {
      const trackTimeSpent = () => {
        if (timeSpentTracked) return

        const timeSpent = Math.round((Date.now() - pageStartTime) / 1000)
        if (timeSpent >= 30) {
          // Track after 30 seconds
          trackEventWrapper('time_spent', {
            duration: timeSpent,
            timeSpent,
            clicks: clickCount,
            keypresses: keypressCount,
            maxScrollDepth,
            ...getPageContext(),
          })
          timeSpentTracked = true
        }
      }

      // Track time spent on visibility change (tab switch, minimize, etc.)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          trackTimeSpent()
        } else {
          // Reset timer when returning to page
          timeSpentTracked = false
        }
      })

      // Track on page unload
      window.addEventListener('beforeunload', trackTimeSpent)
    }

    // Auto-track outbound links if enabled
    if (config.autoTrackOutboundLinks && typeof document !== 'undefined') {
      const handleOutboundLink = (event: Event) => {
        const target = (event.target as HTMLElement | null)?.closest?.('a')
        if (!target || target.tagName !== 'A') return

        const href = target.getAttribute('href')
        const normalizedHref = href?.trim().toLowerCase()
        if (
          !normalizedHref ||
          normalizedHref.startsWith('#') ||
          normalizedHref.startsWith('javascript:') ||
          normalizedHref.startsWith('data:') ||
          normalizedHref.startsWith('vbscript:')
        ) {
          return
        }

        const normalized = normalizeOutboundLink(href ?? normalizedHref, window.location.origin)
        if (!normalized) return

        trackEventWrapper('outbound_link_click', {
          ...normalized,
          outboundText: sanitizeAnalyticsText(target.textContent),
          clicks: clickCount,
          keypresses: keypressCount,
          ...getPageContext(),
        })
      }

      document.addEventListener('click', handleOutboundLink)
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('click', () => {
        clickCount += 1
      })

      document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return
        keypressCount += 1
      })
    }

    // Auto-track page exit
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Track on page unload (user closes tab, navigates away, etc.)
      window.addEventListener('beforeunload', trackCurrentPageExit)

      // Also track on page visibility change to hidden (tab switch, minimize)
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            trackCurrentPageExit()
          }
        })
      }
    }

    // Auto-track web vitals
    if (typeof window !== 'undefined' && typeof PerformanceObserver !== 'undefined') {
      // Track Largest Contentful Paint (LCP)
      try {
        const lcpObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          const lastEntry = entries[entries.length - 1]
          if (lastEntry) {
            trackEventWrapper('web_vital', {
              name: 'LCP',
              value: Math.round(lastEntry.startTime),
              ...getPageContext(),
            })
          }
        })
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })
      } catch {
        debugLog(config, 'LCP observer not supported')
      }

      // Track First Input Delay (FID)
      try {
        const fidObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            trackEventWrapper('web_vital', {
              name: 'FID',
              value: Math.round(entry.processingStart - entry.startTime),
              ...getPageContext(),
            })
          })
        })
        fidObserver.observe({ entryTypes: ['first-input'] })
      } catch {
        debugLog(config, 'FID observer not supported')
      }

      // Track Cumulative Layout Shift (CLS)
      try {
        let clsValue = 0
        const clsObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            if (!entry.hadRecentInput) {
              clsValue += entry.value
            }
          })
        })
        clsObserver.observe({ entryTypes: ['layout-shift'] })

        // Report CLS on page visibility change or before unload
        const reportCLS = () => {
          if (clsValue > 0) {
            trackEventWrapper('web_vital', {
              name: 'CLS',
              value: Math.round(clsValue * 1000) / 1000, // Round to 3 decimal places
              ...getPageContext(),
            })
          }
        }

        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
              reportCLS()
            }
          })
        }
        window.addEventListener('beforeunload', reportCLS)
      } catch {
        debugLog(config, 'CLS observer not supported')
      }

      // Track First Contentful Paint (FCP)
      try {
        const fcpObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            trackEventWrapper('web_vital', {
              name: 'FCP',
              value: Math.round(entry.startTime),
              ...getPageContext(),
            })
          })
        })
        fcpObserver.observe({ entryTypes: ['paint'] })
      } catch {
        debugLog(config, 'FCP observer not supported')
      }

      // Track Time to First Byte (TTFB)
      try {
        const navigationObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            const ttfb = entry.responseStart - entry.requestStart
            if (ttfb > 0) {
              trackEventWrapper('web_vital', {
                name: 'TTFB',
                value: Math.round(ttfb),
                ...getPageContext(),
              })
            }
          })
        })
        navigationObserver.observe({ entryTypes: ['navigation'] })
      } catch {
        debugLog(config, 'TTFB observer not supported')
      }
    }

    // Auto-track additional metrics
    if (typeof window !== 'undefined') {
      const toNonNegativeMetric = (value: number): number | undefined => {
        if (!Number.isFinite(value)) return undefined
        return Math.max(0, Math.round(value))
      }

      // Track page load metrics when DOM is ready
      const trackPageLoadMetrics = () => {
        const metrics: Record<string, any> = {
          ...getPageContext(),
          clicks: clickCount,
          keypresses: keypressCount,
          maxScrollDepth,
        }

        // Track navigation timing
        const navigation = performance.getEntriesByType(
          'navigation',
        )[0] as PerformanceNavigationTiming
        if (navigation) {
          const domContentLoadedTime = toNonNegativeMetric(
            navigation.domContentLoadedEventEnd - navigation.fetchStart,
          )
          const domInteractiveTime = toNonNegativeMetric(
            navigation.domInteractive - navigation.fetchStart,
          )

          if (domContentLoadedTime !== undefined) {
            metrics.domContentLoadedTime = domContentLoadedTime
          }
          if (domInteractiveTime !== undefined) {
            metrics.domInteractiveTime = domInteractiveTime
          }
        }

        // Track viewport and screen information
        if (typeof screen !== 'undefined') {
          metrics.screenWidth = screen.width
          metrics.screenHeight = screen.height
          metrics.colorDepth = screen.colorDepth
          metrics.pixelRatio = window.devicePixelRatio || 1
          metrics.viewportWidth = window.innerWidth
          metrics.viewportHeight = window.innerHeight
        }

        // Track network information if available
        if ('connection' in navigator) {
          const connection = (navigator as any).connection
          if (connection) {
            metrics.connectionType = connection.effectiveType
            metrics.downlink = connection.downlink
            metrics.rtt = connection.rtt
            metrics.saveData = connection.saveData
          }
        }

        // Track memory information if available (Chrome only)
        if ('memory' in performance) {
          const memory = (performance as any).memory
          if (memory) {
            metrics.jsHeapSizeLimit = memory.jsHeapSizeLimit
            metrics.totalJSHeapSize = memory.totalJSHeapSize
            metrics.usedJSHeapSize = memory.usedJSHeapSize
          }
        }

        // Track resource loading metrics
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
        if (resources.length > 0) {
          metrics.totalResources = resources.length
          metrics.cachedResources = resources.filter(r => (r as any).transferSize === 0).length
          metrics.totalTransferSize = resources.reduce(
            (sum, r) => sum + ((r as any).transferSize || 0),
            0,
          )
          metrics.totalEncodedSize = resources.reduce(
            (sum, r) => sum + ((r as any).encodedBodySize || 0),
            0,
          )
          metrics.totalDecodedSize = resources.reduce(
            (sum, r) => sum + ((r as any).decodedBodySize || 0),
            0,
          )
        }

        // Send all metrics in a single event
        trackEventWrapper('auto_metrics', metrics)
      }

      // Track metrics when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', trackPageLoadMetrics)
      } else {
        // DOM is already ready
        trackPageLoadMetrics()
      }

      // Track metrics on page load complete
      window.addEventListener('load', () => {
        // Additional load-time metrics - send as a separate event since it happens later
        setTimeout(() => {
          const metrics: Record<string, any> = {
            ...getPageContext(),
            fullyLoadedTime: Math.round(performance.now()),
          }

          const navigation = performance.getEntriesByType(
            'navigation',
          )[0] as PerformanceNavigationTiming
          if (navigation) {
            const pageLoadTime = toNonNegativeMetric(
              navigation.loadEventEnd - navigation.fetchStart,
            )
            if (pageLoadTime !== undefined) {
              metrics.pageLoadTime = pageLoadTime
            }
          }

          trackEventWrapper('auto_metrics', metrics)
        }, 0)
      })
    }

    debugLog(config, 'Auto-tracking fully initialized')

    // Handle session management asynchronously (don't block tracking)
    if (typeof window !== 'undefined') {
      manageSession(config)
    }
  }

  const stopAutoTracking = () => {
    // Note: Cleanup would need to be implemented to properly remove event listeners
    // For now, this is a placeholder
    debugLog(config, 'Auto-tracking stopped')
  }

  return {
    trackEvent: trackEventWrapper,
    trackError: trackErrorWrapper,
    trackUETEvent,
    trackUETConversion,
    flush: () => flushEvents(config),
    getConsentStatus: () => getConsent(config),
    showConsentBanner: showConsentBannerWrapper,
    startAutoTracking,
    stopAutoTracking,
  }
}

// Owner tracking management functions
export function getDontTrackOwnerStatus(): {
  enabled: boolean
  instructions: string
} {
  const enabled = isDontTrackOwnerEnabled()
  const instructions = enabled
    ? 'To enable tracking again, run: enableOwnerTracking()'
    : 'To disable tracking, run: disableOwnerTracking()'

  return { enabled, instructions }
}

// Composable for accessing attribution data in Vue components
export function useAttributionContext() {
  return getAttributionContext()
}

// Global function exposure for development and debugging
function exposeGlobalFunctions(analytics: Analytics) {
  if (typeof window !== 'undefined') {
    // Owner tracking management - available globally for website owners
    ;(window as any).disableOwnerTracking = () => {
      setDontTrackOwner(true)
      debugLog({ debug: true }, 'Owner tracking disabled. Your visits will not be tracked.')
      return getDontTrackOwnerStatus()
    }
    ;(window as any).enableOwnerTracking = () => {
      setDontTrackOwner(false)
      debugLog({ debug: true }, 'Owner tracking enabled. Your visits will be tracked normally.')
      return getDontTrackOwnerStatus()
    }
    ;(window as any).ownerTrackingStatus = () => {
      const status = getDontTrackOwnerStatus()
      debugLog({ debug: true }, `Owner tracking is ${status.enabled ? 'DISABLED' : 'ENABLED'}`)
      debugLog({ debug: true }, status.instructions)
      return status
    }

    // Analytics instance for debugging
    ;(window as any).analytics = analytics

    // Show cookie banner function for testing
    ;(window as any).showCookieBanner = () => analytics.showConsentBanner()

    // Attribution context accessor
    ;(window as any).getAttributionContext = () => getAttributionContext()

    // Debug logging management - available globally for developers
    ;(window as any).enableDebug = () => {
      enableConsoleDebug()
      return getConsoleDebugStatus()
    }
    ;(window as any).disableDebug = () => {
      disableConsoleDebug()
      return getConsoleDebugStatus()
    }
    ;(window as any).debugStatus = () => {
      const status = getConsoleDebugStatus()
      debugLog(
        { debug: true },
        `Debug logging is ${status.enabled ? 'ENABLED' : 'DISABLED'} (${status.source})`,
      )
      debugLog(
        { debug: true },
        `To ${status.enabled ? 'disable' : 'enable'} debug logging, run: ${
          status.enabled ? 'disableDebug()' : 'enableDebug()'
        }`,
      )
      return status
    }
  }
}

// Initialize analytics with framework adapter
export function initAnalytics(config: AnalyticsConfig, adapter: FrameworkAdapter): Analytics {
  const analytics = createAnalytics(config, adapter)

  // Set up framework-specific initialization
  adapter.onAppReady(async () => {
    debugLog(config, 'Analytics initialized')

    // Fetch geo context to determine consent requirements
    if (typeof window !== 'undefined') {
      try {
        await fetchGeoContext(config)

        if (isConsentRequired()) {
          const { consented } = await getConsentStatus(config)
          if (consented === null) {
            analytics.showConsentBanner()
            // Still initialize analytics for essential/anonymous tracking
            analytics.startAutoTracking()
            // Chat is available regardless of consent (functional service)
            await initializeClearIdeasChat(config)
          } else {
            // User has made a consent choice - initialize third-party services only if allowed.
            const hasConsent = consented === true
            initializeGTag(config, hasConsent)
            initializeUET(config, hasConsent)
            initializeOpenAIAdsPixel(config, hasConsent)
            await initializeClearIdeasChat(config)
            analytics.startAutoTracking()
          }
        } else {
          // Consent not required - initialize third-party services
          initializeGTag(config, true)
          initializeUET(config, true)
          initializeOpenAIAdsPixel(config, true)
          await initializeClearIdeasChat(config)
          analytics.startAutoTracking()
        }
      } catch {
        // Fallback: assume consent required for safety
        debugLog(config, 'Error during initialization, showing consent banner')
        analytics.showConsentBanner()
        analytics.startAutoTracking()
        // Chat is available regardless of consent (functional service)
        await initializeClearIdeasChat(config)
      }
    }
  })

  // Clean up on app destroy
  adapter.onAppDestroy(() => {
    stopFlushTimer()
  })

  // Expose global functions for development
  exposeGlobalFunctions(analytics)

  return analytics
}
