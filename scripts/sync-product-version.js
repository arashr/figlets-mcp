#!/usr/bin/env node
"use strict";

const {
  PRODUCT_VERSION_SOURCE,
  assertProductVersionAlignment,
  bumpVersion,
  collectProductVersionDrift,
  parseSemver,
  readProductVersion,
  syncProductVersion,
} = require("./lib/product-version.js");

function usage() {
  process.stdout.write([
    "Usage:",
    "  npm run release:prepare -- 1.0.0",
    "  npm run release:prepare -- --patch|--minor|--major",
    "  npm run release:prepare -- --check",
    "",
    `Single source of truth: ${PRODUCT_VERSION_SOURCE}`,
    "",
  ].join("\n"));
}

function resolveTargetVersion(args) {
  const flags = new Set(args.filter(arg => arg.startsWith("--")));
  const positional = args.filter(arg => !arg.startsWith("--"));

  if (flags.has("--check")) {
    const bumpKinds = ["patch", "minor", "major"].filter(kind => flags.has(`--${kind}`));
    if (bumpKinds.length > 0 || positional.length > 0) {
      throw new Error("--check cannot be combined with a version or bump flag.");
    }
    return { mode: "check" };
  }

  if (positional.length > 1) {
    throw new Error("Pass one exact version or one bump flag.");
  }

  if (positional.length === 1) {
    parseSemver(positional[0]);
    return { mode: "sync", version: positional[0] };
  }

  const bumpKinds = ["patch", "minor", "major"].filter(kind => flags.has(`--${kind}`));
  if (bumpKinds.length === 1) {
    const current = readProductVersion();
    return { mode: "sync", version: bumpVersion(current, bumpKinds[0]), from: current, bump: bumpKinds[0] };
  }
  if (bumpKinds.length > 1) {
    throw new Error("Choose only one of --patch, --minor, or --major.");
  }

  throw new Error("Pass an exact version, a bump flag, or --check.");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  let target;
  try {
    target = resolveTargetVersion(args);
  } catch (err) {
    usage();
    throw err;
  }

  if (target.mode === "check") {
    const drift = collectProductVersionDrift();
    if (drift.mismatches.length) {
      process.stderr.write([
        "Product version check FAILED",
        `  Source of truth: ${PRODUCT_VERSION_SOURCE} (${drift.version})`,
        ...drift.mismatches.map(item => `  - ${item}`),
        "",
        `Run npm run release:prepare -- ${drift.version} (or --patch/--minor/--major) to sync.`,
        "",
      ].join("\n"));
      process.exit(1);
    }
    process.stdout.write([
      "",
      "Product version check: OK",
      `  Source of truth: ${PRODUCT_VERSION_SOURCE}`,
      `  Product version: ${drift.version}`,
      `  Tarball URL: ${drift.expectedUrl}`,
      "",
    ].join("\n"));
    return;
  }

  const result = syncProductVersion(target.version);
  assertProductVersionAlignment();

  if (result.changed.length === 0) {
    process.stdout.write([
      "",
      "Product version already aligned",
      `  Product version: ${result.version}`,
      "",
    ].join("\n"));
    return;
  }

  const lines = [
    "",
    "Product version sync: OK",
    `  Source of truth: ${PRODUCT_VERSION_SOURCE}`,
  ];
  if (target.from && target.bump) {
    lines.push(`  Bumped: ${target.from} -> ${result.version} (${target.bump})`);
  } else {
    lines.push(`  Set version: ${result.version}`);
  }
  lines.push(`  Updated: ${result.changed.join(", ")}`);
  lines.push(
    "",
    "Next:",
    "  npm run build:server-tarball",
    "  npm run verify:release",
    "  npm run smoke:plugins",
    ""
  );
  process.stdout.write(lines.join("\n"));
}

main();
