# Third-party tools

This guide covers bringing tools such as HubSpot, Intercom or a Meta Pixel under the consent banner, and letting visitors change their decision later.

**The rule behind all of it:** the library controls only what it loads. A vendor snippet pasted into your HTML, or added through a tag manager, runs whatever the visitor decides. To put a tool under consent, remove its snippet and use one of the three options below.

| | [Directory plugin](#the-plugin-directory) | [Custom plugin](#writing-a-custom-plugin) | [Consent-gated script](#consent-gated-scripts) |
| --- | --- | --- | --- |
| Effort | Configuration only | About 20–40 lines of code | Change one attribute of the vendor's snippet |
| Starts only with consent | ✅ | ✅ | ✅ |
| Receives your events and page changes | ✅ | ✅ | ❌ The tool tracks on its own |
| Withdrawal | Vendor told to stop; page reload if it can't be | Same | Page reload |
| Cookies and storage removed | ✅ Built in | ✅ If declared | ✅ If listed in the tag |
| Use for | Supported services | Services not in the directory, done properly | Anything else, quickly |

Plugins are the recommended path. Gated scripts are the fallback for tools nobody has written a plugin for yet.

Contents:

- [What refusal and withdrawal do](#what-refusal-and-withdrawal-do)
- [Letting visitors change their decision](#letting-visitors-change-their-decision)
- [The plugin directory](#the-plugin-directory)
- [Consent-gated scripts](#consent-gated-scripts)
- [Writing a custom plugin](#writing-a-custom-plugin)
- [Script-tag build: plugin files](#script-tag-build-plugin-files)

## What refusal and withdrawal do

This applies to every tool the library controls (plugins and gated scripts):

| Situation | What happens |
| --- | --- |
| Before a decision, where consent is required | Nothing is downloaded or run. |
| Consent not required for the visitor (by region) | Tools run, except **marketing** tools when the browser sends Global Privacy Control. |
| Visitor accepts | The tool's code is downloaded and started. Plugins also receive the current page view. |
| Visitor refuses | Nothing runs. Cookies and storage keys declared for the tool are deleted, then again on every page load while the refusal stands. |
| Visitor withdraws an earlier acceptance | The tool gets no more events. Plugins that can stop their vendor do so (e.g. Meta Pixel `consent revoke`, Intercom `shutdown`). Declared cookies and storage are deleted. If something already running **can't** be stopped (some vendors, and every gated script), the page reloads after the decision is saved, so the code is gone. |

Refusal and withdrawal work **per category**. Refusing marketing doesn't affect a statistics tool.

**About the reload.** It happens only when it's needed, after the decision is stored and recorded, so the reloaded page starts in the refused state. The visitor sees the page refresh once. To turn it off, set `consent: { reloadOnWithdrawal: false }`. A tool that can't be stopped then keeps running until the next page load.

**Limits.** A web page can't:

- delete cookies the vendor set on its own domain (e.g. `linkedin.com`), or HttpOnly cookies;
- undo data the vendor already received.

Also note that vendor scripts read the page address themselves. This library's URL sanitization applies to what *it* sends, not to what a vendor's script collects.

## Letting visitors change their decision

Once a visitor has decided, the banner is gone. Give them a way back: a link, usually in the footer, that reopens the banner. Any of these work:

```html
<a href="#ci-consent-settings">Cookie settings</a>                     <!-- recommended -->
<a href="/privacy" data-ci-consent-settings>Cookie settings</a>
<button type="button" class="ci-consent-settings">Privacy choices</button>
```

- Clicking it opens the banner with focus on the choices. The link's own navigation doesn't happen.
- `href="#ci-consent-settings"` also works when the link is clicked before the script has loaded, and from other pages (`/about#ci-consent-settings`): the banner opens when the page arrives at that address.
- It works in every region, so a visitor where consent isn't required can still opt out.
- It works with client-side routers (Next.js, React Router, Vue, Nuxt, SvelteKit, Angular, Astro; tested in [`examples/`](../examples)). The click is handled before the router sees it.
- When the page has such a link, the floating "Cookie settings" button isn't added (`banner.manageButton: 'auto'`, the default). Set `manageButton: true` to show both.
- Use a real link or button so it works with the keyboard.
- With `banner: false` (your own UI), these links do nothing. Call `analytics.consent.showBanner()` or your own UI instead.

## The plugin directory

Configure by name under `integrations` (Nuxt: `analyticsIntegrations`; Vite: `VITE_ANALYTICS_INTEGRATIONS`; script tag: `window.ciAnalyticsConfig.integrations`). A plugin's code is downloaded only when it's configured **and** allowed.

| Name | Service | Category | Withdrawal | Cookies / storage removed |
| --- | --- | --- | --- | --- |
| `googleAnalytics` | Google Analytics 4, Google Ads | statistics (marketing if Ads only) | Stops (Consent Mode) | `_ga*`, `_gid`, `_gat*`; `_gcl_*` (marketing) |
| `microsoftUet` | Microsoft Advertising UET | marketing | Stops (consent update) | `_uet*` |
| `openAIAds` | OpenAI Ads pixel | marketing | Stops | – |
| `clearIdeasChat` | Clear Ideas Chat | necessary (preferences with `requiresConsent`) | Stops | – |
| `hubspot` | HubSpot tracking code | marketing (configurable) | Stops | `__hstc`, `__hssc`, `__hssrc`, `hubspotutk`, `messagesUtk` |
| `intercom` | Intercom Messenger | preferences (configurable) | Stops (`shutdown`) | `intercom-id-*`, `intercom-session-*`, `intercom-device-id-*`; storage `intercom.*` |
| `metaPixel` | Meta (Facebook) Pixel | marketing | Stops (`consent revoke`) | `_fbp`, `_fbc` |
| `linkedInInsight` | LinkedIn Insight Tag | marketing | **Page reload** | `li_fat_id`, `li_giant` |
| `microsoftClarity` | Microsoft Clarity | statistics | **Page reload** (after `consent false`) | `_clck`, `_clsk` |
| `hotjar` | Hotjar | statistics | **Page reload** | `_hj*`; storage `_hj*` |

Every directory plugin:

- checks account IDs against the vendor's format before using them in a script URL;
- accepts `scriptUrl` to override the vendor script's address (e.g. a proxy, or a test stand-in);
- doesn't forward attribution data or click IDs;
- forwards only the events you map (the exceptions are noted below).

**How they're tested.** These plugins use each vendor's documented JavaScript API. They're tested against stand-ins that record every call, not against live vendor accounts. After enabling one, check it with the vendor's own debugging tools. If a vendor changes its API, please [open an issue or pull request](../CONTRIBUTING.md).

The first four are described in the [README](../README.md#integrations-plugins). The directory services:

### HubSpot

```typescript
integrations: {
  hubspot: {
    portalId: 1234567,                        // your Hub ID
    region: 'eu1',                            // if your account is hosted in the EU (default 'na1')
    events: { sign_up: 'pe1234567_sign_up' }, // optional: site event -> custom behavioral event
  },
}
```

- Depending on your account settings, one script loads HubSpot's tracking, chat, collected forms and ads pixels. The plugin therefore runs as **marketing** by default. Set `category: 'statistics'` if you use HubSpot only for analytics and have assessed that.
- HubSpot's own cookie banner is turned off (`disableHubSpotCookieBanner`). Otherwise visitors would be asked twice.
- The consent choices are passed to HubSpot's categories (`analytics` ← statistics, `advertisement` ← marketing, `functionality` ← preferences).
- **Withdrawal:** `revokeCookieConsent` and `doNotTrack`. A later acceptance resumes tracking.
- **Page views:** HubSpot counts the page its script loads on. The plugin reports later navigations in single-page apps (`setPath` + `trackPageView`); `pageViews: false` turns that off.
- The plugin loads the tracking code only. Forms embedded with HubSpot's separate form embed script aren't affected by it.

### Intercom

```typescript
integrations: {
  intercom: {
    appId: 'abc123',
    region: 'eu',                              // 'us' (default), 'eu' or 'au'
    user: { user_id: 'u_42', email: 'jane@example.com', user_hash: '…' }, // logged-in users
    settings: { hide_default_launcher: false }, // any other Messenger settings
    events: 'custom',                          // optional: also send your own events
  },
}
```

- **Category:** `preferences` by default. Intercom is a support tool, but it also records visits and runs product messages. If your assessment treats the Messenger as strictly necessary, set `category: 'necessary'`.
- **Identity verification.** When passing a logged-in user, also pass `user_hash` (or `intercom_user_jwt`), computed on your server with Intercom's secret. Without it, anyone can pose as that user in the Messenger. The plugin warns in the console if it's missing.
- **Withdrawal:** `shutdown` ends the session and clears Intercom's cookies. A later acceptance boots the Messenger again.
- **Page views:** navigations call `update`. Intercom rate-limits this call.

### Meta Pixel

```typescript
integrations: {
  metaPixel: {
    pixelId: '1234567890',
    events: { sign_up: 'CompleteRegistration', purchase: 'Purchase', newsletter: 'NewsletterSignup' },
  },
}
```

- Sends `PageView` for every page, single-page navigations included. The pixel's own history tracking is turned off so pages aren't counted twice.
- Mapped events use `fbq('track')` for Meta's standard event names and `fbq('trackCustom')` for others.
- **Automatic configuration is off by default** (`autoConfig: false`). The pixel then doesn't collect button clicks and page metadata on its own. Set `autoConfig: true` to allow it.
- **Withdrawal:** `fbq('consent', 'revoke')`.
- Remove the `<noscript><img …></noscript>` part of Meta's snippet. It sends a request without any consent check for visitors without JavaScript.

### LinkedIn Insight Tag

```typescript
integrations: {
  linkedInInsight: { partnerId: 123456, conversions: { sign_up: 9876543 } },
}
```

- The tag records page views itself. Mapped events are sent as conversions (`lintrk('track', { conversion_id })`).
- **Withdrawal reloads the page.** The tag offers no way to stop it once running. Its cookies on `linkedin.com` can't be removed from your site.

### Microsoft Clarity

```typescript
integrations: {
  microsoftClarity: { projectId: 'abcdefghij', events: 'custom' },
}
```

- Heatmaps and session recordings, as **statistics**. Configure masking of sensitive content in your Clarity project.
- Consent is passed to Clarity (`consentv2`: `analytics_Storage` ← statistics, `ad_Storage` ← marketing).
- **Withdrawal** erases Clarity's cookies (`consent false`) and reloads the page, so no recording continues in the open page.
- Clarity tracks single-page navigations itself. With `events: 'custom'`, your own event names are sent with `clarity('event')`.

### Hotjar

```typescript
integrations: {
  hotjar: { siteId: 1234567, events: 'custom' },
}
```

- Heatmaps, recordings and surveys, as **statistics**.
- **Withdrawal reloads the page** (Hotjar can't be stopped once running). Its `_hj*` cookies and storage keys are removed.
- If your account uses Hotjar's newer (Contentsquare) tag, set `scriptUrl` to the script address from your tracking code.

## Consent-gated scripts

For a tool without a plugin, change the vendor's `<script>` tag so the browser doesn't run it. The library then starts it once the category is allowed:

```html
<!-- Before: runs for everyone -->
<script async src="https://cdn.example-vendor.com/tag.js?id=123"></script>

<!-- After: runs only with marketing consent -->
<script type="text/plain" data-ci-consent="marketing" async
        src="https://cdn.example-vendor.com/tag.js?id=123"
        data-ci-cookies="_exv*, exv_id"></script>
```

Inline snippets work the same way:

```html
<script type="text/plain" data-ci-consent="statistics">
  window.vendorTool('init', 'ABC123')
</script>
```

| Attribute | Meaning |
| --- | --- |
| `type="text/plain"` | Required. The browser neither downloads nor runs the script. |
| `data-ci-consent` | Required. `preferences`, `statistics` or `marketing` (or `necessary`: always runs). Any other value never runs. |
| `data-ci-cookies` | Optional. Cookie names the tool sets, comma-separated; `*` at the end matches a prefix. Deleted on refusal and withdrawal. |
| `data-ci-storage` | Optional. `localStorage`/`sessionStorage` keys, same format. |
| `data-ci-type` | Optional. The real type, e.g. `module`. |
| Other attributes | Copied to the running script (`src`, `async`, `integrity`, `crossorigin`, `referrerpolicy`, …). The `id` moves to the running script. |

**How it works.**

- A running copy is inserted right after the inert tag. The tag itself stays in place, so frameworks that render it aren't disturbed.
- Scripts start in document order. An external script without `async` finishes loading before the next gated script runs, so an inline snippet can use the library above it. Give scripts that depend on each other the same category.
- Gated tags added later (e.g. by a single-page app rendering a new view) are picked up automatically.

**Withdrawal.** The library can't stop a gated script. If one has run and its category is withdrawn, the listed cookies and storage keys are deleted and the page reloads (see [`reloadOnWithdrawal`](#what-refusal-and-withdrawal-do)). After the reload the tag stays inert.

**Limitations.**

- Snippets that use `document.write` don't work when started after the page has loaded. Most vendors offer an asynchronous snippet instead.
- Code that waits for `DOMContentLoaded` or `load` doesn't run if consent is given after those events. Vendor tags normally handle this; check your own inline code.
- Only `<script>` elements are gated. Remove `<noscript>` fallbacks (tracking pixels) from vendor snippets: they'd send requests without consent. For iframes (e.g. video embeds), use a plugin or load them from your own code after `analytics.consent.onChange`.

### Content Security Policy

Many sites use a strict Content Security Policy with a per-page nonce and `'strict-dynamic'`. Under such a policy, any script created by a trusted script is itself trusted. An activator that started every inert script would let an attacker who can inject HTML (e.g. into a comment) run code through it. In a real browser, both an injected inline script and an injected external script ran that way.

So the library starts a gated script only if it's safe to:

| Page | Rule |
| --- | --- |
| The page's nonce is known | Only gated tags carrying that nonce are started, and the running copy gets it. Injected markup can't know the nonce. |
| Nonces are used on the page but the library doesn't know the nonce | Nothing is started, with a console warning. |
| No nonces on the page | Gated tags are started. There's no CSP for injected markup to get around, so this adds no risk. |

Where the nonce comes from:

- **Script tag:** put the nonce on the `analytics.js` tag. The library reads it from there. This is tested in a real browser with a strict policy.
- **Bundled apps (Next.js, Vite, …):** module scripts can't see their own tag, so pass it: `gatedScripts: { nonce }`.
- Put the same nonce on each gated tag: `<script type="text/plain" data-ci-consent="marketing" nonce="…">`.

Options (`gatedScripts` in the config; Nuxt `analyticsGatedScripts`; Vite `VITE_ANALYTICS_GATED_SCRIPTS` as JSON):

| Option | Default | Meaning |
| --- | --- | --- |
| `nonce` | Nonce of the script tag that loaded the library | The page's CSP nonce. |
| `requireNonce` | `false` | Require the nonce even if none is visible on the page. Use this if your policy uses hashes with `'strict-dynamic'`. |
| `allowedOrigins` | any | Start external gated scripts only from these origins, e.g. `['https://js.hs-scripts.com']`. |

`gatedScripts: false` turns the feature off.

## Writing a custom plugin

```typescript
import type { AnalyticsPlugin } from '@clearideas/consent-analytics'

const acmeChat: AnalyticsPlugin = {
  name: 'acmeChat',
  category: 'preferences',          // necessary | preferences | statistics | marketing (default)
  cookies: ['acme_session', 'acme_*'],
  storage: ['acme.*'],              // localStorage/sessionStorage keys
  withdrawal: 'stop',               // 'stop' if consentChanged() stops the vendor, else 'reload'

  load(ctx) {
    // Runs once, when the category is first allowed. Vendor code is loaded only here.
    window.acme = window.acme || { q: [] }
    return ctx.loadScript('https://cdn.acme.example/chat.js', { integrity: 'sha384-…' })
  },
  consentChanged(state) {
    // Called whenever the consent state changes after load.
    if (!state.allowed) window.acme?.shutdown()
  },
  track(event) {
    // Only called while allowed. event.params: the event's own parameters, URLs sanitized.
    if (event.name === 'page_view') window.acme?.pageView(event.params.path)
  },
}

initAnalytics({ ...config, plugins: [acmeChat] }, adapter)
// or: initBrowserAnalytics({ ...config, plugins: [acmeChat] }), window.ciAnalyticsConfig.plugins, …
```

Checklist:

- **Don't check consent yourself.** The library decides when `load`, `track` and `consentChanged` run.
- **Load vendor code only in `load()`.** Set up the vendor's command queue before loading its script, so early calls aren't lost.
- **Validate IDs before putting them in a URL.**
- **Declare every cookie and storage key** the vendor sets on your site.
- **Set `withdrawal` honestly.** If the vendor has no way to stop, use `'reload'`. Without a `consentChanged` hook, the default is `'reload'`.
- **Don't forward `event.attribution`** or other data the vendor doesn't need.
- `loadWithoutConsent: true` makes a bridge to a tag your page installs itself (it must not load vendor code). The bridge is loaded early so it can tell the tag "denied".
- Test it with a fake context, like the built-in plugins do (`src/plugins/*.test.ts`).

## Script-tag build: plugin files

With the script tag, built-in plugins are separate files next to `analytics.js` (`dist/script-plugins/<name>.<hash>.js`). Each is downloaded only when the plugin is configured and allowed.

- **Integrity.** Each plugin file is loaded with Subresource Integrity, using a hash built into `analytics.js`. If you pin `analytics.js` with an `integrity` attribute, every plugin it loads is pinned too. A modified plugin file is refused by the browser and that plugin doesn't run; the rest of the page and the library keep working. This is tested in a real browser.
- **Self-hosting.** Copy `dist/analytics.js` and the `dist/script-plugins/` folder together. If the plugin files are served from another origin than the page, that server must send `Access-Control-Allow-Origin`, as integrity-checked scripts require it (jsDelivr and unpkg do). To load plugin files from a different place, set `data-plugin-base-url` on the script tag to the folder that contains `script-plugins/`, ending in `/`.
- **CSP.** Allow the origin of `analytics.js` in `script-src`, or use a nonce with `'strict-dynamic'` (plugin files are then trusted because `analytics.js` loads them).
