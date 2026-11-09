import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  if (manifest.name === "@clearideas/chat") {
    assert(
      paths.has("dist/THIRD_PARTY_NOTICES.txt"),
      "Bundled third-party notices are missing",
    );
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
    const symbol = manifest.name.endsWith('/analytics') ? 'createAnalytics' : 'init';
    assert.equal(typeof esm[symbol], 'function');
    assert.equal(typeof cjs[symbol], 'function');
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
