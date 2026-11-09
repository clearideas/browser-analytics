import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = process.env.RELEASE_TAG;
assert(
  tag && tag === `v${version}`,
  "Release tag must exactly match v + package.json version; update package.json and package-lock.json before tagging.",
);
console.log(`Release tag matches package version ${version}.`);
