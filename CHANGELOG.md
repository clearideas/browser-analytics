# Changelog

## 0.1.1 — November 12, 2026

Stable publication of the production-validated public browser package. Runtime behavior is unchanged from `0.1.0-rc.1`; release metadata and consumer versions move to stable.

## Unreleased

### Third-party tools
- **Plugin directory:** HubSpot, Intercom, Meta Pixel, LinkedIn Insight Tag, Microsoft Clarity and Hotjar join Google Analytics/Ads, Microsoft UET, OpenAI Ads and Clear Ideas Chat. Each is configured by name under `integrations`, is a separate chunk, and is downloaded only when configured and allowed. Account IDs are validated before they're used in a script URL. See `docs/THIRD_PARTY.md`.
- **Consent-gated scripts** for tools without a plugin: `<script type="text/plain" data-ci-consent="marketing" src="…">` runs once its category is allowed. Scripts start in document order (an inline snippet waits for the library above it), and tags added later are picked up. `data-ci-cookies`/`data-ci-storage` name the data to delete. Options: `gatedScripts` (`nonce`, `requireNonce`, `allowedOrigins`), or `false` to turn it off.
- **Content Security Policy:** under `'strict-dynamic'`, a naive script activator would let injected HTML run code (verified in Chromium). Where the page uses nonces, only gated tags carrying the page's nonce are started; the nonce is read from the library's script tag or `gatedScripts.nonce`.
- **Refusal and withdrawal:** declared vendor cookies and, new, storage keys (`storage` on plugins) are deleted on an explicit refusal too, on every page load while it stands. Before, they were deleted only when withdrawn after the plugin had run. A withdrawal that running code can't apply in place (plugins with `withdrawal: 'reload'`, custom plugins without `consentChanged`, gated scripts that ran) reloads the page once after the decision is saved. `consent: { reloadOnWithdrawal: false }` turns this off.
- **Settings link:** `<a href="#ci-consent-settings">`, `data-ci-consent-settings` or the class `ci-consent-settings` reopens the banner from anywhere (e.g. the footer), in every region. It's handled before client-side routers (tested with all seven example apps), and it also works when arriving at `#ci-consent-settings`. With such a link on the page, the floating "Cookie settings" button isn't added (`manageButton: 'auto'`).
- **Script-tag build:** integrations are separate files (`dist/script-plugins/<name>.<hash>.js`) loaded with Subresource Integrity, using hashes built into `analytics.js`. A tampered file is refused (verified in Chromium). `analytics.js` no longer inlines every integration. `data-plugin-base-url` sets where the files are.
- Custom plugins can declare `storage`, `withdrawal` and `loadWithoutConsent`.
- Nuxt (`analyticsConsent`, `analyticsGatedScripts`) and Vite (`VITE_ANALYTICS_CONSENT`, `VITE_ANALYTICS_GATED_SCRIPTS`) now pass consent options through; `consent: { choices: 'categories' }` was previously not settable there.

### Consent categories
- Optional per-category consent (`consent: { choices: 'categories' }`) for preferences, statistics and marketing. The banner gains a "Customize" view with category checkboxes: none pre-ticked, "Necessary" always on. Simple mode (one accept/reject choice) remains the default and is recorded as the same choice for every category.
- Integrations declare a category. Google Analytics maps Consent Mode v2 per category (`analytics_storage` ← statistics, `ad_*` ← marketing) and fires Ads conversions only with marketing. UET and OpenAI Ads are marketing. Chat is necessary, or preferences with `requiresConsent`. Withdrawing a category deletes that category's vendor cookies only.
- Full first-party analytics and stored attribution follow **statistics**. An explicit refusal is now respected everywhere, including where consent is not required.
- Global Privacy Control now withholds **marketing** only (it is an opt-out of sale/sharing); before, it blocked every third-party integration.
- `analytics.consent.set()`, `consent.get().categories`, `useConsent()` with categories. Plugins: `category` (replaces `requiresConsent`, which still works) and `allowedCategories` in the consent state.
- Collector API: consent records carry `categories`, and `decision` may be `partial`.

### Framework examples
- `examples/`: Next.js 16, React Router 8, Vue 3, Nuxt 4, SvelteKit 3, Angular 22 and Astro 7 apps, built against the packed library and tested in Chromium in CI.
- Fixed, found by the Astro example: frameworks that replace the page body on navigation (view transitions) removed the consent banner. The banner, if unanswered, and the "Cookie settings" button are now restored after navigation.
- The release-age gate skips bundled dependencies (covered by their parent package).

### Tracking without consent, per region
- The collector's policy can say `trackingWithoutConsent: 'none'` for a visitor's region: nothing is sent while statistics consent is not given. The default remains `limited` (anonymous essential events). Site-wide default: `consent: { trackingWithoutConsent }`. The sample collector supports `NO_TRACKING_WITHOUT_CONSENT_COUNTRIES` and a per-site setting.

### More frameworks
- `@clearideas/consent-analytics/browser`: framework-agnostic. `initBrowserAnalytics({ apiBaseUrl, siteKey })` detects page changes from the History API (Next.js, React Router/Remix, SvelteKit, Angular, Astro, …), or from `notifyRouteChange()` with `routeChanges: 'manual'`. It is idempotent (StrictMode, hot reload).
- Script-tag build `dist/analytics.js` (also `unpkg`/`jsdelivr`): configured with `data-*` attributes and/or `window.ciAnalyticsConfig`, with a pre-load command queue (`window.ciAnalyticsQueue`) and the `window.ClearIdeasAnalytics` API. About 18 KB gzipped; integrations are separate, integrity-checked files loaded only when used (see *Third-party tools*).
- `@clearideas/consent-analytics/react`: `AnalyticsProvider`, `useAnalytics()`, `useConsent()` (re-renders on consent changes). SSR- and StrictMode-safe.
- `@clearideas/consent-analytics/next`: `<ClearIdeasAnalytics>` for the App Router (client component; navigations from `usePathname`/`useSearchParams`).
- `analytics.ready()` resolves once the consent policy is known. `consent.accept()`/`reject()` wait for it, so decisions made right after start-up carry the right policy version. Consent listeners are also notified when the policy becomes known.
- URL changes that only remove attribution parameters are no longer treated as a new page.
- CommonJS: `require('@clearideas/consent-analytics/nuxt')` now exposes the plugin as `.default` (named exports were added).

### Integrations as plugins
- Google Analytics / Google Ads, Microsoft UET, OpenAI Ads and Clear Ideas Chat are plugins, enabled with `integrations: { googleAnalytics: {...}, ... }` (Nuxt `analyticsIntegrations`, Vite `VITE_ANALYTICS_INTEGRATIONS`). Each is a separate chunk, downloaded only when configured and allowed. Custom plugins: `plugins: [...]` (see `AnalyticsPlugin`). Factories: `@clearideas/consent-analytics/plugins`.
- The core enforces consent for all plugins. Vendor tags loaded by the library (`loadScript: true`, the default for `integrations`) get their consent state set before configuration. Page-installed tags (`loadScript: false`) are kept in sync (`denied` until allowed). Withdrawing consent deletes vendor cookies (`_ga*`, `_gid`, `_gcl_*`, `_uet*`). The page where a visitor accepts is forwarded once.
- Google Analytics (new config) maps page views to GA `page_view` (`page_location`, ...) with `send_page_view: false`, and skips this library's diagnostic events unless `events: 'all'`. Microsoft UET skips automatic events unless `events: 'all'`.
- Chat supports `integrity`/`cssIntegrity` (Subresource Integrity) and `requiresConsent`.
- The legacy flat settings (`gaMeasurementId`, `microsoftAdsTagId`, `openAIAdsPixelId`, `chat*`, ...) keep working with their previous behavior.
- **Breaking:** `initializeGTag`, `initializeUET`, `initializeOpenAIAdsPixel`, `initializeClearIdeasChat`, `trackIntegratedEvent`, `trackOpenAIAdsEvent`, `updateChatConsent`, `grantAnalyticsConsent` and `revokeAnalyticsConsent` were removed. Use `integrations` and `analytics.consent`. `getChatWidgetInstance` moved to `@clearideas/consent-analytics/plugins`.

### Consent banner and API
- New framework-neutral, accessible banner:
  - built with DOM APIs only (configured text is never parsed as HTML);
  - equal accept/reject buttons;
  - a labelled region that doesn't take focus on page load;
  - configurable text (`banner` option), themeable through `--ci-consent-*` CSS variables;
  - `autoShow`, `position` and `injectStyles` options.
- A "Cookie settings" button (`banner.manageButton`, default `'auto'`) lets visitors change their decision.
- Headless consent API: `analytics.consent.get()`, `accept()`, `reject()`, `onChange()`, `showBanner()`. `banner: false` disables the built-in UI.
- Global Privacy Control is honored by default (`respectGlobalPrivacyControl`): where consent is not required, integrations that need consent do not run for GPC browsers unless the visitor explicitly accepts.
- **Breaking:** the Vuetify-styled banner and `getConsentBannerHTML` were removed. `FrameworkAdapter.showConsentBanner` is no longer used.

### Less fingerprinting data
- No exact screen or viewport sizes, colour depth, pixel ratio, JS heap sizes or network downlink/RTT. Coarse viewport/device buckets remain.
- `limited` (pre-consent) events no longer carry the user-agent string; collectors receive it in the request header.

### Collector API v1 (breaking)
- The client speaks the documented v1 contract in `spec/openapi.yaml`: `GET /v1/context`, `POST /v1/events`, `POST /v1/consent`. The pre-v1 `/event/*` endpoints are no longer used. See `docs/BACKEND.md` for the mapping.
- New `siteKey` option (Nuxt `analyticsSiteKey`, Vite `VITE_ANALYTICS_SITE_KEY`). `eventSiteName` still works as a fallback.
- The consent decision is stored in the browser and applies immediately. The collector receives append-only consent records with a stable `consentId` and the `policyVersion`; undelivered records are retried on the next visit. A new policy version asks visitors again.
- Requests carry no cookies (`credentials: 'omit'`) and use `text/plain` JSON bodies, so no CORS preflight is needed and `sendBeacon` works cross-origin.
- Events have an `eventId` (the collector de-duplicates retries), and batches are limited to 50 events / 60 KB. Only network errors, 408, 429 and 5xx are retried.
- Event names are normalized to `^[a-z][a-z0-9_]{0,63}$` and props are fitted to the contract's limits, so the collector does not reject them.
- The `GET /event/session` call and the stored `userId` are gone (removed from storage on startup). The `ci_consent_shown` cookie is no longer set.
- `consentCheckInterval` and `sessionCheckInterval` are deprecated and ignored. New `initialContext` option.
- Added a reference collector and interactive playground (`sample-host/`, `npm run playground`), with contract tests and real-browser end-to-end tests (`npm run test:e2e`).

### Security and privacy
- Page URLs sent to the backend and third parties are reduced to origin + path + campaign parameters; other query parameters and fragments (tokens, emails, session IDs) are removed. New option `urlQueryAllowlist` keeps site-specific parameters. Referrers are reduced to origin + path.
- Google Analytics receives only each event's own parameters. Attribution data, click IDs and library control keys are no longer forwarded as event parameters.
- Attribution accepts only known keys (arbitrary `utm_*`/`ci_*` keys are ignored), drops values over 256 characters, and re-validates data read from storage and cookies.
- **Breaking:** the attribution cookie is opt-in via `cookieDomain` (Nuxt `analyticsCookieDomain`, Vite `VITE_ANALYTICS_COOKIE_DOMAIN`). The domain is validated against the current host and never guessed. Without it no cookie is written and a `ci_click` cookie is ignored. The cookie is now `Secure` on HTTPS.
- **Breaking:** nothing is added to `window` by default, and `window.analytics` is never written. Console helpers (owner opt-out, debug toggles, attribution) are available as a single `window.ciAnalytics` object when `exposeGlobals` or `debug` is enabled. Vite's `useAnalytics()` no longer depends on a global.

### Fixes
- Vite: one `page_view` per route change (was two). A route notification for the URL already being tracked is ignored.
- Attribution is captured when a visitor accepts the consent banner, including after navigating away from the landing page. It was previously lost.
- `page_exit`, `time_spent` and CLS are sent when the page is hidden or unloaded (`visibilitychange`/`pagehide`, via `sendBeacon`); they were previously queued and lost. `page_exit` after a route change now describes the page being left.
- Concurrent sends no longer deliver the same batch more than once.
- Pre-consent `error` events keep their message (truncated to 500 characters).
- `country` and `continent` from the geo response are attached to events.
- `startAutoTracking()` is idempotent; `stopAutoTracking()` removes listeners and observers.
- Cleaning attribution parameters from the URL preserves `history.state` (Vue Router navigation state).
- Vite: `VITE_WEBSITE_BASE_URL` now sets the consent banner's privacy link.

## 0.1.0

Initial public release under the MIT license.

- Browser analytics client for Nuxt and Vite.
- Consent state, attribution, event batching, and optional integrations.
- Documented event/consent backend contract.
- Public contributor checks and npm packaging verification.

## 0.1.0-rc.1 — November 11, 2026

- Prepare the public `@clearideas/consent-analytics` identity and package metadata.
- Add lazy bundled chat loading without a private dependency or mutable CDN alias.
- Honor explicit preference refusal in every consent region.
- Update floating settings-button detection for late SPA footers and attribute changes.
- Export consent CSS for strict-CSP hosts and announce lazy chat readiness.
