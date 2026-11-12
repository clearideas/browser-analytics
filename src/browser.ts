// Framework-agnostic integration: @clearideas/consent-analytics/browser
//
// Works with any site or single-page app. Page changes are detected from the History API
// (pushState/replaceState/popstate), which the routers of Next.js, React Router, Remix,
// SvelteKit, Angular, Astro (view transitions) and Vue Router all use. Frameworks that
// expose navigation events can report them instead (routeChanges: 'manual').
import type { AnalyticsOptions } from './core'
import { withDefaults } from './core'
import { initAnalytics } from './index'
import type { Analytics, AnalyticsConfig, FrameworkAdapter } from './types'

export interface BrowserAnalyticsOptions {
  /**
   * 'history' (default): detect page changes from the History API.
   * 'manual': call notifyRouteChange() after each navigation (e.g. from a router event).
   */
  routeChanges?: 'history' | 'manual'
}

export interface BrowserAnalytics extends Analytics {
  /** Report that the page changed (needed only with routeChanges: 'manual'). */
  notifyRouteChange: () => void
}

type Listener = () => void
const historyListeners = new Set<Listener>()
let historyPatched = false
let pendingNotification: ReturnType<typeof setTimeout> | null = null

// Path + query of the current URL. In-page anchors (#section) are not page changes.
const currentPage = () => `${window.location.pathname}${window.location.search}`

function scheduleNotification(): void {
  // Coalesce bursts (routers often call pushState and replaceState together) and let the
  // framework update the document (e.g. the title) first.
  if (pendingNotification !== null) return
  pendingNotification = setTimeout(() => {
    pendingNotification = null
    for (const listener of [...historyListeners]) listener()
  }, 0)
}

function patchHistory(): void {
  if (historyPatched || typeof window === 'undefined') return
  historyPatched = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method]
    window.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      scheduleNotification()
      return result
    }
  }
  window.addEventListener('popstate', scheduleNotification)
}

/** Call listener when the page (path or query) changes. Returns an unsubscribe function. */
export function watchHistory(listener: (path: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  patchHistory()
  let last = currentPage()
  const onChange = () => {
    const page = currentPage()
    if (page === last) return
    last = page
    listener(window.location.pathname)
  }
  historyListeners.add(onChange)
  return () => historyListeners.delete(onChange)
}

/** A FrameworkAdapter for plain browser pages. */
export function createBrowserAdapter(
  config: AnalyticsConfig,
  options: BrowserAnalyticsOptions = {},
): FrameworkAdapter & { notifyRouteChange: () => void } {
  const manualListeners = new Set<(path: string) => void>()
  return {
    getConfig: () => config,
    getCurrentPath: () => (typeof window === 'undefined' ? '/' : window.location.pathname),
    getCurrentUrl: () => (typeof window === 'undefined' ? '' : window.location.href),
    getReferrer: () => (typeof document === 'undefined' ? '' : document.referrer),
    onRouteChange: callback => {
      if (options.routeChanges === 'manual') {
        manualListeners.add(callback)
        return () => manualListeners.delete(callback)
      }
      return watchHistory(callback)
    },
    onAppReady: callback => {
      if (typeof document === 'undefined') return
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => callback(), { once: true })
      } else {
        setTimeout(callback, 0)
      }
    },
    onAppDestroy: () => {},
    getRouter: () => null,
    notifyRouteChange: () => {
      if (typeof window === 'undefined') return
      for (const listener of [...manualListeners]) listener(window.location.pathname)
    },
  }
}

let instance: BrowserAnalytics | null = null

/**
 * Start analytics on this page. Only apiBaseUrl and siteKey are required. Calling it again
 * returns the running instance (safe with React StrictMode and hot reloading).
 */
export function initBrowserAnalytics(
  options: AnalyticsOptions,
  browserOptions: BrowserAnalyticsOptions = {},
): BrowserAnalytics {
  if (instance) return instance
  const config = withDefaults(options)
  const adapter = createBrowserAdapter(config, browserOptions)
  const analytics = initAnalytics(config, adapter)
  instance = Object.assign(analytics, { notifyRouteChange: adapter.notifyRouteChange })
  return instance
}

/** The instance started by initBrowserAnalytics, if any. */
export function getBrowserAnalytics(): BrowserAnalytics | null {
  return instance
}

export type { AnalyticsOptions } from './core'
export type { Analytics, AnalyticsConfig, ConsentSnapshot } from './types'
