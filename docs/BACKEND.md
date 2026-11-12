# Collector API (v1)

`@clearideas/consent-analytics` is the browser client. It sends events and consent records to a
**collector** that implements the v1 contract:

- **Contract:** [`spec/openapi.yaml`](../spec/openapi.yaml) (OpenAPI 3.1 / JSON Schema 2020-12). This is the normative document. Its description includes the rules for origins, CORS, media types, size limits, idempotency and retries.
- **Reference implementation:** [`sample-host/`](../sample-host/README.md), a small Node collector that validates requests against the spec. Use it for local development and testing, or as a starting point.
- **Playground:** `npm run playground` runs the library against the sample collector in your browser. See the sample host README.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/context?siteKey=…` | Consent policy for this visitor: `consentRequired`, `policyVersion`, optional coarse `geo`, `ttlSeconds`. Cached by the browser for its session. |
| `POST` | `/v1/events` | Batch of up to 50 events (≤ 64 KiB). Returns `202` with `accepted`, `duplicates` and per-event `rejected`. |
| `POST` | `/v1/consent` | Append-only consent record (proof of consent). Returns `201` with a `recordId`. |
| `GET` | `/v1/health` | Optional liveness check. |

The library calls `<apiBaseUrl>/v1/...`. Configure `apiBaseUrl` and `siteKey` in the client.

## Implementer checklist

- [ ] **Site keys and origins.** Register each site with a public `siteKey` and the exact browser origins allowed to use it. Reject other origins with `403`. Require `Origin` on `POST` (browsers always send it, including on `sendBeacon`).
- [ ] **CORS.** Echo `Access-Control-Allow-Origin` for allowed origins on every response, errors included, with `Vary: Origin`. Answer `OPTIONS` with `204`. Never send `Access-Control-Allow-Credentials`.
- [ ] **Bodies.** Accept JSON sent as `text/plain` as well as `application/json`; the browser uses `text/plain` so that no preflight is needed. Enforce 64 KiB (events) and 4 KiB (consent) limits with `413`.
- [ ] **Validation.** Validate against the spec's schemas. Invalid events are reported per event; the rest of the batch is stored.
- [ ] **Idempotency.** Store each `(siteKey, eventId)` once. Retries are expected.
- [ ] **Consent policy.** Determine the visitor's region however you like (IPInfo or another IP geolocation service, a CDN country header, ...). **Unknown region means consent is required.** If you trust a CDN header, make sure clients cannot reach your server directly and send it themselves.
- [ ] **Tracking without consent.** Optionally return `policy.trackingWithoutConsent: 'none'` for regions where even anonymous measurement needs consent; browsers then send nothing until statistics consent is given.
- [ ] **Consent categories.** Store each record's `categories` (`preferences`, `statistics`, `marketing`); `decision` is `granted`, `denied` or `partial`.
- [ ] **Policy version.** Change `policyVersion` whenever your consent policy or banner changes materially; browsers will ask again.
- [ ] **`limited` events.** These come from visitors who have not consented where consent is required. Keep them anonymous: do not join them with persistent identifiers or `full` events.
- [ ] **No cookies, no IPs with consent records.** The client sends no credentials. Do not identify visitors by cookies, and do not store IP addresses with consent records.
- [ ] **Operations.** Add authentication for any read or admin APIs, plus rate limiting (`429` with `Retry-After`), retention and access controls. These are outside the contract.

## Checking an implementation

The sample host's contract tests (`sample-host/test/contract.test.ts`) show the expected behavior for each rule. They validate every response against the schema the spec declares for its status code. Point similar tests, or the playground, at your implementation.

## Changes from the pre-v1 endpoints

| Before | v1 |
| --- | --- |
| `GET /event/geo` and `GET /event/consent/status` | One `GET /v1/context`. The consent **decision** is stored in the browser; the server no longer returns it. |
| `POST /event/consent/update` | `POST /v1/consent` (append-only record with `consentId`, `policyVersion`, `decidedAt`, `source`). |
| `GET /event/session` (returned a `userId`) | Removed. |
| `POST /event` with a bare array | `POST /v1/events` with an envelope `{ v, siteKey, sentAt, events }`. Each event has an `eventId`, `name`, `occurredAt`, `trackingCategory`, `consent` and `props`. |
| `credentials: 'include'` (cookies) | No credentials. Cross-site cookies were blocked by Safari and Firefox, so a stored decision could be lost and the banner shown again. |
| Site identified by `eventSiteName` in each event | `siteKey` in the envelope and query, checked against allowed origins. |
