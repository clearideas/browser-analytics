import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "public-package-check-"));
try {
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
      {
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: join(scratch, "npm-cache") },
      },
    ),
  );
  execFileSync("tar", ["-xzf", join(scratch, packed.filename), "-C", scratch]);
  const root = join(scratch, "package");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const paths = new Set(packed.files.map((file) => file.path));
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.publishConfig.access, "public");
  assert.match(
    readFileSync(join(root, "LICENSE"), "utf8"),
    /Permission is hereby granted/,
  );
  const targets = [manifest.main, manifest.module, manifest.types];
  function collect(value) {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  }
  collect(manifest.exports);
  for (const target of targets.filter(Boolean)) {
    assert(
      paths.has(target.replace(/^\.\//, "")),
      `Missing package entry: ${target}`,
    );
  }
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})\b/,
    /\bnpm_[A-Za-z0-9]{30,100}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\bhf_[A-Za-z0-9]{25,100}\b/,
    /\bsk-(?:proj-|ant-api\d\d-)?[A-Za-z0-9_-]{35,250}\b/,
    /\bwidget_[A-Za-z0-9_-]{8,100}\.[A-Za-z0-9_-]{32,150}\b/,
  ];
  for (const path of paths) {
    assert(
      /^(?:dist\/|src\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/.test(
        path,
      ),
      `Unexpected packed file: ${path}`,
    );
    assert(
      !/(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|node_modules\/|tests?\/)|\.(?:pem|key|tgz)$/.test(
        path,
      ),
      `Private/development file packed: ${path}`,
    );
    assert(!/\.(?:test|spec)\./.test(path), `Test artifact packed: ${path}`);
    const content = readFileSync(join(root, path), "utf8");
    assert(
      !credentialPatterns.some((pattern) => pattern.test(content)),
      `Credential-shaped content in ${path}; matched value withheld`,
    );
  }
  // React/Next entries must stay client modules for the Next.js App Router.
  for (const entry of ["dist/react.mjs", "dist/next.mjs", "dist/react.cjs", "dist/next.cjs"]) {
    assert(
      readFileSync(join(root, entry), "utf8").startsWith("'use client';"),
      `${entry} must start with 'use client'`,
    );
  }
  // The script-tag build has no module imports; its plugins are separate files loaded with
  // Subresource Integrity. Every built-in plugin has a file, and the hash built into
  // analytics.js matches the packed file exactly.
  const script = readFileSync(join(root, "dist/analytics.js"), "utf8");
  assert(!/\bimport\s*\(|\brequire\(/.test(script), "dist/analytics.js must be self-contained");
  const builtIns = [
    ...readFileSync("src/plugins/loader-types.ts", "utf8")
      .match(/BUILT_IN_PLUGINS = \[([^\]]*)\]/)[1]
      .matchAll(/'([A-Za-z]+)'/g),
  ].map((match) => match[1]);
  assert(builtIns.length >= 10, "could not read BUILT_IN_PLUGINS");
  for (const name of builtIns) {
    const entry = script.match(new RegExp(`${name}:\\["([^"]+)","(sha384-[^"]+)"\\]`));
    assert(entry, `dist/analytics.js has no plugin file for ${name}`);
    const [, fileName, integrity] = entry;
    const path = `dist/script-plugins/${fileName}`;
    assert(paths.has(path), `Missing packed plugin file: ${path}`);
    const digest = createHash("sha384").update(readFileSync(join(root, path))).digest("base64");
    assert.equal(`sha384-${digest}`, integrity, `Integrity mismatch for ${path}`);
  }
  // Exercise the actual extracted tarball, not the development source tree.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const root = process.argv[1];
    const manifest = JSON.parse((await import('node:fs')).readFileSync(root + '/package.json', 'utf8'));
    const esm = await import(pathToFileURL(root + '/' + manifest.module));
    const cjs = createRequire(import.meta.url)(root + '/' + manifest.main);
    const symbol = 'createAnalytics';
    assert.equal(typeof esm[symbol], 'function');
    assert.equal(typeof cjs[symbol], 'function');
    // Built-in plugins are a separate entry and lazily loaded chunks.
    const pluginsEntry = manifest.exports['./plugins'];
    const esmPlugins = await import(pathToFileURL(root + '/' + pluginsEntry.import.replace('./', '')));
    const cjsPlugins = createRequire(import.meta.url)(root + '/' + pluginsEntry.require.replace('./', ''));
    for (const factory of ['googleAnalytics', 'microsoftUet', 'openAIAds', 'clearIdeasChat',
      'hubspot', 'intercom', 'metaPixel', 'linkedInInsight', 'microsoftClarity', 'hotjar']) {
      assert.equal(typeof esmPlugins[factory], 'function', factory);
      assert.equal(typeof cjsPlugins[factory], 'function', factory);
    }
    const browser = await import(pathToFileURL(root + '/dist/browser.mjs'));
    assert.equal(typeof browser.initBrowserAnalytics, 'function');
  `,
      root,
    ],
    { stdio: "pipe" },
  );
  console.log(
    `${manifest.name}: checked ${paths.size} packed files, license, exports, credentials, ESM import, and CommonJS require.`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
