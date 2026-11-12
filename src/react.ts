// React integration: @clearideas/consent-analytics/react
//
//   <AnalyticsProvider config={{ apiBaseUrl, siteKey }}>…</AnalyticsProvider>
//   const analytics = useAnalytics()      // trackEvent, consent, …
//   const consent = useConsent()          // re-renders when the consent state changes
//
// Safe with server-side rendering (nothing runs until the component mounts in the
// browser) and with StrictMode (initialization is idempotent). Page changes are detected
// from the History API, which React Router, Remix and Next.js use.
import type { ReactNode } from 'react'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { BrowserAnalytics, BrowserAnalyticsOptions } from './browser'
import { getBrowserAnalytics, initBrowserAnalytics } from './browser'
import { OPTIONAL_CATEGORIES } from './categories'
import type { AnalyticsOptions } from './core'
import type { ConsentSnapshot } from './types'

const AnalyticsContext = createContext<BrowserAnalytics | null>(null)

export interface AnalyticsProviderProps {
  /** Only apiBaseUrl and siteKey are required. Read once, on mount. */
  config: AnalyticsOptions
  routeChanges?: BrowserAnalyticsOptions['routeChanges']
  children?: ReactNode
}

export function AnalyticsProvider({ config, routeChanges, children }: AnalyticsProviderProps) {
  const [analytics, setAnalytics] = useState<BrowserAnalytics | null>(() => getBrowserAnalytics())
  useEffect(() => {
    setAnalytics(initBrowserAnalytics(config, { routeChanges }))
    // The configuration is read once: analytics is a page-level singleton.
  }, [])
  return createElement(AnalyticsContext.Provider, { value: analytics }, children)
}

/** The analytics instance, or null before it has started (e.g. during server rendering). */
export function useAnalytics(): BrowserAnalytics | null {
  return useContext(AnalyticsContext) ?? getBrowserAnalytics()
}

const sameSnapshot = (a: ConsentSnapshot | null, b: ConsentSnapshot | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.required === b.required &&
    a.granted === b.granted &&
    a.gpc === b.gpc &&
    a.policyVersion === b.policyVersion &&
    OPTIONAL_CATEGORIES.every(category => a.categories[category] === b.categories[category]))

/**
 * The visitor's consent state ({ required, granted, gpc, policyVersion }), or null before
 * analytics has started. Re-renders when the policy becomes known and after decisions.
 */
export function useConsent(): ConsentSnapshot | null {
  const analytics = useAnalytics()
  const cache = useRef<ConsentSnapshot | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => (analytics ? analytics.consent.onChange(onChange) : () => {}),
    [analytics],
  )
  const getSnapshot = useCallback(() => {
    const next = analytics ? analytics.consent.get() : null
    if (!sameSnapshot(cache.current, next)) cache.current = next
    return cache.current
  }, [analytics])

  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
