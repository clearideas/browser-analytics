import { AnalyticsProvider, useAnalytics, useConsent } from '@clearideas/consent-analytics/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router'

const config = { apiBaseUrl: 'http://localhost:18787/', siteKey: 'demo-site' }

function ConsentState() {
  const consent = useConsent()
  return <p id="consent-state">{consent ? `statistics:${consent.categories.statistics}` : 'loading'}</p>
}

function Cta() {
  const analytics = useAnalytics()
  return (
    <button id="cta" onClick={() => analytics?.trackEvent('cta_click', { framework: 'react-router' })}>
      Track CTA
    </button>
  )
}

function Home() {
  return (
    <main>
      <h1>Home</h1>
      <Link id="nav-pricing" to="/pricing">Pricing</Link>
      <Cta />
    </main>
  )
}

function Pricing() {
  return (
    <main>
      <h1>Pricing</h1>
      <Link id="nav-home" to="/">Home</Link>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AnalyticsProvider config={config}>
      <BrowserRouter>
        <ConsentState />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
        </Routes>
        {/* Reopens the consent banner, so visitors can change their decision. */}
        <footer><a id="cookie-settings" href="#ci-consent-settings">Cookie settings</a></footer>
      </BrowserRouter>
    </AnalyticsProvider>
  </StrictMode>,
)
