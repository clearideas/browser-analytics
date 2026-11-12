// Main analytics module - exports the core functionality
export * from './attribution'
export type { BannerOptions } from './banner'
export { CONSENT_SETTINGS_SELECTOR } from './banner'
export * from './consent'
export * from './core'
export type { GatedScriptsOptions } from './gated-scripts'
export * from './integrations'
export { PluginHost } from './plugins/host'
export type { IntegrationsConfig } from './plugins/registry'
export type {
  AnalyticsPlugin,
  ConsentState,
  CookieRule,
  PluginConsentState,
  PluginContext,
  PluginEvent,
  StorageRule,
  WithdrawalMode,
} from './plugins/types'
export * from './storage'
export * from './tracking'
export * from './types'

// Factory function to create analytics instance
import {
  captureInitialAttribution,
  cleanAttributionFromUrl,
  getAttributionContext,
  readLandingAttribution,
  setAttributionCookie,
  updateAttributionLastSeen,
} from './attribution'
import {
  CONSENT_SETTINGS_HASH,
  CONSENT_SETTINGS_SELECTOR,
  hideBanner,
  hideManageButton,
  isBannerVisible,
  resolveBannerOptions,
  showBanner,
  showManageButton,
} from './banner'
import type { CategoryChoices } from './categories'
import {
  allCategories,
  completeChoices,
  isOptionalCategory,
  OPTIONAL_CATEGORIES,
} from './categories'
import {
  flushPendingConsentRecords,
  getConsent,
  getConsentCategories,
  getConsentDecision,
  getCurrentPolicyVersion,
  isConsentRequired,
  isGlobalPrivacyControlEnabled,
  setConsent as setConsentUtil,
} from './consent'
import {
  getConnectionType,
  getDeviceBucket,
  getViewportBucket,
  normalizeOutboundLink,
  sanitizeAnalyticsText,
  sanitizeEventUrls,
} from './core'
import { GatedScripts } from './gated-scripts'
import { toThirdPartyEventParams, trackUETConversion, trackUETEvent } from './integrations'
import { pageReloader } from './plugins/dom'
import { PluginHost } from './plugins/host'
import { resolvePluginSpecs } from './plugins/registry'
import type { ConsentState } from './plugins/types'
import { isCategoryAllowed } from './plugins/types'
import {
  clearAttributionDataForGDPR,
  getGeoContext,
  isDontTrackOwnerEnabled,
  setDontTrackOwner,
  setGeoContext,
} from './storage'
import { flushEvents, initializeEventQueue, stopFlushTimer, trackEvent } from './tracking'
import type {
  Analytics,
  AnalyticsConfig,
  ConsentApi,
  ConsentSnapshot,
  FrameworkAdapter,
} from './types'
import {
  debugLog,
  disableConsoleDebug,
  enableConsoleDebug,
  getConsoleDebugStatus,
  getSiteKey,
  STORAGE_KEYS,
} from './types'

// Fetch the consent policy for this visitor (GET /v1/context) unless a fresh one is
// cached for this browser session or was supplied with the page (initialContext).
// On failure nothing is stored, so consent is treated as required.
async function fetchContext(config: AnalyticsConfig): Promise<void> {
  if (typeof window === 'undefined') return

  if (config.initialContext) {
    setGeoContext({
      requiresConsent: config.initialContext.consentRequired === true,
      policyVersion: config.initialContext.policyVersion,
      trackingWithoutConsent: config.initialContext.trackingWithoutConsent,
      country: config.initialContext.country,
      continent: config.initialContext.continent,
    })
    return
  }

  const cached = getGeoContext()
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    debugLog(config, 'Using cached context')
    return
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const url = `${config.apiBaseUrl.replace(/\/$/, '')}/v1/context?siteKey=${encodeURIComponent(
      getSiteKey(config),
    )}`
    const response = await fetch(url, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Context API failed: ${response.status}`)

    const context = await response.json()
    const ttlSeconds = Number(context?.ttlSeconds)
    setGeoContext({
      requiresConsent: context?.policy?.consentRequired !== false,
      policyVersion:
        typeof context?.policy?.policyVersion === 'string'
          ? context.policy.policyVersion
          : undefined,
      trackingWithoutConsent:
        context?.policy?.trackingWithoutConsent === 'none' ||
        context?.policy?.trackingWithoutConsent === 'limited'
          ? context.policy.trackingWithoutConsent
          : undefined,
      country: typeof context?.geo?.country === 'string' ? context.geo.country : undefined,
      continent: typeof context?.geo?.continent === 'string' ? context.geo.continent : undefined,
      expiresAt: Date.now() + (Number.isFinite(ttlSeconds) ? ttlSeconds : 3600) * 1000,
    })
  } catch (error) {
    debugLog(config, 'Error fetching context; consent will be required', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export function createAnalytics(config: AnalyticsConfig, adapter: FrameworkAdapter): Analytics {
  return createAnalyticsInternal(config, adapter).analytics
}

function createAnalyticsInternal(config: AnalyticsConfig, adapter: FrameworkAdapter) {
  // Initialize event queue

  initializeEventQueue(config)

  // Integrations run as plugins under the consent rules (see plugins/host.ts).
  const plugins = new PluginHost(config, resolvePluginSpecs(config))
  // Consent-gated <script type="text/plain" data-ci-consent> tags (see gated-scripts.ts).
  const gatedScripts =
    config.gatedScripts === false ? null : new GatedScripts(config, config.gatedScripts ?? {})
  const bannerOptions = resolveBannerOptions(
    config.banner === false ? undefined : config.banner,
    config.websiteBaseUrl,
  )
  const consentListeners = new Set<(state: ConsentSnapshot) => void>()

  const consentState = (): ConsentState => ({
    required: isConsentRequired(config),
    granted: getConsentDecision(config),
    categories: getConsentCategories(config),
    gpc: isGlobalPrivacyControlEnabled(config),
  })
  const categoriesMode = config.consent?.choices === 'categories'
  const offeredCategories = (config.consent?.categories ?? [...OPTIONAL_CATEGORIES]).filter(
    isOptionalCategory,
  )

  // Bring plugins and gated scripts in line with the current consent state (cheap when
  // unchanged).
  const syncPlugins = (): ConsentState => {
    const state = consentState()
    plugins.applyConsent(state)
    gatedScripts?.apply(state)
    return state
  }

  // Attribution present in the landing URL, held in memory only. It is persisted
  // once storage is allowed (immediately, or when the visitor accepts the banner),
  // even if they have navigated away from the landing page by then.
  const landingAttribution = readLandingAttribution()

  // Build and send one event. The caller's props are never mutated. URLs are sanitized
  // for every destination; attribution enrichment goes to our backend only.
  // Synchronous up to queueing: consent is read from the browser, no network round trip.
  const dispatchEvent = (name: string, props: Record<string, any>): Promise<void> => {
    const eventProps = sanitizeEventUrls({ ...props }, config.urlQueryAllowlist)
    const backendProps: Record<string, any> = { ...eventProps }

    // Add first-touch attribution (validated, known keys only) for our backend.
    const attributionContext = getAttributionContext(config)
    if (attributionContext) {
      backendProps.attribution = attributionContext
      for (const [key, value] of Object.entries(attributionContext)) {
        if (typeof value !== 'string' || !value) continue
        if (key.startsWith('utm_') || key.startsWith('ci_')) {
          backendProps[key] = value
        }
      }
      if (attributionContext.gclid) backendProps.gclid = attributionContext.gclid
      if (attributionContext.msclkid) backendProps.msclkid = attributionContext.msclkid
    }

    // Our backend. The event is queued synchronously; only delivery is async.
    const delivery = trackEvent(config, name, backendProps)

    // Plugins receive the event's own parameters, not our enrichment; the host forwards
    // it only to plugins the current consent state allows.
    syncPlugins()
    plugins.track({
      name,
      params: toThirdPartyEventParams(eventProps),
      props: eventProps,
      attribution: attributionContext ?? undefined,
    })

    return delivery
  }

  // Track event wrapper
  const trackEventWrapper = async (name: string, props: Record<string, any> = {}) => {
    debugLog(config, 'trackEventWrapper called', { eventName: name })

    // Check if owner tracking is disabled
    if (isDontTrackOwnerEnabled()) {
      debugLog(config, 'Owner tracking disabled, skipping event', {
        eventName: name,
      })
      return
    }

    await dispatchEvent(name, props)
  }

  // For page-hide/unload handlers: the event is queued before the handler returns.
  const trackEventNow = (name: string, props: Record<string, any> = {}) => {
    if (isDontTrackOwnerEnabled()) return
    void dispatchEvent(name, props)
  }

  // Persist landing attribution once storage is allowed (no consent required, or
  // consent given), share it via cookie if configured, and tidy the visible URL.
  const persistAttributionIfAllowed = () => {
    if (typeof window === 'undefined') return

    // Stored attribution is part of analytics: it needs the statistics category.
    if (!isCategoryAllowed('statistics', consentState())) {
      debugLog(config, 'GDPR: Skipping attribution capture - no statistics consent')
      return
    }

    const attributionData = captureInitialAttribution(config, landingAttribution)
    if (attributionData) {
      if (config.cookieDomain) setAttributionCookie(attributionData, config.cookieDomain)

      if (config.cleanAttributionUrl !== false) {
        const cleanUrl = cleanAttributionFromUrl()
        if (cleanUrl !== window.location.href) {
          // Keep the router's history.state (Vue Router stores navigation data there).
          window.history.replaceState(window.history.state, '', cleanUrl)
          debugLog(config, 'Cleaned attribution parameters from URL')
        }
      }
    }

    updateAttributionLastSeen()
  }

  // Error tracking wrapper
  const trackErrorWrapper = (message: string, props: Record<string, any> = {}) => {
    trackEventWrapper('error', { message, ...props })
  }

  // --- Consent ---------------------------------------------------------------------

  const consentSnapshot = (state: ConsentState = consentState()): ConsentSnapshot => ({
    ...state,
    policyVersion: getCurrentPolicyVersion(),
  })

  // "Cookie settings" button: lets visitors change their decision later.
  const updateManageButton = () => {
    if (config.banner === false) return
    const setting = bannerOptions.manageButton
    const state = consentState()
    const decided = OPTIONAL_CATEGORIES.some(category => state.categories[category] !== null)
    // A consent settings link on the page (e.g. in the footer) replaces the floating button.
    const hasSettingsLink =
      typeof document !== 'undefined' && document.querySelector(CONSENT_SETTINGS_SELECTOR) !== null
    const show =
      setting === true || (setting === 'auto' && state.required && decided && !hasSettingsLink)
    if (show) showManageButton(bannerOptions, () => showConsentBanner({ focus: true }))
    else hideManageButton()
  }

  /**
   * Apply a decision. The decision is stored and every consumer (plugins, attribution,
   * UI) is updated synchronously, before the consent record is sent, so no event reaches a
   * third party under the previous state.
   */
  // Whether the banner should be on screen (shown and not yet answered).
  let bannerWanted = false

  const decide = async (choices: CategoryChoices, source: 'banner' | 'api') => {
    debugLog(config, 'Consent decision', { choices, source })
    const recording = setConsentUtil(config, choices, source)
    bannerWanted = false
    hideBanner()
    const state = syncPlugins()
    if (isCategoryAllowed('statistics', state)) {
      // Storage is now allowed: persist the landing attribution held in memory.
      persistAttributionIfAllowed()
    } else {
      // GDPR: Clear attribution data when consent is withdrawn
      clearAttributionDataForGDPR(config.cookieDomain)
    }
    updateManageButton()
    notifyConsentListeners(state)
    await recording

    // A withdrawal that running third-party code cannot apply in place: reload, so the
    // code is gone. The decision is already stored, so nothing that needs it starts again.
    const pluginsNeedReload = plugins.takeReloadRequest()
    const gatedNeedReload = gatedScripts?.takeReloadRequest() ?? false
    if ((pluginsNeedReload || gatedNeedReload) && config.consent?.reloadOnWithdrawal !== false) {
      debugLog(config, 'Reloading the page to complete the withdrawal')
      pageReloader.reload()
    }
  }

  const notifyConsentListeners = (state: ConsentState = consentState()) => {
    const snapshot = consentSnapshot(state)
    for (const listener of consentListeners) {
      try {
        listener(snapshot)
      } catch (error) {
        debugLog(config, 'Consent listener failed', error)
      }
    }
  }

  const showConsentBanner = ({ focus = false }: { focus?: boolean } = {}) => {
    if (config.banner === false) {
      debugLog(config, 'Built-in banner disabled (banner: false); use analytics.consent')
      return
    }
    // Remember where the visitor came from before hiding anything: browsers move focus
    // to <body> when the focused element (e.g. "Cookie settings") is hidden.
    const opener =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    hideManageButton()
    bannerWanted = true
    showBanner(
      bannerOptions,
      {
        onAccept: () => void decide(allCategories(true), 'banner'),
        onReject: () => void decide(allCategories(false), 'banner'),
        onSave: choices => void decide(completeChoices(choices), 'banner'),
      },
      {
        focus,
        returnFocusTo: opener,
        // Category choices, opened directly when the visitor asked for the settings.
        categories: categoriesMode
          ? { offered: offeredCategories, current: getConsentCategories(config), expanded: focus }
          : undefined,
      },
    )
  }

  // Readiness: initAnalytics marks the instance pending until the consent policy is known.
  let ready: Promise<void> = Promise.resolve()
  let resolveReady = () => {}
  const beginInit = () => {
    ready = new Promise<void>(resolve => (resolveReady = resolve))
  }

  const consent: ConsentApi = {
    get: () => consentSnapshot(),
    // Wait for the policy so the decision is recorded under the right policy version.
    accept: async () => {
      await ready
      return decide(allCategories(true), 'api')
    },
    reject: async () => {
      await ready
      return decide(allCategories(false), 'api')
    },
    set: async choices => {
      await ready
      return decide(completeChoices(choices), 'api')
    },
    onChange: listener => {
      consentListeners.add(listener)
      return () => consentListeners.delete(listener)
    },
    showBanner: () => showConsentBanner({ focus: true }),
  }

  // Auto-tracking functionality. Everything registered here is recorded in
  // `autoTrackingCleanup` so stopAutoTracking() can undo it and a second
  // startAutoTracking() call is a no-op.
  let autoTrackingCleanup: Array<() => void> | null = null

  const startAutoTracking = () => {
    if (autoTrackingCleanup) {
      debugLog(config, 'Auto-tracking already running')
      return
    }
    const cleanup: Array<() => void> = []
    autoTrackingCleanup = cleanup

    const listen = (
      target: EventTarget,
      type: string,
      handler: EventListener,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler, options)
      cleanup.push(() => target.removeEventListener(type, handler, options))
    }

    debugLog(config, 'Starting auto-tracking')
    debugLog(config, 'Auto-tracking config', {
      autoTrackScrollDepth: config.autoTrackScrollDepth,
      autoTrackTimeSpent: config.autoTrackTimeSpent,
      autoTrackOutboundLinks: config.autoTrackOutboundLinks,
    })

    // GDPR: Only capture attribution if consent not required OR consent provided
    persistAttributionIfAllowed()

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

    // Context of the page currently being viewed, captured at its page_view. Exit
    // events use this, because by the time a route change is reported the URL
    // already points at the next page.
    let currentPageContext = getPageContext()
    // Page identity: the URL without attribution parameters, so removing utm_*/gclid from
    // the address bar (history.replaceState) is not mistaken for a navigation.
    const pageKey = (url: string) => cleanAttributionFromUrl(url)
    let lastTrackedPage = pageKey(currentPageContext.url)

    const resetPageState = () => {
      pageStartTime = Date.now()
      pageExitTracked = false
      timeSpentTracked = false
      maxScrollDepth = 0
      clickCount = 0
      keypressCount = 0
    }

    const trackPageExit = (track: (name: string, props: Record<string, any>) => unknown) => {
      if (pageExitTracked) return
      pageExitTracked = true

      const timeSpentSeconds = Math.round((Date.now() - pageStartTime) / 1000)
      track('page_exit', {
        ...currentPageContext,
        timeSpent: timeSpentSeconds,
        timeSpentTotal: timeSpentSeconds,
        clicks: clickCount,
        keypresses: keypressCount,
        maxScrollDepth,
      })
    }

    // Work to do when the page is hidden or unloaded. Handlers must queue events
    // synchronously (trackEventNow); the queue is then sent with sendBeacon before the
    // handler returns, because the browser may discard the page right afterwards.
    const pageHiddenHandlers: Array<() => void> = []
    const handlePageHidden = () => {
      for (const handler of pageHiddenHandlers) handler()
      void flushEvents(config)
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') handlePageHidden()
      })
      listen(window, 'pagehide', handlePageHidden)
    }

    // Track initial page view
    debugLog(config, 'Sending initial page view', currentPageContext)
    trackEventWrapper('page_view', currentPageContext)

    // Set up route change tracking
    const unsubscribeRouteChange = adapter.onRouteChange((path: string) => {
      const nextPageContext = getPageContext()
      if (pageKey(nextPageContext.url) === lastTrackedPage) {
        debugLog(config, 'Route change to the current URL ignored', { path })
        return
      }
      debugLog(config, 'Route changed', { path })

      trackPageExit(trackEventWrapper)
      resetPageState()
      currentPageContext = nextPageContext
      lastTrackedPage = pageKey(nextPageContext.url)
      debugLog(config, 'Sending route page view', nextPageContext)
      trackEventWrapper('page_view', nextPageContext)
    })
    cleanup.push(() => unsubscribeRouteChange?.())

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

      listen(window, 'scroll', trackScrollDepth, { passive: true })
      cleanup.push(() => {
        if (throttleTimer !== null) window.clearTimeout(throttleTimer)
      })
    }

    // Auto-track time spent if enabled
    if (config.autoTrackTimeSpent && typeof window !== 'undefined') {
      const trackTimeSpent = () => {
        if (timeSpentTracked) return

        const timeSpent = Math.round((Date.now() - pageStartTime) / 1000)
        if (timeSpent >= 30) {
          // Track after 30 seconds
          trackEventNow('time_spent', {
            duration: timeSpent,
            timeSpent,
            clicks: clickCount,
            keypresses: keypressCount,
            maxScrollDepth,
            ...currentPageContext,
          })
          timeSpentTracked = true
        }
      }

      // Tab switch, minimize, close, navigation away
      pageHiddenHandlers.push(trackTimeSpent)

      // Reset when returning to the page
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') timeSpentTracked = false
      })
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

      listen(document, 'click', handleOutboundLink)
    }

    if (typeof document !== 'undefined') {
      listen(document, 'click', () => {
        clickCount += 1
      })

      listen(document, 'keydown', event => {
        const keyEvent = event as KeyboardEvent
        if (keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey) return
        keypressCount += 1
      })
    }

    // Auto-track page exit when the page is hidden or unloaded
    pageHiddenHandlers.push(() => trackPageExit(trackEventNow))

    // Auto-track web vitals
    if (typeof window !== 'undefined' && typeof PerformanceObserver !== 'undefined') {
      const observe = (entryTypes: string[], callback: PerformanceObserverCallback) => {
        const observer = new PerformanceObserver(callback)
        observer.observe({ entryTypes })
        cleanup.push(() => observer.disconnect())
      }

      // Track Largest Contentful Paint (LCP)
      try {
        observe(['largest-contentful-paint'], list => {
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
      } catch {
        debugLog(config, 'LCP observer not supported')
      }

      // Track First Input Delay (FID)
      try {
        observe(['first-input'], list => {
          list.getEntries().forEach((entry: any) => {
            trackEventWrapper('web_vital', {
              name: 'FID',
              value: Math.round(entry.processingStart - entry.startTime),
              ...getPageContext(),
            })
          })
        })
      } catch {
        debugLog(config, 'FID observer not supported')
      }

      // Track Cumulative Layout Shift (CLS)
      try {
        let clsValue = 0
        observe(['layout-shift'], list => {
          list.getEntries().forEach((entry: any) => {
            if (!entry.hadRecentInput) {
              clsValue += entry.value
            }
          })
        })

        // Report CLS when the page is hidden or unloaded
        pageHiddenHandlers.push(() => {
          if (clsValue > 0) {
            trackEventNow('web_vital', {
              name: 'CLS',
              value: Math.round(clsValue * 1000) / 1000, // Round to 3 decimal places
              ...currentPageContext,
            })
          }
        })
      } catch {
        debugLog(config, 'CLS observer not supported')
      }

      // Track First Contentful Paint (FCP)
      try {
        observe(['paint'], list => {
          list.getEntries().forEach((entry: any) => {
            trackEventWrapper('web_vital', {
              name: 'FCP',
              value: Math.round(entry.startTime),
              ...getPageContext(),
            })
          })
        })
      } catch {
        debugLog(config, 'FCP observer not supported')
      }

      // Track Time to First Byte (TTFB)
      try {
        observe(['navigation'], list => {
          list.getEntries().forEach((entry: any) => {
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

        // Deliberately not collected (fingerprinting surface): exact screen and viewport
        // sizes, color depth, pixel ratio, JS heap sizes, network downlink/RTT. The page
        // context already carries coarse viewport/device buckets and connection type.

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
        listen(document, 'DOMContentLoaded', trackPageLoadMetrics)
      } else {
        // DOM is already ready
        trackPageLoadMetrics()
      }

      // Track metrics on page load complete
      listen(window, 'load', () => {
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
  }

  const stopAutoTracking = () => {
    if (!autoTrackingCleanup) return
    for (const undo of autoTrackingCleanup.splice(0)) {
      try {
        undo()
      } catch {
        // Keep cleaning up even if one step fails
      }
    }
    autoTrackingCleanup = null
    debugLog(config, 'Auto-tracking stopped')
  }

  const analytics: Analytics = {
    trackEvent: trackEventWrapper,
    trackError: trackErrorWrapper,
    trackUETEvent,
    trackUETConversion,
    flush: () => flushEvents(config),
    getConsentStatus: () => getConsent(config),
    showConsentBanner: () => showConsentBanner(),
    startAutoTracking,
    stopAutoTracking,
    consent,
    ready: () => ready,
  }

  // Frameworks that replace the page body on navigation (e.g. Astro view transitions)
  // remove the consent UI; put back what should be there.
  const restoreConsentUi = () => {
    if (config.banner === false || typeof document === 'undefined') return
    if (bannerWanted && !isBannerVisible()) {
      bannerWanted = false
      showConsentBanner()
    } else if (!bannerWanted) {
      updateManageButton()
    }
  }

  // Consent settings links (e.g. "Cookie settings" in the footer) reopen the banner.
  const openSettingsFromLink = (event: Event) => {
    const target = event.target as Element | null
    if (!target?.closest?.(CONSENT_SETTINGS_SELECTOR)) return
    if (config.banner === false) return
    event.preventDefault()
    showConsentBanner({ focus: true })
  }

  return {
    analytics,
    plugins,
    gatedScripts,
    openSettingsFromLink,
    restoreConsentUi,
    syncPlugins,
    updateManageButton,
    bannerOptions,
    notifyConsentListeners,
    beginInit,
    endInit: () => resolveReady(),
  }
}

// Owner tracking management functions
export function getDontTrackOwnerStatus(): {
  enabled: boolean
  instructions: string
} {
  const enabled = isDontTrackOwnerEnabled()
  const instructions = enabled
    ? 'To enable tracking again, run: ciAnalytics.enableOwnerTracking()'
    : 'To disable tracking, run: ciAnalytics.disableOwnerTracking()'

  return { enabled, instructions }
}

// Composable for accessing attribution data in Vue components
export function useAttributionContext() {
  return getAttributionContext()
}

/** Helpers exposed as `window.ciAnalytics` when `exposeGlobals` or `debug` is enabled. */
export interface AnalyticsGlobals {
  instance: Analytics
  disableOwnerTracking: () => ReturnType<typeof getDontTrackOwnerStatus>
  enableOwnerTracking: () => ReturnType<typeof getDontTrackOwnerStatus>
  ownerTrackingStatus: () => ReturnType<typeof getDontTrackOwnerStatus>
  showCookieBanner: () => void
  getAttributionContext: () => ReturnType<typeof getAttributionContext>
  enableDebug: () => ReturnType<typeof getConsoleDebugStatus>
  disableDebug: () => ReturnType<typeof getConsoleDebugStatus>
  debugStatus: () => ReturnType<typeof getConsoleDebugStatus>
}

// Console helpers for site owners and developers. Opt-in: nothing is added to `window`
// unless `exposeGlobals` or `debug` is set, and only one namespaced global is used so
// other libraries (e.g. Segment's `window.analytics`) are never overwritten.
function exposeGlobalFunctions(analytics: Analytics, config: AnalyticsConfig) {
  if (typeof window === 'undefined') return
  if (config.exposeGlobals !== true && config.debug !== true) return

  const globals: AnalyticsGlobals = {
    instance: analytics,
    // Owner tracking management - lets site owners exclude their own visits
    disableOwnerTracking: () => {
      setDontTrackOwner(true)
      debugLog({ debug: true }, 'Owner tracking disabled. Your visits will not be tracked.')
      return getDontTrackOwnerStatus()
    },
    enableOwnerTracking: () => {
      setDontTrackOwner(false)
      debugLog({ debug: true }, 'Owner tracking enabled. Your visits will be tracked normally.')
      return getDontTrackOwnerStatus()
    },
    ownerTrackingStatus: () => {
      const status = getDontTrackOwnerStatus()
      debugLog({ debug: true }, `Owner tracking is ${status.enabled ? 'DISABLED' : 'ENABLED'}`)
      debugLog({ debug: true }, status.instructions)
      return status
    },
    showCookieBanner: () => analytics.showConsentBanner(),
    getAttributionContext: () => getAttributionContext(config),
    // Debug logging management
    enableDebug: () => {
      enableConsoleDebug()
      return getConsoleDebugStatus()
    },
    disableDebug: () => {
      disableConsoleDebug()
      return getConsoleDebugStatus()
    },
    debugStatus: () => {
      const status = getConsoleDebugStatus()
      debugLog(
        { debug: true },
        `Debug logging is ${status.enabled ? 'ENABLED' : 'DISABLED'} (${status.source})`,
      )
      debugLog(
        { debug: true },
        `To ${status.enabled ? 'disable' : 'enable'} debug logging, run: ${
          status.enabled ? 'ciAnalytics.disableDebug()' : 'ciAnalytics.enableDebug()'
        }`,
      )
      return status
    },
  }

  ;(window as any).ciAnalytics = globals
}

// Initialize analytics with framework adapter
export function initAnalytics(config: AnalyticsConfig, adapter: FrameworkAdapter): Analytics {
  const internal = createAnalyticsInternal(config, adapter)
  const { analytics } = internal
  if (typeof window !== 'undefined') internal.beginInit()

  const initialize = async () => {
    // Pre-v1 versions stored a server user ID here; it is no longer used.
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION_STATUS)
    } catch {
      // Ignore storage errors
    }
    // Deliver consent records that failed to send on an earlier visit.
    void flushPendingConsentRecords(config)

    // Fetch the consent policy for this visitor. On failure consent is required.
    await fetchContext(config)

    // Start the integrations this visitor's consent state allows (chat is functional
    // and starts regardless; tags that need consent wait for it).
    const state = internal.syncPlugins()
    debugLog(config, 'Consent state', state)
    // The consent situation is now known (policy from the collector).
    internal.notifyConsentListeners(state)

    const undecided = state.required && state.granted === null
    if (undecided && config.banner !== false && internal.bannerOptions.autoShow) {
      analytics.showConsentBanner()
    } else if (window.location.hash === CONSENT_SETTINGS_HASH) {
      // Arrived through a settings link (e.g. clicked before this script had loaded).
      analytics.consent.showBanner()
    } else if (!undecided) {
      internal.updateManageButton()
    }

    // Essential and anonymous tracking runs in every case; what is collected depends on
    // the consent state (see shouldTrackEvent).
    analytics.startAutoTracking()
  }

  // Set up framework-specific initialization
  adapter.onAppReady(async () => {
    debugLog(config, 'Analytics initialized')
    if (typeof window === 'undefined') return
    try {
      await initialize()
    } finally {
      internal.endInit()
    }
  })

  // Keep the consent UI in place across navigations that replace the page body.
  adapter.onRouteChange(() => internal.restoreConsentUi())

  // Consent settings links anywhere on the page (capture phase: before routers that
  // handle link clicks themselves).
  if (typeof document !== 'undefined') {
    document.addEventListener('click', internal.openSettingsFromLink, true)
  }

  // Vue/React layouts can mount their footer after policy initialization, and
  // replace it after route changes. React only to settings-link presence changes
  // so rendering our own floating button cannot create an observer loop.
  let settingsLinksObserver: MutationObserver | undefined
  if (
    config.banner !== false &&
    internal.bannerOptions.manageButton === 'auto' &&
    typeof document !== 'undefined' &&
    document.documentElement &&
    typeof MutationObserver !== 'undefined'
  ) {
    let hadSettingsLink = document.querySelector(CONSENT_SETTINGS_SELECTOR) !== null
    settingsLinksObserver = new MutationObserver(() => {
      const hasSettingsLink = document.querySelector(CONSENT_SETTINGS_SELECTOR) !== null
      if (hasSettingsLink === hadSettingsLink) return
      hadSettingsLink = hasSettingsLink
      internal.restoreConsentUi()
    })
    settingsLinksObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'class', 'data-ci-consent-settings'],
    })
  }

  // Clean up on app destroy
  adapter.onAppDestroy(() => {
    settingsLinksObserver?.disconnect()
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', internal.openSettingsFromLink, true)
    }
    stopFlushTimer()
  })

  // Expose console helpers (opt-in)
  exposeGlobalFunctions(analytics, config)

  return analytics
}
