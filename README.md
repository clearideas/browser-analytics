# Browser Analytics

An MIT-licensed browser analytics client for Nuxt and Vite applications, with consent state, attribution tracking, event batching, and optional advertising and chat integrations.

The client expects a compatible event and consent API. The backend is not included in this repository; see [the backend contract](docs/BACKEND.md).

## Features

- ✅ **Multi-framework support**: Works with both Nuxt and Vite
- ✅ **Consent controls**: Consent state and configurable cookie banners
- ✅ **Third-party integrations**: Google Analytics 4, Microsoft UET (Bing Ads), Clear Ideas Chat (chat widget)
- ✅ **Type-safe**: Full TypeScript support
- ✅ **Peer dependencies**: No forced installation of framework-specific packages
- ✅ **Graceful degradation**: Handles missing optional dependencies
- ✅ **Debug logging**: Comprehensive logging for development

## Architecture

```
src/
├── index.ts          # Main exports and factory
├── types.ts          # TypeScript interfaces
├── core.ts           # Core utilities (UTM, session IDs, etc.)
├── storage.ts        # Local/session storage helpers
├── consent.ts        # Consent state and storage controls
├── tracking.ts       # Event tracking and queuing system
├── integrations.ts   # Third-party integrations (GA4, UET, Clear Ideas Chat)
├── nuxt.ts           # Nuxt plugin wrapper
├── vite.ts           # Vite SPA wrapper
└── README.md         # This file
```

## Installation

Install the public package from npm after the first public release:

```bash
npm install @clearideas/analytics vue
```

No npm account or private registry token is required for public releases. To try an unreleased checkout, run `npm ci`, `npm run check`, and `npm pack`; install the resulting `.tgz` in your application. Use Node.js 22.22.3+ or 24.15+ for development.

### Optional Peer Dependencies

Install framework-specific packages only if you use them:

```bash
# For Nuxt projects
npm install nuxt

# Clear Ideas Chat loads automatically from CDN (no additional dependencies needed)
```

### Using Clear Ideas Chat Widget

Clear Ideas Chat is loaded as a chat widget only - no analytics events are sent to Clear Ideas Chat. The widget is initialized automatically when consent is granted. If you need to programmatically control the chat widget:

```typescript
// Use the global ClearIdeasWidget instance (loaded from CDN)
const openChat = () => {
  if (typeof window !== 'undefined' && (window as any).clearIdeasWidget) {
    (window as any).clearIdeasWidget.open()
  }
}

// Available methods:
// widget.open()      - Open the chat widget
// widget.close()     - Close the chat widget
// widget.toggle()    - Toggle open/closed state
// widget.hide()      - Hide the floating action button
// widget.show()      - Show the floating action button
// widget.destroy()   - Remove widget from DOM
```

### Troubleshooting

If npm reports a 404, check that the public release is available and that your registry is `https://registry.npmjs.org/`. An existing organization-level `.npmrc` can redirect this scope to a private registry.

**"useRuntimeConfig is not defined" Error:**
- **CRITICAL**: Add `@clearideas/analytics` to `build.transpile` in your `nuxt.config.ts`
- This is required because Nuxt doesn't transpile external packages by default
- Without transpilation, Nuxt composables like `useRuntimeConfig` won't be available during SSR
- See the Nuxt configuration section below for the correct setup

## Usage

### Nuxt Application

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  plugins: ['@clearideas/analytics/nuxt.client'], // Client-side only
  runtimeConfig: {
    public: {
      analyticsDebug: true, // Enable debug logging
      apiBaseUrl: 'https://api.clearideas.com/',
      eventSiteName: 'my-nuxt-app',
      // ... other config
    }
  }
})
```

The Nuxt plugin automatically:
- Uses Nuxt's runtime config
- Integrates with Nuxt hooks (`page:start`, `app:mounted`)
- Provides analytics via `$analytics` in components

### Vite SPA Application

```typescript
// main.ts
import { createApp } from 'vue'
import { createRouter } from 'vue-router'
import { initViteAnalytics } from '@clearideas/analytics/vite'

const app = createApp(App)
const router = createRouter({ /* router config */ })

// Initialize analytics
const analytics = initViteAnalytics(router)

app.use(router)
app.mount('#app')
```

```typescript
// In Vue components
import { useAnalytics } from '@clearideas/analytics/vite'

export default {
  setup() {
    const analytics = useAnalytics()

    const handleClick = () => {
      analytics.trackEvent('button_click', { button: 'hero_cta' })
    }

    return { handleClick }
  }
}
```

## Configuration

### Nuxt Configuration

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  plugins: ['@clearideas/analytics/nuxt.client'],
  runtimeConfig: {
    public: {
      // Debug logging (development only)
      analyticsDebug: true,

      // API configuration
      apiBaseUrl: 'https://api.clearideas.com/',
      eventSiteName: 'my-nuxt-app',

      // Third-party integrations (optional)
      gaMeasurementId: 'GA-XXXXXXXXXX',        // Google Analytics 4
      microsoftAdsTagId: 'YOUR_UET_TAG_ID',    // Microsoft Ads UET tag ID
      chatAccessKey: 'YOUR_CHAT_ACCESS_KEY',  // Clear Ideas Chat access key (required)
      chatApiBaseUrl: 'https://api.clearideas.com', // Clear Ideas Chat API base URL (optional)
      chatPosition: 'bottom-right',            // Widget position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
      chatWidth: 380,                          // Widget width in pixels (optional)
      chatHeight: 540,                         // Widget height in pixels (optional)
      chatOpenOnLoad: false,                   // Open widget when page loads (optional)
      chatEnabled: true,                       // Enable/disable chat widget (default: true)
      // Note: Clear Ideas Chat is only initialized for chat functionality after user consent, no events are tracked

      // Google Ads conversions (auto-fire based on attribution)
      googleAdsConversions: {
        purchase: 'AW-123456789/ABCdef123',
        signup: 'AW-123456789/XYZuvw456',
        lead: 'AW-123456789/MNOopq789',
        demo_request: 'AW-123456789/STUrst012'
      },

      // Microsoft Ads custom goals
      microsoftAdsGoals: {
        signup: 'YOUR_SIGNUP_GOAL_ID',
        purchase: 'YOUR_PURCHASE_GOAL_ID',
        lead: 'YOUR_LEAD_GOAL_ID',
        contact: 'YOUR_CONTACT_GOAL_ID',
      },

      // Analytics behavior
      analyticsFlushInterval: 60000,           // 1 minute
      analyticsConsentCheckInterval: 86400000, // 24 hours
      analyticsSessionCheckInterval: 1800000,  // 30 minutes
      analyticsBatchSize: 10,
      analyticsMaxRetries: 2,
      analyticsTrackScrollDepth: true,
      analyticsTrackTimeSpent: true,
      analyticsTrackOutboundLinks: true,
    }
  }
})
```

### Vite Environment Variables

Create `.env` file:

```bash
# Debug logging (development only)
VITE_ANALYTICS_DEBUG=true

# API configuration
VITE_API_BASE_URL=https://api.clearideas.com/
VITE_EVENT_SITE_NAME=my-vite-app

# Third-party integrations (optional)
VITE_GA_MEASUREMENT_ID=GA-XXXXXXXXXX
VITE_MICROSOFT_ADS_TAG_ID=YOUR_UET_TAG_ID
VITE_MICROSOFT_ADS_GOALS={"signup":"YOUR_SIGNUP_GOAL_ID","purchase":"YOUR_PURCHASE_GOAL_ID"}
VITE_CHAT_ACCESS_KEY=YOUR_CHAT_ACCESS_KEY
VITE_CHAT_API_BASE_URL=https://api.clearideas.com
VITE_CHAT_POSITION=bottom-right
VITE_CHAT_WIDTH=380
VITE_CHAT_HEIGHT=540
VITE_CHAT_OPEN_ON_LOAD=false
VITE_CHAT_ENABLED=true

# Google Ads conversions (auto-fire based on attribution)
# JSON string of event -> conversion ID mappings
VITE_GOOGLE_ADS_CONVERSIONS={"purchase":"AW-123456789/ABCdef123","signup":"AW-123456789/XYZuvw456"}

# Analytics behavior
VITE_ANALYTICS_FLUSH_INTERVAL=60000
VITE_ANALYTICS_CONSENT_CHECK_INTERVAL=86400000
VITE_ANALYTICS_SESSION_CHECK_INTERVAL=1800000
VITE_ANALYTICS_BATCH_SIZE=10
VITE_ANALYTICS_MAX_RETRIES=2
VITE_ANALYTICS_TRACK_SCROLL_DEPTH=true
VITE_ANALYTICS_TRACK_TIME_SPENT=true
VITE_ANALYTICS_TRACK_OUTBOUND_LINKS=true
```

## Attribution Tracking

This package includes built-in **attribution tracking** that captures click IDs from paid advertising platforms and persists them across sessions. Perfect for tracking conversions from Google Ads, Microsoft Ads, Facebook Ads, and other marketing campaigns.

### Consent and attribution

Attribution capture uses the consent state and geographic policy returned by the configured backend. Review that policy and your enabled third-party integrations for your application. The library does not establish legal compliance on its own.

The intended attribution behavior is:
- ✅ **No consent required**: Full attribution capture (non-GDPR regions)
- ✅ **Consent provided**: Full attribution capture
- ✅ **Consent not provided**: Attribution capture skipped (GDPR regions)
- ✅ **First-party storage**: Cookies stored on your domain only
- ✅ **Your server only**: Attribution data sent to your API, not third parties
- ✅ **Right to erasure**: Attribution data cleared when consent withdrawn
- ✅ **Data minimization**: Only essential attribution parameters collected

### What It Tracks

- **Google Ads**: `gclid`, `gbraid`, `wbraid`
- **Microsoft Ads**: `msclkid`
- **Facebook Ads**: `fbclid`
- **UTM Parameters**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- **Session Data**: referrer, landing page, timestamps

### How It Works

1. **Capture**: On first visit, extracts attribution parameters from URL
2. **Persist**: Stores in localStorage + cookie (90 days, cross-subdomain)
3. **Clean**: Optionally removes parameters from URL for cleaner appearance
4. **Attach**: Includes attribution data in all events sent to your `/event` endpoint
5. **Convert**: Automatically fires Google Ads/Microsoft Ads conversions based on attribution

### OpenAI Ads Measurement Pixel

Configure the OpenAI Ads Measurement Pixel with a public Pixel ID:

```bash
VITE_OPENAI_ADS_PIXEL_ID=px_...
VITE_OPENAI_ADS_DEBUG=false
```

For Nuxt, use `openAIAdsPixelId` in public runtime config, or source it from
`NUXT_PUBLIC_OPENAI_ADS_PIXEL_ID`.

When configured and third-party tracking is allowed by consent, the package loads the OpenAI Ads
browser SDK and maps common Clear Ideas events to OpenAI standard events:

- `signup_complete` / `sign_up_complete` -> `registration_completed`
- `trial_started` -> `trial_started`
- `submit_contact_form` and sign-up intent events -> `lead_created`
- `intent_pricing_view` -> `page_viewed`
- `newsletter_signup` -> custom `newsletter_signup`

Override or extend mappings with `VITE_OPENAI_ADS_EVENTS` JSON or `openAIAdsEvents` in Nuxt public
runtime config. Custom mappings may be either a standard event name string or an object:

```json
{
  "quote_requested": {
    "eventName": "custom",
    "customEventName": "quote_requested",
    "type": "custom"
  }
}
```

### Automatic Setup

Attribution tracking is **enabled by default** - no configuration required. The package automatically:

- Captures attribution data on first page load
- Sets cross-subdomain cookies for `.yourdomain.com`
- Sends attribution data to your server API
- Includes attribution in all tracked events
- Cleans URLs after capture by default

Set `analyticsCleanAttributionUrl: false` in Nuxt public runtime config to preserve campaign
parameters in the visible URL after capture.

### Vue/Nuxt Components

Access attribution data in your components:

```vue
<template>
  <!-- Hidden form fields for serverless forms -->
  <input type="hidden" name="gclid" :value="attribution.gclid">
  <input type="hidden" name="msclkid" :value="attribution.msclkid">
  <input type="hidden" name="utm_source" :value="attribution.utm_source">
</template>

<script setup lang="ts">
import { useAttributionContext } from '@clearideas/analytics'

const attribution = useAttributionContext()
// Returns: { gclid: "...", utm_source: "...", landingPath: "...", ... }
</script>
```

### Server-Side (Express.js)

**Optional Express middleware is available in [`docs/express-middleware.md`](docs/express-middleware.md)**

For advanced server-side attribution handling, see the Express middleware documentation. It includes:

- Middleware to attach attribution context to requests
- Automatic attribution injection into form submissions

**Note**: Attribution data is automatically included in all events sent to your `/event` endpoint.

### Session Persistence

Attribution data persists across:
- **Browser sessions**: 90 days in cookies + localStorage
- **Subdomains**: Cookie domain `.yourdomain.com` shares across `app.yourdomain.com`, `blog.yourdomain.com`
- **Server sessions**: Sent to your API on session creation

### Conversion Tracking

**Fully Automatic**: Just call `trackEvent()` - the system detects attribution and fires appropriate conversions.

**Google Analytics**: Always sent (for analytics tracking)
**Google Ads Conversions**: Auto-fired if traffic came from Google Ads
**Microsoft Ads Conversions**: Auto-fired if traffic came from Microsoft Ads

```typescript
// Automatic conversion detection - no manual config needed!
analytics.trackEvent('purchase', {
  value: 99.99,
  currency: 'USD'
})

// System automatically:
// ✅ Sends to your API with attribution data
// ✅ Sends Google Analytics event
// ✅ Fires Google Ads conversion if user came from Google Ads
// ✅ Fires Microsoft Ads conversion if user came from Microsoft Ads

// Manual override still works
analytics.trackEvent('purchase', {
  value: 99.99,
  ads_send_to: 'AW-CUSTOM/CONVERSION' // Force specific conversion
})
```

### Manual Access

For debugging or custom implementations:

```typescript
// Global access (available in browser console)
window.getAttributionContext()
// Returns current attribution data or null

// Programmatic access
import { getAttributionContext } from '@clearideas/analytics'
const attribution = getAttributionContext()
```

### Cross-Domain Tracking

For redirects between different domains:

1. **Same Domain**: Automatic via cookies
2. **Different TLDs**: Preserve query parameters in redirects, or use link decoration
3. **GA4 Linker**: Configure GA4 linker for cross-domain client ID sharing

### Gotchas & Solutions

**Problem**: Attribution parameters disappear after page refresh
**Solution**: Package captures and persists them automatically

**Problem**: Cross-subdomain tracking not working
**Solution**: Cookie uses `.domain.com` - ensure all subdomains share root domain

**Problem**: Serverless forms missing attribution
**Solution**: Use `useAttributionContext()` to add hidden form fields

**Problem**: Wrong conversion attribution
**Solution**: Package only sends conversions to the originating ad platform

### Debug Logging

Enable debug logging to see detailed analytics activity:

**Nuxt:**
```typescript
runtimeConfig: {
  public: {
    analyticsDebug: true, // Shows 🔍 [Analytics] messages in console
  }
}
```

**Vite:**
```bash
VITE_ANALYTICS_DEBUG=true
```

Debug logs include initialization, event tracking, consent status, API calls, and third-party integrations.

## Public Page Detection

For applications with authentication, you can conditionally show consent banners only on public pages:

### Nuxt Version

```typescript
// types/nuxt.d.ts (create this file for proper typing)
import type { Analytics } from '@clearideas/analytics'

declare module '#app' {
  interface NuxtApp {
    $analytics: Analytics
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $analytics: Analytics
  }
}

// In components (with proper typing)
<script setup lang="ts">
const { $analytics } = useNuxtApp()
const analytics = $analytics // Fully typed!

// Or use destructuring:
const analytics = useNuxtApp().$analytics
</script>

// Alternative: Direct access with type assertion
<script setup lang="ts">
import type { Analytics } from '@clearideas/analytics'

const analytics = useNuxtApp().$analytics as Analytics
</script>

// Quick Fix: Inline type declaration (if above doesn't work)
<script setup lang="ts">
const analytics = useNuxtApp().$analytics as {
  trackEvent: (name: string, props?: Record<string, any>) => void
  trackError: (message: string, props?: Record<string, any>) => void
  getConsentStatus: () => Promise<boolean | null>
  showConsentBanner: () => void
}
</script>

// Legacy Options API
export default {
  mounted() {
    const analytics = this.$analytics as any // Type assertion for legacy API
    const route = this.$route

    // Define public routes
    const publicRoutes = ['/login', '/signup', '/pricing', '/about']

    this.$nextTick(() => {
      if (publicRoutes.includes(route.path)) {
        analytics.showConsentBanner()
      }
    })
  }
}

// Troubleshooting TypeScript Issues:
//
// 1. Restart TypeScript Server:
//    Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"
//
// 2. Check tsconfig.json includes types directory:
//    {
//      "include": ["types/**/*", "nuxt.config.ts", ...]
//    }
//
// 3. Verify package installation:
//    npm ls @clearideas/analytics
//
// 4. Alternative: Use type assertion directly:
//    const analytics = useNuxtApp().$analytics as any

```

### Vite SPA Version

```typescript
// In App.vue or router guard
import { useAnalytics } from './lib/analytics/vite'

export default {
  setup() {
    const analytics = useAnalytics()
    const router = useRouter()

    // Define public routes
    const publicRoutes = ['/login', '/signup', '/pricing', '/about']

    router.afterEach((to) => {
      if (publicRoutes.includes(to.path)) {
        // Check if consent banner should be shown
        const { isConsentRequired } = require('./lib/analytics/consent')
        const { getLocalConsentStatus } = require('./lib/analytics/storage')

        if (isConsentRequired()) {
          const consent = getLocalConsentStatus()
          if (consent.consented === null) {
            analytics.showConsentBanner()
          }
        }
      }
    })
  }
}
```

## API Reference

### Analytics Interface

```typescript
interface Analytics {
  trackEvent(name: string, props?: Record<string, any>): void
  trackError(message: string, props?: Record<string, any>): void
  trackUETEvent(eventAction: string, eventLabel?: string, eventValue?: number): void
  trackUETConversion(goalId?: string, revenue?: number, currency?: string): void
  flush(): void
  getConsentStatus(): Promise<boolean | null>
  showConsentBanner(): void
  startAutoTracking(): void
  stopAutoTracking(): void
}
```

### Key Functions

- `trackEvent()`: Track custom events with properties
- `trackError()`: Track JavaScript errors
- `getConsentStatus()`: Check user's consent status
- `showConsentBanner()`: Display GDPR consent banner
- `flush()`: Send all queued events immediately
- `getDontTrackOwnerStatus()`: Get owner tracking status and instructions

### Owner Tracking Management

For website owners and developers who want to prevent their own visits from being tracked:

```typescript
import { getDontTrackOwnerStatus, setDontTrackOwner, isDontTrackOwnerEnabled } from '@clearideas/analytics'

// Check current owner tracking status
const status = getDontTrackOwnerStatus()
console.log(`Owner tracking is ${status.enabled ? 'DISABLED' : 'ENABLED'}`)
console.log(status.instructions) // Shows how to enable/disable

// Programmatically control owner tracking
if (!isDontTrackOwnerEnabled()) {
  setDontTrackOwner(true) // Disable owner tracking
}

// Global functions (available in browser console)
window.disableOwnerTracking() // Disable tracking for your visits
window.enableOwnerTracking()  // Re-enable tracking
window.ownerTrackingStatus()  // Check current status
```

**Note**: Owner tracking status is stored locally and applies only to your browser session.

### Debug Logging Management

For developers who want to enable/disable debug logging from the browser console:

```typescript
import { enableConsoleDebug, disableConsoleDebug, getConsoleDebugStatus } from '@clearideas/analytics'

// Programmatically control debug logging
enableConsoleDebug()  // Enable debug logging
disableConsoleDebug() // Disable debug logging

// Check current debug status
const status = getConsoleDebugStatus()
console.log(`Debug logging is ${status.enabled ? 'ENABLED' : 'DISABLED'} (${status.source})`)

// Global functions (available in browser console)
window.enableDebug()   // Enable debug logging
window.disableDebug()  // Disable debug logging
window.debugStatus()   // Check current debug status and get instructions
```

**Note**: Console debug override takes precedence over config settings and persists for the current browser session.

## Peer Dependencies

This package uses peer dependencies to avoid forcing you to install packages you don't need:

| Package | When Required | Install Command |
|---------|---------------|-----------------|
| `nuxt` | Only for Nuxt projects | `npm install nuxt` |
| `vue` | Required for both frameworks | `npm install vue` |
| `vue-router` | Optional, for route tracking | `npm install vue-router` |

**Missing peer dependencies are handled gracefully** - the package won't crash, it will simply disable the relevant features and show helpful console warnings.

## Migration from Existing Analytics

The API remains backward compatible. Key changes:

1. **Peer Dependencies**: Install only what you need
2. **Debug Logging**: Enable with `analyticsDebug: true` (Nuxt) or `VITE_ANALYTICS_DEBUG=true` (Vite)
3. **Import Paths**: Use `@clearideas/analytics/nuxt` or `@clearideas/analytics/vite`
4. **Graceful Degradation**: Missing optional dependencies won't break your app

## Benefits

- ✅ **Lightweight**: No forced dependencies for unused features
- ✅ **Framework Agnostic**: Same code works in Nuxt and Vite
- ✅ **Consent controls**: Consent state and storage management
- ✅ **Type Safe**: Full TypeScript support
- ✅ **Developer Friendly**: Comprehensive debug logging
- ✅ **Resilient**: Graceful handling of missing dependencies
- ✅ **Performance Optimized**: Event batching and queuing

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run tests: `npm test`
5. Build: `npm run build`
6. Submit a pull request

## Support

- 📖 **Documentation**: This README and inline code comments
- 🐛 **Issues**: [GitHub Issues](https://github.com/clearideas/browser-analytics/issues)
- 📧 **Contact**: For support inquiries, please create an issue
