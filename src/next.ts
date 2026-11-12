// Next.js (App Router) integration: @clearideas/consent-analytics/next
//
//   // app/layout.tsx
//   import { ClearIdeasAnalytics } from '@clearideas/consent-analytics/next'
//   <body>
//     <ClearIdeasAnalytics config={{ apiBaseUrl: '…', siteKey: '…' }}>{children}</ClearIdeasAnalytics>
//   </body>
//
// Page changes come from Next's own navigation hooks (usePathname/useSearchParams). The
// hooks are used inside a Suspense boundary, so static rendering is not affected.
// This file is a client module ('use client' is added to the built output).
import { usePathname, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { createElement, Suspense, useEffect } from 'react'

import type { AnalyticsOptions } from './core'
import { AnalyticsProvider, useAnalytics } from './react'

function RouteReporter() {
  const analytics = useAnalytics()
  const pathname = usePathname()
  const search = useSearchParams()?.toString()
  useEffect(() => {
    // The core ignores reports for the page it already tracked (e.g. the initial page).
    analytics?.notifyRouteChange()
  }, [analytics, pathname, search])
  return null
}

export interface ClearIdeasAnalyticsProps {
  /** Only apiBaseUrl and siteKey are required. Read once, on mount. */
  config: AnalyticsOptions
  children?: ReactNode
}

export function ClearIdeasAnalytics({ config, children }: ClearIdeasAnalyticsProps) {
  return createElement(
    AnalyticsProvider,
    { config, routeChanges: 'manual' },
    createElement(Suspense, { fallback: null }, createElement(RouteReporter)),
    children,
  )
}

export { useAnalytics, useConsent } from './react'
