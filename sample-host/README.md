# Sample collector and playground

A reference implementation of the collector contract in [`../spec/openapi.yaml`](../spec/openapi.yaml), plus an interactive **playground**: a small demo website running the real library against this collector, with live panels showing everything that leaves the browser.

It is intentionally small: [Hono](https://hono.dev) on Node.js, SQLite through the built-in `node:sqlite` (no native dependencies), and request validation generated from the spec itself with Ajv, so it cannot drift from the contract. TypeScript runs directly on Node ≥ 22.18 (type stripping); there is no build step.

## Playground

From the repository root:

```sh
npm ci && (cd sample-host && npm ci)
npm run playground
```

Open http://localhost:5173. The collector API runs on http://localhost:8787. Because the two are different origins, the playground is a cross-origin client like a real website.

Things to try:

Start over at any time with the **Reset** buttons at the top:
- **Reset consent** forgets the visitor's decision (the banner appears again).
- **Reset visitor** clears all `ci_*` storage and cookies (a brand-new browser).
- **Reset everything** also clears the server data and the region override.

| Try | What to look for |
| --- | --- |
| Region **Germany**, then reload | Banner shown. Events are `limited` (anonymous, URL without query). **Track sign_up** sends nothing. |
| **From a Google Ads click**, then **Accept** | A `granted` consent record. The URL loses `gclid`/`utm_*`. *Browser storage* shows `ci_click`. `sign_up` is `full` with attribution. *Google (gtag)* shows the event **without** attribution, plus the Ads conversion. |
| **Cookie settings** (or the floating button) → **Reject** | A `denied` record with the same `consentId`. Attribution removed. gtag consent `denied`. Focus returns to the button. |
| Region **United States** + **Browser sends Global Privacy Control** | No banner and `full` first-party events, but *Third-party tags: off*: nothing goes to gtag until you accept via Cookie settings. |
| **Via a password-reset link** | The token, email and fragment appear in the address bar but in no event. |
| Region **United States** | No banner; `full` tracking. |
| Region **Unknown** | Banner (unknown region means consent is required). |
| Navigate Home → Pricing → Docs | One `page_view` per page; `page_exit` describes the page you left. |
| Switch to another browser tab | `page_exit` delivered by `sendBeacon`. |
| **Publish new policy version** | Visitors who already decided are asked again. |
| **Track "Newsletter Signup"** | Stored as `newsletter_signup` (event names are normalized to the contract). |
| **Consent choices per category**, then **Customize** | Unticked category boxes. Saving *Statistics* only gives a `partial` record, `full` events, and gtag `analytics_storage: granted` with ad signals `denied`; no Ads conversion. |
| **Nothing tracked without consent** (region Germany) | The collector's policy becomes `trackingWithoutConsent: none`: no events at all until you accept. |

The same scenarios run automatically in a real browser: `npm run test:e2e` (see `../e2e/playground.spec.ts`).

Two more pages on the playground port:
- `/plain/first`: a plain site using only the script tag (`dist/analytics.js`). Tests: `../e2e/script-tag.spec.ts`.
- `/tools/`: third-party tools under a strict Content Security Policy (per-request nonce, `'strict-dynamic'`). It has directory plugins (Meta Pixel, Hotjar) pointed at local stand-ins that record what they receive, consent-gated scripts, an injected comment with inert scripts that must never run, and a footer "Cookie settings" link. `?csp=off` removes the policy; `?lib=tampered` serves altered plugin files, which integrity checks must block. Tests: `../e2e/third-party.spec.ts`.

## Running the collector

```sh
cd sample-host
npm ci
npm start                     # http://localhost:8787, data in ./data/analytics.db
```

Or with Docker, from the repository root: `docker compose up` (uses `sites.example.json`).

### Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Collector API port |
| `SITES_FILE` | built-in `demo-site` for the playground | JSON array of sites: `siteKey`, `allowedOrigins` (exact origins), `policyVersion`, `consentMode` (`geo`, `always`, `never`). See `sites.example.json`. |
| `DATABASE_PATH` | `./data/analytics.db` | SQLite file, or `:memory:` |
| `TRUSTED_GEO_HEADERS` | *(none)* | Comma-separated request headers carrying the visitor's country, e.g. `cf-ipcountry`, `cloudfront-viewer-country`, `x-vercel-ip-country`. **Only list headers your proxy sets**; otherwise clients can send them and pick their own consent policy. |
| `DEFAULT_COUNTRY` | *(none)* | Country to assume when none is known (local development). Without it, unknown means consent is required. |
| `CONSENT_COUNTRIES` | EU + EEA + UK + CH | Comma-separated ISO codes where consent is required |
| `NO_TRACKING_WITHOUT_CONSENT_COUNTRIES` | *(none)* | Comma-separated ISO codes where browsers may send nothing without consent (`policy.trackingWithoutConsent: none`). Elsewhere, anonymous essential events are allowed. A site can also set `"trackingWithoutConsent": "none"` in the sites file. |
| `CONTEXT_TTL_SECONDS` | `3600` | How long browsers may cache `GET /v1/context` |
| `DEV_MODE` | off | Enables the playground (`PLAYGROUND_PORT`, default `5173`) and the `/_dev/*` endpoints (event listing, live stream, geo override, reset). **Never enable in production:** `/_dev` is unauthenticated. |

### Adapting it

- **Geolocation:** replace `resolveGeo()` in `src/geo.ts`, for example to call IPInfo with the client IP.
- **Storage:** implement the `EventStore` interface in `src/store.ts`. `SqliteStore` and `MemoryStore` both pass the same conformance tests in `test/store.test.ts`.
- **Production concerns not included:** authentication for read/admin APIs, rate limiting, retention and backups.

## Tests

From the repository root: `npm test` runs the contract tests (`test/contract.test.ts`), which check every response against the spec, and the storage conformance tests. They also run the real browser client against this collector in-process (`../test/client-host.test.ts`).
