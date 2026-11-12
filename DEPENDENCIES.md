# Dependency maintenance

The published package has **no runtime dependencies**. The only peer dependency is `nuxt`, which is optional and needed only for the Nuxt plugin (`@clearideas/consent-analytics/nuxt`).

## Peer dependencies

- `nuxt`: `^3.0.0 || ^4.0.0`. The plugin uses only `useRuntimeConfig` (from `nuxt/app`), `nuxtApp.hook('app:mounted' | 'page:start')` and `nuxtApp.provide`, all of which exist in Nuxt 3 and 4. The range is based on that API surface; there is no automated Nuxt integration test yet.
- `vue` and `vue-router` are **not** dependencies. No source file imports them. The Vite adapter accepts an existing router instance (duck-typed `afterEach`) and falls back to `popstate` without one.

## Development toolchain

Lockfile regenerated on 2026-11-10 from versions available on the public registry. Intentional constraints:

- TypeScript stays on 6.0.x (6.0.3). typescript-eslint supports TypeScript `<6.1`; TypeScript 7 is outside that range. Upgrade after the parser adds support and all checks pass.
- `@types/node` follows the Node.js 24 line (24.19.2), matching the release/build runtime.
- Tests run in `happy-dom` (a simulated browser DOM) via Vitest. See `vitest.config.ts` and `test/setup.ts`.
- The `minimatch` override pins the patched `^11.0.5` release because eslint, `@eslint/config-array` and `@typescript-eslint/typescript-estree` still request `^10.x`. Remove the override once their ranges include the fix (`npm explain minimatch` shows the requested ranges).

Do not use `npm audit fix --force`; it can downgrade the toolchain.

## Sample host

`sample-host/` is a separate, private package with its own lockfile. Its runtime dependencies are pinned to exact versions: `hono`, `@hono/node-server`, `ajv`, `ajv-formats` and `yaml`. It uses Node's built-in `node:sqlite` rather than a native SQLite module. CI runs the supply-chain gate on both lockfiles.

End-to-end tests use `@playwright/test` (a root dev dependency). CI installs Chromium with `npx playwright install --with-deps chromium`.

## Supply-chain gate

CI and the publish workflow run `scripts/check-npm-release-age.mjs` before `npm ci`. For every package in `package-lock.json` it requires:

1. the package resolves from `https://registry.npmjs.org/` (git URLs, tarball URLs, other registries and missing sources fail), and
2. the locked version was published at least `NPM_RELEASE_AGE_DAYS` days ago (default 3).

Only the first-party `@clearideas` scope is exempt from the age requirement. The script refuses to pass if it checked nothing.

## After changing dependencies

```sh
npm install
NPM_RELEASE_AGE_DAYS=3 node scripts/check-npm-release-age.mjs
npm audit
npm run check
```
