#!/usr/bin/env node
// Sync plugins/claude-code from the monorepo root into this package before npm pack/publish
// so the published tarball ships the Claude Code marketplace alongside the MCP server.
// _marketplacePath() in src/cli/setup.js picks up <package>/plugins/claude-code automatically.
"use strict";

const fs = require("fs");
const path = require("path");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SOURCE = path.resolve(PACKAGE_ROOT, "../../plugins/claude-code");
const DEST = path.resolve(PACKAGE_ROOT, "plugins/claude-code");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(SOURCE)) {
  process.stderr.write(`sync-plugins: source not found at ${SOURCE}; skipping. The published package will not include the Claude Code marketplace.\n`);
  process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
copyRecursive(SOURCE, DEST);
process.stdout.write(`sync-plugins: copied ${SOURCE} -> ${DEST}\n`);
