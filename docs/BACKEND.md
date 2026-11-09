# Backend contract

`@clearideas/analytics` is the browser client. It does not include an event database, consent service, dashboard, or geographic-policy service. Configure `apiBaseUrl` for your application; optional advertising and Chat integrations use their own configured endpoints/identifiers.

The client appends these routes to `apiBaseUrl` (trailing slash is optional):

| Method | Path | Client expectation |
| --- | --- | --- |
| GET | `/event/session` | JSON containing the current `userId` if known; the server can establish its session cookie. |
| GET | `/event/geo` | JSON with `country`, `continent`, and a boolean `requiresConsent`; optional `cached`. |
| GET | `/event/consent/status` | JSON with `consented` (`true`, `false`, or `null`) and `version` (string or `null`). |
| POST | `/event/consent/update` | JSON request `{ name, consented, origin, hostname }`; successful JSON response may contain `version`. |
| POST | `/event` | A JSON array of `AnalyticsEvent` objects, sent with `sendBeacon` or fetch. Return a successful status when accepted. |

Fetch requests use `credentials: 'include'`. Cross-origin backends must explicitly allow the application's origin and credentials, and apply their own validation, authorization, request limits, retention and storage policy. `sendBeacon` cannot supply custom authorization headers. The geographic result is a host policy input, not a legal determination made by this package.

For example, `{ "country": "CA", "continent": "NA", "requiresConsent": true }` is a valid conservative geographic policy response. An unknown or unavailable geographic response causes the client to default to requiring consent.

See `AnalyticsConfig`, `AnalyticsEvent`, `ConsentStatus`, and `GeoContext` in `src/types.ts` for the current types. A failure-tolerant client does not substitute for implementing these services in a production integration.
