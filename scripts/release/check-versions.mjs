#!/usr/bin/env node
// Fail unless every publishable package (and the root) has the version named by the git tag.
import { normalizeVersion, publishablePackages, readManifest, SEMVER } from "./packages.mjs";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: check-versions.mjs <tag-or-version>   e.g. v0.1.1");
  process.exit(2);
}
const expected = normalizeVersion(arg);
if (!SEMVER.test(expected)) {
  console.error(`✖ "${arg}" is not a valid semver tag (expected vMAJOR.MINOR.PATCH[-prerelease])`);
  process.exit(1);
}
let ok = true;
const root = readManifest(".");
if (root.manifest.version !== expected) {
  console.error(`✖ root package.json version ${root.manifest.version} != ${expected}`);
  ok = false;
}
for (const { manifest, dir } of publishablePackages()) {
  if (manifest.version !== expected) {
    console.error(`✖ ${manifest.name} (${dir}) version ${manifest.version} != tag ${expected}`);
    ok = false;
  } else {
    console.log(`✓ ${manifest.name}@${manifest.version}`);
  }
}
if (!ok) {
  console.error("\nVersion mismatch. Bump with `pnpm release:version <version>` and re-tag.");
  process.exit(1);
}
console.log(`\nAll packages are at ${expected}.`);
