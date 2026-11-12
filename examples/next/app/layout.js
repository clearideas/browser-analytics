import { ClearIdeasAnalytics } from '@clearideas/consent-analytics/next'

import { ConsentState } from './client'

export const metadata = { title: 'Next.js example' }

const config = { apiBaseUrl: 'http://localhost:18787/', siteKey: 'demo-site' }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClearIdeasAnalytics config={config}>
          <ConsentState />
          {children}
          {/* Reopens the consent banner, so visitors can change their decision. */}
          <footer><a id="cookie-settings" href="#ci-consent-settings">Cookie settings</a></footer>
        </ClearIdeasAnalytics>
      </body>
    </html>
  )
}
