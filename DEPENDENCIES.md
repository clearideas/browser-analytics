# Dependency maintenance

Dependencies were refreshed against the public npm registry on 2026-11-09. Runtime packages and development tools use their current stable releases, with two intentional compatibility constraints:

- TypeScript stays on the latest 6.0.x release (6.0.3). The current typescript-eslint parser supports TypeScript versions below 6.1; TypeScript 7 is outside that supported range. Upgrade the compiler after the parser adds support and all checks pass.
- `@types/node` follows the current Node.js 24 line (24.19.2), matching the release/build runtime instead of describing Node.js 26-only APIs.

The optional framework peer dependencies describe the versions tested/supported by this release; they are not private package dependencies. Optional Nuxt is not installed just to build the framework-neutral analytics core.

The `minimatch` override selects the patched 11.x release because upstream development tools still request affected 10.x versions. Chat also overrides `glob` to the patched 14.x release for its test tooling. Review/remove these overrides when upstream ranges include the fixes. Do not use `npm audit fix --force` to downgrade the toolchain.

Run `npm outdated`, `npm audit`, and `npm run check` after changes. Browser Chat additionally runs `npm run test:e2e`. Changes to bundled dependencies must regenerate `dist/THIRD_PARTY_NOTICES.txt`; `check:package` requires the notices in its tarball.
