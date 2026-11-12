'use client'
import { useAnalytics, useConsent } from '@clearideas/consent-analytics/next'

export function ConsentState() {
  const consent = useConsent()
  return <p id="consent-state">{consent ? `statistics:${consent.categories.statistics}` : 'loading'}</p>
}

export function Cta() {
  const analytics = useAnalytics()
  return (
    <button id="cta" onClick={() => analytics?.trackEvent('cta_click', { framework: 'next' })}>
      Track CTA
    </button>
  )
}
