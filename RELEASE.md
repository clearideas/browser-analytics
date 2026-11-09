# Release process

This repository publishes an MIT-licensed npm package. Application deployments and CDN hosting belong to the consuming application or infrastructure project.

## Prepare a release

1. Use Node.js 24, install dependencies with `npm ci`, and run `npm run check`.
2. Update `package.json` and `package-lock.json` to the intended version, review the diff, and commit the release source.
3. Inspect the release contents with `npm pack --dry-run --ignore-scripts`. The package check also inspects an actual tarball and exercises its ESM and CommonJS entries.
4. Tag the reviewed commit as `v` followed by exactly the package version and create a GitHub release from that tag. Do not include old private branches or tags in a new public repository.

## npm publication

The publish workflow runs only when a GitHub release is published and the repository variable `NPM_RELEASES_ENABLED` is `true`. It verifies the tag, runs the checks, and publishes with public access using the `NPM_ACCESS_TOKEN` repository secret. Keep that token scoped to publishing this package; users installing a public release do not need it.

Manual publication is `npm publish --access public`; `prepublishOnly` runs the checks first. Merely changing `publishConfig.access` does not change an existing restricted npm package or GitHub repository's visibility. Existing package access and GitHub visibility must be changed at launch by a maintainer.

## Application and CDN deployment

Consumers can install a pinned public npm version or serve selected built files from their own hosting. This repository does not hold AWS roles, buckets, CloudFront distribution settings, deployment credentials, or production upload scripts. Deploy the released package artifact from the private application/infrastructure project that owns those endpoints. Publishing to npm does not deploy or invalidate a CDN.

## First public release

Use a reviewed source snapshot or a reviewed and sanitized history. Replacing an example key in current files does not remove historical copies or revoke that key. Verify that any previously embedded key is revoked or intentionally public and adequately restricted before publishing the old history. Keep private configuration, environment files, source-control metadata and generated release archives out of the public export.
