# Security reporting

For a suspected vulnerability, use GitHub's private vulnerability reporting option in this repository's Security tab if it is available. Otherwise contact the maintainers privately through [Clear Ideas](https://clearideas.com/contact) and ask for a private reporting channel.

Include the affected version, a minimal reproduction using fabricated data, and the impact you observed. Do not put credentials or private customer data in public issues.

This is browser client code. Configuration embedded in a page or bundle is visible to visitors. Supply only intentionally public widget identifiers/keys, enforce their origin and resource restrictions on the backend, and keep provider keys, npm tokens, and administrative credentials server-side.

## Security-relevant design

- **Consent-gated scripts and CSP.** Under a `'strict-dynamic'` Content Security Policy, scripts created by trusted scripts are trusted. The gated-script feature therefore never starts an inert `<script>` that could be injected markup: where the page uses nonces, a gated tag must carry the page's nonce. See `docs/THIRD_PARTY.md#content-security-policy`. A way around these rules is a vulnerability; please report it as described above.
- **Script-tag plugin files** are loaded with Subresource Integrity, using hashes built into `analytics.js`. Pinning `analytics.js` with `integrity` pins every plugin file it loads.
- **Vendor IDs** from configuration are validated before they're used in script URLs.
- **Configured text** (banner texts) is rendered as text, never parsed as HTML.
