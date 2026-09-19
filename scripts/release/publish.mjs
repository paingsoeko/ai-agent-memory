#!/usr/bin/env node
// Pack each workspace package with pnpm (rewrites workspace:^ to real versions) and publish the
// tarball with npm using Trusted Publishing (OIDC). Skips versions already on the registry.
// Never prints or handles tokens: authentication is done by npm from the GitHub OIDC token.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { publishablePackages, ROOT } from "./packages.mjs";

const dryRun = process.argv.includes("--dry-run");
const artifacts = join(ROOT, "artifacts");
mkdirSync(artifacts, { recursive: true });

function versionExists(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    if (/E404|404 Not Found|No match found/.test(r.stderr + r.stdout)) return false;
    throw new Error(`npm view failed for ${name}@${version}: ${r.stderr.trim()}`);
  }
  const out = r.stdout.trim();
  return out !== "" && out !== "[]";
}

const published = [];
const skipped = [];
for (const { manifest, dir } of publishablePackages()) {
  const { name, version } = manifest;
  if (versionExists(name, version)) {
    console.log(`↷ ${name}@${version} already exists on npm — skipping`);
    skipped.push(name);
    continue;
  }
  console.log(`▶ packing ${name}@${version}`);
  execFileSync("pnpm", ["pack", "--pack-destination", artifacts], {
    cwd: join(ROOT, dir),
    stdio: "inherit",
  });
  const tarball = readdirSync(artifacts).find(
    (f) => f === `${name.replace("@", "").replace("/", "-")}-${version}.tgz`,
  );
  if (!tarball) throw new Error(`tarball for ${name}@${version} not found in ${artifacts}`);
  const distTag = version.includes("-") ? "next" : "latest";
  const args = ["publish", join(artifacts, tarball), "--access", "public", "--tag", distTag];
  if (process.env.GITHUB_ACTIONS === "true") args.push("--provenance");
  if (dryRun) args.push("--dry-run");
  console.log(`▶ npm ${args.join(" ")}`);
  execFileSync("npm", args, { cwd: ROOT, stdio: "inherit" });
  published.push(`${name}@${version}`);
}

console.log(
  `\n${dryRun ? "Dry-run complete" : "Published"}: ${published.length} package(s)${skipped.length ? `, skipped ${skipped.length} already-published` : ""}.`,
);
if (published.length === 0 && skipped.length > 0) {
  console.error(
    "✖ Every package at this version is already on npm. Nothing was published. Bump the version and tag again.",
  );
  process.exit(1);
}
