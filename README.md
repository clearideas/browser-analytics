# Browser Analytics

An MIT-licensed, privacy-focused browser analytics client with a built-in consent banner. Works on any website: a plain `<script>` tag, React, Next.js, Vue/Vite, Nuxt, SvelteKit, Angular, Astro and more.

The client talks to a **collector** through a documented HTTP contract: [`spec/openapi.yaml`](spec/openapi.yaml) (v1). A reference collector and an interactive playground are in [`sample-host/`](sample-host/README.md); see [docs/BACKEND.md](docs/BACKEND.md) for implementers.

**Try it:** `npm ci && (cd sample-host && npm ci) && npm run playground`, then open http://localhost:5173.

## Features

- ✅ **Any site or framework**: script tag, React, Next.js, Vue/Vite, Nuxt, plus History-API detection for SvelteKit, Angular, Astro, Remix/React Router
- ✅ **Consent**: region-aware policy from your collector, a framework-neutral accessible banner, a headless consent API, Global Privacy Control
- ✅ **Third-party tools under consent**: a directory of plugins (Google Analytics 4 / Google Ads, Microsoft UET, OpenAI Ads, Clear Ideas Chat, HubSpot, Intercom, Meta Pixel, LinkedIn Insight, Microsoft Clarity, Hotjar) or your own, loaded only when allowed; consent-gated `<script>` tags for everything else; withdrawal removes their cookies and stops them (see [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md))
- ✅ **Changing a decision later**: a footer link (`href="#ci-consent-settings"`) or a floating button reopens the banner
- ✅ **Privacy by default**: URLs sanitized, no cookies unless configured, no fingerprinting data, nothing on `window` unless asked
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
├── consent.ts        # Consent state, policy version, consent records
├── banner.ts         # Framework-neutral consent banner and "Cookie settings" button
├── gated-scripts.ts  # Consent-gated <script type="text/plain" data-ci-consent> tags
├── tracking.ts       # Event tracking and queuing system
├── integrations.ts   # Helpers shared by integrations
├── plugins/          # Plugin host and the plugin directory (loaded on demand)
├── nuxt.ts           # Nuxt plugin wrapper
└── vite.ts           # Vite SPA wrapper
```

## Installation

Install the public package from npm after the first public release:

```bash
npm install @clearideas/consent-analytics
```

No npm account or private registry token is required for public releases. To try an unreleased checkout, run `npm ci`, `npm run check`, and `npm pack`; install the resulting `.tgz` in your application. Use Node.js 22.22.3+ or 24.15+ for development.

### Optional Peer Dependencies

Install framework-specific packages only if you use them:

```bash
# For Nuxt projects
npm install nuxt

# Clear Ideas Chat loads automatically from CDN (no additional dependencies needed)
```

### Clear Ideas Chat

The chat widget is an integration like the others: configure `integrations.clearIdeasChat` (see [Integrations](#integrations-plugins)). No events are sent to the chat. Once loaded, the widget instance is available as `window.clearIdeasWidget` (`open()`, `close()`, `toggle()`, `hide()`, `show()`, `destroy()`).

### Troubleshooting

If npm reports a 404, check that the public release is available and that your registry is `https://registry.npmjs.org/`. An existing organization-level `.npmrc` can redirect this scope to a private registry.

**"useRuntimeConfig is not defined" (Nuxt):**
- Not needed with Nuxt 4: the example app (`examples/nuxt`) works with just `plugins: ['@clearideas/consent-analytics/nuxt.client']`.
- If you see this error on an older Nuxt, add `@clearideas/consent-analytics` to `build.transpile` in `nuxt.config.ts`.

## Quick start by framework

Every integration needs only your collector URL (`apiBaseUrl`) and `siteKey`; everything else is optional (see [Configuration](#configuration)). Working apps for Next.js, React Router, Vue, Nuxt, SvelteKit, Angular and Astro are in [`examples/`](examples/README.md); CI builds each one and tests it in a real browser.

### Any website: script tag

No build tools. Put this in `<head>`:

```html
<script async src="https://cdn.jsdelivr.net/npm/@clearideas/consent-analytics/dist/analytics.js"
        data-api-base-url="https://collector.example.com/"
        data-site-key="my-site"></script>
```

- More settings (integrations, banner texts, …): set `window.ciAnalyticsConfig = { … }` before the tag.
- Calls made before the script loads can be queued; they run once the consent policy is known:
  `(window.ciAnalyticsQueue = window.ciAnalyticsQueue || []).push(['trackEvent', 'sign_up', { plan: 'pro' }])`.
- API after loading: `ClearIdeasAnalytics.get().trackEvent(…)`, `ClearIdeasAnalytics.get().consent.showBanner()`.
- Other `data-*` options: `data-cookie-domain`, `data-website-base-url`, `data-debug`, `data-banner="false"`, `data-route-changes="manual"`, `data-auto-init="false"`.
- Pin a version in production (`…/@clearideas/consent-analytics@x.y.z/dist/analytics.js`) and add `integrity`/`crossorigin` attributes.
- Integrations are separate files next to `analytics.js` (`dist/script-plugins/`), downloaded only when configured and allowed. They're integrity-checked with hashes built into `analytics.js`, so pinning `analytics.js` pins them too. When self-hosting, copy both (see [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md#script-tag-build-plugin-files)).
- With a Content Security Policy nonce, put the nonce on this tag.

### Any framework: `@clearideas/consent-analytics/browser`

```typescript
import { initBrowserAnalytics } from '@clearideas/consent-analytics/browser'

const analytics = initBrowserAnalytics({ apiBaseUrl: 'https://collector.example.com/', siteKey: 'my-site' })
analytics.trackEvent('sign_up', { plan: 'pro' })
```

Page changes are detected from the History API (`pushState`/`replaceState`/back-forward). That is what the routers of Next.js, React Router/Remix, SvelteKit, Angular, Astro (view transitions) and Vue Router use. In-page anchors (`#section`) and URL clean-ups are not counted as pages. Calling `initBrowserAnalytics` again returns the running instance.

To report navigations yourself, pass `{ routeChanges: 'manual' }` and call `analytics.notifyRouteChange()` after each one:

```typescript
// SvelteKit: src/routes/+layout.svelte (SvelteKit 3 takes its config in vite.config.js)
import { afterNavigate } from '$app/navigation'
import { browser } from '$app/environment'
import { initBrowserAnalytics } from '@clearideas/consent-analytics/browser'
if (browser) {
  const analytics = initBrowserAnalytics(config, { routeChanges: 'manual' })
  afterNavigate(() => analytics.notifyRouteChange())
}

// Angular (main.ts, after bootstrapApplication; see examples/angular)
const appRef = await bootstrapApplication(AppComponent, appConfig)
const analytics = initBrowserAnalytics(config, { routeChanges: 'manual' })
appRef.injector.get(Router).events
  .pipe(filter(event => event instanceof NavigationEnd))
  .subscribe(() => analytics.notifyRouteChange())

// Astro with view transitions (<ClientRouter />): report each page load.
// The consent banner is restored automatically when the page body is replaced.
document.addEventListener('astro:page-load', () => analytics.notifyRouteChange())
```

(With the default `'history'` mode none of this is needed; manual mode is for frameworks where you prefer their own navigation events.)

### React (and React Router, Remix, Vite + React)

```tsx
import { AnalyticsProvider, useAnalytics, useConsent } from '@clearideas/consent-analytics/react'

<AnalyticsProvider config={{ apiBaseUrl: 'https://collector.example.com/', siteKey: 'my-site' }}>
  <App />
</AnalyticsProvider>

function SignUpButton() {
  const analytics = useAnalytics()          // null until mounted in the browser
  return <button onClick={() => analytics?.trackEvent('sign_up')}>Sign up</button>
}

function CookieLink() {
  const consent = useConsent()              // { required, granted, gpc, policyVersion } | null
  const analytics = useAnalytics()
  return <a onClick={() => analytics?.consent.showBanner()}>Cookies ({consent?.granted ? 'on' : 'off'})</a>
}
```

It's safe with server rendering (nothing runs until the component mounts) and with StrictMode. `react` ≥ 18 is an optional peer dependency.

### Next.js (App Router)

```tsx
// app/layout.tsx
import { ClearIdeasAnalytics } from '@clearideas/consent-analytics/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClearIdeasAnalytics config={{ apiBaseUrl: process.env.NEXT_PUBLIC_COLLECTOR_URL!, siteKey: 'my-site' }}>
          {children}
        </ClearIdeasAnalytics>
      </body>
    </html>
  )
}
```

- Navigations are reported from Next's `usePathname`/`useSearchParams`, inside a Suspense boundary, so static rendering is unaffected.
- Use `useAnalytics()`/`useConsent()` (also exported from `@clearideas/consent-analytics/next`) in client components.
- For the Pages Router, use `AnalyticsProvider` from `@clearideas/consent-analytics/react` in `_app.tsx`.

### Nuxt and Vue (Vite)

See [Nuxt Application](#nuxt-application) and [Vite SPA Application](#vite-spa-application) below.

## Usage

### Nuxt Application

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  plugins: ['@clearideas/consent-analytics/nuxt.client'], // Client-side only
  runtimeConfig: {
    public: {
      analyticsDebug: true, // Enable debug logging
      apiBaseUrl: 'https://collector.example.com/', // collector implementing spec/openapi.yaml
      analyticsSiteKey: 'my-site',                  // site key registered with the collector
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
import { initViteAnalytics } from '@clearideas/consent-analytics/vite'

const app = createApp(App)
const router = createRouter({ /* router config */ })

// Initialize analytics
const analytics = initViteAnalytics(router)

app.use(router)
app.mount('#app')
```

```typescript
// In Vue components
import { useAnalytics } from '@clearideas/consent-analytics/vite'

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
  plugins: ['@clearideas/consent-analytics/nuxt.client'],
  runtimeConfig: {
    public: {
      // Debug logging (development only)
      analyticsDebug: true,

      // API configuration
      apiBaseUrl: 'https://collector.example.com/',
      analyticsSiteKey: 'my-site', // falls back to eventSiteName if not set

      // Integrations (optional; see "Integrations"). Objects or JSON strings.
      analyticsIntegrations: {
        googleAnalytics: {
          measurementId: 'G-XXXXXXXXXX',
          adsConversions: { purchase: 'AW-123456789/ABCdef123', sign_up: 'AW-123456789/XYZuvw456' },
        },
        microsoftUet: { tagId: 'YOUR_UET_TAG_ID', goals: { purchase: 'YOUR_GOAL_ID' } },
        clearIdeasChat: { accessKey: 'YOUR_CHAT_ACCESS_KEY', position: 'bottom-right' },
      },

      // Consent banner (optional; see "Consent banner and API"). false = your own UI.
      analyticsBanner: { privacyPolicyUrl: 'https://example.com/privacy' },
      analyticsRespectGpc: true, // honor Global Privacy Control (default)
      analyticsConsent: { choices: 'categories' },  // how consent is asked (optional)
      analyticsGatedScripts: { allowedOrigins: ['https://js.hs-scripts.com'] }, // or false (optional)

      // Analytics behavior
      analyticsFlushInterval: 60000,           // 1 minute
      analyticsBatchSize: 10,
      analyticsMaxRetries: 2,
      analyticsTrackScrollDepth: true,
      analyticsTrackTimeSpent: true,
      analyticsTrackOutboundLinks: true,

      // Privacy & scope (optional)
      analyticsUrlQueryAllowlist: 'q,page',    // extra query params kept in page URLs (array or comma list)
      analyticsCookieDomain: 'example.com',    // share attribution across subdomains (default: no cookie)
      analyticsExposeGlobals: false,           // window.ciAnalytics console helpers (also on with analyticsDebug)
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
VITE_API_BASE_URL=https://collector.example.com/
VITE_ANALYTICS_SITE_KEY=my-site   # falls back to VITE_EVENT_SITE_NAME

# Integrations (optional, JSON; see "Integrations")
VITE_ANALYTICS_INTEGRATIONS={"googleAnalytics":{"measurementId":"G-XXXXXXXXXX","adsConversions":{"purchase":"AW-123456789/ABCdef123"}},"clearIdeasChat":{"accessKey":"YOUR_CHAT_ACCESS_KEY"}}

# Consent banner (optional, JSON or "false" for your own UI)
VITE_ANALYTICS_BANNER={"privacyPolicyUrl":"https://example.com/privacy"}
VITE_ANALYTICS_RESPECT_GPC=true
# How consent is asked (optional, JSON; see "Consent banner and API")
VITE_ANALYTICS_CONSENT={"choices":"categories"}
# Consent-gated <script> tags (optional, JSON or "false"; see docs/THIRD_PARTY.md)
VITE_ANALYTICS_GATED_SCRIPTS={"allowedOrigins":["https://js.hs-scripts.com"]}

# Analytics behavior
VITE_ANALYTICS_FLUSH_INTERVAL=60000
VITE_ANALYTICS_BATCH_SIZE=10
VITE_ANALYTICS_MAX_RETRIES=2
VITE_ANALYTICS_TRACK_SCROLL_DEPTH=true
VITE_ANALYTICS_TRACK_TIME_SPENT=true
VITE_ANALYTICS_TRACK_OUTBOUND_LINKS=true

# Privacy & scope (optional)
VITE_ANALYTICS_URL_QUERY_ALLOWLIST=q,page   # extra query params kept in page URLs
VITE_ANALYTICS_COOKIE_DOMAIN=example.com    # share attribution across subdomains (default: no cookie)
VITE_ANALYTICS_EXPOSE_GLOBALS=false         # window.ciAnalytics console helpers (also on with debug)
VITE_WEBSITE_BASE_URL=https://example.com/  # consent banner links to <base>privacy
```

### Consent model

- The collector decides whether consent is required for a visitor (`GET /v1/context`, usually by region) and publishes a `policyVersion`. If the context cannot be fetched, consent is required.
- The visitor's decision is stored in the browser (`localStorage`, key `ci_consent_status`). It applies immediately, and a consent record is sent to the collector (`POST /v1/consent`). Records that cannot be delivered are retried on the next visit.
- When the collector publishes a new `policyVersion`, visitors who decided under the old one are asked again.
- Until a visitor consents where consent is required, only anonymous `limited` events are sent (`page_view`, `page_exit`, `web_vital`, `auto_metrics`, `error`), and third-party tags stay denied.
- **Nothing at all without consent, in some regions.** If the collector's policy says `trackingWithoutConsent: 'none'` for a visitor's region, nothing is sent while statistics consent is not given (undecided or refused). Nothing is stored either, except the consent mechanism itself. Elsewhere the anonymous `limited` events continue. A site-wide default can be set with `consent: { trackingWithoutConsent: 'none' }`; the collector's per-region answer takes precedence. The sample collector configures this with `NO_TRACKING_WITHOUT_CONSENT_COUNTRIES` (e.g. `DE,AT`) or per site.
- Requests to the collector carry no cookies.
- **Refusal and withdrawal.** Third-party tools the library controls stop, and the cookies and storage keys declared for them are deleted. If a running tool can't be stopped in place, the page reloads once after the decision is saved (`consent: { reloadOnWithdrawal: false }` turns that off). Details in [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md#what-refusal-and-withdrawal-do).

If your server already knows the policy (server-side rendering, an edge function), pass it in the config as `initialContext: { consentRequired, policyVersion, country }` to skip the context request. (Currently available when calling `initAnalytics`/`createAnalytics` directly; the Nuxt and Vite integrations do not read it yet.)

### Why it works this way (GDPR and ePrivacy)

Several parts of the design come from GDPR and the EU ePrivacy Directive. They are explained here so they are not removed as unnecessary complexity. This section describes the design; it is not legal advice, and how you configure and use the library is up to you.

| Behavior | Reason |
|---|---|
| Consent before non-essential storage or access on the device (cookies, `localStorage`), with the consent decision itself treated as necessary | ePrivacy Directive Art. 5(3) requires consent for storage that isn't strictly necessary. GDPR defines what valid consent is (Art. 4(11), Art. 7). |
| Unknown region or failed context request means consent is required | Safe default. If the visitor's region is unknown, the library can't assume consent is unnecessary. |
| Reject is as prominent as accept; the banner can be reopened at any time (footer link or "Cookie settings" button) | Consent must be freely given, and withdrawing it must be as easy as giving it (GDPR Art. 4(11), Art. 7(3); EDPB Guidelines 05/2020). |
| Category checkboxes are never pre-ticked | Silence or pre-ticked boxes are not consent (GDPR Recital 32; CJEU *Planet49*, C-673/17). |
| Separate `statistics` and `marketing` categories | Consent must be specific to each purpose (GDPR Art. 4(11), Art. 6(1)(a)). |
| Append-only consent records with `consentId`, `policyVersion`, `decidedAt`, `source` | The site must be able to show that consent was given (GDPR Art. 7(1)). Withdrawals are new records, so history is never overwritten. |
| Asking again when `policyVersion` changes | Consent is only valid for the purposes the visitor was told about. |
| Attribution data and vendor cookies deleted when consent is withdrawn; third-party code that can't be stopped is removed by a page reload | Once consent is withdrawn, data kept only because of it should stop being processed and be erased (GDPR Art. 7(3), Art. 17(1)(b)). |
| Third-party code is loaded by the library only after consent (plugins, gated scripts), never before | Storage and access on the device by those tools needs consent first (ePrivacy Art. 5(3)); a tool that has already run can't be un-run. |
| URL sanitization, no fingerprinting fields, no IPs or cookies with consent records | Data minimization and data protection by default (GDPR Art. 5(1)(c), Art. 25). Reading device characteristics can fall under ePrivacy Art. 5(3) as well (EDPB Guidelines 2/2023). |
| `trackingWithoutConsent: 'none'` per region | EU countries don't agree on whether anonymous audience measurement without consent is acceptable (France's CNIL allows a narrow exemption; other regulators are stricter), so this is set per region rather than fixed. |

Global Privacy Control is a different matter: it comes from US state privacy laws (e.g. California's CCPA/CPRA opt-out of sale/sharing), not GDPR, which is why it withholds only `marketing`.

### What leaves the page

- **Page URLs** are reduced to origin + path + campaign parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` and the `ci_*` equivalents). Other query parameters (reset tokens, emails, session IDs, search terms) and `#fragments` are removed, for your backend and for third parties alike. Keep site-specific parameters with `urlQueryAllowlist`.
- **Referrers** are reduced to origin + path.
- **Before consent** (where consent is required), URLs are origin + path only and events carry only an allowlisted, anonymous set of fields.
- **Google Analytics** receives each event's own parameters. Attribution data, click IDs and this library's control keys (`ads_send_to`, `force_ads_conversion`, `goal_id`, ...) are used for conversion decisions but not forwarded as event parameters.
- Props objects passed to `trackEvent()` are never modified.

## Integrations (plugins)

Third-party tools are **plugins**, enabled by configuration (`integrations` in `initAnalytics`/`createAnalytics`, `analyticsIntegrations` in Nuxt, `VITE_ANALYTICS_INTEGRATIONS` in Vite, `window.ciAnalyticsConfig.integrations` with the script tag). Each built-in integration is a separate chunk that is downloaded only when it is configured **and** allowed.

**[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)** is the full guide: the plugin directory with per-service notes, consent-gated `<script>` tags for tools without a plugin, what refusal and withdrawal do, and writing your own plugin.

| Integration | Options | Consent category |
| --- | --- | --- |
| `googleAnalytics` | `measurementId`, `adsConversions` (event → `AW-…/label`), `loadScript` (default `true`), `scriptUrl`, `events` (`'page_views_and_custom'` default, or `'all'`) | statistics (Consent Mode: `analytics_storage` ← statistics, `ad_*` ← marketing; Ads conversions need marketing). Marketing if used for Ads only. |
| `microsoftUet` | `tagId`, `goals` (event → goal ID), `loadScript` (default `true`), `scriptUrl`, `events` (`'custom'` default, or `'all'`) | marketing |
| `openAIAds` | `pixelId`, `events`, `debug`, `scriptUrl` | marketing |
| `clearIdeasChat` | `accessKey`, `widgetUrl`, `cssUrl`, `integrity`, `cssIntegrity`, `requiresConsent` (default `false`), widget options (`position`, `width`, …) | necessary (functional); preferences with `requiresConsent: true` |
| `hubspot` | `portalId`, `region` (`'na1'`/`'eu1'`), `events` (event → custom behavioral event), `pageViews`, `category`, `scriptUrl` | marketing (configurable) |
| `intercom` | `appId`, `region` (`'us'`/`'eu'`/`'au'`), `user` (with `user_hash`), `settings`, `events` (`'none'`/`'custom'`), `category`, `scriptUrl` | preferences (configurable) |
| `metaPixel` | `pixelId`, `events` (event → Meta event), `autoConfig` (default `false`), `scriptUrl` | marketing |
| `linkedInInsight` | `partnerId`, `conversions` (event → conversion ID), `scriptUrl` | marketing; withdrawal reloads the page |
| `microsoftClarity` | `projectId`, `events` (`'none'`/`'custom'`), `scriptUrl` | statistics; withdrawal reloads the page |
| `hotjar` | `siteId`, `events` (`'none'`/`'custom'`), `scriptUrl` | statistics; withdrawal reloads the page |

How the core runs them:

- A plugin runs only when its category is allowed: the visitor accepted it, or consent is not required for the visitor (marketing additionally requires that the browser sends no Global Privacy Control signal). Events are never sent to a plugin that is not allowed.
- **Consent before configuration.** With `loadScript: true`, `gtag.js` and `bat.js` are loaded only after consent, and the vendor's consent state is set before the tag is configured. With `loadScript: false` (a tag your page installs itself), the library keeps that tag's consent state in sync: `denied` until allowed, then `granted`.
- The page where the visitor accepts is sent to the integration (so the first page view is not lost).
- **Withdrawing consent** tells the vendor (`denied`, `revoke`, `shutdown`, …) and deletes its first-party cookies and storage keys for that category (e.g. statistics: `_ga*`, `_gid`; marketing: `_gcl_*`, `_uet*`). Vendors that can't be stopped once running (LinkedIn Insight, Clarity, Hotjar) trigger one page reload after the decision is saved.
- **Refusing** deletes the same data, on every page load while the refusal stands (a vendor may have set it on an earlier visit).
- Integrations receive each event's own parameters. Attribution and click IDs are used for conversion decisions (Google Ads, Microsoft Ads) but not forwarded.
- **Chat script integrity:** pin a versioned `widgetUrl` and set `integrity` (Subresource Integrity) so a change on the CDN cannot change the code running on your site.

The older flat settings (`gaMeasurementId`, `googleAdsConversions`, `microsoftAdsTagId`, `microsoftAdsGoals`, `openAIAdsPixelId`, `chat*`) still work. They map to these integrations with their previous behavior (page-installed Google/Microsoft tags, all events forwarded). Explicit `integrations` settings win, and `false` disables one.

### Custom plugins

```typescript
import type { AnalyticsPlugin } from '@clearideas/consent-analytics'

const myTool: AnalyticsPlugin = {
  name: 'myTool',
  category: 'statistics',           // necessary | preferences | statistics | marketing (default)
  cookies: [/^_mytool/],            // deleted on refusal and withdrawal
  storage: ['mytool.*'],            // localStorage/sessionStorage keys, same
  withdrawal: 'stop',               // 'reload' if the vendor can't be stopped (default without consentChanged)
  load(ctx) { return ctx.loadScript('https://cdn.example.com/mytool.js', { integrity: 'sha384-…' }) },
  consentChanged(state) { window.myTool?.setConsent(state.allowed) },
  track(event) { window.myTool?.track(event.name, event.params) },
}

initAnalytics({ ...config, plugins: [myTool] }, adapter)
```

The built-in factories are also available for code-level use: `import { googleAnalytics, hubspot } from '@clearideas/consent-analytics/plugins'`. A checklist for writing plugins is in [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md#writing-a-custom-plugin).

**Tools without a plugin:** gate the vendor's own `<script>` tag instead. The browser doesn't run `type="text/plain"` scripts, and the library starts them once the category is allowed:

```html
<script type="text/plain" data-ci-consent="marketing" src="https://cdn.vendor.example/tag.js"
        data-ci-cookies="_vendor*"></script>
```

This controls only *when* the script starts. It gets none of your events, and withdrawal reloads the page. See [Consent-gated scripts](docs/THIRD_PARTY.md#consent-gated-scripts), including how this works safely with a Content Security Policy.

## Consent banner and API

The built-in banner is framework-neutral and accessible:
- It's a labelled region with native buttons, and it's keyboard operable.
- Accept and reject are equally prominent.
- It doesn't take focus on page load, but does when the visitor opens it.
- The privacy link only accepts http(s) URLs.
- Configured text is always rendered as text, never as HTML.

```typescript
banner: {
  title: 'Cookies',
  message: 'We use cookies to …',
  acceptLabel: 'Accept all',
  rejectLabel: 'Reject non-essential',
  privacyPolicyUrl: 'https://example.com/privacy', // default: <websiteBaseUrl>privacy, or /privacy
  privacyLinkLabel: 'Privacy policy',
  position: 'bottom',            // or 'top'
  autoShow: true,                // false: only when you call analytics.consent.showBanner()
  injectStyles: true,            // false: style .ci-consent yourself
  manageButton: 'auto',          // floating "Cookie settings" button: 'auto' | true | false
  manageLabel: 'Cookie settings',
}
```

Theme it with CSS custom properties: `--ci-consent-background`, `--ci-consent-color`, `--ci-consent-border`, `--ci-consent-link`, `--ci-consent-button-background`, `--ci-consent-button-color`, `--ci-consent-button-border`, `--ci-consent-radius`, `--ci-consent-font`, `--ci-consent-focus`, `--ci-consent-max-width`, `--ci-consent-z-index`.

**Changing a decision.** Once a visitor has decided, the banner is gone. Add a link to your footer that reopens it:

```html
<a href="#ci-consent-settings">Cookie settings</a>
```

- `data-ci-consent-settings` or the class `ci-consent-settings` work as well, on any link or button.
- The link opens the banner with focus on the choices, in every region. It works with client-side routers, and before the script has loaded (the banner opens on arrival at `#ci-consent-settings`).
- Without such a link, a small floating "Cookie settings" button appears once a visitor has decided, where consent is required (`manageButton: 'auto'`, the default). With the link on the page, the button isn't added.
- From code: `analytics.consent.showBanner()`.

**Headless.** With `banner: false`, build your own UI on the consent API:

```typescript
analytics.consent.get()        // { required, granted, categories, gpc, policyVersion }
await analytics.consent.accept()
await analytics.consent.reject()
await analytics.consent.set({ statistics: true, marketing: false })
const stop = analytics.consent.onChange(state => { /* ... */ })
analytics.consent.showBanner() // built-in banner on demand (no-op with banner: false)
```

**Consent categories.** By default visitors make one choice (*simple* mode): "Accept all" or "Reject non-essential", recorded as the same choice for every category. To let visitors choose per category, use:

```typescript
consent: { choices: 'categories', categories: ['statistics', 'marketing'] } // default: all three
```

The banner then gets a **Customize** button. It opens a list of categories with descriptions; none is pre-ticked, and "Necessary" is always on. Choices are recorded as `partial` with the choice per category. What each category covers:

| Category | Covers |
| --- | --- |
| necessary | The consent mechanism; functional integrations (chat by default) |
| preferences | Remembered settings (chat storage with `requiresConsent: true`), Intercom (default) |
| statistics | Full first-party analytics (`full` events), stored attribution, Google Analytics, Microsoft Clarity, Hotjar |
| marketing | Google Ads conversions and ad signals, Microsoft UET, OpenAI Ads, Meta Pixel, LinkedIn Insight, HubSpot (default), custom plugins by default |

Labels and descriptions are configurable: `banner.categoryText`, `customizeLabel`, `saveLabel`, `categoriesLegend`. The headless API accepts per-category choices too: `analytics.consent.set({ statistics: true, marketing: false })`. `consent.get().categories` and React's `useConsent()` report them.

**Global Privacy Control** is an opt-out of sale/sharing, so it withholds **marketing** where consent is not required, unless the visitor explicitly accepts. Analytics is unaffected. Set `respectGlobalPrivacyControl: false` to turn this off.

## Attribution Tracking

This package includes built-in **attribution tracking** that captures click IDs from paid advertising platforms and persists them across sessions. Perfect for tracking conversions from Google Ads, Microsoft Ads, Facebook Ads, and other marketing campaigns.

### Consent and attribution

Attribution capture follows the consent policy from the collector (see *Consent model*). The library applies whatever policy and category choices it's given; deciding what that policy should be for your site, your users, and your third-party integrations is up to you.

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
- **UTM Parameters**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_context`
- **Internal campaign parameters**: `ci_source`, `ci_medium`, `ci_campaign`, `ci_term`, `ci_content`
- **Session Data**: referrer (origin + path), landing path, timestamps

Only these keys are captured. Values longer than 256 characters are dropped, and data read back from storage or cookies is re-validated, so unexpected keys are never sent.

### How It Works

1. **Capture**: On first visit, extracts attribution parameters from URL
2. **Persist**: Stores in localStorage once storage is allowed (immediately, or when the visitor accepts the banner, even after navigating away from the landing page). With `cookieDomain` set, also in a 90-day cookie shared across subdomains
3. **Clean**: Optionally removes parameters from URL for cleaner appearance
4. **Attach**: Includes attribution data in events sent to your collector (`POST /v1/events`)
5. **Convert**: Automatically fires Google Ads/Microsoft Ads conversions based on attribution

### OpenAI Ads Measurement Pixel

Configure the OpenAI Ads Measurement Pixel as an integration, with a public Pixel ID:

```json
{ "openAIAds": { "pixelId": "px_...", "debug": false } }
```

When consent allows it, the package loads the OpenAI Ads browser SDK and maps common Clear Ideas
events to OpenAI standard events:

- `signup_complete` / `sign_up_complete` -> `registration_completed`
- `trial_started` -> `trial_started`
- `submit_contact_form` and sign-up intent events -> `lead_created`
- `intent_pricing_view` -> `page_viewed`
- `newsletter_signup` -> custom `newsletter_signup`

Override or extend mappings with `events` in the integration's options. Custom mappings may be
either a standard event name string or an object:

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

- Captures attribution data on first page load (or when consent is given)
- Sets a cross-subdomain cookie only if you configure `cookieDomain`
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
import { useAttributionContext } from '@clearideas/consent-analytics'

const attribution = useAttributionContext()
// Returns: { gclid: "...", utm_source: "...", landingPath: "...", ... }
</script>
```

**Note**: Attribution data is automatically included in `full` events sent to your collector (`props.attribution`).

### Session Persistence

Attribution data persists across:
- **Browser sessions**: localStorage (and the 90-day cookie when `cookieDomain` is set)
- **Subdomains**: set `cookieDomain: 'yourdomain.com'` to share across `app.yourdomain.com` and `blog.yourdomain.com`. The domain must be the current host or a parent of it; it is never guessed, so unrelated tenants on shared hosting domains don't share attribution

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
// Browser console (when exposeGlobals or debug is enabled)
ciAnalytics.getAttributionContext()
// Returns current attribution data or null

// Programmatic access
import { getAttributionContext } from '@clearideas/consent-analytics'
const attribution = getAttributionContext()
```

### Cross-Domain Tracking

For redirects between different domains:

1. **Same Domain / subdomains**: Automatic within one origin; set `cookieDomain` to share across subdomains
2. **Different TLDs**: Preserve query parameters in redirects, or use link decoration
3. **GA4 Linker**: Configure GA4 linker for cross-domain client ID sharing

### Gotchas & Solutions

**Problem**: Attribution parameters disappear after page refresh
**Solution**: Package captures and persists them automatically

**Problem**: Cross-subdomain tracking not working
**Solution**: Set `cookieDomain` to the shared parent domain (e.g. `example.com`); it is off by default

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

## Typing `$analytics` in Nuxt

```typescript
// types/nuxt.d.ts
import type { Analytics } from '@clearideas/consent-analytics'

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
```

Then `const { $analytics } = useNuxtApp()` is fully typed.

### Showing the banner only on some pages

Turn off the automatic display and show the built-in banner where you want, for example on public pages only:

```typescript
// config: banner: { autoShow: false }   (Nuxt: analyticsBanner, Vite: VITE_ANALYTICS_BANNER)
router.afterEach(to => {
  const { required, granted } = analytics.consent.get()
  if (publicRoutes.includes(to.path) && required && granted === null) {
    analytics.consent.showBanner()
  }
})
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
  consent: {
    get(): { required: boolean; granted: boolean | null; gpc: boolean; policyVersion?: string }
    accept(): Promise<void>
    reject(): Promise<void>
    onChange(listener: (state) => void): () => void
    showBanner(): void
  }
}
```

### Key Functions

- `trackEvent()`: Track custom events with properties
- `trackError()`: Track JavaScript errors
- `getConsentStatus()`: Check user's consent status
- `showConsentBanner()`: Display the consent banner
- `consent`: Headless consent API (see *Consent banner and API*)
- `flush()`: Send all queued events immediately
- `startAutoTracking()`: Start automatic page view, exit, scroll, outbound-link and web-vital tracking (idempotent; called for you by the Nuxt/Vite integrations)
- `stopAutoTracking()`: Remove all automatic-tracking listeners and observers; can be restarted
- `getDontTrackOwnerStatus()`: Get owner tracking status and instructions

### Owner Tracking Management

For website owners and developers who want to prevent their own visits from being tracked:

```typescript
import { getDontTrackOwnerStatus, setDontTrackOwner, isDontTrackOwnerEnabled } from '@clearideas/consent-analytics'

// Check current owner tracking status
const status = getDontTrackOwnerStatus()
console.log(`Owner tracking is ${status.enabled ? 'DISABLED' : 'ENABLED'}`)
console.log(status.instructions) // Shows how to enable/disable

// Programmatically control owner tracking
if (!isDontTrackOwnerEnabled()) {
  setDontTrackOwner(true) // Disable owner tracking
}

// Browser console (when exposeGlobals or debug is enabled)
ciAnalytics.disableOwnerTracking() // Disable tracking for your visits
ciAnalytics.enableOwnerTracking()  // Re-enable tracking
ciAnalytics.ownerTrackingStatus()  // Check current status
```

**Note**: Console helpers are opt-in. Set `exposeGlobals: true` (Nuxt `analyticsExposeGlobals`, Vite `VITE_ANALYTICS_EXPOSE_GLOBALS=true`) or enable debug to get a single `window.ciAnalytics` object. The library never writes `window.analytics`, so it can coexist with Segment and similar tools.

**Note**: Owner tracking status is stored locally and applies only to your browser session.

### Debug Logging Management

For developers who want to enable/disable debug logging from the browser console:

```typescript
import { enableConsoleDebug, disableConsoleDebug, getConsoleDebugStatus } from '@clearideas/consent-analytics'

// Programmatically control debug logging
enableConsoleDebug()  // Enable debug logging
disableConsoleDebug() // Disable debug logging

// Check current debug status
const status = getConsoleDebugStatus()
console.log(`Debug logging is ${status.enabled ? 'ENABLED' : 'DISABLED'} (${status.source})`)

// Browser console (when exposeGlobals or debug is enabled)
ciAnalytics.enableDebug()   // Enable debug logging
ciAnalytics.disableDebug()  // Disable debug logging
ciAnalytics.debugStatus()   // Check current debug status and get instructions
```

**Note**: Console debug override takes precedence over config settings and persists for the current browser session.

## Peer Dependencies

The core has no runtime dependencies. The only peer dependency is optional:

| Package | When Required | Supported |
|---------|---------------|-----------|
| `nuxt` | Only for the Nuxt plugin (`@clearideas/consent-analytics/nuxt`) | `^3.0.0 \|\| ^4.0.0` |

The Vite adapter does not import Vue or Vue Router. Pass your existing router instance to `initViteAnalytics(router)` for route tracking; without one it falls back to `popstate`.

**Missing peer dependencies are handled gracefully** - the package won't crash, it will simply disable the relevant features and show helpful console warnings.

## Migration from Existing Analytics

The API remains backward compatible. Key changes:

1. **Peer Dependencies**: Install only what you need
2. **Debug Logging**: Enable with `analyticsDebug: true` (Nuxt) or `VITE_ANALYTICS_DEBUG=true` (Vite)
3. **Import Paths**: Use `@clearideas/consent-analytics/nuxt` or `@clearideas/consent-analytics/vite`
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
- 🐛 **Issues**: [GitHub Issues](https://github.com/clearideas/consent-analytics/issues)
- 📧 **Contact**: For support inquiries, please create an issue

## Bundling Clear Ideas Chat in an application

Applications can load the public chat package lazily rather than using a CDN alias:

```ts
import { setChatWidgetLoader } from '@clearideas/consent-analytics/plugins'

setChatWidgetLoader(async () => {
  const { init } = await import('@clearideas/chat')
  return { init: options => init({ ...options, accessKey: String(options.accessKey) }) }
})
```

Register the loader before initializing analytics, and retain the existing chat
configuration (`chatAccessKey`, `chatApiBaseUrl`, etc.). The loader runs only when
chat is configured. The package applies its bundled CSS inside its shadow root;
no `updates.clearideas.com` script or stylesheet is needed. Applications that must
apply profile or layout state after that lazy load can listen for
`CHAT_WIDGET_READY_EVENT`, exported from the same plugins entry.

An explicit preference refusal disables chat persistence even where the collector
does not require an initial opt-in. Chat can still provide functional support.

For a strict CSP, import `@clearideas/consent-analytics/consent.css` and configure
`banner: { injectStyles: false }`. The exported file is generated from the built-in
banner stylesheet, so it stays in sync with its markup.

Consent settings links may be added or removed by a SPA after initialization. The
client observes those changes and updates the automatic floating-button fallback.
`manageButton: true` still explicitly requests both controls.
