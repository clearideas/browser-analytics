# Contributing

Use Node.js 22.22.3+ or 24.15+ and npm. Clone the repository, then run:

```sh
npm ci
(cd sample-host && npm ci)   # the reference collector; tests use it
npm run check
```

The checks lint and type-check source, run the test suite, build the package, and inspect a locally packed release. Unit and integration tests use local mocks and need no Clear Ideas account, provider key, AWS credentials, or private npm token.

## Tests

Tests run with Vitest in a simulated browser DOM (`happy-dom`). `npm test` runs them; `npm run test:coverage` also enforces the coverage floors in `vitest.config.ts`, which only ever go up. `npm run check` uses the coverage run.

- `test/setup.ts` isolates every test. It removes listeners and intervals the library registers, clears storage, cookies, the DOM, the URL and vendor globals, and fails any unmocked `fetch`.
- `test/helpers.ts` provides `makeConfig()`, `mockApi()` (a fake backend that records `fetch` and `sendBeacon` requests), `makeAdapter()` (a framework adapter with a `navigate()` helper), `seedGeo()`, `seedConsent()` and `settle()`.
- Place unit tests next to the module (`src/foo.test.ts`). Behavior tests that boot the library like an application (`boot()`), adapter tests (Vite, Nuxt) and tests of the harness itself live in `test/`.
- A bug fix starts with a test that fails without the fix. Check that the test really fails (e.g. by temporarily reverting the fix), because a test that cannot fail protects nothing.

### Integrations

Built-in integrations are plugins in `src/plugins/` (see `AnalyticsPlugin` in `src/plugins/types.ts`); `src/plugins/host.ts` runs them. Rules:
- Plugins never check consent themselves; the host decides when they load and which events they receive.
- Vendor code is loaded only in `load()`. A spec with `loadWithoutConsent` (page-installed tags) must not load vendor code at all.
- Declare the vendor's first-party cookies (and storage keys) so they are deleted on refusal and withdrawal.
- Test a plugin with a fake `PluginContext` (see `src/plugins/*.test.ts`, `pluginContext()` in `test/helpers.ts`).

Adding a service to the plugin directory:
1. `src/plugins/<service>.ts`: the factory. Validate account IDs with `vendorId()` before using them in a URL. Set up the vendor's command queue before loading its script. Accept `scriptUrl`. Forward only mapped events; never `attribution`.
2. Set `withdrawal` from what the vendor's API can do: `'stop'` only if `consentChanged()` really stops it, otherwise `'reload'`. If you can't tell, use `'reload'`.
3. Turn off the vendor's own consent banner, if it has one.
4. Cookie and storage names go in `vendor-cookies.ts`, so the core can delete them without loading the plugin.
5. Register it in `loader-types.ts` (`BUILT_IN_PLUGINS`), `loaders.ts` (dynamic `import()`), `registry.ts` (options type and spec), `index.ts` (exports), and `SCRIPT_PLUGINS` in `rollup.config.js`. The registry test checks that the spec matches the plugin, and `npm run check:package` checks the script-tag files and their integrity hashes.
6. Document it in `docs/THIRD_PARTY.md`: category, withdrawal, cookies, and the vendor API calls used, so reviewers can check them against the vendor's documentation.

Consent-gated scripts (`src/gated-scripts.ts`) must never start an inert script that might be injected markup: keep the nonce rules (see `docs/THIRD_PARTY.md`) and their tests (`src/gated-scripts.test.ts`, `e2e/third-party.spec.ts`).

### Consent behavior

Some consent behavior exists because of GDPR and the ePrivacy Directive: reject as prominent as accept, no pre-ticked categories, append-only consent records, asking again on a new policy version, deleting data on withdrawal, and "unknown region means consent required". The README section *Why it works this way* lists each one and its reason. A change that weakens one of them needs that reason addressed in the pull request. Don't describe the project as compliant with any regulation or as a certified consent platform; describe what it does.

### Contract and end-to-end tests

- `spec/openapi.yaml` is the contract. `sample-host/test/contract.test.ts` checks the reference collector against it, and `test/v1-protocol.test.ts` and `test/client-host.test.ts` check the client against it. A change to the protocol changes the spec first.
- `npm run test:e2e` builds the library and runs `e2e/*.spec.ts` in Chromium against the playground. Install a browser once with `npx playwright install chromium`. To use an existing Chromium binary instead, set `PW_CHROMIUM_EXECUTABLE=/path/to/chrome`. Do not add flags such as `--disable-web-security`: they remove the `Origin` header and CORS, which the tests verify.
- `npm run playground` starts the same setup for manual exploration.

Open a pull request against `main` with a description of the change and its validation. Add focused tests when changing behavior. Use fabricated data and placeholder widget keys in examples; keep `.env`, credentials, generated tarballs, and local service data out of commits.

Contributions are made under the repository's [MIT license](LICENSE). Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Dependency versions and compatibility decisions are documented in [DEPENDENCIES.md](DEPENDENCIES.md).
