#!/usr/bin/env node
// Set the same version on the root and every workspace package, commit and tag.
//   pnpm release:version patch|minor|major|1.2.3 [--no-git]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { normalizeVersion, PACKAGE_DIRS, readManifest, SEMVER } from "./packages.mjs";

const [, , bump, ...flags] = process.argv;
if (!bump) {
  console.error("usage: set-version.mjs <patch|minor|major|x.y.z> [--no-git]");
  process.exit(2);
}
const root = readManifest(".");
const current = root.manifest.version;
let next;
if (["patch", "minor", "major"].includes(bump)) {
  const [maj, min, pat] = current.split("-")[0].split(".").map(Number);
  next =
    bump === "major"
      ? `${maj + 1}.0.0`
      : bump === "minor"
        ? `${maj}.${min + 1}.0`
        : `${maj}.${min}.${pat + 1}`;
} else {
  next = normalizeVersion(bump);
}
if (!SEMVER.test(next)) {
  console.error(`✖ invalid version "${next}"`);
  process.exit(1);
}
if (!flags.includes("--no-git")) {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status) {
    console.error("✖ working tree is not clean; commit or stash first.");
    process.exit(1);
  }
}
const files = [];
for (const dir of [".", ...PACKAGE_DIRS]) {
  const { path, manifest } = readManifest(dir);
  manifest.version = next;
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  files.push(path);
  console.log(`✓ ${manifest.name} ${current} → ${next}`);
}
if (!flags.includes("--no-git")) {
  execFileSync("git", ["add", ...files, "pnpm-lock.yaml"], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(release): v${next}`], { stdio: "inherit" });
  execFileSync("git", ["tag", "-a", `v${next}`, "-m", `v${next}`], { stdio: "inherit" });
  console.log(`\nTagged v${next}. Push with:\n  git push origin main --follow-tags`);
}
