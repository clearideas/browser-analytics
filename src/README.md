# @clearideas/analytics

Privacy-focused analytics library for Nuxt and Vite applications with GDPR compliance and consent management.

## Features

- ✅ **Multi-framework support**: Works with both Nuxt and Vite
- ✅ **GDPR compliant**: Built-in consent management and cookie banners
- ✅ **Third-party integrations**: Google Analytics 4, Microsoft UET (Bing Ads), Clear Ideas Chat
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
├── consent.ts        # Consent management and GDPR compliance
├── tracking.ts       # Event tracking and queuing system
├── integrations.ts   # Third-party integrations (GA4, UET, Clear Ideas Chat)
├── nuxt.ts           # Nuxt plugin wrapper
├── vite.ts           # Vite SPA wrapper
└── README.md         # This file
```

## Installation

```bash
npm install @clearideas/analytics
# or
yarn add @clearideas/analytics
```

### Optional Peer Dependencies

Install framework-specific packages only if you use them:

```bash
# For Nuxt projects
npm install nuxt

# Clear Ideas Chat loads automatically from CDN (no additional dependencies needed)
```

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

## Third-Party Integration Setup

This package handles consent management automatically, but you need to add the proper HTML templates for Google Analytics and Microsoft UET initialization.

### Google Analytics 4 Setup

Add these scripts to your HTML `<head>` in the correct order:

```html
<!-- 1) Inline bootstrap FIRST: dataLayer, gtag, consent=denied -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    ad_storage: 'denied',
    wait_for_update: 500
  });
</script>

<!-- 2) GA loader script (use your GA4 measurement ID) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA-MEASUREMENT-ID"></script>

<!-- 3) GA + Ads configs AFTER loader -->
<script>
  gtag('config', 'GA-MEASUREMENT-ID', {
    anonymize_ip: true,
    client_storage: 'cookies'
  });
  // Configure Google Ads (optional, if using conversions)
  gtag('config', 'AW-XXXXXXXXX');
</script>
```

### Microsoft UET (Bing Ads) Setup

Add these scripts to your HTML `<head>` after GA:

```html
<!-- Microsoft UET initialization -->
<script>
  (function(w,d,t,r,u)
  {
      var f,n,i;
      w[u]=w[u]||[],f=function()
      {
          var o={ti:"YOUR_UET_TAG_ID", enableAutoSpaTracking: true};
          o.q=w[u],w[u]=new UET(o);
      },
      n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function()
      {
          var s=this.readyState;
          s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)
      },
      i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)
  })
  (window,document,"script","//bat.bing.com/bat.js","uetq");
</script>

<!-- Set default UET consent (denied) -->
<script>
  window.uetq = window.uetq || [];
  window.uetq.push('consent', 'default', {
    'ad_storage': 'denied'
  });
</script>
```

### Automatic Consent Management

The package automatically handles consent updates:

- **Non-GDPR regions**: Consent granted automatically during initialization
- **GDPR regions**: Consent granted only after user accepts banner
- **Consent revocation**: Automatically revokes consent for both GA and UET

**Do not add manual consent helpers** - the package manages all consent updates.

### Configuration Keys

Update your config with the integration IDs:

```typescript
{
  gaMeasurementId: 'GA-XXXXXXXXXX',        // Your GA4 measurement ID
  googleAdsConversions: {                   // Optional: conversion mappings
    'purchase': 'AW-XXXXXXX/ABC123',
    'signup': 'AW-XXXXXXX/DEF456'
  },
  microsoftAdsTagId: 'YOUR_UET_TAG_ID',   // Your Microsoft UET tag ID
  microsoftAdsGoals: {                     // Optional: goal mappings
    'purchase': '12345678',
    'signup': '87654321'
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
      microsoftAdsTagId: 'YOUR_UET_TAG_ID',   // Microsoft UET (Bing Ads)
      chatAccessKey: 'YOUR_CHAT_ACCESS_KEY',  // Clear Ideas Chat access key (required)
      chatApiBaseUrl: 'https://api.clearideas.com', // Clear Ideas Chat API base URL (optional)
      chatPosition: 'bottom-right',            // Widget position (optional)
      chatEnabled: true,                       // Enable/disable chat widget (default: true)

      // Microsoft UET custom goals
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
VITE_MICROSOFT_ADS_GOALS='{"signup":"12345","purchase":"67890"}'
VITE_CHAT_ACCESS_KEY=YOUR_CHAT_ACCESS_KEY
VITE_CHAT_API_BASE_URL=https://api.clearideas.com
VITE_CHAT_POSITION=bottom-right
VITE_CHAT_ENABLED=true

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
// In a layout or page component
export default defineComponent({
  setup() {
    const analytics = useNuxtApp().$analytics
    const route = useRoute()

    // Define public routes
    const publicRoutes = ['/login', '/signup', '/pricing', '/about']

    onMounted(() => {
      if (publicRoutes.includes(route.path)) {
        analytics.showConsentBanner()
      }
    })
  }
})
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

## Peer Dependencies

This package uses peer dependencies to avoid forcing you to install packages you don't need:

| Package | When Required | Install Command |
|---------|---------------|-----------------|
| `nuxt` | Only for Nuxt projects | `npm install nuxt` |
| Clear Ideas Chat | Loads automatically from CDN | No installation needed |
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
- ✅ **GDPR Compliant**: Consent management built-in
- ✅ **Type Safe**: Full TypeScript support
- ✅ **Developer Friendly**: Comprehensive debug logging
- ✅ **Resilient**: Graceful handling of missing dependencies
- ✅ **Performance Optimized**: Event batching and queuing

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Contributing

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
